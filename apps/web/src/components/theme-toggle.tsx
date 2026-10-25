"use client";

import { useSyncExternalStore } from "react";

type Theme = "light" | "dark";

/** Where a visitor's choice is kept. Read before first paint by THEME_SCRIPT. */
const STORAGE_KEY = "TKM_PORTFOLIO_theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * Runs in <head> before the page is drawn, so a visitor who picked a theme
 * never sees a flash of the other one. Without a stored choice, the device
 * setting applies (through CSS).
 */
export const THEME_SCRIPT = `try{var t=localStorage.getItem("${STORAGE_KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

function currentTheme(): Theme {
  const chosen = document.documentElement.dataset.theme;
  if (chosen === "light" || chosen === "dark") return chosen;
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

function subscribe(onChange: () => void) {
  const media = window.matchMedia(DARK_QUERY);
  media.addEventListener("change", onChange);
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => {
    media.removeEventListener("change", onChange);
    observer.disconnect();
  };
}

/**
 * Switches between light and dark. Visitors start in their device's theme;
 * after they choose, the choice is remembered on this device.
 */
export function ThemeToggle() {
  // null while server rendering: the theme is only known in the browser.
  const theme = useSyncExternalStore(subscribe, currentTheme, () => null);
  const dark = theme === "dark";

  return (
    <button
      type="button"
      aria-pressed={theme === null ? undefined : dark}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={() => {
        const next: Theme = currentTheme() === "dark" ? "light" : "dark";
        document.documentElement.dataset.theme = next;
        try {
          localStorage.setItem(STORAGE_KEY, next);
        } catch {
          // Storage can be unavailable (private browsing); the switch still
          // applies to this page.
        }
      }}
      className="inline-flex size-11 items-center justify-center rounded-md text-muted hover:bg-surface-muted hover:text-foreground"
    >
      <span className="sr-only">Dark mode</span>
      {theme !== null && (dark ? <SunIcon /> : <MoonIcon />)}
    </button>
  );
}

function SunIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-5"
      fill="currentColor"
    >
      <path d="M20.5 14.6A8.5 8.5 0 0 1 9.4 3.5a8.5 8.5 0 1 0 11.1 11.1Z" />
    </svg>
  );
}
