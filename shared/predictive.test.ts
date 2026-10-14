import { describe, expect, it } from "vitest";
import { dailyKm, daysBetween, projectOdometer, riskBand, vehicleHealth, type HealthInputs } from "./predictive";

const DAY = 86_400_000;
const T0 = Date.parse("2026-06-01T00:00:00Z");
const TODAY = "2026-10-08";

const base: HealthInputs = {
  odometer: 50_000,
  readings: [],
  reminders: [],
  issues_90d: 0,
  issues_180d: 0,
  open_critical: 0,
  open_high: 0,
  cost_90d: 0,
  cost_prev_90d: 0,
  age_years: 2,
  days_since_inspection: 10,
};

describe("dailyKm", () => {
  it("fits a least-squares slope", () => {
    const pts = [0, 10, 20, 30].map((d) => ({ t: T0 + d * DAY, km: 10_000 + d * 120 }));
    expect(dailyKm(pts)).toBe(120);
  });
  it("needs two readings at least a week apart", () => {
    expect(dailyKm([{ t: T0, km: 1 }])).toBeNull();
    expect(dailyKm([{ t: T0, km: 1 }, { t: T0 + 6 * DAY, km: 900 }])).toBeNull();
  });
  it("never goes negative (odometer corrections)", () => {
    expect(dailyKm([{ t: T0, km: 5000 }, { t: T0 + 30 * DAY, km: 4000 }])).toBe(0);
  });
});

describe("vehicleHealth", () => {
  it("a healthy vehicle scores zero", () => {
    const h = vehicleHealth(base, TODAY);
    expect(h.risk_score).toBe(0);
    expect(h.band).toBe("low");
    expect(h.factors).toEqual([]);
  });

  it("projects service by km through usage and picks the nearest reminder", () => {
    const readings = [0, 30, 60].map((d) => ({ t: T0 + d * DAY, km: 48_800 + d * 20 }));
    const h = vehicleHealth({ ...base, readings, reminders: [{ due_km: 50_200, due_date: null }, { due_km: null, due_date: "2026-12-31" }] }, TODAY);
    expect(h.avg_daily_km).toBe(20);
    expect(h.days_to_service).toBe(10);
    expect(h.factors.map((f) => f.code)).toEqual(["service_due_14d"]);
    expect(h.risk_score).toBe(20);
  });

  it("flags an overdue service by km or date", () => {
    expect(vehicleHealth({ ...base, reminders: [{ due_km: 49_000, due_date: null }] }, TODAY).factors[0].code).toBe("service_overdue");
    const byDate = vehicleHealth({ ...base, reminders: [{ due_km: null, due_date: "2026-10-01" }] }, TODAY);
    expect(byDate.service_overdue).toBe(true);
    expect(byDate.days_to_service).toBe(-7);
  });

  it("adds up a risky vehicle and caps at 100", () => {
    const h = vehicleHealth(
      {
        ...base,
        reminders: [{ due_km: 49_000, due_date: null }],
        open_critical: 1,
        issues_90d: 3,
        issues_180d: 4,
        cost_90d: 2000,
        cost_prev_90d: 500,
        age_years: 12,
        days_since_inspection: null,
      },
      TODAY,
    );
    // 30 + 20 + 15 + 15 (4 issues / 500 km floor = 8 per 1,000 km) + 10 + 10 + 10 = 110 → 100
    expect(h.issue_rate).toBe(8);
    expect(h.factors.map((f) => f.code)).toEqual([
      "service_overdue", "open_critical_issue", "repeat_failure", "issue_rate_high", "cost_rising", "age_10y", "inspection_overdue",
    ]);
    expect(h.factors.find((f) => f.code === "cost_rising")?.value).toBe(4);
    expect(h.risk_score).toBe(100);
    expect(h.band).toBe("high");
  });

  it("medium band and secondary tiers", () => {
    const readings = [0, 90].map((d) => ({ t: T0 + d * DAY, km: 40_000 + d * 50 }));
    const h = vehicleHealth(
      { ...base, readings, open_high: 2, issues_180d: 9, cost_90d: 300, age_years: 7, days_since_inspection: 120 },
      TODAY,
    );
    // rate = 9 * 1000 / (50 * 180) = 1.0 → issue_rate 8; open_high 10; cost_new 5; age_6y 5; inspection 10
    expect(h.factors.map((f) => [f.code, f.points])).toEqual([
      ["open_high_issue", 10], ["issue_rate", 8], ["cost_new", 5], ["age_6y", 5], ["inspection_overdue", 10],
    ]);
    expect(h.risk_score).toBe(38);
    expect(h.band).toBe("medium");
  });
});

describe("helpers", () => {
  it("riskBand thresholds", () => {
    expect(riskBand(29)).toBe("low");
    expect(riskBand(30)).toBe("medium");
    expect(riskBand(60)).toBe("high");
  });
  it("daysBetween and projectOdometer", () => {
    expect(daysBetween("2026-10-08", "2026-10-18")).toBe(10);
    expect(projectOdometer(1000, 12.5, 30)).toBe(1375);
    expect(projectOdometer(1000, null, 30)).toBe(1000);
  });
});
