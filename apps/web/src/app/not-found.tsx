import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-start gap-4 px-4 py-16 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
        We couldn’t find that page
      </h1>
      <p className="text-muted">
        The page you’re looking for doesn’t exist. It may have been removed, or
        the link may be wrong.
      </p>
      <Link
        href="/"
        className="inline-flex min-h-11 items-center rounded-md bg-accent px-4 font-semibold text-on-accent hover:bg-accent-hover"
      >
        Go to the home page
      </Link>
    </div>
  );
}
