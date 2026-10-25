import { createTicketBodySchema } from "@continuity/checkout";
import { getCheckoutStore, parseBody } from "@/lib/checkout/server";

/** Adds a ticket to the catalog (tests use this to get one of their own). */
export async function POST(request: Request) {
  const body = await parseBody(request, createTicketBodySchema);
  if (!body.ok) return body.response;
  const ticket = getCheckoutStore().addTicket(body.data);
  return Response.json({ ok: true, ticket }, { status: 201 });
}
