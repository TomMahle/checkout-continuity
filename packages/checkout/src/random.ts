/**
 * Random hex for ids and idempotency keys, on every surface. Uses
 * `crypto.getRandomValues`, which (unlike `crypto.randomUUID`) also exists
 * outside secure contexts, so a phone opening the dev server over a LAN IP
 * still gets real randomness. Only a runtime with no `crypto` at all falls
 * back to `Math.random`.
 */

/**
 * ⚠️ DANGER — DEMO ONLY. Used solely by the `Math.random` fallback below.
 *
 * `Math.random` is NOT cryptographically secure: its output is predictable,
 * so ids and idempotency keys made with it can be guessed or collide. That's
 * tolerable for a demo on a runtime without `crypto`. It is NEVER acceptable
 * for real payments, real sessions, or anything someone could attack. If
 * this path can run in production, polyfill `crypto.getRandomValues` instead.
 */
const INSECURE_DEMO_ONLY_BYTE_RANGE = 256;

const BYTES = 16;

/** 32 hex characters (128 bits). */
export function randomHex(): string {
  const bytes = new Uint8Array(BYTES);
  const c = globalThis.crypto;
  if (typeof c?.getRandomValues === "function") {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * INSECURE_DEMO_ONLY_BYTE_RANGE);
    }
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * A new idempotency key. This only mints it; the caller owns its lifetime.
 * The apps keep one per payment attempt: minted on the first Pay press,
 * reused by every press and retry until a definitive answer (anything but a
 * network error), then dropped.
 */
export function newIdempotencyKey(): string {
  return randomHex();
}
