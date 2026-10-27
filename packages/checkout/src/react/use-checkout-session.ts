import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { CheckoutClient } from "../client";
import { remainingMs, type ClockAnchor } from "../countdown";
import { newIdempotencyKey } from "../random";
import type { PaymentBehaviour, SessionSnapshot, Surface } from "../schema";
import {
  canPay,
  currentProblem,
  isLive,
  isOpen,
  problemFor,
  type Busy,
  type Problem,
} from "../session-view";

export interface CheckoutSessionOptions {
  id: string;
  client: CheckoutClient;
  surface: Surface;
  /** A server-rendered snapshot to show (and hydrate) before the first fetch. */
  initial?: SessionSnapshot;
  /**
   * Count the first fetch as a resume (a deep link open) for analytics. The
   * web counts its resume on the server render instead.
   */
  resumeOnLoad?: boolean;
  /**
   * Calls back whenever the screen comes back into view (tab shown, app
   * foregrounded) and returns an unsubscribe. Keep it stable (module-level).
   */
  subscribeForeground: (onForeground: () => void) => () => void;
}

const noopSubscribe = () => () => {};
/** False while rendering on the server and during hydration, true after. */
const useHydrated = () =>
  useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );

/**
 * One checkout session, live, for any React surface: the snapshot, a
 * countdown anchored to the server's clock, and the pay / accept actions.
 * Updates arrive over server-sent events (reconnecting on its own) and a
 * refetch whenever the screen comes back into view.
 */
export function useCheckoutSession(options: CheckoutSessionOptions) {
  const { id, client, surface, subscribeForeground } = options;
  const hydrated = useHydrated();

  const [snapshot, setSnapshot] = useState(options.initial ?? null);
  const [anchor, setAnchor] = useState<ClockAnchor | null>(null);
  const [perf, setPerf] = useState(0);
  const [busy, setBusy] = useState<Busy>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const version = useRef(options.initial?.version ?? 0);
  /** One key per payment attempt; kept across network retries, dropped on any answer. */
  const payKey = useRef<string | null>(null);
  const resumeNext = useRef(options.resumeOnLoad ?? false);

  const apply = useCallback(
    (next?: SessionSnapshot, nextAnchor?: ClockAnchor) => {
      if (nextAnchor) {
        setAnchor(nextAnchor);
        setPerf(performance.now());
      }
      // Responses can arrive out of order (events vs fetch); never go backwards.
      if (next && next.version >= version.current) {
        version.current = next.version;
        setSnapshot(next);
      }
    },
    [],
  );

  const refresh = useCallback(() => {
    const resume = resumeNext.current;
    resumeNext.current = false;
    void client.getSession(id, surface, resume).then((result) => {
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
  }, [apply, client, id, surface]);

  // After mount: an anchored snapshot (a server-rendered one is a few hundred
  // ms old and has no anchor), then keep time locally.
  useEffect(() => {
    refresh();
    const tick = setInterval(() => setPerf(performance.now()), 250);
    return () => clearInterval(tick);
  }, [refresh]);

  // Live updates while anything can still change. Before the first snapshot
  // we don't know yet, so watch.
  const live = snapshot ? isLive(snapshot.status) : true;
  useEffect(() => {
    if (!live) return;
    const watch = client.watchSession(id, (next) => apply(next));
    // Back in view: the stream may have died while hidden (a suspended app
    // always loses it), so catch up now and reconnect without waiting.
    const unsubscribe = subscribeForeground(() => {
      refresh();
      watch.retryNow();
    });
    return () => {
      watch.stop();
      unsubscribe();
    };
  }, [live, apply, client, id, refresh, subscribeForeground]);

  const open = snapshot !== null && isOpen(snapshot.status);
  // Until anchored, show what the server said (matches server-rendered HTML).
  const remaining = !snapshot
    ? null
    : anchor
      ? remainingMs(snapshot.expiresAt, anchor, perf)
      : Math.max(0, snapshot.expiresAt - snapshot.serverNow);
  const timeIsUp = hydrated && anchor !== null && open && remaining === 0;

  // The countdown reaching zero is a reason to ask, not to conclude: only
  // the server decides a hold has expired.
  useEffect(() => {
    if (!timeIsUp) return;
    refresh();
    const retry = setInterval(refresh, 1000);
    return () => clearInterval(retry);
  }, [timeIsUp, refresh]);

  const payable = canPay({ snapshot, remaining, busy, interactive: hydrated });

  async function pay(payment: PaymentBehaviour) {
    if (!snapshot || !payable) return;
    payKey.current ??= newIdempotencyKey();
    setBusy(payment);
    setProblem(null);
    const result = await client.complete(id, {
      version: snapshot.version,
      idempotencyKey: payKey.current,
      payment,
      surface,
    });
    if (result.ok || result.code !== "network_error") payKey.current = null;
    apply(result.snapshot, result.anchor);
    setProblem(problemFor(result, version.current));
    setBusy(null);
  }

  async function acceptPrice() {
    if (!snapshot || busy !== null) return;
    setBusy("accept");
    setProblem(null);
    const result = await client.acknowledgePrice(id, snapshot.version, surface);
    apply(result.snapshot, result.anchor);
    setProblem(problemFor(result, version.current));
    setBusy(null);
  }

  return {
    snapshot,
    /** Milliseconds left on the hold; null until there is a snapshot. */
    remaining,
    hydrated,
    isOpen: open,
    timeIsUp,
    canPay: payable,
    busy,
    /** Only while the session is still at the version it was about. */
    problem: currentProblem(problem, snapshot),
    /** The first load failed with nothing to show (gone, or unreachable). */
    loadError,
    pay,
    acceptPrice,
    refresh,
  };
}

export type CheckoutSession = ReturnType<typeof useCheckoutSession>;
