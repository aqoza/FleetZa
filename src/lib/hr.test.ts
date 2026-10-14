import { describe, expect, it } from "vitest";
import { clockHours, leaveMoves, monthBounds, payrollEditable, weekendFromWeekStart, workdays } from "./hr";

describe("weekendFromWeekStart", () => {
  it("maps week starts to weekends", () => {
    expect(weekendFromWeekStart(0)).toEqual([5, 6]);
    expect(weekendFromWeekStart(1)).toEqual([0, 6]);
    expect(weekendFromWeekStart(6)).toEqual([5]);
  });
});

describe("workdays", () => {
  it("matches app.hr_workdays", () => {
    // 2026-10-01 is a Thursday; Fri/Sat weekend leaves 6 of 10 days.
    expect(workdays("2026-10-01", "2026-10-10", [5, 6])).toBe(6);
    expect(workdays("2026-10-04", "2026-10-08", [5, 6])).toBe(5);
    expect(workdays("2026-10-09", "2026-10-10", [5, 6])).toBe(0);
    expect(workdays("2026-10-10", "2026-10-01", [5, 6])).toBe(0);
  });
});

describe("clockHours", () => {
  it("handles same-day and overnight shifts", () => {
    expect(clockHours("08:00", "17:30")).toBe(9.5);
    expect(clockHours("22:00", "06:00")).toBe(8);
    expect(clockHours("", "06:00")).toBeNull();
  });
});

describe("monthBounds", () => {
  it("returns the first and last day", () => {
    expect(monthBounds("2026-02-14")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(monthBounds("2028-02-01")).toEqual({ start: "2028-02-01", end: "2028-02-29" });
    expect(monthBounds("2026-12-31")).toEqual({ start: "2026-12-01", end: "2026-12-31" });
  });
});

describe("state helpers", () => {
  it("lists legal leave moves", () => {
    expect(leaveMoves("pending")).toEqual(["approved", "rejected", "canceled"]);
    expect(leaveMoves("approved")).toEqual(["canceled"]);
    expect(leaveMoves("rejected")).toEqual([]);
  });
  it("locks approved runs", () => {
    expect(payrollEditable("draft")).toBe(true);
    expect(payrollEditable("calculated")).toBe(true);
    expect(payrollEditable("approved")).toBe(false);
  });
});
