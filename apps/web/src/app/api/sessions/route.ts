import { createSessionBodySchema } from "@continuity/checkout";
import { getCheckoutStore, parseBody, respond } from "@/lib/checkout/server";

/** Creates a session for one ticket and holds a unit of stock for it. */
export async function POST(request: Request) {
  const body = await parseBody(request, createSessionBodySchema);
  if (!body.ok) return body.response;
  return respond(
    getCheckoutStore().createSession({
      ticketIds: [body.data.ticketId],
      surface: body.data.surface,
    }),
  );
}
