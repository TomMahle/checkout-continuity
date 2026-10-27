import { formatCents } from "@continuity/checkout";
import { primaryButton, secondaryButton } from "./buttons";
import type { WebCheckoutSession } from "./use-checkout-session";

/** One button per payment stub behaviour (a demo lever). */
export function PayButtons({ session }: { session: WebCheckoutSession }) {
  const { canPay, busy, pay } = session;
  return (
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
          {busy === "success"
            ? "Paying…"
            : `Pay ${formatCents(session.snapshot.totalCents)}`}
        </button>
        <button
          type="button"
          onClick={() => pay("fail")}
          disabled={!canPay}
          className={secondaryButton}
        >
          {busy === "fail" ? "Paying…" : "Pay (card declined)"}
        </button>
        <button
          type="button"
          onClick={() => pay("slow_success")}
          disabled={!canPay}
          className={secondaryButton}
        >
          {busy === "slow_success" ? "Paying…" : "Pay (slow, 3s)"}
        </button>
      </div>
    </section>
  );
}
