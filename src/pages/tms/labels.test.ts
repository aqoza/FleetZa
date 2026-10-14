import { describe, expect, it } from "vitest";
import { fromLocalInput, toLocalInput } from "./labels";

describe("TMS-UI-001 delivery timestamp", () => {
  it("keeps a same-minute delivery within dispatch and current-time bounds", () => {
    const dispatched = new Date(2026, 9, 14, 14, 23, 20, 123);
    const delivered = new Date(2026, 9, 14, 14, 23, 30, 456);
    const now = new Date(2026, 9, 14, 14, 23, 31, 789);
    const input = toLocalInput(delivered.toISOString(), "millisecond");
    expect(fromLocalInput(input)).toBe(delivered.toISOString());
    expect(input >= toLocalInput(dispatched.toISOString(), "millisecond")).toBe(true);
    expect(input <= toLocalInput(now.toISOString(), "millisecond")).toBe(true);
  });

  it("retains minute precision for planned windows and empty fields", () => {
    expect(toLocalInput(fromLocalInput("2026-10-14T14:23"))).toBe("2026-10-14T14:23");
    expect(toLocalInput(null, "millisecond")).toBe("");
    expect(fromLocalInput("")).toBeNull();
  });
});
