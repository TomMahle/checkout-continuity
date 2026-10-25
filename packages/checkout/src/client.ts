import { anchorAt, type ClockAnchor } from "./countdown";
import {
  errorCodeSchema,
  sessionSnapshotSchema,
  type CompleteBody,
  type ErrorCode,
  type SessionSnapshot,
  type Surface,
} from "./schema";

/*
 * One API client for every surface (web island, Expo app), so they interpret
 * responses identically. Every response that carries a snapshot comes back
 * with a clock anchor, so callers can count down without trusting Date.now().
 */

export type ClientResult<T = object> =
  | ({ ok: true; snapshot: SessionSnapshot; anchor: ClockAnchor } & T)
  | {
      ok: false;
      code: ErrorCode | "network_error" | "bad_response";
      message: string;
      /** Present on conflicts: the server's current view, ready to render. */
      snapshot?: SessionSnapshot;
      anchor?: ClockAnchor;
      replayed?: boolean;
    };

export interface ClientOptions {
  /** "" for same-origin web; the LAN URL in the Expo app. */
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Monotonic ms. Defaults to `performance.now()`. */
  perfNow?: () => number;
}

export type CheckoutClient = ReturnType<typeof createCheckoutClient>;

export function createCheckoutClient(options: ClientOptions = {}) {
  const baseUrl = options.baseUrl ?? "";
  const doFetch = options.fetch ?? ((...args) => fetch(...args));
  const perfNow = options.perfNow ?? (() => performance.now());

  async function call<T extends object = object>(
    path: string,
    init?: { method: string; body: unknown },
  ): Promise<ClientResult<T>> {
    const t0 = perfNow();
    let body: Record<string, unknown>;
    try {
      const response = await doFetch(`${baseUrl}${path}`, {
        method: init?.method ?? "GET",
        headers: init ? { "content-type": "application/json" } : undefined,
        body: init ? JSON.stringify(init.body) : undefined,
        cache: "no-store",
      });
      body = await response.json();
    } catch {
      return {
        ok: false,
        code: "network_error",
        message: "Can't reach the server.",
      };
    }
    const t1 = perfNow();

    const parsed = sessionSnapshotSchema.safeParse(body.snapshot);
    const snapshot = parsed.success ? parsed.data : undefined;
    const anchor = snapshot && anchorAt(snapshot.serverNow, t0, t1);

    if (body.ok === true && snapshot && anchor) {
      return {
        ...(body as object),
        ok: true,
        snapshot,
        anchor,
      } as ClientResult<T>;
    }
    const code = errorCodeSchema.safeParse(body.code);
    return {
      ok: false,
      code: code.success ? code.data : "bad_response",
      message:
        typeof body.message === "string"
          ? body.message
          : "Unexpected response.",
      snapshot,
      anchor,
      replayed: body.replayed === true,
    };
  }

  const session = (id: string) => `/api/sessions/${encodeURIComponent(id)}`;

  return {
    createSession: (ticketId: string, surface: Surface) =>
      call("/api/sessions", { method: "POST", body: { ticketId, surface } }),

    /** `resume` marks a page load / deep link open (for analytics). */
    getSession: (id: string, surface: Surface, resume = false) =>
      call(`${session(id)}?surface=${surface}${resume ? "&resume=1" : ""}`),

    acknowledgePrice: (id: string, version: number, surface?: Surface) =>
      call(`${session(id)}/acknowledge-price`, {
        method: "POST",
        body: { version, surface },
      }),

    complete: (id: string, body: CompleteBody & { surface?: Surface }) =>
      call<{ orderId: string; replayed: boolean }>(`${session(id)}/complete`, {
        method: "POST",
        body,
      }),
  };
}
