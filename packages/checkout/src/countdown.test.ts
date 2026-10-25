import { describe, expect, it } from "vitest";
import {
  anchorAt,
  estimateServerNow,
  formatRemaining,
  remainingMs,
} from "./countdown";
import { formatCents } from "./money";

describe("countdown", () => {
  it("anchors at the request midpoint and follows the monotonic clock", () => {
    // Request left at t=1000, answer arrived at t=1200: server said 50_000.
    const anchor = anchorAt(50_000, 1000, 1200);
    expect(anchor.perfAt).toBe(1100);
    expect(estimateServerNow(anchor, 1100)).toBe(50_000);
    expect(estimateServerNow(anchor, 3100)).toBe(52_000);
  });

  it("ignores the device's wall clock entirely", () => {
    // A device whose Date.now() is hours off still agrees with the server.
    const anchor = anchorAt(1_000_000, 10, 10);
    expect(remainingMs(1_010_000, anchor, 4010)).toBe(6000);
  });

  it("never goes negative", () => {
    const anchor = anchorAt(1000, 0, 0);
    expect(remainingMs(1500, anchor, 9000)).toBe(0);
  });

  it("formats m:ss, rounding up", () => {
    expect(formatRemaining(9001)).toBe("0:10");
    expect(formatRemaining(60_000)).toBe("1:00");
    expect(formatRemaining(0)).toBe("0:00");
    expect(formatRemaining(-5)).toBe("0:00");
  });
});

describe("formatCents", () => {
  it("formats dollars and cents", () => {
    expect(formatCents(8500)).toBe("$85.00");
    expect(formatCents(5)).toBe("$0.05");
    expect(formatCents(123456789)).toBe("$1,234,567.89");
  });
});
