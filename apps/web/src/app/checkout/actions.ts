"use server";

import { webSurfaceFor } from "@continuity/checkout";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCheckoutStore } from "@/lib/checkout/server";

/**
 * Starts a checkout session and goes to it. A plain form action, so Buy works
 * before (or without) hydration. "Start over" after expiry uses it too.
 */
export async function startCheckout(formData: FormData) {
  const ticketId = String(formData.get("ticketId") ?? "");
  const surface = webSurfaceFor((await headers()).get("user-agent") ?? "");
  const result = getCheckoutStore().createSession({
    ticketIds: [ticketId],
    surface,
  });
  if (!result.ok) redirect(`/checkout?problem=${result.code}`);
  redirect(`/checkout/${result.snapshot.id}`);
}
