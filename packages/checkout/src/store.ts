import {
  createMemoryAnalytics,
  type Analytics,
  type AnalyticsEventType,
  type MemoryAnalytics,
} from "./analytics";
import { createAdjustableClock, type AdjustableClock } from "./clock";
import { createStubPayment, type PaymentGateway } from "./payment";
import type {
  CartItem,
  ErrorCode,
  PaymentBehaviour,
  PriceChange,
  SessionSnapshot,
  SessionStatus,
  Surface,
  Ticket,
} from "./schema";

/*
 * The checkout state machine. Pure TypeScript with an in-memory store, so it
 * runs identically in unit tests, in Next route handlers and in a scripted
 * scenario. Payment, the clock and analytics are injected.
 *
 * Statuses and transitions (see docs/checkout-continuity.md for the diagram):
 *
 *   active         -> price_changed   a quote went UP (needs acknowledgement)
 *   active         -> active          a quote went down: applied, fan notified
 *   price_changed  -> active          acknowledged, or the catalog reverted
 *   active|payment_failed -> completing   compare-and-set; one winner
 *   completing     -> completed       payment succeeded; inventory consumed
 *   completing     -> payment_failed  declined, or no answer within the timeout
 *   payment_failed -> completing      retry (with a fresh idempotency key)
 *   payment_failed -> expired         too many declines (hold released)
 *   active|price_changed|payment_failed -> expired   hold ran out / admin
 *
 * `completed` and `expired` are terminal. A hold is never extended by
 * activity, and a payment that has started is allowed to finish even if the
 * hold's deadline passes meanwhile (the stock is already ours).
 */

/** Failed payments allowed before the hold is given up. */
export const MAX_FAILED_PAYMENTS = 3;
/** Same-device returns inside this window aren't "resuming" for analytics. */
const RESUME_MIN_AGE_MS = 5000;

type AttemptResult =
  | { kind: "completed"; orderId: string }
  | { kind: "payment_failed"; reason: string };

interface Session {
  id: string;
  items: CartItem[];
  status: SessionStatus;
  version: number;
  expiresAt: number;
  createdAt: number;
  createdSurface: Surface;
  orderId?: string;
  failureReason?: string;
  /** Definitive results by idempotency key: a retry replays, never re-charges. */
  attempts: Record<string, AttemptResult>;
  inflight: Map<string, Promise<CompleteResult>>;
  completing?: { key: string; startedAt: number };
  failedPayments: number;
  /** True while the stock for `items` is subtracted from the catalog. */
  holdsInventory: boolean;
  priceDrops: PriceChange[];
  /** Analytics de-duplication: each (surface, thing) is reported once. */
  seen: Set<string>;
}

export interface Failure {
  ok: false;
  code: ErrorCode;
  message: string;
  /** Present whenever the session exists, so a client can just re-render. */
  snapshot?: SessionSnapshot;
  replayed?: boolean;
}
export type Result<T = object> =
  ({ ok: true; snapshot: SessionSnapshot } & T) | Failure;
export type CompleteResult = Result<{ orderId: string; replayed: boolean }>;

export interface ViewOptions {
  /** Who is looking. Without it the read is invisible to analytics. */
  surface?: Surface;
  /** A page load / deep link open, as opposed to a background refetch. */
  resume?: boolean;
}

export interface StoreOptions {
  clock?: AdjustableClock;
  /** How long a hold lasts. */
  ttlMs?: number;
  /** After this long `completing` is presumed crashed and becomes payment_failed. */
  completingTimeoutMs?: number;
  payment?: PaymentGateway;
  analytics?: MemoryAnalytics;
  tickets?: Ticket[];
}

export type CheckoutStore = ReturnType<typeof createCheckoutStore>;

export const DEFAULT_HOLD_TTL_MS = 10_000;
export const DEFAULT_COMPLETING_TIMEOUT_MS = 15_000;

const OPEN: SessionStatus[] = ["active", "price_changed", "payment_failed"];

export function createCheckoutStore(options: StoreOptions = {}) {
  const clock = options.clock ?? createAdjustableClock();
  const payment = options.payment ?? createStubPayment().gateway;
  const analytics: MemoryAnalytics =
    options.analytics ?? createMemoryAnalytics();
  const initialTickets = options.tickets ?? [];
  let ttlMs = options.ttlMs ?? DEFAULT_HOLD_TTL_MS;
  const completingTimeoutMs =
    options.completingTimeoutMs ?? DEFAULT_COMPLETING_TIMEOUT_MS;

  const tickets = new Map<string, Ticket>();
  const sessions = new Map<string, Session>();
  const listeners = new Set<() => void>();

  const seed = () => {
    tickets.clear();
    for (const t of initialTickets) tickets.set(t.id, { ...t });
  };
  seed();

  // ---- helpers -------------------------------------------------------------

  const emit = () => listeners.forEach((listener) => listener());

  function track(
    type: AnalyticsEventType,
    s: Session,
    data: Record<string, unknown> = {},
    surface?: Surface,
  ) {
    (analytics as Analytics).track({
      at: clock.now(),
      type,
      sessionId: s.id,
      surface,
      data,
    });
  }

  function bump(s: Session) {
    s.version += 1;
  }

  function releaseHold(s: Session) {
    if (!s.holdsInventory) return;
    s.holdsInventory = false;
    for (const item of s.items) {
      const ticket = tickets.get(item.ticketId);
      if (ticket) ticket.available += 1;
    }
  }

  function expire(s: Session, reason: string) {
    s.status = "expired";
    s.failureReason = reason;
    s.completing = undefined;
    releaseHold(s);
    bump(s);
  }

  /** Items whose quote no longer matches the live catalog. */
  function mismatches(s: Session): PriceChange[] {
    const out: PriceChange[] = [];
    for (const item of s.items) {
      const current = tickets.get(item.ticketId)?.priceCents;
      if (current !== undefined && current !== item.quotedPriceCents) {
        out.push({
          ticketId: item.ticketId,
          eventName: item.eventName,
          quotedPriceCents: item.quotedPriceCents,
          currentPriceCents: current,
        });
      }
    }
    return out;
  }

  const requote = (s: Session, changes: PriceChange[]) => {
    for (const change of changes) {
      for (const item of s.items) {
        if (item.ticketId === change.ticketId) {
          item.quotedPriceCents = change.currentPriceCents;
        }
      }
    }
  };

  /**
   * Brings a session up to date with the clock and the catalog. Called on
   * every read and write, which is what makes expiry "lazy": nothing runs on
   * a timer, the next look at a session settles what happened to it.
   * Returns whether anything changed.
   */
  function refresh(s: Session): boolean {
    const before = s.version;
    const now = clock.now();

    if (
      s.status === "completing" &&
      s.completing &&
      now - s.completing.startedAt >= completingTimeoutMs
    ) {
      // The attempt crashed or hung. Its outcome is unknown, so the fan may
      // retry; if the old attempt answers later it is refunded (see below).
      s.completing = undefined;
      s.failedPayments += 1;
      s.status = "payment_failed";
      s.failureReason = "payment_timeout";
      bump(s);
      track("completion_failed", s, { reason: "payment_timeout" });
    }

    if (OPEN.includes(s.status) && now >= s.expiresAt) {
      expire(s, "hold_expired");
    }

    if (
      s.status === "active" ||
      s.status === "price_changed" ||
      s.status === "payment_failed"
    ) {
      const changes = mismatches(s);
      if (changes.length === 0) {
        if (s.status === "price_changed") {
          s.status = "active"; // the catalog went back to what was quoted
          bump(s);
        }
      } else if (
        changes.some((c) => c.currentPriceCents > c.quotedPriceCents)
      ) {
        if (s.status !== "price_changed") {
          s.status = "price_changed";
          bump(s);
        }
      } else if (s.status !== "price_changed") {
        // Only decreases: take the lower price now and tell the fan.
        requote(s, changes);
        s.priceDrops = [...s.priceDrops, ...changes];
        bump(s);
      }
    }
    return s.version !== before;
  }

  function snapshot(s: Session): SessionSnapshot {
    return {
      id: s.id,
      items: s.items.map((item) => ({ ...item })),
      status: s.status,
      version: s.version,
      expiresAt: s.expiresAt,
      serverNow: clock.now(),
      totalCents: s.items.reduce((sum, i) => sum + i.quotedPriceCents, 0),
      priceChanges: s.status === "price_changed" ? mismatches(s) : [],
      priceDrops: s.priceDrops,
      ...(s.orderId ? { orderId: s.orderId } : {}),
      ...(s.failureReason ? { failureReason: s.failureReason } : {}),
    };
  }

  const fail = (
    code: ErrorCode,
    message: string,
    s?: Session,
    extra: Partial<Failure> = {},
  ): Failure => ({
    ok: false,
    code,
    message,
    ...(s ? { snapshot: snapshot(s) } : {}),
    ...extra,
  });

  /** Reports what a surface saw, once per distinct thing. */
  function noteView(s: Session, view: ViewOptions) {
    const { surface } = view;
    if (!surface) return;
    const once = (key: string) => {
      if (s.seen.has(key)) return false;
      s.seen.add(key);
      return true;
    };
    if (view.resume) {
      const crossDevice = surface !== s.createdSurface;
      const ageMs = clock.now() - s.createdAt;
      if (
        (crossDevice || ageMs > RESUME_MIN_AGE_MS) &&
        once(`resumed:${surface}`)
      ) {
        track(
          "session_resumed",
          s,
          { cross_device: crossDevice, age_ms: ageMs },
          surface,
        );
      }
    }
    if (s.status === "expired" && once(`expired:${surface}`)) {
      track("expired_seen", s, { reason: s.failureReason }, surface);
    }
    if (s.status === "price_changed") {
      const changes = mismatches(s);
      const fingerprint = changes
        .map((c) => `${c.ticketId}:${c.currentPriceCents}`)
        .join(",");
      if (once(`price:${surface}:${fingerprint}`)) {
        track("price_change_shown", s, { changes }, surface);
      }
    }
  }

  /** Expires every overdue hold, returning its stock. */
  function sweep() {
    let changed = false;
    for (const s of sessions.values()) changed = refresh(s) || changed;
    if (changed) emit();
  }

  function lookup(id: string): Session | undefined {
    const s = sessions.get(id);
    if (s && refresh(s)) emit();
    return s;
  }

  // ---- public API ----------------------------------------------------------

  const store = {
    clock,
    analytics,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },

    // -- reading the catalog (settles overdue holds first)

    listTickets(): Ticket[] {
      sweep();
      return [...tickets.values()].map((t) => ({ ...t }));
    },

    getTicket(id: string): Ticket | undefined {
      sweep();
      const t = tickets.get(id);
      return t && { ...t };
    },

    // -- sessions

    createSession(input: { ticketIds: string[]; surface: Surface }): Result {
      sweep();
      const wanted = new Map<string, number>();
      for (const id of input.ticketIds) {
        wanted.set(id, (wanted.get(id) ?? 0) + 1);
      }
      for (const [id, count] of wanted) {
        const ticket = tickets.get(id);
        if (!ticket) return fail("ticket_not_found", `No ticket ${id}.`);
        if (ticket.available < count) {
          return fail("sold_out", `${ticket.eventName} is sold out.`);
        }
      }
      const now = clock.now();
      const s: Session = {
        id: `cs_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`,
        items: input.ticketIds.map((id) => {
          const t = tickets.get(id)!;
          t.available -= 1;
          return {
            ticketId: t.id,
            eventName: t.eventName,
            quotedPriceCents: t.priceCents,
          };
        }),
        status: "active",
        version: 1,
        expiresAt: now + ttlMs,
        createdAt: now,
        createdSurface: input.surface,
        attempts: {},
        inflight: new Map(),
        failedPayments: 0,
        holdsInventory: true,
        priceDrops: [],
        seen: new Set([`created:${input.surface}`]),
      };
      sessions.set(s.id, s);
      track("session_created", s, { ttl_ms: ttlMs }, input.surface);
      emit();
      return { ok: true, snapshot: snapshot(s) };
    },

    getSession(id: string, view: ViewOptions = {}): Result {
      const s = lookup(id);
      if (!s) return fail("not_found", "No such checkout session.");
      noteView(s, view);
      return { ok: true, snapshot: snapshot(s) };
    },

    acknowledgePrice(id: string, version: number, surface?: Surface): Result {
      const s = lookup(id);
      if (!s) return fail("not_found", "No such checkout session.");
      if (version !== s.version) {
        return fail("version_conflict", "The session changed.", s);
      }
      if (s.status === "expired") {
        return fail("session_expired", "This hold has expired.", s);
      }
      if (s.status !== "price_changed") {
        return fail("nothing_to_acknowledge", "No price change to accept.", s);
      }
      const changes = mismatches(s);
      requote(s, changes);
      s.status = "active";
      s.failureReason = undefined;
      bump(s);
      track("price_change_accepted", s, { changes }, surface);
      emit();
      return { ok: true, snapshot: snapshot(s) };
    },

    /**
     * Pays for the session. Two separate guards, doing different jobs:
     *  - the idempotency key makes a retry of the SAME press harmless
     *    (network blip, double tap): it replays the stored result;
     *  - the status compare-and-set makes two DIFFERENT presses (two devices)
     *    exclusive: whoever flips active -> completing first wins and the
     *    other gets a conflict. There is no `await` between check and set.
     */
    async complete(
      id: string,
      request: {
        version: number;
        idempotencyKey: string;
        payment?: PaymentBehaviour;
        surface?: Surface;
      },
    ): Promise<CompleteResult> {
      const s = lookup(id);
      if (!s) return fail("not_found", "No such checkout session.");
      const key = request.idempotencyKey;

      const prior = s.attempts[key];
      if (prior) {
        track(
          "duplicate_blocked",
          s,
          { reason: "replayed_key" },
          request.surface,
        );
        return prior.kind === "completed"
          ? {
              ok: true,
              replayed: true,
              orderId: prior.orderId,
              snapshot: snapshot(s),
            }
          : fail("payment_failed", prior.reason, s, { replayed: true });
      }
      const running = s.inflight.get(key);
      if (running) {
        track(
          "duplicate_blocked",
          s,
          { reason: "same_key_in_flight" },
          request.surface,
        );
        return running;
      }

      // Say *why* first when the answer doesn't depend on what the client saw.
      switch (s.status) {
        case "completed":
          track(
            "duplicate_blocked",
            s,
            { reason: "already_completed" },
            request.surface,
          );
          return fail("already_completed", "This order is already paid.", s);
        case "completing":
          track(
            "duplicate_blocked",
            s,
            { reason: "payment_in_progress" },
            request.surface,
          );
          return fail(
            "payment_in_progress",
            "A payment is already in progress.",
            s,
          );
        case "expired":
          return fail("session_expired", "This hold has expired.", s);
        default:
          break;
      }
      if (request.version !== s.version) {
        return fail("version_conflict", "The session changed.", s);
      }
      if (s.status === "price_changed") {
        return fail(
          "price_not_acknowledged",
          "A price changed. Review it before paying.",
          s,
        );
      }

      // Compare-and-set. Everything above and below is synchronous.
      s.status = "completing";
      s.completing = { key, startedAt: clock.now() };
      s.failureReason = undefined;
      bump(s);
      track(
        "completion_attempted",
        s,
        { payment: request.payment ?? "success" },
        request.surface,
      );
      emit();

      const run = runPayment(s, request);
      s.inflight.set(key, run);
      try {
        return await run;
      } finally {
        s.inflight.delete(key);
      }
    },

    // -- admin / test hooks

    setPrice(ticketId: string, priceCents: number): Ticket | undefined {
      const t = tickets.get(ticketId);
      if (!t) return undefined;
      t.priceCents = priceCents;
      emit();
      return { ...t };
    },

    setAvailability(ticketId: string, available: number): Ticket | undefined {
      const t = tickets.get(ticketId);
      if (!t) return undefined;
      t.available = available;
      emit();
      return { ...t };
    },

    addTicket(ticket: Omit<Ticket, "id"> & { id?: string }): Ticket {
      const id = ticket.id ?? `t_${crypto.randomUUID().slice(0, 8)}`;
      const t = { ...ticket, id };
      tickets.set(id, t);
      emit();
      return { ...t };
    },

    /** Ends a hold right now, as if its deadline had just passed. */
    expireNow(id: string): Result {
      const s = sessions.get(id);
      if (!s) return fail("not_found", "No such checkout session.");
      if (OPEN.includes(s.status)) s.expiresAt = clock.now();
      refresh(s);
      emit();
      return { ok: true, snapshot: snapshot(s) };
    },

    advanceClock(ms: number) {
      clock.advance(ms);
      sweep();
      emit();
    },

    getTtlMs: () => ttlMs,
    /** Applies to sessions created from now on; existing holds keep theirs. */
    setTtlMs(next: number) {
      ttlMs = next;
    },
    completingTimeoutMs,

    listSessions: (): SessionSnapshot[] => {
      sweep();
      return [...sessions.values()].map(snapshot);
    },

    events: (filter?: Parameters<MemoryAnalytics["list"]>[0]) =>
      analytics.list(filter),

    reset() {
      sessions.clear();
      seed();
      analytics.clear();
      clock.reset();
      ttlMs = options.ttlMs ?? DEFAULT_HOLD_TTL_MS;
      emit();
    },
  };

  // ---- completion internals ------------------------------------------------

  async function runPayment(
    s: Session,
    request: {
      idempotencyKey: string;
      payment?: PaymentBehaviour;
      surface?: Surface;
    },
  ): Promise<CompleteResult> {
    const key = request.idempotencyKey;
    const amountCents = s.items.reduce((sum, i) => sum + i.quotedPriceCents, 0);

    let charge: Awaited<ReturnType<PaymentGateway["charge"]>>;
    try {
      charge = await payment.charge({
        sessionId: s.id,
        amountCents,
        idempotencyKey: key,
        behaviour: request.payment ?? "success",
      });
    } catch {
      charge = { ok: false, reason: "payment_error" };
    }

    // Is this attempt still the one that owns the session? It isn't if the
    // completing timeout fired (or an admin expired it) while we waited.
    const stillOurs = s.status === "completing" && s.completing?.key === key;

    if (charge.ok && !stillOurs) {
      await payment.refund(charge.chargeId);
      s.attempts[key] = { kind: "payment_failed", reason: "payment_timeout" };
      track(
        "completion_failed",
        s,
        { reason: "late_success_refunded" },
        request.surface,
      );
      emit();
      return fail("payment_failed", "payment_timeout", s);
    }

    if (charge.ok) {
      const orderId = `ord_${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`;
      s.status = "completed";
      s.orderId = orderId;
      s.completing = undefined;
      s.holdsInventory = false; // consumed, not returned
      s.attempts[key] = { kind: "completed", orderId };
      bump(s);
      track("completion_succeeded", s, { order_id: orderId }, request.surface);
      emit();
      return { ok: true, replayed: false, orderId, snapshot: snapshot(s) };
    }

    s.attempts[key] = { kind: "payment_failed", reason: charge.reason };
    if (stillOurs) {
      s.completing = undefined;
      s.failedPayments += 1;
      if (s.failedPayments >= MAX_FAILED_PAYMENTS) {
        expire(s, "too_many_payment_failures");
      } else {
        s.status = "payment_failed";
        s.failureReason = charge.reason;
        bump(s);
      }
    }
    track("completion_failed", s, { reason: charge.reason }, request.surface);
    emit();
    return fail("payment_failed", charge.reason, s);
  }

  return store;
}
