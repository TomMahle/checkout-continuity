import { setTtlBodySchema } from "@continuity/checkout";
import { getCheckoutStore, parseBody } from "@/lib/checkout/server";

/** Hold length for sessions created from now on. */
export async function PUT(request: Request) {
  const body = await parseBody(request, setTtlBodySchema);
  if (!body.ok) return body.response;
  const store = getCheckoutStore();
  store.setTtlMs(body.data.ttlMs);
  return Response.json({ ok: true, ttlMs: store.getTtlMs() });
}
