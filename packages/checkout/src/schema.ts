import { z } from "zod";

/** Where a fan is looking at the session from. Drives analytics only. */
export const surfaceSchema = z.enum(["web", "mobile_web", "app"]);
export type Surface = z.infer<typeof surfaceSchema>;

/** Phones browsing the web site count as their own surface. */
export function webSurfaceFor(userAgent: string): Surface {
  return /Mobi|Android|iPhone|iPad/i.test(userAgent) ? "mobile_web" : "web";
}

export const sessionStatusSchema = z.enum([
  "active",
  "price_changed",
  "completing",
  "completed",
  "payment_failed",
  "expired",
]);
export type SessionStatus = z.infer<typeof sessionStatusSchema>;

/** Which way the payment stub should behave for one request. */
export const paymentBehaviourSchema = z.enum([
  "success",
  "fail",
  "slow_success",
]);
export type PaymentBehaviour = z.infer<typeof paymentBehaviourSchema>;

/** A catalog entry. Live: an admin can edit price and stock at any time. */
export const ticketSchema = z.object({
  id: z.string().min(1),
  eventName: z.string().min(1),
  /** Integer cents, so totals never pick up floating-point drift. */
  priceCents: z.number().int().nonnegative(),
  /** Units neither sold nor held by an open session. */
  available: z.number().int().nonnegative(),
});
export type Ticket = z.infer<typeof ticketSchema>;

/** What the fan was quoted. A snapshot, copied from the catalog at creation. */
export const cartItemSchema = z.object({
  ticketId: z.string().min(1),
  eventName: z.string().min(1),
  quotedPriceCents: z.number().int().nonnegative(),
});
export type CartItem = z.infer<typeof cartItemSchema>;

export const priceChangeSchema = z.object({
  ticketId: z.string().min(1),
  eventName: z.string().min(1),
  quotedPriceCents: z.number().int().nonnegative(),
  currentPriceCents: z.number().int().nonnegative(),
});
export type PriceChange = z.infer<typeof priceChangeSchema>;

/** Everything a client may know about a session. All times are epoch ms. */
export const sessionSnapshotSchema = z.object({
  id: z.string(),
  items: z.array(cartItemSchema),
  status: sessionStatusSchema,
  /** Bumped on every state change; mutations must echo the one they saw. */
  version: z.number().int().positive(),
  expiresAt: z.number(),
  /** The server's clock when this snapshot was built. See countdown.ts. */
  serverNow: z.number(),
  totalCents: z.number().int().nonnegative(),
  /** Tickets whose catalog price differs from the quote, awaiting a decision. */
  priceChanges: z.array(priceChangeSchema),
  /** Decreases already applied automatically (the fan is told, not asked). */
  priceDrops: z.array(priceChangeSchema),
  orderId: z.string().optional(),
  failureReason: z.string().optional(),
});
export type SessionSnapshot = z.infer<typeof sessionSnapshotSchema>;

// ---- Request bodies --------------------------------------------------------

export const createSessionBodySchema = z.object({
  ticketId: z.string().min(1),
  surface: surfaceSchema,
});

export const acknowledgePriceBodySchema = z.object({
  version: z.number().int().positive(),
  surface: surfaceSchema.optional(),
});

export const completeBodySchema = z.object({
  version: z.number().int().positive(),
  /** One per Pay press: reused on retries, fresh after a definitive result. */
  idempotencyKey: z.string().min(8).max(128),
  payment: paymentBehaviourSchema.default("success"),
  surface: surfaceSchema.optional(),
});
export type CompleteBody = z.input<typeof completeBodySchema>;

export const createTicketBodySchema = ticketSchema.partial({ id: true });
export const updateTicketBodySchema = z
  .object({
    priceCents: ticketSchema.shape.priceCents,
    available: ticketSchema.shape.available,
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, "Nothing to change");
export const advanceClockBodySchema = z.object({
  ms: z.number().int().positive(),
});
export const setTtlBodySchema = z.object({
  ttlMs: z.number().int().positive(),
});

// ---- Errors ----------------------------------------------------------------

/** Why a request was refused. Each maps to one HTTP status (errorStatus). */
export const errorCodeSchema = z.enum([
  "bad_request",
  "not_found",
  "ticket_not_found",
  "sold_out",
  "version_conflict",
  "session_expired",
  "price_not_acknowledged",
  "nothing_to_acknowledge",
  "payment_in_progress",
  "already_completed",
  "payment_failed",
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  not_found: 404,
  ticket_not_found: 404,
  // A declined card is not a conflict, but it still carries a snapshot.
  payment_failed: 402,
  sold_out: 409,
  version_conflict: 409,
  session_expired: 409,
  price_not_acknowledged: 409,
  nothing_to_acknowledge: 409,
  payment_in_progress: 409,
  already_completed: 409,
};

export function errorStatus(code: ErrorCode): number {
  return STATUS[code];
}
