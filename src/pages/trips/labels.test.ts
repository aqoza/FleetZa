import { describe, expect, it } from "vitest";
import { fromInput, toInput } from "./labels";

describe("TRIP-UI-001 completion timestamp", () => {
  it("keeps a same-minute completion after the recorded start", () => {
    const started = new Date(2026, 9, 14, 14, 19, 35, 123);
    const finished = new Date(2026, 9, 14, 14, 19, 40, 456);
    const submitted = fromInput(toInput(finished.toISOString(), "millisecond"))!;
    expect(submitted).toBe(finished.toISOString());
    expect(Date.parse(submitted)).toBeGreaterThan(started.getTime());
  });

  it("retains minute precision for planning and supports clearing", () => {
    expect(toInput(fromInput("2026-10-14T14:19"))).toBe("2026-10-14T14:19");
    expect(toInput(null, "millisecond")).toBe("");
    expect(fromInput("")).toBeNull();
  });
});
