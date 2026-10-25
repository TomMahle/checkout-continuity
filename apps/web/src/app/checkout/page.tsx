import { formatCents } from "@continuity/checkout";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { getCheckoutStore } from "@/lib/checkout/server";
import { startCheckout } from "./actions";

export const metadata: Metadata = {
  title: "Checkout continuity",
  description:
    "Start a ticket checkout on one device and finish it on another.",
};

const PROBLEMS: Record<string, string> = {
  sold_out:
    "That ticket just sold out. Holds from other fans may still free up.",
  ticket_not_found: "That ticket doesn't exist.",
};

export default function CheckoutIndex({
  searchParams,
}: PageProps<"/checkout">) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Tickets</h1>
        <p className="text-muted">
          Buy starts a checkout and holds a ticket for you for a short time.
          Open the same checkout on your phone and carry on from there.
        </p>
      </header>
      {/* The heading above is in the static shell; stock is read per request. */}
      <Suspense fallback={<p className="text-muted">Loading tickets…</p>}>
        <Tickets searchParams={searchParams} />
      </Suspense>
      <p className="text-sm text-muted">
        <Link
          href="/checkout/admin"
          className="underline underline-offset-2 hover:text-foreground"
        >
          Admin: change prices, stock and the clock
        </Link>
      </p>
    </div>
  );
}

async function Tickets({
  searchParams,
}: {
  searchParams: PageProps<"/checkout">["searchParams"];
}) {
  await connection();
  const { problem } = await searchParams;
  const tickets = getCheckoutStore().listTickets();
  const message = typeof problem === "string" ? PROBLEMS[problem] : undefined;
  return (
    <>
      {message && (
        <p
          role="alert"
          className="rounded-md border border-border bg-accent-soft px-4 py-3"
        >
          {message}
        </p>
      )}
      <ul role="list" aria-label="Tickets" className="flex flex-col gap-3">
        {tickets.map((ticket) => (
          <li
            key={ticket.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-4"
          >
            <div>
              <h2 className="font-semibold">{ticket.eventName}</h2>
              <p className="text-sm text-muted">
                {formatCents(ticket.priceCents)} ·{" "}
                {ticket.available > 0
                  ? `${ticket.available} available`
                  : "Sold out"}
              </p>
            </div>
            <form action={startCheckout}>
              <input type="hidden" name="ticketId" value={ticket.id} />
              <button
                type="submit"
                disabled={ticket.available === 0}
                aria-label={`Buy ${ticket.eventName}`}
                className="min-h-11 rounded-md bg-accent px-5 font-medium text-on-accent hover:bg-accent-hover disabled:opacity-50"
              >
                Buy
              </button>
            </form>
          </li>
        ))}
      </ul>
    </>
  );
}
