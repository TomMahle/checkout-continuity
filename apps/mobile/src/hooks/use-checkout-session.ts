import {
  newIdempotencyKey,
  remainingMs,
  type ClockAnchor,
  type PaymentBehaviour,
  type SessionSnapshot,
} from "@continuity/checkout";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { checkoutClient } from "@/lib/checkout-client";

const OPEN = ["active", "price_changed", "payment_failed"];
/**
 * Polling instead of server-sent events: React Native has no EventSource, and
 * a polyfill is another dependency for a screen that is open for seconds.
 * 2s keeps another device's payment visible quickly; refetching when the app
 * returns to the foreground covers the case that matters most.
 */
const POLL_MS = 2000;

const PROBLEMS: Record<string, string> = {
  version_conflict: "This checkout changed. Check it over, then try again.",
  payment_in_progress: "A payment is already in progress for this checkout.",
  already_completed: "This order has already been paid.",
  session_expired: "The hold expired before the payment started.",
  price_not_acknowledged: "A price changed. Review it before paying.",
  payment_failed: "The payment was declined. Your hold is still active.",
  network_error:
    "Can't reach the server. Nothing was charged. Tap again to retry; it reuses the same payment request.",
};

export function useCheckoutSession(id: string) {
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [anchor, setAnchor] = useState<ClockAnchor | null>(null);
  const [perf, setPerf] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<PaymentBehaviour | "accept" | null>(null);
  const version = useRef(0);
  const payKey = useRef<string | null>(null);
  const firstLoad = useRef(true);

  const apply = useCallback(
    (next?: SessionSnapshot, nextAnchor?: ClockAnchor) => {
      if (nextAnchor) {
        setAnchor(nextAnchor);
        setPerf(performance.now());
      }
      // Responses can arrive out of order; never go backwards.
      if (next && next.version >= version.current) {
        version.current = next.version;
        setSnapshot(next);
      }
    },
    [],
  );

  const refresh = useCallback(() => {
    // The first load is a "resume" (a deep link open); later ones are refetches.
    const resume = firstLoad.current;
    firstLoad.current = false;
    void checkoutClient.getSession(id, "app", resume).then((result) => {
      if (!result.ok && !result.snapshot) {
        setLoadError(
          result.code === "not_found"
            ? "This checkout doesn't exist (or the server restarted)."
            : result.message,
        );
        return;
      }
      setLoadError(null);
      apply(result.snapshot, result.anchor);
    });
  }, [apply, id]);

  const open = snapshot ? OPEN.includes(snapshot.status) : false;
  const live = snapshot ? open || snapshot.status === "completing" : true;

  useEffect(() => {
    refresh();
    const tick = setInterval(() => setPerf(performance.now()), 250);
    return () => clearInterval(tick);
  }, [refresh]);

  useEffect(() => {
    if (!live) return;
    const poll = setInterval(refresh, POLL_MS);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => {
      clearInterval(poll);
      sub.remove();
    };
  }, [live, refresh]);

  const remaining =
    snapshot && anchor ? remainingMs(snapshot.expiresAt, anchor, perf) : null;

  // Hitting zero is a reason to ask the server, not to declare expiry.
  const timeIsUp = open && remaining === 0;
  useEffect(() => {
    if (timeIsUp) refresh();
  }, [timeIsUp, refresh]);

  async function pay(payment: PaymentBehaviour) {
    if (!snapshot || busy) return;
    payKey.current ??= newIdempotencyKey();
    setBusy(payment);
    setProblem(null);
    const result = await checkoutClient.complete(id, {
      version: snapshot.version,
      idempotencyKey: payKey.current,
      payment,
      surface: "app",
    });
    if (result.ok || result.code !== "network_error") payKey.current = null;
    apply(result.snapshot, result.anchor);
    if (!result.ok) setProblem(PROBLEMS[result.code] ?? result.message);
    setBusy(null);
  }

  async function acceptPrice() {
    if (!snapshot || busy) return;
    setBusy("accept");
    setProblem(null);
    const result = await checkoutClient.acknowledgePrice(
      id,
      snapshot.version,
      "app",
    );
    apply(result.snapshot, result.anchor);
    if (!result.ok) setProblem(PROBLEMS[result.code] ?? result.message);
    setBusy(null);
  }

  return {
    snapshot,
    remaining,
    loadError,
    problem,
    busy,
    open,
    timeIsUp,
    pay,
    acceptPrice,
    refresh,
  };
}
