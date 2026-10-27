import { formatCents } from "@continuity/checkout";
import { startCheckout } from "@/app/checkout/actions";
import { primaryButton } from "./buttons";
import type { WebCheckoutSession } from "./use-checkout-session";

const EXPIRY_TEXT: Record<string, string> = {
  hold_expired: "Your hold ended and the tickets were released.",
  admin_expired: "Your hold was ended early and the tickets were released.",
  too_many_payment_failures:
    "Too many payments were declined, so the tickets were released.",
};

const tone = {
  info: "border-border bg-accent-soft",
  warn: "border-warn bg-warn-soft",
  danger: "border-danger bg-danger-soft",
  ok: "border-accent bg-accent-soft",
} as const;

export function Banner({
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

/**
 * What the snapshot says, one banner per status (plus price drops). The
 * single source of truth for the session's state; see session-view.ts in @continuity/checkout for why
 * the "Heads up" banner doesn't repeat any of it.
 */
export function StatusBanners({ session }: { session: WebCheckoutSession }) {
  const { snapshot, hydrated, busy, remaining, isOpen } = session;
  return (
    <>
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
          {busy
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
            onClick={session.acceptPrice}
            disabled={!hydrated || busy !== null || remaining <= 0}
            className={`${primaryButton} mt-3`}
          >
            {busy === "accept" ? "Accepting…" : "Accept new price"}
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
              {formatCents(c.currentPriceCents)}. We&apos;ve updated your total.
            </span>
          ))}
        </Banner>
      )}
    </>
  );
}

/** The server no longer knows this session (say, it restarted). */
export function GoneBanner({ ticketId }: { ticketId?: string }) {
  return (
    <div role="status">
      <Banner kind="danger" title="This checkout is gone">
        The server doesn&apos;t know this checkout anymore, probably because it
        restarted. Nothing was charged.
        {ticketId && (
          <form action={startCheckout} className="mt-3">
            <input type="hidden" name="ticketId" value={ticketId} />
            <button type="submit" className={primaryButton}>
              Start over
            </button>
          </form>
        )}
      </Banner>
    </div>
  );
}

/** A refusal the snapshot can't explain by itself (see session-view.ts in @continuity/checkout). */
export function ProblemBanner({ problem }: { problem: string | null }) {
  if (!problem) return null;
  return (
    <Banner kind="warn" title="Heads up">
      {problem}
    </Banner>
  );
}
