import type { Metadata } from "next";
import Link from "next/link";
import { AdminPanel } from "@/components/checkout/admin-panel";

export const metadata: Metadata = { title: "Checkout admin" };

export default function CheckoutAdmin() {
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
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Checkout admin</h1>
        <p className="text-muted">
          Change prices and stock, end holds, move the clock and read the event
          log, to see how open checkouts react.
        </p>
      </header>
      <AdminPanel />
    </div>
  );
}
