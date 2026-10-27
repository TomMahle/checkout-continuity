import { webSurfaceFor } from "@continuity/checkout";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { renderSVG } from "uqr";
import { CheckoutLive } from "@/components/checkout/checkout-live";
import { CopyButton } from "@/components/checkout/copy-button";
import { getCheckoutStore } from "@/lib/checkout/server";
import { shareableOrigin } from "@/lib/lan";

export const metadata: Metadata = { title: "Checkout" };

/** Scheme registered in apps/mobile/app.json. */
const APP_SCHEME = "continuity";

/*
 * This route opts out of the "instant navigation" check (a dev-time
 * validation only): it reads `params` and per-request data, and rendering is
 * one in-memory lookup, so there is no slow data worth a loading state.
 *
 * Unknown sessions get their 404 from src/proxy.ts. By the time this page
 * runs, the root layout's static shell is already streaming with a 200, so
 * the notFound() below is only a fallback (a soft 404 with noindex).
 */
export const instant = false;

/**
 * A server component. The event, prices, status banners and remaining hold
 * time (CheckoutLive's server render) and both QR codes arrive as HTML in the
 * first response. Only what is interactive hydrates: the live panel and the
 * copy buttons. QR codes are drawn here as inline SVG, so no QR library
 * ships to the browser.
 */
export default async function CheckoutSession({
  params,
}: PageProps<"/checkout/[id]">) {
  await connection();
  const { id } = await params;
  const requestHeaders = await headers();
  const surface = webSurfaceFor(requestHeaders.get("user-agent") ?? "");

  const result = getCheckoutStore().getSession(id, { surface, resume: true });
  if (!result.ok) notFound();

  const origin =
    process.env.CHECKOUT_PUBLIC_ORIGIN ??
    shareableOrigin(
      `${requestHeaders.get("x-forwarded-proto") ?? "http"}://${requestHeaders.get("host")}`,
    );
  const webUrl = `${origin}/checkout/${id}`;
  const deepLink = `${APP_SCHEME}://checkout/${id}`;
  // Expo Go doesn't register the app's scheme; it opens routes as
  // exp://<metro host>/--/<path>. In development, assume Metro runs on this
  // machine on its default port, at the same network address as the links.
  const expoGoOrigin =
    process.env.CHECKOUT_EXPO_GO_ORIGIN ??
    (process.env.NODE_ENV === "production"
      ? undefined
      : `exp://${new URL(origin).hostname}:8081`);
  const links = [
    // First, so nobody scans the app link from Expo Go, where it does nothing.
    ...(expoGoOrigin
      ? [
          {
            label: "Scan with Expo Go (dev)",
            url: `${expoGoOrigin.replace(/\/$/, "")}/--/checkout/${id}`,
          },
        ]
      : []),
    { label: "Open in the app (installed build)", url: deepLink },
    { label: "Open on the web", url: webUrl },
  ];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10 sm:px-6">
      <div>
        <Link
          href="/checkout"
          className="inline-flex min-h-11 items-center gap-1 rounded-md font-medium text-accent hover:text-accent-hover hover:underline"
        >
          <span aria-hidden="true">←</span> All tickets
        </Link>
      </div>
      <h1 className="text-3xl font-bold tracking-tight">Checkout</h1>
      <CheckoutLive initial={result.snapshot} surface={surface} />
      <section
        aria-labelledby="continue-heading"
        className="rounded-lg border border-border bg-surface p-4"
      >
        <h2 id="continue-heading" className="font-semibold">
          Continue on another device
        </h2>
        <p className="mt-1 text-sm text-muted">
          The same checkout, same timer. Scan with your phone or copy the link.
        </p>
        <div className="mt-4 flex flex-wrap gap-6">
          {links.map(({ label, url }) => (
            <figure key={label} className="flex w-44 flex-col gap-2">
              <div
                role="img"
                aria-label={`QR code: ${url}`}
                className="size-44 rounded-md bg-white p-2 [&>svg]:size-full"
                dangerouslySetInnerHTML={{
                  __html: renderSVG(url, { border: 0 }),
                }}
              />
              <figcaption className="text-sm font-medium">{label}</figcaption>
              <code className="text-xs break-all text-muted">{url}</code>
              <CopyButton value={url} label={`${label} link`} />
            </figure>
          ))}
        </div>
      </section>
    </div>
  );
}
