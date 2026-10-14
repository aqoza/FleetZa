import { describe, expect, it } from "vitest";
import { coerceDimension, fillSeries, periodRange, suggestedType, toCsv, totalOf, weekStart } from "./bi";

describe("metric catalog", () => {
  it("falls back to a dimension the metric has", () => {
    expect(coerceDimension("payroll_net", "vehicle")).toBe("none");
    expect(coerceDimension("fuel_cost", "driver")).toBe("driver");
    expect(coerceDimension("nope", "month")).toBe("none");
  });

  it("suggests a chart per dimension", () => {
    expect(suggestedType("none")).toBe("kpi");
    expect(suggestedType("month")).toBe("bar");
    expect(suggestedType("status")).toBe("pie");
    expect(suggestedType("vehicle")).toBe("bar");
  });
});

describe("periods", () => {
  it("computes inclusive ranges ending today", () => {
    expect(periodRange("last_30_days", "2026-10-09")).toEqual({ from: "2026-09-10", to: "2026-10-09" });
    expect(periodRange("last_90_days", "2026-03-01")).toEqual({ from: "2025-12-02", to: "2026-03-01" });
    expect(periodRange("this_year", "2026-10-09")).toEqual({ from: "2026-01-01", to: "2026-10-09" });
    expect(periodRange("last_12_months", "2026-10-09")).toEqual({ from: "2025-11-01", to: "2026-10-09" });
    expect(periodRange("custom", "2026-10-09", "2026-01-05", "2026-02-01")).toEqual({ from: "2026-01-05", to: "2026-02-01" });
  });

  it("finds the Monday of a week", () => {
    expect(weekStart("2026-10-09")).toBe("2026-10-05");
    expect(weekStart("2026-10-05")).toBe("2026-10-05");
    expect(weekStart("2026-10-11")).toBe("2026-10-05");
  });
});

describe("series", () => {
  it("fills empty months with zero", () => {
    const rows = fillSeries([{ key: "2026-08", label: "2026-08", value: 5 }], "month", "2026-06-15", "2026-09-01");
    expect(rows.map((r) => [r.key, r.value])).toEqual([["2026-06", 0], ["2026-07", 0], ["2026-08", 5], ["2026-09", 0]]);
  });

  it("fills empty weeks with zero", () => {
    const rows = fillSeries([{ key: "2026-09-28", label: "2026-09-28", value: 2 }], "week", "2026-09-22", "2026-10-09");
    expect(rows.map((r) => r.key)).toEqual(["2026-09-21", "2026-09-28", "2026-10-05"]);
    expect(totalOf(rows)).toBe(2);
  });

  it("leaves rankings untouched", () => {
    const rows = [{ key: "a", label: "A", value: 1 }];
    expect(fillSeries(rows, "vehicle", "2026-01-01", "2026-02-01")).toBe(rows);
  });

  it("writes CSV with quoting", () => {
    expect(toCsv(["Vehicle", "Fuel"], [{ label: 'Truck "7", A', value: 12.5 }])).toBe('Vehicle,Fuel\n"Truck ""7"", A",12.5');
  });
});
