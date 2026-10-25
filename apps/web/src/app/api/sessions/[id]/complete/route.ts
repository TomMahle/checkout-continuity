import { completeBodySchema } from "@continuity/checkout";
import { getCheckoutStore, parseBody, respond } from "@/lib/checkout/server";

/**
 * Pays. 200 with the order; 402 if the card failed; 409 for every conflict
 * (stale version, another payment in progress, expired, price not accepted).
 * All of them carry the current snapshot.
 */
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/sessions/[id]/complete">,
) {
  const { id } = await ctx.params;
  const body = await parseBody(request, completeBodySchema);
  if (!body.ok) return body.response;
  return respond(await getCheckoutStore().complete(id, body.data));
}
