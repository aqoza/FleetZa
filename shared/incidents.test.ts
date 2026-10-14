import { describe, expect, it } from "vitest";
import {
  INCIDENT_TRANSITIONS, byType, driverStats, incidentCost, lastMonths, monthIn, monthlyStats, needsRootCause, ourFault,
  type DriverRow,
} from "./incidents";

const row = (o: Partial<DriverRow>): DriverRow => ({
  occurred_at: "2026-09-10T08:00:00Z", incident_type: "collision", severity: "minor", injuries: 0, actual_cost: null,
  estimated_damage: null, driver_id: "d1", at_fault: "unknown", ...o,
});

describe("incident rules", () => {
  it("mirrors the database transitions", () => {
    expect(INCIDENT_TRANSITIONS.reported).toEqual(["investigating", "resolved"]);
    expect(INCIDENT_TRANSITIONS.resolved).toContain("investigating");
    expect(INCIDENT_TRANSITIONS.closed).toEqual([]);
  });

  it("needs a root cause only for serious incidents", () => {
    expect(needsRootCause({ severity: "major", root_cause: " " })).toBe(true);
    expect(needsRootCause({ severity: "critical", root_cause: "Brakes" })).toBe(false);
    expect(needsRootCause({ severity: "moderate", root_cause: null })).toBe(false);
  });

  it("uses the actual cost once known", () => {
    expect(incidentCost({ actual_cost: 900, estimated_damage: 1200 })).toBe(900);
    expect(incidentCost({ actual_cost: null, estimated_damage: 1200 })).toBe(1200);
    expect(incidentCost({ actual_cost: null, estimated_damage: null })).toBe(0);
  });

  it("counts our driver and shared fault against the driver", () => {
    expect(ourFault("our_driver")).toBe(true);
    expect(ourFault("shared")).toBe(true);
    expect(ourFault("third_party")).toBe(false);
  });
});

describe("overview figures", () => {
  it("lists the last months across a year boundary", () => {
    expect(lastMonths("2026-02-15", 4)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });

  it("buckets by month in the tenant's time zone", () => {
    expect(monthIn("2026-09-30T22:30:00Z", "Asia/Muscat")).toBe("2026-10");
    const s = monthlyStats(
      [row({ occurred_at: "2026-09-30T22:30:00Z", severity: "major", estimated_damage: 500 }), row({ occurred_at: "2026-09-02T08:00:00Z" })],
      ["2026-09", "2026-10"], "Asia/Muscat",
    );
    expect(s).toEqual([
      { month: "2026-09", count: 1, serious: 0, cost: 0 },
      { month: "2026-10", count: 1, serious: 1, cost: 500 },
    ]);
  });

  it("groups by type, most frequent first", () => {
    const t = byType([row({ incident_type: "theft", actual_cost: 50 }), row({}), row({ actual_cost: 10 })]);
    expect(t.map((x) => [x.type, x.count, x.cost])).toEqual([["collision", 2, 10], ["theft", 1, 50]]);
  });

  it("ranks drivers by at-fault incidents", () => {
    const s = driverStats([
      row({ driver_id: "a", at_fault: "third_party", actual_cost: 100 }),
      row({ driver_id: "a", at_fault: "third_party", occurred_at: "2026-10-01T00:00:00Z" }),
      row({ driver_id: "b", at_fault: "our_driver", severity: "critical", injuries: 2 }),
      row({ driver_id: null }),
    ]);
    expect(s.map((x) => x.driverId)).toEqual(["b", "a"]);
    expect(s[0]).toMatchObject({ atFault: 1, serious: 1, injuries: 2 });
    expect(s[1]).toMatchObject({ count: 2, cost: 100, last: "2026-10-01T00:00:00Z" });
  });
});
