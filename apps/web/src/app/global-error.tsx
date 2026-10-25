"use client"; // Error boundaries must be Client Components

import "./globals.css";

/**
 * Last-resort error page, shown only if the root layout itself fails. It
 * replaces the whole document, so it brings its own <html>, <body> and styles.
 */
export default function GlobalError({ retry }: { retry: () => void }) {
  return (
    <html lang="en">
      <body className="font-sans">
        <title>Something went wrong · Checkout continuity</title>
        <main className="mx-auto flex max-w-2xl flex-col items-start gap-4 px-4 py-16 sm:px-6">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Something went wrong
          </h1>
          <p className="text-muted">
            This site didn’t load properly. Please try again.
          </p>
          <button
            type="button"
            onClick={() => retry()}
            className="inline-flex min-h-11 items-center rounded-md bg-accent px-4 font-semibold text-on-accent hover:bg-accent-hover"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
