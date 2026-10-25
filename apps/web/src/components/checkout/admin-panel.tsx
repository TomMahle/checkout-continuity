"use client";

import {
  formatCents,
  type AnalyticsEvent,
  type SessionSnapshot,
  type Ticket,
} from "@continuity/checkout";
import { useCallback, useEffect, useState } from "react";

interface AdminState {
  now: number;
  clockOffsetMs: number;
  ttlMs: number;
  tickets: Ticket[];
  sessions: SessionSnapshot[];
  events: AnalyticsEvent[];
}

const inputClass =
  "min-h-11 w-28 rounded-md border border-border bg-surface px-2";
const buttonClass =
  "min-h-11 rounded-md border border-border bg-surface px-3 font-medium hover:bg-surface-muted disabled:opacity-50";

/** Control surface for demos and tests. No auth: a real one would need staff login. */
export function AdminPanel() {
  const [state, setState] = useState<AdminState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      fetch("/api/admin/state", { cache: "no-store" })
        .then((response) => response.json())
        .then(setState)
        .catch(() => setError("Can't reach the server.")),
    [],
  );

  useEffect(() => {
    void load();
    const poll = setInterval(() => void load(), 1500);
    return () => clearInterval(poll);
  }, [load]);

  async function send(path: string, method: string, body?: unknown) {
    setError(null);
    const response = await fetch(path, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      const json = await response.json().catch(() => null);
      setError(json?.message ?? `Request failed (${response.status})`);
    }
    await load();
  }

  if (!state) return <p className="text-muted">Loading…</p>;

  return (
    <div className="flex flex-col gap-8">
      {error && (
        <p
          role="alert"
          className="rounded-md border-2 border-danger bg-danger-soft p-3"
        >
          {error}
        </p>
      )}

      <section
        aria-labelledby="tickets-heading"
        className="flex flex-col gap-3"
      >
        <h2 id="tickets-heading" className="text-xl font-semibold">
          Catalog
        </h2>
        <ul role="list" className="flex flex-col gap-3">
          {state.tickets.map((ticket) => (
            <TicketRow key={ticket.id} ticket={ticket} send={send} />
          ))}
        </ul>
      </section>

      <section aria-labelledby="clock-heading" className="flex flex-col gap-3">
        <h2 id="clock-heading" className="text-xl font-semibold">
          Clock and holds
        </h2>
        <p className="text-sm text-muted">
          Hold length {state.ttlMs / 1000}s (new sessions). Clock is{" "}
          {state.clockOffsetMs / 1000}s ahead of real time. Advancing the clock
          affects every session; use &ldquo;Expire now&rdquo; below to end just
          one.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              void send("/api/admin/clock", "POST", {
                ms: Number(data.get("seconds")) * 1000,
              });
            }}
          >
            <label className="flex flex-col text-sm">
              Advance clock (seconds)
              <input
                name="seconds"
                type="number"
                min={1}
                defaultValue={5}
                className={inputClass}
              />
            </label>
            <button type="submit" className={buttonClass}>
              Advance
            </button>
          </form>
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              void send("/api/admin/ttl", "PUT", {
                ttlMs: Number(data.get("seconds")) * 1000,
              });
            }}
          >
            <label className="flex flex-col text-sm">
              Hold length (seconds)
              <input
                name="seconds"
                type="number"
                min={1}
                defaultValue={state.ttlMs / 1000}
                key={state.ttlMs}
                className={inputClass}
              />
            </label>
            <button type="submit" className={buttonClass}>
              Set
            </button>
          </form>
          <button
            type="button"
            className={buttonClass}
            onClick={() => void send("/api/admin/reset", "POST")}
          >
            Reset everything
          </button>
        </div>
      </section>

      <section
        aria-labelledby="sessions-heading"
        className="flex flex-col gap-3"
      >
        <h2 id="sessions-heading" className="text-xl font-semibold">
          Sessions
        </h2>
        {state.sessions.length === 0 ? (
          <p className="text-muted">None yet.</p>
        ) : (
          <ul role="list" className="flex flex-col gap-2">
            {[...state.sessions]
              .reverse()
              .slice(0, 15)
              .map((s) => (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface p-3"
                >
                  <span>
                    <a
                      className="font-mono underline"
                      href={`/checkout/${s.id}`}
                    >
                      {s.id}
                    </a>{" "}
                    · {s.status.replace("_", " ")} · v{s.version} ·{" "}
                    {s.items.map((i) => i.eventName).join(", ")}
                  </span>
                  <button
                    type="button"
                    className={buttonClass}
                    disabled={
                      s.status === "expired" || s.status === "completed"
                    }
                    onClick={() =>
                      void send(`/api/admin/sessions/${s.id}/expire`, "POST")
                    }
                  >
                    Expire now
                  </button>
                </li>
              ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="events-heading" className="flex flex-col gap-3">
        <h2 id="events-heading" className="text-xl font-semibold">
          Event log
        </h2>
        <ol
          tabIndex={0}
          aria-label="Events, newest first"
          className="flex max-h-96 flex-col gap-1 overflow-auto rounded-lg border border-border bg-surface p-3 font-mono text-xs"
        >
          {state.events.map((e) => (
            <li key={e.seq}>
              {new Date(e.at).toISOString().slice(11, 23)} {e.type}{" "}
              {e.sessionId?.slice(0, 11)} {e.surface ?? ""}{" "}
              {Object.keys(e.data).length > 0 && JSON.stringify(e.data)}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function TicketRow({
  ticket,
  send,
}: {
  ticket: Ticket;
  send: (path: string, method: string, body?: unknown) => Promise<void>;
}) {
  return (
    <li className="rounded-lg border border-border bg-surface p-3">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          void send(`/api/admin/tickets/${ticket.id}`, "PATCH", {
            priceCents: Math.round(Number(data.get("price")) * 100),
            available: Number(data.get("available")),
          });
        }}
      >
        <div className="min-w-48 flex-1">
          <h3 className="font-medium">{ticket.eventName}</h3>
          <p className="text-sm text-muted">
            {ticket.id} · {formatCents(ticket.priceCents)} · {ticket.available}{" "}
            available
          </p>
        </div>
        <label className="flex flex-col text-sm">
          Price ($)
          <input
            name="price"
            type="number"
            step="0.01"
            min={0}
            defaultValue={(ticket.priceCents / 100).toFixed(2)}
            key={`p${ticket.priceCents}`}
            aria-label={`Price in dollars for ${ticket.eventName}`}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col text-sm">
          Available
          <input
            name="available"
            type="number"
            min={0}
            defaultValue={ticket.available}
            key={`a${ticket.available}`}
            aria-label={`Available for ${ticket.eventName}`}
            className={inputClass}
          />
        </label>
        <button
          type="submit"
          className={buttonClass}
          aria-label={`Update ${ticket.eventName}`}
        >
          Update
        </button>
      </form>
    </li>
  );
}
