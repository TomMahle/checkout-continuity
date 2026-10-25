import { getCheckoutStore } from "@/lib/checkout/server";

/** Back to the seed catalog, no sessions, no events, real time. */
export async function POST() {
  getCheckoutStore().reset();
  return Response.json({ ok: true });
}
