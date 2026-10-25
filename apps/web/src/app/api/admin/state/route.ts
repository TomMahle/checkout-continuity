import { getCheckoutStore } from "@/lib/checkout/server";

/**
 * Everything the admin page shows. Unauthenticated: this is a prototype
 * control surface; a real one would sit behind staff auth.
 */
export async function GET(request: Request) {
  const sessionId = new URL(request.url).searchParams.get("sessionId");
  const store = getCheckoutStore();
  return Response.json(
    {
      ok: true,
      now: store.clock.now(),
      clockOffsetMs: store.clock.offsetMs(),
      ttlMs: store.getTtlMs(),
      tickets: store.listTickets(),
      sessions: store.listSessions(),
      events: store
        .events(sessionId ? { sessionId } : undefined)
        .slice(-200)
        .reverse(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
