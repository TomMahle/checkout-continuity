import { surfaceSchema } from "@continuity/checkout";
import { getCheckoutStore, respond } from "@/lib/checkout/server";

/**
 * The current snapshot. `?surface=` says who is asking (for analytics) and
 * `&resume=1` marks a page load or deep-link open rather than a refetch.
 */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/sessions/[id]">,
) {
  const { id } = await ctx.params;
  const params = new URL(request.url).searchParams;
  const surface = surfaceSchema.safeParse(params.get("surface"));
  return respond(
    getCheckoutStore().getSession(id, {
      surface: surface.success ? surface.data : undefined,
      resume: params.get("resume") === "1",
    }),
  );
}
