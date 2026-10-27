import { describe, expect, it } from "vitest";
import type { ClientResult } from "./client";
import type { SessionSnapshot } from "./schema";
import { canPay, currentProblem, problemFor } from "./session-view";

const snapshot = (over: Partial<SessionSnapshot> = {}): SessionSnapshot => ({
  id: "cs_1",
  items: [],
  status: "active",
  version: 3,
  expiresAt: 10_000,
  serverNow: 0,
  totalCents: 0,
  priceChanges: [],
  priceDrops: [],
  ...over,
});

const refusal = (
  code: Extract<ClientResult, { ok: false }>["code"],
  withSnapshot = true,
): ClientResult => ({
  ok: false,
  code,
  message: `server says ${code}`,
  ...(withSnapshot ? { snapshot: snapshot() } : {}),
});

describe("problemFor", () => {
  it("stays quiet when the status banner already explains the refusal", () => {
    for (const code of [
      "payment_failed",
      "session_expired",
      "already_completed",
      "payment_in_progress",
      "price_not_acknowledged",
    ] as const) {
      expect(problemFor(refusal(code), 3)).toBeNull();
    }
  });

  it("explains what a snapshot can't: network trouble and conflicts", () => {
    expect(problemFor(refusal("network_error", false), 3)?.text).toMatch(
      /Can't reach the server/,
    );
    expect(problemFor(refusal("version_conflict"), 4)).toMatchObject({
      version: 4,
      text: expect.stringMatching(/changed while you were looking/),
    });
  });

  it("falls back to the server's message, even for a usually-explained code without a snapshot", () => {
    expect(problemFor(refusal("payment_failed", false), 3)?.text).toBe(
      "server says payment_failed",
    );
  });
});

describe("currentProblem", () => {
  it("shows a problem only while the snapshot is at its version", () => {
    const problem = { text: "x", version: 3 };
    expect(currentProblem(problem, snapshot({ version: 3 }))).toBe("x");
    expect(currentProblem(problem, snapshot({ version: 4 }))).toBeNull();
    expect(currentProblem(problem, null)).toBeNull();
  });
});

describe("canPay", () => {
  const base = {
    snapshot: snapshot(),
    remaining: 5000,
    busy: null,
    interactive: true,
  } as const;

  it("allows an active or failed session with time left", () => {
    expect(canPay(base)).toBe(true);
    expect(
      canPay({ ...base, snapshot: snapshot({ status: "payment_failed" }) }),
    ).toBe(true);
  });

  it("refuses while busy, before hydration, near expiry or in other statuses", () => {
    expect(canPay({ ...base, busy: "accept" })).toBe(false);
    expect(canPay({ ...base, interactive: false })).toBe(false);
    expect(canPay({ ...base, remaining: 1000 })).toBe(false);
    expect(canPay({ ...base, remaining: null })).toBe(false);
    expect(
      canPay({ ...base, snapshot: snapshot({ status: "price_changed" }) }),
    ).toBe(false);
    expect(canPay({ ...base, snapshot: null })).toBe(false);
  });
});
