import { describe, expect, it } from "vitest";
import { isIdle, latestActivity } from "./idle";

describe("idle sign-out", () => {
  it("is off without a setting", () => {
    expect(isIdle(0, 10 * 3_600_000, null)).toBe(false);
    expect(isIdle(0, 10 * 3_600_000, 0)).toBe(false);
  });
  it("trips at the configured minutes", () => {
    expect(isIdle(0, 14 * 60_000, 15)).toBe(false);
    expect(isIdle(0, 15 * 60_000, 15)).toBe(true);
  });
  it("uses the newest stamp across tabs and ignores junk", () => {
    expect(latestActivity(1000, "5000")).toBe(5000);
    expect(latestActivity(9000, "5000")).toBe(9000);
    expect(latestActivity(1000, "nope")).toBe(1000);
    expect(latestActivity(1000, null)).toBe(1000);
  });
});
