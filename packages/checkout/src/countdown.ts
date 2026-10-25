/**
 * Counting down to a server deadline without trusting the device clock.
 *
 * `Date.now()` on a phone can be minutes off, and jumps when the OS re-syncs.
 * `performance.now()` is monotonic but has no relation to the server. So:
 * the server says what time it is (`serverNow`) in each response, and the
 * client pins that to its own monotonic clock at the request's midpoint
 * (`(t0 + t1) / 2`, assuming the trip there and back took equal time, which
 * cancels most of the network latency). From then on, server time is
 * `serverNow + (performance.now() - anchor)`.
 */
export interface ClockAnchor {
  /** The server's epoch ms at the moment `perfAt` on the local clock. */
  serverNow: number;
  /** Local `performance.now()` at the request midpoint. */
  perfAt: number;
}

/** `t0`/`t1`: local `performance.now()` just before sending / after receiving. */
export function anchorAt(serverNow: number, t0: number, t1: number) {
  return { serverNow, perfAt: (t0 + t1) / 2 } satisfies ClockAnchor;
}

export function estimateServerNow(anchor: ClockAnchor, perfNow: number) {
  return anchor.serverNow + (perfNow - anchor.perfAt);
}

/** Milliseconds left on a deadline, never negative. */
export function remainingMs(
  expiresAt: number,
  anchor: ClockAnchor,
  perfNow: number,
) {
  return Math.max(0, expiresAt - estimateServerNow(anchor, perfNow));
}

/** "m:ss", rounded up so "0:00" only shows once time is truly up. */
export function formatRemaining(ms: number) {
  const totalSeconds = Math.ceil(Math.max(0, ms) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

/** Pay is disabled this long before expiry, so a press can't race the hold. */
export const PAY_CUTOFF_MS = 1000;
