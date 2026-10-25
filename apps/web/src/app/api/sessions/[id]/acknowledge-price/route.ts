import { acknowledgePriceBodySchema } from "@continuity/checkout";
import { getCheckoutStore, parseBody, respond } from "@/lib/checkout/server";

/** The fan accepts the current catalog prices. Requires the version they saw. */
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/sessions/[id]/acknowledge-price">,
) {
  const { id } = await ctx.params;
  const body = await parseBody(request, acknowledgePriceBodySchema);
  if (!body.ok) return body.response;
  return respond(
    getCheckoutStore().acknowledgePrice(
      id,
      body.data.version,
      body.data.surface,
    ),
  );
}
