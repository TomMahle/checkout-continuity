import { NextResponse, type NextRequest } from "next/server";
import { getCheckoutStore } from "@/lib/checkout/server";

/*
 * A real 404 for unknown checkout sessions. With Cache Components the root
 * layout is a static shell that starts streaming (and so commits to a 200)
 * before the session page runs, so a notFound() there can only send a "soft
 * 404". This check runs before any rendering, so the status is still ours.
 * It's one in-memory lookup (and invisible to analytics: no surface).
 */
export function proxy(request: NextRequest) {
  const id = decodeURIComponent(request.nextUrl.pathname.split("/")[2] ?? "");
  if (getCheckoutStore().getSession(id).ok) return;
  return NextResponse.rewrite(new URL("/_not-found", request.url), {
    status: 404,
  });
}

export const config = {
  // `/checkout/<id>`, but not the static pages beside it.
  matcher: "/checkout/((?!admin$)[^/]+)",
};
