import { describe, expect, it } from "vitest";
import {
  bayUtilization, BOOKING_TRANSITIONS, elapsedLabel, findConflict, hoursBetween, laborByEmployee, overlaps, timelinePosition,
  weeklyHours, weekStart,
} from "./workshop";

const at = (h: number) => new Date(Date.UTC(2026, 9, 8, h)).toISOString(); // Thu 8 Oct 2026

describe("overlaps / findConflict", () => {
  it("treats slots as half-open, like the database", () => {
    expect(overlaps({ starts_at: at(8), ends_at: at(10) }, { starts_at: at(9), ends_at: at(11) })).toBe(true);
    expect(overlaps({ starts_at: at(8), ends_at: at(10) }, { starts_at: at(10), ends_at: at(11) })).toBe(false);
  });
  it("only live bookings in the same bay conflict", () => {
    const others = [
      { id: "a", bay_id: "L1", starts_at: at(8), ends_at: at(10), status: "done" as const },
      { id: "b", bay_id: "L2", starts_at: at(8), ends_at: at(10), status: "scheduled" as const },
      { id: "c", bay_id: "L1", starts_at: at(9), ends_at: at(12), status: "in_progress" as const },
    ];
    expect(findConflict({ bay_id: "L1", starts_at: at(8), ends_at: at(9), status: "scheduled" }, others)).toBeNull();
    expect(findConflict({ bay_id: "L1", starts_at: at(8), ends_at: at(10), status: "scheduled" }, others)?.id).toBe("c");
    expect(findConflict({ id: "c", bay_id: "L1", starts_at: at(9), ends_at: at(12), status: "in_progress" }, others)).toBeNull();
  });
});

describe("time helpers", () => {
  it("hours round to 2 decimals", () => {
    expect(hoursBetween(at(8), new Date(Date.UTC(2026, 9, 8, 10, 30)).toISOString())).toBe(2.5);
    expect(hoursBetween(at(8), new Date(Date.UTC(2026, 9, 8, 8, 20)).toISOString())).toBe(0.33);
  });
  it("elapsed label", () => {
    expect(elapsedLabel(at(8), Date.parse(at(10)) + 5 * 60_000)).toBe("2:05");
    expect(elapsedLabel(at(10), Date.parse(at(8)))).toBe("0:00");
  });
  it("timeline position clips to the window", () => {
    const day = new Date(at(6));
    expect(timelinePosition({ starts_at: at(8), ends_at: at(10) }, day, 12)).toEqual({ left: (2 / 12) * 100, width: (2 / 12) * 100 });
    expect(timelinePosition({ starts_at: at(4), ends_at: at(7) }, day, 12)).toEqual({ left: 0, width: (1 / 12) * 100 });
    expect(timelinePosition({ starts_at: at(19), ends_at: at(20) }, day, 12)).toBeNull();
  });
  it("transitions follow the guard", () => {
    expect(BOOKING_TRANSITIONS.scheduled).toEqual(["in_progress", "canceled"]);
    expect(BOOKING_TRANSITIONS.done).toEqual([]);
  });
});

describe("reports", () => {
  it("utilization clips bookings and ignores canceled", () => {
    const from = new Date(at(0));
    const to = new Date(Date.UTC(2026, 9, 9));
    const u = bayUtilization([
      { bay_id: "L1", starts_at: at(8), ends_at: at(11), status: "done" },
      { bay_id: "L1", starts_at: new Date(Date.UTC(2026, 9, 7, 22)).toISOString(), ends_at: at(1), status: "done" },
      { bay_id: "L1", starts_at: at(12), ends_at: at(15), status: "canceled" },
    ], ["L1", "L2"], from, to, 8);
    expect(u).toEqual([{ bayId: "L1", bookedHours: 4, pct: 50 }, { bayId: "L2", bookedHours: 0, pct: 0 }]);
  });
  it("labor by employee and week", () => {
    const rows = [
      { employee_id: "e1", started_at: at(8), hours: 2.5, cost: 11.25 },
      { employee_id: "e2", started_at: at(9), hours: 4, cost: 12 },
      { employee_id: "e1", started_at: new Date(Date.UTC(2026, 9, 1, 8)).toISOString(), hours: 3, cost: 13.5 },
      { employee_id: "e1", started_at: at(12), hours: null, cost: 0 },
    ];
    expect(laborByEmployee(rows)).toEqual([
      { employeeId: "e1", hours: 5.5, cost: 24.75, entries: 2 },
      { employeeId: "e2", hours: 4, cost: 12, entries: 1 },
    ]);
    expect(weekStart(at(8))).toBe("2026-10-05");
    expect(weeklyHours(rows, 2, new Date(at(12)))).toEqual([{ week: "2026-09-28", hours: 3 }, { week: "2026-10-05", hours: 6.5 }]);
  });
});
