import { describe, expect, it } from "vitest";
import { createMemoryAnalytics } from "./analytics";
import { createAdjustableClock } from "./clock";
import { createStubPayment, type PaymentGateway } from "./payment";
import {
  createCheckoutStore,
  MAX_FAILED_PAYMENTS,
  type CheckoutStore,
} from "./store";
import type { SessionSnapshot } from "./schema";

const TTL = 10_000;

function setup(
  options: { payment?: PaymentGateway; completingTimeoutMs?: number } = {},
) {
  const clock = createAdjustableClock(() => 1_000_000);
  const analytics = createMemoryAnalytics();
  const stub = createStubPayment({ slowMs: 50 });
  const store = createCheckoutStore({
    clock,
    analytics,
    ttlMs: TTL,
    payment: options.payment ?? stub.gateway,
    completingTimeoutMs: options.completingTimeoutMs,
    tickets: [
      { id: "a", eventName: "Alpha", priceCents: 8500, available: 3 },
      { id: "b", eventName: "Beta", priceCents: 12000, available: 3 },
    ],
  });
  return { store, clock, analytics, stub };
}

function create(store: CheckoutStore, ticketIds = ["a"]): SessionSnapshot {
  const result = store.createSession({ ticketIds, surface: "web" });
  if (!result.ok) throw new Error(result.message);
  return result.snapshot;
}

function get(store: CheckoutStore, id: string): SessionSnapshot {
  const result = store.getSession(id);
  if (!result.ok) throw new Error(result.message);
  return result.snapshot;
}

let keyCounter = 0;
const pay = (
  store: CheckoutStore,
  s: SessionSnapshot,
  extra: { key?: string; payment?: "success" | "fail" | "slow_success" } = {},
) =>
  store.complete(s.id, {
    version: s.version,
    idempotencyKey: extra.key ?? `key-${++keyCounter}-aaaa`,
    payment: extra.payment,
  });

describe("creating a session", () => {
  it("snapshots the quote, starts active and holds one unit per item", () => {
    const { store, clock } = setup();
    const s = create(store, ["a", "b"]);
    expect(s).toMatchObject({
      status: "active",
      version: 1,
      totalCents: 20500,
      expiresAt: clock.now() + TTL,
      serverNow: clock.now(),
      priceChanges: [],
    });
    expect(s.items.map((i) => i.quotedPriceCents)).toEqual([8500, 12000]);
    expect(store.getTicket("a")?.available).toBe(2);
    expect(store.getTicket("b")?.available).toBe(2);
  });

  it("refuses sold-out and unknown tickets without holding anything", () => {
    const { store } = setup();
    store.setAvailability("a", 1);
    expect(
      store.createSession({ ticketIds: ["a", "a"], surface: "web" }),
    ).toMatchObject({
      ok: false,
      code: "sold_out",
    });
    expect(store.getTicket("a")?.available).toBe(1);
    expect(
      store.createSession({ ticketIds: ["zzz"], surface: "web" }),
    ).toMatchObject({
      ok: false,
      code: "ticket_not_found",
    });
  });

  it("reports unknown sessions as not found", () => {
    expect(setup().store.getSession("nope")).toMatchObject({
      ok: false,
      code: "not_found",
    });
  });
});

describe("lazy expiry and inventory", () => {
  it("expires on the first read after the deadline and returns the stock", () => {
    const { store, clock } = setup();
    const s = create(store);
    expect(store.getTicket("a")?.available).toBe(2);
    clock.advance(TTL);
    const after = get(store, s.id);
    expect(after.status).toBe("expired");
    expect(after.version).toBeGreaterThan(s.version);
    expect(store.getTicket("a")?.available).toBe(3);
  });

  it("releases an abandoned hold when someone only looks at the ticket", () => {
    const { store, clock } = setup();
    create(store);
    clock.advance(TTL + 1);
    // No one ever reads the session; the catalog read settles it.
    expect(store.getTicket("a")?.available).toBe(3);
  });

  it("does not extend a hold on activity", () => {
    const { store, clock } = setup();
    const s = create(store);
    clock.advance(TTL - 1);
    expect(get(store, s.id).expiresAt).toBe(s.expiresAt);
    clock.advance(1);
    expect(get(store, s.id).status).toBe("expired");
  });

  it("frees stock for someone else once a hold lapses", () => {
    const { store, clock } = setup();
    store.setAvailability("a", 1);
    create(store);
    expect(
      store.createSession({ ticketIds: ["a"], surface: "web" }),
    ).toMatchObject({
      code: "sold_out",
    });
    clock.advance(TTL);
    expect(store.createSession({ ticketIds: ["a"], surface: "web" }).ok).toBe(
      true,
    );
  });

  it("expires nothing twice and treats expired as terminal", async () => {
    const { store, clock } = setup();
    const s = create(store);
    clock.advance(TTL);
    const expired = get(store, s.id);
    expect(get(store, s.id).version).toBe(expired.version);
    expect(await pay(store, expired)).toMatchObject({
      ok: false,
      code: "session_expired",
    });
    expect(store.acknowledgePrice(s.id, expired.version)).toMatchObject({
      ok: false,
      code: "session_expired",
    });
    expect(store.getTicket("a")?.available).toBe(3);
  });

  it("expireNow ends a hold immediately", () => {
    const { store } = setup();
    const s = create(store);
    const result = store.expireNow(s.id);
    expect(result.ok && result.snapshot.status).toBe("expired");
    expect(store.getTicket("a")?.available).toBe(3);
  });

  it("lets a payment in progress finish after the deadline passes", async () => {
    const { store, clock } = setup();
    const s = create(store);
    const paying = pay(store, s, { payment: "slow_success" });
    clock.advance(TTL + 1);
    expect(get(store, s.id).status).toBe("completing");
    expect(await paying).toMatchObject({ ok: true });
    expect(get(store, s.id).status).toBe("completed");
  });
});

describe("price changes", () => {
  it("names the changed ticket, old and new price, and only that one", () => {
    const { store } = setup();
    const s = create(store, ["a", "b"]);
    store.setPrice("b", 13000);
    const after = get(store, s.id);
    expect(after.status).toBe("price_changed");
    expect(after.version).toBeGreaterThan(s.version);
    expect(after.priceChanges).toEqual([
      {
        ticketId: "b",
        eventName: "Beta",
        quotedPriceCents: 12000,
        currentPriceCents: 13000,
      },
    ]);
    expect(after.totalCents).toBe(20500); // still the old quote until accepted
  });

  it("blocks payment on an increase until it is acknowledged", async () => {
    const { store } = setup();
    const s = create(store);
    store.setPrice("a", 9000);
    const blocked = await pay(store, get(store, s.id));
    expect(blocked).toMatchObject({
      ok: false,
      code: "price_not_acknowledged",
    });

    const current = get(store, s.id);
    const acked = store.acknowledgePrice(s.id, current.version);
    expect(acked.ok && acked.snapshot).toMatchObject({
      status: "active",
      totalCents: 9000,
      priceChanges: [],
    });
    expect(await pay(store, get(store, s.id))).toMatchObject({ ok: true });
  });

  it("applies a decrease automatically and says so", () => {
    const { store } = setup();
    const s = create(store);
    store.setPrice("a", 8000);
    const after = get(store, s.id);
    expect(after).toMatchObject({ status: "active", totalCents: 8000 });
    expect(after.version).toBeGreaterThan(s.version);
    expect(after.priceDrops).toEqual([
      {
        ticketId: "a",
        eventName: "Alpha",
        quotedPriceCents: 8500,
        currentPriceCents: 8000,
      },
    ]);
  });

  it("asks about an increase even when another ticket went down", () => {
    const { store } = setup();
    const s = create(store, ["a", "b"]);
    store.setPrice("a", 8000);
    store.setPrice("b", 15000);
    const after = get(store, s.id);
    expect(after.status).toBe("price_changed");
    expect(after.priceChanges).toHaveLength(2);
  });

  it("returns to active if the price goes back before acknowledgement", () => {
    const { store } = setup();
    const s = create(store);
    store.setPrice("a", 9000);
    expect(get(store, s.id).status).toBe("price_changed");
    store.setPrice("a", 8500);
    expect(get(store, s.id).status).toBe("active");
  });

  it("makes a stale acknowledgement lose to a newer change", () => {
    const { store } = setup();
    const s = create(store);
    store.setPrice("a", 9000);
    const seen = get(store, s.id);
    store.setPrice("a", 9500); // changes again while the fan reads
    // Same version: the status is still price_changed, but the fan saw 9000.
    // Acknowledging accepts what is current, and says so in the snapshot.
    const acked = store.acknowledgePrice(s.id, seen.version);
    expect(acked.ok && acked.snapshot.totalCents).toBe(9500);
  });

  it("has nothing to acknowledge when the price is fine", () => {
    const { store } = setup();
    const s = create(store);
    expect(store.acknowledgePrice(s.id, s.version)).toMatchObject({
      ok: false,
      code: "nothing_to_acknowledge",
    });
  });

  it("does not move the deadline when a price is accepted", () => {
    const { store } = setup();
    const s = create(store);
    store.setPrice("a", 9000);
    const changed = get(store, s.id);
    const acked = store.acknowledgePrice(s.id, changed.version);
    expect(acked.ok && acked.snapshot.expiresAt).toBe(s.expiresAt);
  });
});

describe("version conflicts", () => {
  it("rejects a stale version with the current snapshot", async () => {
    const { store } = setup();
    const s = create(store);
    store.setPrice("a", 8000); // bumps the version on next read
    const result = await store.complete(s.id, {
      version: s.version,
      idempotencyKey: "stale-key-1",
    });
    expect(result).toMatchObject({ ok: false, code: "version_conflict" });
    expect(!result.ok && result.snapshot?.priceDrops).toHaveLength(1);
  });

  it("rejects acknowledging with a stale version", () => {
    const { store } = setup();
    const s = create(store);
    store.setPrice("a", 9000);
    expect(store.acknowledgePrice(s.id, s.version)).toMatchObject({
      ok: false,
      code: "version_conflict",
    });
  });
});

describe("completing", () => {
  it("moves active -> completing -> completed and consumes the stock", async () => {
    const { store, clock } = setup();
    const s = create(store);
    const paying = pay(store, s, { payment: "slow_success" });
    expect(get(store, s.id).status).toBe("completing");
    const result = await paying;
    expect(result.ok && result.orderId).toMatch(/^ord_/);
    expect(get(store, s.id)).toMatchObject({ status: "completed" });
    // Completion consumed the unit: expiry later must not hand it back.
    clock.advance(TTL * 10);
    expect(store.getTicket("a")?.available).toBe(2);
  });

  it("replays the stored result for a repeated key, charging once", async () => {
    const { store, stub } = setup();
    const s = create(store);
    const first = await pay(store, s, { key: "press-1-abcd" });
    const second = await store.complete(s.id, {
      version: s.version, // stale, as a retrying client's would be
      idempotencyKey: "press-1-abcd",
    });
    expect(first.ok && second.ok && second.orderId).toBe(
      first.ok && first.orderId,
    );
    expect(second.ok && second.replayed).toBe(true);
    expect(stub.refunds).toEqual([]);
  });

  it("replays a failure for a repeated key instead of retrying the card", async () => {
    const { store } = setup();
    const s = create(store);
    const first = await pay(store, s, { key: "press-1-abcd", payment: "fail" });
    expect(first).toMatchObject({ ok: false, code: "payment_failed" });
    const again = await store.complete(s.id, {
      version: s.version,
      idempotencyKey: "press-1-abcd",
      payment: "success",
    });
    expect(again).toMatchObject({
      ok: false,
      code: "payment_failed",
      replayed: true,
    });
  });

  it("gives a second key on a paid order an already_completed conflict", async () => {
    const { store, analytics } = setup();
    const s = create(store);
    await pay(store, s);
    const dup = await pay(store, get(store, s.id));
    expect(dup).toMatchObject({ ok: false, code: "already_completed" });
    expect(dup.ok === false && dup.snapshot?.status).toBe("completed");
    expect(analytics.list({ type: "duplicate_blocked" })).toHaveLength(1);
  });

  it("lets exactly one of two concurrent presses win", async () => {
    const { store } = setup();
    const s = create(store);
    const [one, two] = await Promise.all([
      pay(store, s, { key: "device-one-1", payment: "slow_success" }),
      pay(store, s, { key: "device-two-2", payment: "slow_success" }),
    ]);
    const results = [one, two];
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const loser = results.find((r) => !r.ok);
    expect(loser).toMatchObject({ code: "payment_in_progress" });
    expect(store.getTicket("a")?.available).toBe(2);
  });

  it("lets a repeated key join the attempt that is already running", async () => {
    const { store } = setup();
    const s = create(store);
    const [one, two] = await Promise.all([
      pay(store, s, { key: "same-press-1", payment: "slow_success" }),
      pay(store, s, { key: "same-press-1", payment: "slow_success" }),
    ]);
    expect(one.ok && two.ok && one.orderId).toBe(two.ok && two.orderId);
  });

  it("shows other devices a completing session and refuses them", async () => {
    const { store } = setup();
    const s = create(store);
    const paying = pay(store, s, { payment: "slow_success" });
    const seen = get(store, s.id);
    expect(seen.status).toBe("completing");
    expect(await pay(store, seen)).toMatchObject({
      code: "payment_in_progress",
    });
    await paying;
  });
});

describe("payment failure", () => {
  it("moves to payment_failed, keeps the hold and allows a retry", async () => {
    const { store } = setup();
    const s = create(store);
    const failed = await pay(store, s, { payment: "fail" });
    expect(failed).toMatchObject({ ok: false, code: "payment_failed" });
    const after = get(store, s.id);
    expect(after).toMatchObject({
      status: "payment_failed",
      failureReason: "card_declined",
    });
    expect(store.getTicket("a")?.available).toBe(2); // still held
    const retry = await pay(store, after);
    expect(retry.ok).toBe(true);
  });

  it("gives the hold up after too many declines", async () => {
    const { store } = setup();
    const s = create(store);
    for (let i = 0; i < MAX_FAILED_PAYMENTS; i++) {
      await pay(store, get(store, s.id), { payment: "fail" });
    }
    expect(get(store, s.id)).toMatchObject({
      status: "expired",
      failureReason: "too_many_payment_failures",
    });
    expect(store.getTicket("a")?.available).toBe(3);
  });

  it("treats a throwing gateway as a failure", async () => {
    const { store } = setup({
      payment: {
        charge: () => Promise.reject(new Error("boom")),
        refund: async () => {},
      },
    });
    const s = create(store);
    expect(await pay(store, s)).toMatchObject({
      ok: false,
      code: "payment_failed",
    });
    expect(get(store, s.id).status).toBe("payment_failed");
  });

  it("still asks about a price change that happened while failed", async () => {
    const { store } = setup();
    const s = create(store);
    await pay(store, s, { payment: "fail" });
    store.setPrice("a", 9000);
    expect(get(store, s.id).status).toBe("price_changed");
  });

  it("expires a failed session at its deadline", async () => {
    const { store, clock } = setup();
    const s = create(store);
    await pay(store, s, { payment: "fail" });
    clock.advance(TTL);
    expect(get(store, s.id).status).toBe("expired");
  });
});

describe("completing timeout", () => {
  function hanging() {
    const pending: Array<(ok: boolean) => void> = [];
    const refunds: string[] = [];
    const gateway: PaymentGateway = {
      charge: () =>
        new Promise((resolve) =>
          pending.push((ok) =>
            resolve(
              ok
                ? { ok: true, chargeId: "ch_late" }
                : { ok: false, reason: "declined" },
            ),
          ),
        ),
      refund: async (id) => void refunds.push(id),
    };
    return { gateway, pending, refunds };
  }

  it("unwedges a crashed attempt so the fan can try again", async () => {
    const h = hanging();
    const { store, clock } = setup({
      payment: h.gateway,
      completingTimeoutMs: 5000,
    });
    const s = create(store);
    void pay(store, s); // never settles
    clock.advance(4999);
    expect(get(store, s.id).status).toBe("completing");
    clock.advance(1);
    expect(get(store, s.id)).toMatchObject({
      status: "payment_failed",
      failureReason: "payment_timeout",
    });
  });

  it("refunds an attempt that succeeds after it was given up on", async () => {
    const h = hanging();
    const { store, clock } = setup({
      payment: h.gateway,
      completingTimeoutMs: 5000,
    });
    const s = create(store);
    const first = pay(store, s, { key: "first-press-1" });
    clock.advance(5000);
    const timedOut = get(store, s.id);
    expect(timedOut.status).toBe("payment_failed");

    const second = pay(store, timedOut, { key: "second-press-2" });
    h.pending[1](true); // the retry succeeds
    expect(await second).toMatchObject({ ok: true });

    h.pending[0](true); // ...then the original finally answers
    expect(await first).toMatchObject({ ok: false, code: "payment_failed" });
    expect(h.refunds).toEqual(["ch_late"]);
    expect(get(store, s.id).status).toBe("completed");
  });
});

describe("analytics", () => {
  it("logs the funnel, with cross-device resumes marked", async () => {
    const { store, analytics } = setup();
    const created = store.createSession({ ticketIds: ["a"], surface: "web" });
    if (!created.ok) throw new Error();
    const id = created.snapshot.id;
    store.getSession(id, { surface: "web", resume: true }); // same page, not a resume
    store.getSession(id, { surface: "app", resume: true });
    store.getSession(id, { surface: "app", resume: true }); // reported once
    store.setPrice("a", 9000);
    store.getSession(id, { surface: "app" });
    store.getSession(id, { surface: "app" });
    const seen = get(store, id);
    store.acknowledgePrice(id, seen.version, "app");
    await store.complete(id, {
      version: seen.version + 1,
      idempotencyKey: "analytics-1",
      surface: "app",
    });

    const types = analytics.list({ sessionId: id }).map((e) => e.type);
    expect(types).toEqual([
      "session_created",
      "session_resumed",
      "price_change_shown",
      "price_change_accepted",
      "completion_attempted",
      "completion_succeeded",
    ]);
    expect(analytics.list({ type: "session_resumed" })[0]).toMatchObject({
      surface: "app",
      data: { cross_device: true, age_ms: 0 },
    });
  });

  it("records expiry as seen once per surface", () => {
    const { store, clock, analytics } = setup();
    const s = create(store);
    clock.advance(TTL);
    store.getSession(s.id, { surface: "web" });
    store.getSession(s.id, { surface: "web" });
    store.getSession(s.id, { surface: "app" });
    expect(analytics.list({ type: "expired_seen" })).toHaveLength(2);
  });
});

describe("subscriptions and reset", () => {
  it("notifies subscribers on state changes", () => {
    const { store } = setup();
    let calls = 0;
    const off = store.subscribe(() => calls++);
    create(store);
    expect(calls).toBeGreaterThan(0);
    off();
    const before = calls;
    create(store);
    expect(calls).toBe(before);
  });

  it("reset restores the catalog and forgets sessions", () => {
    const { store, clock } = setup();
    const s = create(store);
    store.setPrice("a", 1);
    clock.advance(5);
    store.reset();
    expect(store.getSession(s.id)).toMatchObject({ ok: false });
    expect(store.getTicket("a")).toMatchObject({
      priceCents: 8500,
      available: 3,
    });
    expect(clock.offsetMs()).toBe(0);
  });
});
