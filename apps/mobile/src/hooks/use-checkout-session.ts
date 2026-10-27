import { useCheckoutSession as useSharedCheckoutSession } from "@continuity/checkout/react";
import { AppState } from "react-native";
import { checkoutClient } from "@/lib/checkout-client";

/** The app came back to the foreground. */
function subscribeForeground(onForeground: () => void) {
  const sub = AppState.addEventListener("change", (state) => {
    if (state === "active") onForeground();
  });
  return () => sub.remove();
}

/**
 * The shared session hook, app flavour: no snapshot until the first fetch,
 * which counts as a resume (a deep link open). Live updates use the same
 * server-sent events as the web, read through `expo/fetch`.
 */
export function useCheckoutSession(id: string) {
  return useSharedCheckoutSession({
    id,
    client: checkoutClient,
    surface: "app",
    resumeOnLoad: true,
    subscribeForeground,
  });
}
