"use client";

import {
  PAY_CUTOFF_MS,
  createCheckoutClient,
  formatCents,
  formatRemaining,
  newIdempotencyKey,
  remainingMs,
  sessionSnapshotSchema,
  type ClockAnchor,
  type PaymentBehaviour,
  type SessionSnapshot,
  type Surface,
} from "@continuity/checkout";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { startCheckout } from "@/app/checkout/actions";

const OPEN = ["active", "price_changed", "payment_failed"];

const EXPIRY_TEXT: Record<string, string> = {
  hold_expired: "Your hold ended and the tickets were released.",
  admin_expired: "Your hold was ended early and the tickets were released.",
  too_many_payment_failures:
    "Too many payments were declined, so the tickets were released.",
};

const PROBLEM_TEXT: Record<string, string> = {
  version_conflict:
    "This checkout changed while you were looking at it. Check it over, then try again.",
  payment_in_progress: "A payment is already in progress for this checkout.",
  already_completed: "This order has already been paid.",
  session_expired: "The hold expired before the payment started.",
  price_not_acknowledged: "A price changed. Review it before paying.",
  payment_failed:
    "The payment was declined. Your hold is still active; try again.",
  network_error:
    "Can't reach the server. Nothing was charged. Tap again to retry: it's the same payment request, so you can't be charged twice.",
};

const noopSubscribe = () => () => {};
/** False while rendering on the server and during hydration, true after. */
const useHydrated = () =>
  useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );

const tone = {
  info: "border-border bg-accent-soft",
  warn: "border-warn bg-warn-soft",
  danger: "border-danger bg-danger-soft",
  ok: "border-accent bg-accent-soft",
} as const;

/**
 * The live checkout. Rendered to HTML on the server like any component, so
 * the item, prices, status banners and remaining time are in the first
 * paint; the Pay buttons stay disabled until hydration makes them work.
 * After mount it refetches (to anchor the countdown on the server's clock),
 * subscribes to server-sent events, and refetches when the tab returns.
 */
export function CheckoutLive({
  initial,
  surface,
}: {
  initial: SessionSnapshot;
  surface: Surface;
}) {
  const id = initial.id;
  const client = useMemo(() => createCheckoutClient(), []);
  const hydrated = useHydrated();

  const [snapshot, setSnapshot] = useState(initial);
  const [anchor, setAnchor] = useState<ClockAnchor | null>(null);
  const [perf, setPerf] = useState(0);
  const [pending, setPending] = useState<PaymentBehaviour | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const version = useRef(initial.version);
  /** One key per Pay press; kept across network retries, dropped on any answer. */
  const payKey = useRef<string | null>(null);

  const apply = useCallback(
    (next?: SessionSnapshot, nextAnchor?: ClockAnchor) => {
      if (nextAnchor) {
        setAnchor(nextAnchor);
        setPerf(performance.now());
      }
      // Responses can arrive out of order (SSE vs fetch); never go backwards.
      if (next && next.version >= version.current) {
        version.current = next.version;
        setSnapshot(next);
      }
    },
    [],
  );

  const refresh = useCallback(() => {
    void client
      .getSession(id, surface)
      .then((result) => apply(result.snapshot, result.anchor));
  }, [apply, client, id, surface]);

  // After mount: get a properly anchored snapshot (the server-rendered one
  // is a few hundred ms old and has no anchor), then keep time locally.
  useEffect(() => {
    refresh();
    const tick = setInterval(() => setPerf(performance.now()), 250);
    return () => clearInterval(tick);
  }, [refresh]);

  // Live updates from other devices. Opened after mount, never during SSR.
  useEffect(() => {
    const source = new EventSource(
      `/api/sessions/${encodeURIComponent(id)}/events`,
    );
    source.onmessage = (event) => {
      try {
        const parsed = sessionSnapshotSchema.safeParse(JSON.parse(event.data));
        if (parsed.success) apply(parsed.data);
      } catch {}
    };
    return () => source.close();
  }, [apply, id]);

  // Coming back to the tab (or the phone waking up): the world may have moved.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onVisible);
    };
  }, [refresh]);

  const isOpen = OPEN.includes(snapshot.status);
  // Until anchored, show what the server rendered (matches the HTML).
  const remaining = anchor
    ? remainingMs(snapshot.expiresAt, anchor, perf)
    : Math.max(0, snapshot.expiresAt - snapshot.serverNow);
  const timeIsUp = hydrated && anchor !== null && isOpen && remaining <= 0;

  // The countdown reaching zero is a reason to ask, not to conclude: only
  // the server decides a hold has expired.
  useEffect(() => {
    if (!timeIsUp) return;
    refresh();
    const retry = setInterval(refresh, 1000);
    return () => clearInterval(retry);
  }, [timeIsUp, refresh]);

  const canPay =
    hydrated &&
    pending === null &&
    !accepting &&
    (snapshot.status === "active" || snapshot.status === "payment_failed") &&
    remaining > PAY_CUTOFF_MS;

  async function pay(payment: PaymentBehaviour) {
    if (!canPay) return;
    payKey.current ??= newIdempotencyKey();
    setPending(payment);
    setProblem(null);
    const result = await client.complete(id, {
      version: snapshot.version,
      idempotencyKey: payKey.current,
      payment,
      surface,
    });
    if (result.ok || result.code !== "network_error") payKey.current = null;
    apply(result.snapshot, result.anchor);
    if (!result.ok) setProblem(PROBLEM_TEXT[result.code] ?? result.message);
    setPending(null);
  }

  async function accept() {
    setAccepting(true);
    setProblem(null);
    const result = await client.acknowledgePrice(id, snapshot.version, surface);
    apply(result.snapshot, result.anchor);
    if (!result.ok) setProblem(PROBLEM_TEXT[result.code] ?? result.message);
    setAccepting(false);
  }

  const changed = new Map(snapshot.priceChanges.map((c) => [c.ticketId, c]));
  const total = formatCents(snapshot.totalCents);

  return (
    <div className="flex flex-col gap-5">
      <div role="status" className="flex flex-col gap-3 empty:hidden">
        {snapshot.status === "completed" && (
          <Banner kind="ok" title="Order confirmed">
            Thank you! Your order number is{" "}
            <strong className="font-mono">{snapshot.orderId}</strong>.
          </Banner>
        )}

        {snapshot.status === "expired" && (
          <Banner kind="danger" title="This checkout has expired">
            {EXPIRY_TEXT[snapshot.failureReason ?? "hold_expired"] ??
              EXPIRY_TEXT.hold_expired}
            <form action={startCheckout} className="mt-3">
              <input
                type="hidden"
                name="ticketId"
                value={snapshot.items[0]?.ticketId}
              />
              <button type="submit" className={primaryButton}>
                Start over
              </button>
            </form>
          </Banner>
        )}

        {snapshot.status === "completing" && (
          <Banner kind="info" title="Payment pending">
            {pending
              ? "Processing your payment…"
              : "A payment is in progress from another device. This page updates when it finishes, and you can't pay twice."}
          </Banner>
        )}

        {snapshot.status === "price_changed" && (
          <Banner kind="warn" title="A price changed while you were away">
            <ul role="list" className="mt-1 flex flex-col gap-1">
              {snapshot.priceChanges.map((c) => (
                <li key={c.ticketId}>
                  <strong>{c.eventName}</strong>:{" "}
                  {formatCents(c.quotedPriceCents)} →{" "}
                  <strong>{formatCents(c.currentPriceCents)}</strong>{" "}
                  {c.currentPriceCents > c.quotedPriceCents
                    ? "(increase)"
                    : "(decrease)"}
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={accept}
              disabled={!hydrated || accepting || remaining <= 0}
              className={`${primaryButton} mt-3`}
            >
              {accepting ? "Accepting…" : "Accept new price"}
            </button>
          </Banner>
        )}

        {snapshot.status === "payment_failed" && (
          <Banner kind="danger" title="Payment failed">
            {snapshot.failureReason === "payment_timeout"
              ? "The payment didn't finish in time and was not taken."
              : "Your card was declined."}{" "}
            Your tickets are still held. Try again before the timer runs out.
          </Banner>
        )}

        {snapshot.priceDrops.length > 0 && isOpen && (
          <Banner kind="info" title="Good news: a price dropped">
            {snapshot.priceDrops.map((c) => (
              <span
                key={`${c.ticketId}-${c.currentPriceCents}`}
                className="block"
              >
                {c.eventName}: {formatCents(c.quotedPriceCents)} →{" "}
                {formatCents(c.currentPriceCents)}. We&apos;ve updated your
                total.
              </span>
            ))}
          </Banner>
        )}

        {problem && (
          <Banner kind="warn" title="Heads up">
            {problem}
          </Banner>
        )}
      </div>

      <section
        aria-label="Order"
        className="rounded-lg border border-border bg-surface p-4"
      >
        <ul role="list" className="flex flex-col gap-2">
          {snapshot.items.map((item, index) => {
            const change = changed.get(item.ticketId);
            return (
              <li
                key={`${item.ticketId}-${index}`}
                className="flex flex-wrap items-baseline justify-between gap-2"
              >
                <span className="font-medium">{item.eventName}</span>
                <span>
                  {change ? (
                    <>
                      <s className="text-muted">
                        {formatCents(change.quotedPriceCents)}
                      </s>{" "}
                      <strong>{formatCents(change.currentPriceCents)}</strong>
                    </>
                  ) : (
                    formatCents(item.quotedPriceCents)
                  )}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 flex items-baseline justify-between border-t border-border pt-3 text-lg font-semibold">
          <span>Total</span>
          <span>{total}</span>
        </p>
        <p className="mt-2 text-sm text-muted">
          Status:{" "}
          <span data-testid="status">{snapshot.status.replace("_", " ")}</span>
        </p>
        {isOpen && (
          <p className="mt-1 text-sm text-muted">
            {timeIsUp
              ? "Time is up. Confirming with the server…"
              : "Your tickets are held for "}
            {!timeIsUp && (
              <strong
                role="timer"
                data-testid="countdown"
                className="text-foreground tabular-nums"
              >
                {formatRemaining(remaining)}
              </strong>
            )}
          </p>
        )}
      </section>

      {(isOpen || snapshot.status === "completing") && (
        <section aria-labelledby="pay-heading" className="flex flex-col gap-2">
          <h2 id="pay-heading" className="font-semibold">
            Pay
          </h2>
          <p className="text-sm text-muted">
            Demo: choose how the payment stub behaves.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => pay("success")}
              disabled={!canPay}
              className={primaryButton}
            >
              {pending === "success" ? "Paying…" : `Pay ${total}`}
            </button>
            <button
              type="button"
              onClick={() => pay("fail")}
              disabled={!canPay}
              className={secondaryButton}
            >
              {pending === "fail" ? "Paying…" : "Pay (card declined)"}
            </button>
            <button
              type="button"
              onClick={() => pay("slow_success")}
              disabled={!canPay}
              className={secondaryButton}
            >
              {pending === "slow_success" ? "Paying…" : "Pay (slow, 3s)"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

const primaryButton =
  "min-h-11 rounded-md bg-accent px-5 font-medium text-on-accent hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButton =
  "min-h-11 rounded-md border border-border bg-surface px-5 font-medium hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50";

function Banner({
  kind,
  title,
  children,
}: {
  kind: keyof typeof tone;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-lg border-2 p-4 ${tone[kind]}`}>
      <h2 className="font-semibold">{title}</h2>
      <div className="mt-1">{children}</div>
    </div>
  );
}
