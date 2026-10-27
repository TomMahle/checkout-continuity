import {
  createCheckoutClient,
  type SessionSnapshot,
  type Surface,
} from "@continuity/checkout";
import { useCheckoutSession } from "@continuity/checkout/react";

const client = createCheckoutClient();

/** Tab shown again, or the page restored from the back/forward cache. */
function subscribeForeground(onForeground: () => void) {
  const onVisible = () => {
    if (document.visibilityState === "visible") onForeground();
  };
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("pageshow", onVisible);
  return () => {
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("pageshow", onVisible);
  };
}

/**
 * The shared session hook, web flavour: starts from the server-rendered
 * snapshot (so there always is one), and counts its resume on the server.
 */
export function useWebCheckoutSession(
  initial: SessionSnapshot,
  surface: Surface,
) {
  const session = useCheckoutSession({
    id: initial.id,
    client,
    surface,
    initial,
    subscribeForeground,
  });
  return {
    ...session,
    snapshot: session.snapshot ?? initial,
    remaining: session.remaining ?? 0,
  };
}

export type WebCheckoutSession = ReturnType<typeof useWebCheckoutSession>;
