import type { Surface } from "./schema";

export type AnalyticsEventType =
  | "session_created"
  | "session_resumed"
  | "price_change_shown"
  | "price_change_accepted"
  | "expired_seen"
  | "completion_attempted"
  | "completion_succeeded"
  | "completion_failed"
  | "duplicate_blocked";

export interface AnalyticsEvent {
  seq: number;
  /** Epoch ms on the checkout clock. */
  at: number;
  type: AnalyticsEventType;
  sessionId?: string;
  surface?: Surface;
  data: Record<string, unknown>;
}

export type NewAnalyticsEvent = Omit<AnalyticsEvent, "seq">;

/** Where events go. Swap for a real pipeline (and add the experiment arm). */
export interface Analytics {
  track(event: NewAnalyticsEvent): void;
}

export interface MemoryAnalytics extends Analytics {
  list(filter?: {
    sessionId?: string;
    type?: AnalyticsEventType;
  }): AnalyticsEvent[];
  clear(): void;
}

/** Keeps the most recent `max` events. */
export function createMemoryAnalytics(max = 1000): MemoryAnalytics {
  let events: AnalyticsEvent[] = [];
  let seq = 0;
  return {
    track(event) {
      events.push({ ...event, seq: ++seq });
      if (events.length > max) events = events.slice(-max);
    },
    list(filter = {}) {
      return events.filter(
        (e) =>
          (!filter.sessionId || e.sessionId === filter.sessionId) &&
          (!filter.type || e.type === filter.type),
      );
    },
    clear() {
      events = [];
    },
  };
}
