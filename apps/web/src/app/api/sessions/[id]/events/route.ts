import { getCheckoutStore } from "@/lib/checkout/server";

/**
 * Server-sent events: a snapshot on connect, then one whenever the session
 * changes (another device paying, an admin edit, expiry). Expiry is lazy, so
 * a once-a-second look is what notices a deadline passing with no traffic.
 */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/sessions/[id]/events">,
) {
  const { id } = await ctx.params;
  const store = getCheckoutStore();
  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let last = "";
      let closed = false;

      const close = () => {
        if (closed) return;
        closed = true;
        cleanup();
        try {
          controller.close();
        } catch {}
      };

      const send = () => {
        if (closed) return;
        const result = store.getSession(id); // no surface: not an analytics view
        if (!result.ok) return close();
        const { snapshot } = result;
        const fingerprint = JSON.stringify([
          snapshot.version,
          snapshot.status,
          snapshot.priceChanges,
        ]);
        if (fingerprint === last) return;
        last = fingerprint;
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(snapshot)}\n\n`),
        );
      };

      send();
      const unsubscribe = store.subscribe(send);
      const timer = setInterval(() => {
        send();
        if (!closed) controller.enqueue(encoder.encode(": keep-alive\n\n"));
      }, 1000);
      cleanup = () => {
        unsubscribe();
        clearInterval(timer);
      };
      request.signal.addEventListener("abort", close);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
