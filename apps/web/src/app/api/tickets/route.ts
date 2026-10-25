import { getCheckoutStore } from "@/lib/checkout/server";

/** The live catalog. Reading it settles overdue holds, so stock is current. */
export async function GET(request: Request) {
  void request.url; // request-time data: never prerendered
  return Response.json(
    { ok: true, tickets: getCheckoutStore().listTickets() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
