"use client"; // Error boundaries must be Client Components

import Link from "next/link";
import { useEffect } from "react";

export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-start gap-4 px-4 py-16 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
        Something went wrong
      </h1>
      <p className="text-muted">
        This page didn’t load properly. Try again, or go to the home page.
      </p>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => retry()}
          className="inline-flex min-h-11 items-center rounded-md bg-accent px-4 font-semibold text-on-accent hover:bg-accent-hover"
        >
          Try again
        </button>
        <Link
          href="/"
          className="inline-flex min-h-11 items-center rounded-md border border-border px-4 font-semibold hover:bg-surface-muted"
        >
          Home page
        </Link>
      </div>
    </div>
  );
}
