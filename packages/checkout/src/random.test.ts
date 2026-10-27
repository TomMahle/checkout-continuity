import { afterEach, describe, expect, it, vi } from "vitest";
import { newIdempotencyKey, randomHex } from "./random";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("randomHex", () => {
  it("returns 32 hex characters, different each time", () => {
    const a = randomHex();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(randomHex()).not.toBe(a);
  });

  it("uses getRandomValues without crypto.randomUUID (insecure contexts)", () => {
    const real = globalThis.crypto;
    const getRandomValues = vi.fn(real.getRandomValues.bind(real));
    // Insecure contexts don't have randomUUID at all; it isn't a throwing stub.
    vi.stubGlobal("crypto", { getRandomValues, randomUUID: undefined });
    expect(randomHex()).toMatch(/^[0-9a-f]{32}$/);
    expect(getRandomValues).toHaveBeenCalledOnce();
  });

  it("falls back to Math.random without crypto", () => {
    vi.stubGlobal("crypto", undefined);
    expect(randomHex()).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("newIdempotencyKey", () => {
  it("fits the complete body's key length limits", () => {
    const key = newIdempotencyKey();
    expect(key.length).toBeGreaterThanOrEqual(8);
    expect(key.length).toBeLessThanOrEqual(128);
  });
});
