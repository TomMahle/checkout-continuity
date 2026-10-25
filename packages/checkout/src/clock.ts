/** Time source for the domain. Injected so tests and admins can move it. */
export interface Clock {
  /** Epoch milliseconds. */
  now(): number;
}

export interface AdjustableClock extends Clock {
  /** Jumps forward. Everything that is "lazily" time-based catches up on its next read. */
  advance(ms: number): void;
  offsetMs(): number;
  reset(): void;
}

export function createAdjustableClock(
  base: () => number = Date.now,
): AdjustableClock {
  let offset = 0;
  return {
    now: () => base() + offset,
    advance(ms) {
      offset += ms;
    },
    offsetMs: () => offset,
    reset() {
      offset = 0;
    },
  };
}
