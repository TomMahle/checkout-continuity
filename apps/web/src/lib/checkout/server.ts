import "server-only";
import {
  createAdjustableClock,
  createStubPayment,
  errorStatus,
  type ErrorCode,
  type Ticket,
} from "@continuity/checkout";
import {
  createCheckoutStore,
  type CheckoutStore,
  type Result,
} from "@continuity/checkout/store";
import type { ZodType } from "zod";

/** Demo catalog. Plenty of stock except the last one, for sold-out demos. */
export const SEED_TICKETS: Ticket[] = [
  {
    id: "egg-festival",
    eventName: "Egg Festival",
    priceCents: 8500,
    available: 500,
  },
  {
    id: "stardew-valley-fair",
    eventName: "Stardew Valley Fair",
    priceCents: 12000,
    available: 200,
  },
  {
    id: "trout-derby",
    eventName: "Trout Derby",
    priceCents: 4500,
    available: 300,
  },
  {
    id: "feast-of-the-winter-star",
    eventName: "Feast of the Winter Star",
    priceCents: 9500,
    available: 150,
  },
  {
    id: "moonlight-jellies",
    eventName: "Dance of the Moonlight Jellies",
    priceCents: 6400,
    available: 4,
  },
];

const envInt = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
};

const globalForCheckout = globalThis as typeof globalThis & {
  __checkoutStore?: CheckoutStore;
};

/**
 * One store per server process, parked on globalThis. Next dev re-evaluates
 * modules on HMR, and route handlers and pages can be separate bundles; a
 * module-level variable would give each its own empty store.
 */
export function getCheckoutStore(): CheckoutStore {
  globalForCheckout.__checkoutStore ??= createCheckoutStore({
    clock: createAdjustableClock(),
    ttlMs: envInt("CHECKOUT_HOLD_TTL_MS", 10_000),
    completingTimeoutMs: envInt("CHECKOUT_COMPLETING_TIMEOUT_MS", 15_000),
    payment: createStubPayment({
      slowMs: envInt("CHECKOUT_SLOW_PAYMENT_MS", 3000),
    }).gateway,
    tickets: SEED_TICKETS,
  });
  return globalForCheckout.__checkoutStore;
}

const noStore = { "Cache-Control": "no-store" };

/** Every outcome, success or conflict, goes out as JSON with its snapshot. */
export function respond(result: Result<object>) {
  return Response.json(result, {
    status: result.ok ? 200 : errorStatus(result.code),
    headers: noStore,
  });
}

export function respondError(code: ErrorCode, message: string) {
  return Response.json(
    { ok: false, code, message },
    { status: errorStatus(code), headers: noStore },
  );
}

/** Validates a JSON body with a schema from the checkout package. */
export async function parseBody<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return {
      ok: false,
      response: respondError("bad_request", "Body must be JSON."),
    };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
      .join("; ");
    return { ok: false, response: respondError("bad_request", message) };
  }
  return { ok: true, data: parsed.data };
}
