import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { RouteFocus } from "@/components/route-focus";
import { THEME_SCRIPT, ThemeToggle } from "@/components/theme-toggle";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Checkout continuity",
    template: "%s · Checkout continuity",
  },
  description:
    "A prototype checkout that a fan can start on one device and finish on another.",
};

const NAV_LINKS = [
  { label: "Tickets", href: "/checkout" },
  { label: "Admin", href: "/checkout/admin" },
];

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      // THEME_SCRIPT may set data-theme before React loads.
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col font-sans">
        <RouteFocus />
        <a
          href="#main"
          className="fixed top-2 left-2 z-50 -translate-y-16 rounded-md bg-accent px-4 py-2 font-medium text-on-accent focus:translate-y-0"
        >
          Skip to main content
        </a>
        <header className="border-b border-border bg-surface">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 sm:px-6">
            <Link
              href="/checkout"
              className="rounded-md text-lg font-semibold tracking-tight"
            >
              Checkout continuity
            </Link>
            <nav aria-label="Main" className="ml-auto">
              <ul role="list" className="flex items-center gap-1">
                {NAV_LINKS.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="inline-flex min-h-11 items-center rounded-md px-2 font-medium text-muted hover:text-foreground sm:px-3"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
            <ThemeToggle />
          </div>
        </header>
        <main
          id="main"
          tabIndex={-1}
          className="flex flex-1 flex-col focus:outline-none"
        >
          {children}
        </main>
      </body>
    </html>
  );
}
