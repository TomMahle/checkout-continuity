import { formatCents, formatRemaining } from "@continuity/checkout";
import type { WebCheckoutSession } from "./use-checkout-session";

/** The items, total, status and the hold countdown. */
export function OrderSummary({ session }: { session: WebCheckoutSession }) {
  const { snapshot, isOpen, timeIsUp, remaining } = session;
  const changed = new Map(snapshot.priceChanges.map((c) => [c.ticketId, c]));
  return (
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
        <span>{formatCents(snapshot.totalCents)}</span>
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
  );
}
