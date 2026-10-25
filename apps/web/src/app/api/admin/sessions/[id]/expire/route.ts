import { getCheckoutStore, respond } from "@/lib/checkout/server";

/** Ends one hold right now and returns its stock. */
export async function POST(
  _request: Request,
  ctx: RouteContext<"/api/admin/sessions/[id]/expire">,
) {
  const { id } = await ctx.params;
  return respond(getCheckoutStore().expireNow(id));
}
