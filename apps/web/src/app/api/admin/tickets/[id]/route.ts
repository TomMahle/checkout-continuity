import { updateTicketBodySchema } from "@continuity/checkout";
import {
  getCheckoutStore,
  parseBody,
  respondError,
} from "@/lib/checkout/server";

/** Edits a ticket's price and/or stock. Open sessions notice on their next read. */
export async function PATCH(
  request: Request,
  ctx: RouteContext<"/api/admin/tickets/[id]">,
) {
  const { id } = await ctx.params;
  const body = await parseBody(request, updateTicketBodySchema);
  if (!body.ok) return body.response;
  const store = getCheckoutStore();
  let ticket = store.getTicket(id);
  if (!ticket) return respondError("ticket_not_found", `No ticket ${id}.`);
  if (body.data.priceCents !== undefined) {
    ticket = store.setPrice(id, body.data.priceCents);
  }
  if (body.data.available !== undefined) {
    ticket = store.setAvailability(id, body.data.available);
  }
  return Response.json({ ok: true, ticket });
}
