import AxeBuilder from "@axe-core/playwright";
import { devices, type Browser, type Page } from "@playwright/test";
import {
  availableOf,
  createSession,
  dollars,
  newTicket,
  setPrice,
} from "./checkout-helpers";
import { expect, test } from "@playwright/test";

/*
 * Checkout continuity. Multi-device scenarios are tagged @desktop: they open
 * their own phone-sized context, so running them again under the "mobile"
 * project would only repeat them. Each test makes its own ticket and session.
 */

const WAIT = { timeout: 15_000 };

async function openPhone(browser: Browser) {
  const context = await browser.newContext({ ...devices["Pixel 7"] });
  return { context, page: await context.newPage() };
}

const payButton = (page: Page) => page.getByRole("button", { name: /^Pay \$/ });
const slowButton = (page: Page) =>
  page.getByRole("button", { name: /^Pay \(slow/ });
const declineButton = (page: Page) =>
  page.getByRole("button", { name: /^Pay \(card declined/ });
const banner = (page: Page) => page.getByRole("status");
// Next keeps the previous page mounted but hidden after a navigation.
const status = (page: Page) =>
  page.getByTestId("status").filter({ visible: true });
const order = (page: Page) => page.getByRole("region", { name: "Order" });

test("buying a ticket opens a live checkout with a countdown", async ({
  page,
  request,
}) => {
  const ticket = await newTicket(request);
  await page.goto("/checkout");
  await page.getByRole("button", { name: `Buy ${ticket.eventName}` }).click();
  await expect(page).toHaveURL(/\/checkout\/cs_/);
  await expect(order(page).getByText(ticket.eventName)).toBeVisible();
  await expect(payButton(page)).toBeEnabled(WAIT); // hydrated
  await expect(page.getByTestId("countdown")).toHaveText(/^\d+:\d\d$/);
});

test.describe("across devices @desktop", () => {
  test("a phone resumes the session started on desktop, and it is counted as cross-device", async ({
    page,
    browser,
    request,
  }) => {
    const ticket = await newTicket(request, { priceCents: 7000 });
    await page.goto("/checkout");
    await page.getByRole("button", { name: `Buy ${ticket.eventName}` }).click();
    await expect(page).toHaveURL(/\/checkout\/cs_/);
    const url = page.url();
    const id = url.split("/").pop()!;

    const phone = await openPhone(browser);
    await phone.page.goto(url);
    await expect(phone.page.getByText(ticket.eventName)).toBeVisible();
    await expect(phone.page.getByText(dollars(7000)).first()).toBeVisible();
    await expect(status(phone.page)).toHaveText("active");
    await expect(payButton(phone.page)).toBeEnabled(WAIT);

    const state = await (
      await request.get(`/api/admin/state?sessionId=${id}`)
    ).json();
    const resumed = state.events.find(
      (e: { type: string }) => e.type === "session_resumed",
    );
    expect(resumed).toMatchObject({
      surface: "mobile_web",
      data: { cross_device: true },
    });
    await phone.context.close();
  });

  test("a price increase names the ticket on both devices and blocks payment until accepted", async ({
    page,
    browser,
    request,
  }) => {
    const ticket = await newTicket(request, { priceCents: 7000 });
    const { body } = await createSession(request, ticket.id);
    const url = `/checkout/${body.snapshot.id}`;
    await page.goto(url);
    const phone = await openPhone(browser);
    await phone.page.goto(url);
    await expect(payButton(page)).toBeEnabled(WAIT);
    await expect(payButton(phone.page)).toBeEnabled(WAIT);

    await setPrice(request, ticket.id, 7500);

    for (const p of [page, phone.page]) {
      await expect(banner(p)).toContainText(ticket.eventName, WAIT);
      await expect(banner(p)).toContainText(
        `${dollars(7000)} → ${dollars(7500)}`,
      );
      await expect(status(p)).toHaveText("price changed");
      await expect(payButton(p)).toBeDisabled();
    }

    // Accepting on the phone unblocks both.
    await phone.page.getByRole("button", { name: "Accept new price" }).click();
    for (const p of [page, phone.page]) {
      await expect(status(p)).toHaveText("active", WAIT);
      await expect(payButton(p)).toHaveText(`Pay ${dollars(7500)}`);
      await expect(payButton(p)).toBeEnabled();
    }
    await payButton(page).click();
    await expect(banner(page)).toContainText("Order confirmed", WAIT);
    await phone.context.close();
  });

  test("a price decrease is applied with a notice and does not block", async ({
    page,
    request,
  }) => {
    const ticket = await newTicket(request, { priceCents: 7000 });
    const { body } = await createSession(request, ticket.id);
    await page.goto(`/checkout/${body.snapshot.id}`);
    await expect(payButton(page)).toBeEnabled(WAIT);
    await setPrice(request, ticket.id, 6000);
    await expect(banner(page)).toContainText("a price dropped", WAIT);
    await expect(banner(page)).toContainText(
      `${dollars(7000)} → ${dollars(6000)}`,
    );
    await expect(payButton(page)).toHaveText(`Pay ${dollars(6000)}`);
    await expect(payButton(page)).toBeEnabled();
  });

  test("an expired hold shows as expired on both devices and releases the ticket", async ({
    page,
    browser,
    request,
  }) => {
    const ticket = await newTicket(request, { available: 3 });
    const { body } = await createSession(request, ticket.id);
    const id = body.snapshot.id;
    expect(await availableOf(request, ticket.id)).toBe(2);

    await page.goto(`/checkout/${id}`);
    const phone = await openPhone(browser);
    await phone.page.goto(`/checkout/${id}`);
    await expect(payButton(phone.page)).toBeEnabled(WAIT);

    await request.post(`/api/admin/sessions/${id}/expire`);

    for (const p of [page, phone.page]) {
      await expect(banner(p)).toContainText("This checkout has expired", WAIT);
      await expect(p.getByRole("button", { name: /^Pay/ })).toHaveCount(0);
    }
    expect(await availableOf(request, ticket.id)).toBe(3);

    // Start over makes a new session for the same ticket.
    await phone.page.getByRole("button", { name: "Start over" }).click();
    await expect(phone.page).not.toHaveURL(new RegExp(id));
    await expect(phone.page).toHaveURL(/\/checkout\/cs_/);
    await expect(status(phone.page)).toHaveText("active");
    await phone.context.close();
  });

  test("a slow payment on desktop shows as pending on the phone, which cannot pay, then completes", async ({
    page,
    browser,
    request,
  }) => {
    const ticket = await newTicket(request);
    const { body } = await createSession(request, ticket.id);
    const url = `/checkout/${body.snapshot.id}`;
    await page.goto(url);
    const phone = await openPhone(browser);
    await phone.page.goto(url);
    await expect(slowButton(page)).toBeEnabled(WAIT);
    await expect(payButton(phone.page)).toBeEnabled(WAIT);

    await slowButton(page).click();

    await expect(banner(phone.page)).toContainText("Payment pending", WAIT);
    await expect(status(phone.page)).toHaveText("completing");
    await expect(payButton(phone.page)).toBeDisabled();
    await expect(slowButton(phone.page)).toBeDisabled();

    await expect(banner(page)).toContainText("Order confirmed", WAIT);
    await expect(banner(phone.page)).toContainText("Order confirmed", WAIT);
    const order = (await banner(page).locator("strong").textContent())!;
    await expect(banner(phone.page)).toContainText(order);
    await expect(payButton(phone.page)).toHaveCount(0);
    await phone.context.close();
  });

  test("a declined card keeps the hold and can be retried", async ({
    page,
    request,
  }) => {
    const ticket = await newTicket(request);
    const { body } = await createSession(request, ticket.id);
    await page.goto(`/checkout/${body.snapshot.id}`);
    await expect(declineButton(page)).toBeEnabled(WAIT);
    await declineButton(page).click();
    await expect(banner(page)).toContainText("Payment failed", WAIT);
    await expect(status(page)).toHaveText("payment failed");
    await expect(payButton(page)).toBeEnabled();
    await payButton(page).click();
    await expect(banner(page)).toContainText("Order confirmed", WAIT);
  });

  test("the first response already contains the order, prices and hold time (no JavaScript)", async ({
    browser,
    request,
  }) => {
    const ticket = await newTicket(request, { priceCents: 7000 });
    const { body } = await createSession(request, ticket.id);
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(`/checkout/${body.snapshot.id}`);
    await expect(page.getByText(ticket.eventName)).toBeVisible();
    await expect(page.getByText(dollars(7000)).first()).toBeVisible();
    await expect(status(page)).toHaveText("active");
    await expect(page.getByTestId("countdown")).toHaveText(/^\d+:\d\d$/);
    await expect(
      page.getByRole("img", { name: /^QR code: continuity:\/\// }),
    ).toBeVisible();
    // Interactive controls are present but inert until the island hydrates.
    await expect(payButton(page)).toBeDisabled();
    await context.close();
  });

  test("an expired or price-changed session renders its banner before hydration", async ({
    browser,
    request,
  }) => {
    const ticket = await newTicket(request, { priceCents: 7000 });
    const { body } = await createSession(request, ticket.id);
    await setPrice(request, ticket.id, 9000);
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(`/checkout/${body.snapshot.id}`);
    await expect(banner(page)).toContainText(
      `${ticket.eventName}: ${dollars(7000)} → ${dollars(9000)}`,
    );
    await request.post(`/api/admin/sessions/${body.snapshot.id}/expire`);
    await page.reload();
    await expect(banner(page)).toContainText("This checkout has expired");
    await context.close();
  });
});

test.describe("checkout API @desktop", () => {
  test("two concurrent payments with different keys: exactly one wins, one gets a 409 with the snapshot", async ({
    request,
  }) => {
    const ticket = await newTicket(request, { available: 5 });
    const { body } = await createSession(request, ticket.id);
    const { id, version } = body.snapshot;
    const attempt = (key: string) =>
      request.post(`/api/sessions/${id}/complete`, {
        data: { version, idempotencyKey: key, payment: "slow_success" },
      });

    const [a, b] = await Promise.all([
      attempt("device-a-0001"),
      attempt("device-b-0002"),
    ]);
    const statuses = [a.status(), b.status()].sort();
    expect(statuses).toEqual([200, 409]);

    const loser = await (a.status() === 409 ? a : b).json();
    expect(loser).toMatchObject({ ok: false, code: "payment_in_progress" });
    expect(loser.snapshot.status).toBe("completing");

    const winner = await (a.status() === 200 ? a : b).json();
    expect(winner.snapshot.status).toBe("completed");
    // One order, one unit consumed.
    expect(await availableOf(request, ticket.id)).toBe(4);
  });

  test("the same idempotency key twice returns the same order, charging once", async ({
    request,
  }) => {
    const ticket = await newTicket(request, { available: 5 });
    const { body } = await createSession(request, ticket.id);
    const { id, version } = body.snapshot;
    const data = {
      version,
      idempotencyKey: "press-0001-abcd",
      payment: "success",
    };

    const first = await (
      await request.post(`/api/sessions/${id}/complete`, { data })
    ).json();
    const second = await request.post(`/api/sessions/${id}/complete`, { data });
    expect(second.status()).toBe(200);
    const replay = await second.json();
    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(replay.orderId).toBe(first.orderId);

    // A different key on a paid order is a duplicate, not a second order.
    const dup = await request.post(`/api/sessions/${id}/complete`, {
      data: {
        ...data,
        version: replay.snapshot.version,
        idempotencyKey: "press-0002-abcd",
      },
    });
    expect(dup.status()).toBe(409);
    expect((await dup.json()).code).toBe("already_completed");
    expect(await availableOf(request, ticket.id)).toBe(4);
  });

  test("a stale version is a 409 carrying the current snapshot", async ({
    request,
  }) => {
    const ticket = await newTicket(request, { priceCents: 7000 });
    const { body } = await createSession(request, ticket.id);
    await setPrice(request, ticket.id, 7500);
    const response = await request.post(
      `/api/sessions/${body.snapshot.id}/complete`,
      {
        data: {
          version: body.snapshot.version,
          idempotencyKey: "stale-key-0001",
        },
      },
    );
    expect(response.status()).toBe(409);
    const json = await response.json();
    expect(json.code).toBe("version_conflict");
    expect(json.snapshot.status).toBe("price_changed");
    expect(json.snapshot.priceChanges[0]).toMatchObject({
      ticketId: ticket.id,
      quotedPriceCents: 7000,
      currentPriceCents: 7500,
    });
  });

  test("stock held by an abandoned session is released, so the next fan can buy", async ({
    request,
  }) => {
    const ticket = await newTicket(request, { available: 1 });
    const first = await createSession(request, ticket.id);
    expect(first.response.status()).toBe(200);

    const blocked = await createSession(request, ticket.id);
    expect(blocked.response.status()).toBe(409);
    expect(blocked.body.code).toBe("sold_out");

    await request.post(`/api/admin/sessions/${first.body.snapshot.id}/expire`);
    const second = await createSession(request, ticket.id);
    expect(second.response.status()).toBe(200);
  });

  test("bad input is a 400 and an unknown session a 404", async ({
    request,
  }) => {
    const bad = await request.post("/api/sessions", { data: { ticketId: "" } });
    expect(bad.status()).toBe(400);
    expect((await bad.json()).code).toBe("bad_request");
    expect((await request.get("/api/sessions/cs_nope")).status()).toBe(404);
  });

  test("an unknown session page is a real 404, rendered on the server", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    const response = await page.goto("/checkout/cs_nope");
    expect(response?.status()).toBe(404);
    expect(await response?.text()).not.toContain("__next_error__");
    await expect(page.locator("main h1")).toHaveText(/couldn.t find/);
    // A client-rendered fallback re-creates the layout's <script> and warns.
    expect(errors.filter((e) => e.includes("script tag"))).toEqual([]);
  });
});

test.describe("accessibility @desktop", () => {
  test("checkout, session and admin pages have no WCAG violations", async ({
    page,
    request,
  }) => {
    const ticket = await newTicket(request, { priceCents: 7000 });
    const { body } = await createSession(request, ticket.id);
    await setPrice(request, ticket.id, 9000);
    for (const path of [
      "/checkout",
      `/checkout/${body.snapshot.id}`,
      "/checkout/admin",
    ]) {
      await page.goto(path);
      await expect(page.locator("main h1")).toBeVisible();
      if (path.includes("cs_"))
        await expect(
          page.getByRole("button", { name: "Accept new price" }),
        ).toBeEnabled(WAIT);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(
        results.violations.map(
          (v) =>
            `${path}: ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
        ),
      ).toEqual([]);
    }
  });
});
