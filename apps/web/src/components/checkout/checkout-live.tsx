"use client";

import type { SessionSnapshot, Surface } from "@continuity/checkout";
import { ProblemBanner, StatusBanners } from "./banners";
import { OrderSummary } from "./order-summary";
import { PayButtons } from "./pay-buttons";
import { useWebCheckoutSession } from "./use-checkout-session";

/**
 * The live checkout. Rendered to HTML on the server like any component, so
 * the item, prices, status banners and remaining time are in the first
 * paint; the Pay buttons stay disabled until hydration makes them work.
 * The live part (refetch, server-sent events, countdown) is in
 * the shared useCheckoutSession (@continuity/checkout/react).
 */
export function CheckoutLive({
  initial,
  surface,
}: {
  initial: SessionSnapshot;
  surface: Surface;
}) {
  const session = useWebCheckoutSession(initial, surface);
  const { status } = session.snapshot;
  return (
    <div className="flex flex-col gap-5">
      <div role="status" className="flex flex-col gap-3 empty:hidden">
        <StatusBanners session={session} />
        <ProblemBanner problem={session.problem} />
      </div>
      <OrderSummary session={session} />
      {(session.isOpen || status === "completing") && (
        <PayButtons session={session} />
      )}
    </div>
  );
}
