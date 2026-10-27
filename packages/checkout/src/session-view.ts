import type { ClientResult } from "./client";
import { PAY_CUTOFF_MS } from "./countdown";
import type {
  PaymentBehaviour,
  SessionSnapshot,
  SessionStatus,
} from "./schema";

/*
 * The rules a checkout screen applies to a snapshot, shared so web and app
 * can't disagree about when Pay is allowed or what a refusal means.
 */

/** A hold is live: the countdown runs and the fan can still act. */
export const OPEN_STATUSES: readonly SessionStatus[] = [
  "active",
  "price_changed",
  "payment_failed",
];

export const isOpen = (status: SessionStatus) => OPEN_STATUSES.includes(status);

/** Anything can still change, so it's worth watching for updates. */
export const isLive = (status: SessionStatus) =>
  isOpen(status) || status === "completing";

/** What this screen is waiting on: a payment it sent, or a price acceptance. */
export type Busy = PaymentBehaviour | "accept" | null;

export function canPay(input: {
  snapshot: SessionSnapshot | null;
  /** Milliseconds left on the hold, or null before the first snapshot. */
  remaining: number | null;
  busy: Busy;
  /** False while server-rendered HTML is still waiting to hydrate. */
  interactive: boolean;
}): boolean {
  const { snapshot, remaining } = input;
  return (
    input.interactive &&
    input.busy === null &&
    snapshot !== null &&
    (snapshot.status === "active" || snapshot.status === "payment_failed") &&
    remaining !== null &&
    remaining > PAY_CUTOFF_MS
  );
}

/**
 * What the "Heads up" banner says about a refused request, if anything.
 *
 * A refusal carries the server's snapshot, and the screen re-renders from it,
 * so for most codes the status banners already tell the story ("Payment
 * failed", "This checkout has expired", ...). Repeating that in a second
 * banner says it twice, and worse, the copy goes stale as soon as the
 * snapshot moves on: "declined, your hold is still active" next to "expired".
 * So a problem only covers what the snapshot can't say (network trouble, a
 * version conflict), and only for the snapshot it arrived with.
 */
export interface Problem {
  text: string;
  /** The snapshot version this was true for. Hidden once the session moves. */
  version: number;
}

const PROBLEM_TEXT: Record<string, string> = {
  version_conflict:
    "This checkout changed while you were looking at it. Check it over, then try again.",
  network_error:
    "Can't reach the server. Nothing was charged. Tap again to retry: it's the same payment request, so you can't be charged twice.",
};

/** Refusals whose snapshot status already has its own banner. */
const EXPLAINED_BY_STATUS = new Set([
  "payment_failed",
  "session_expired",
  "already_completed",
  "payment_in_progress",
  "price_not_acknowledged",
]);

/** `version`: the snapshot version on screen once `result` is applied. */
export function problemFor(
  result: ClientResult,
  version: number,
): Problem | null {
  if (result.ok) return null;
  if (result.snapshot && EXPLAINED_BY_STATUS.has(result.code)) return null;
  return { text: PROBLEM_TEXT[result.code] ?? result.message, version };
}

/** The problem to show next to `snapshot`, if it still applies. */
export function currentProblem(
  problem: Problem | null,
  snapshot: SessionSnapshot | null,
): string | null {
  return problem && snapshot && problem.version === snapshot.version
    ? problem.text
    : null;
}
