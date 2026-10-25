import { advanceClockBodySchema } from "@continuity/checkout";
import { getCheckoutStore, parseBody } from "@/lib/checkout/server";

/**
 * Moves the checkout clock forward for EVERY session (a global lever; for
 * one session use /api/admin/sessions/:id/expire).
 */
export async function POST(request: Request) {
  const body = await parseBody(request, advanceClockBodySchema);
  if (!body.ok) return body.response;
  const store = getCheckoutStore();
  store.advanceClock(body.data.ms);
  return Response.json({ ok: true, now: store.clock.now() });
}
