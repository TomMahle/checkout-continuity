import type { APIRequestContext } from "@playwright/test";

let counter = 0;

/**
 * Tests share one server, so each makes its own ticket: a price change or a
 * sold-out ticket in one test can't touch another's sessions.
 */
export async function newTicket(
  request: APIRequestContext,
  { priceCents = 8500, available = 50 } = {},
) {
  const eventName = `E2E Show ${Date.now().toString(36)}-${counter++}-${Math.random().toString(36).slice(2, 6)}`;
  const response = await request.post("/api/admin/tickets", {
    data: { eventName, priceCents, available },
  });
  const { ticket } = await response.json();
  return ticket as {
    id: string;
    eventName: string;
    priceCents: number;
    available: number;
  };
}

export async function createSession(
  request: APIRequestContext,
  ticketId: string,
  surface: "web" | "mobile_web" | "app" = "web",
) {
  const response = await request.post("/api/sessions", {
    data: { ticketId, surface },
  });
  return { response, body: await response.json() };
}

export async function setPrice(
  request: APIRequestContext,
  ticketId: string,
  priceCents: number,
) {
  const response = await request.patch(`/api/admin/tickets/${ticketId}`, {
    data: { priceCents },
  });
  if (!response.ok()) throw new Error(`setPrice failed: ${response.status()}`);
}

export async function availableOf(
  request: APIRequestContext,
  ticketId: string,
) {
  const { tickets } = await (await request.get("/api/tickets")).json();
  return tickets.find((t: { id: string }) => t.id === ticketId).available;
}

export const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
