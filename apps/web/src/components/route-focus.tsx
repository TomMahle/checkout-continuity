"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Puts keyboard focus somewhere sensible after a client-side navigation,
 * which Next.js leaves to the app. Without this, focus is stranded on the
 * link that was just used (now hidden, because Next.js keeps the previous
 * page mounted but hidden), and the next Tab press lands somewhere arbitrary.
 *
 * - Returning to a page (e.g. Back to the list) restores focus to the element
 *   that last had it there, such as the park you opened.
 * - Arriving at a page otherwise focuses its main heading, which screen
 *   readers announce and from which Tab continues into the content.
 */
export function RouteFocus() {
  const pathname = usePathname();
  const lastFocusedByPath = useRef(new Map<string, HTMLElement>());
  const previousPath = useRef(pathname);

  // Remember the last focused element on each page.
  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement) {
        lastFocusedByPath.current.set(window.location.pathname, event.target);
      }
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, []);

  useEffect(() => {
    if (previousPath.current === pathname) return; // first load: leave focus alone
    previousPath.current = pathname;

    // Wait a frame so the new page is shown and the old one hidden.
    const frame = requestAnimationFrame(() => {
      const remembered = lastFocusedByPath.current.get(pathname);
      if (remembered?.isConnected && isVisible(remembered)) {
        remembered.focus();
        return;
      }
      const heading = [
        ...document.querySelectorAll<HTMLElement>("main h1"),
      ].find(isVisible);
      if (heading) {
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [pathname]);

  return null;
}

function isVisible(element: HTMLElement) {
  return element.getClientRects().length > 0;
}
