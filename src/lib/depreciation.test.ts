import { describe, expect, it } from "vitest";
import {
  accumulatedDepreciation, bookValue, disposalResult, monthlyCharges, monthsElapsed, yearlySchedule,
  type DepreciationInput,
} from "./depreciation";

const sl: DepreciationInput = { method: "straight_line", cost: 12000, salvage: 2000, lifeMonths: 60, purchaseDate: "2024-03-15" };
const db: DepreciationInput = { ...sl, method: "declining_balance" };

describe("depreciation", () => {
  it("counts the purchase month as month 1", () => {
    expect(monthsElapsed("2024-03-15", "2024-03-31")).toBe(1);
    expect(monthsElapsed("2024-03-15", "2025-02-01")).toBe(12);
    expect(monthsElapsed("2024-03-15", "2024-01-01")).toBe(0);
  });

  it("straight line: equal monthly charges down to salvage", () => {
    const c = monthlyCharges(sl);
    expect(c).toHaveLength(60);
    expect(c[0]).toBeCloseTo(166.6667, 3);
    expect(bookValue(sl, "2025-02-28")).toBe(10000);
    expect(bookValue(sl, "2030-01-01")).toBe(2000);
    expect(accumulatedDepreciation(sl, "2025-02-28")).toBe(2000);
  });

  it("declining balance: front-loaded, never below salvage, ends on salvage", () => {
    const c = monthlyCharges(db);
    expect(c[0]).toBeCloseTo(400, 6);
    expect(c[0]).toBeGreaterThan(c[30]);
    expect(c.reduce((s, x) => s + x, 0)).toBeCloseTo(10000, 6);
    expect(bookValue(db, "2025-02-28")).toBeLessThan(bookValue(sl, "2025-02-28"));
    expect(bookValue(db, "2040-01-01")).toBe(2000);
  });

  it("yearly schedule sums to cost minus salvage", () => {
    for (const input of [sl, db, { ...sl, lifeMonths: 30 }]) {
      const s = yearlySchedule(input);
      expect(s.reduce((t, y) => t + y.depreciation, 0)).toBeCloseTo(input.cost - input.salvage, 6);
      expect(s[s.length - 1].closingValue).toBe(input.salvage);
    }
    expect(yearlySchedule(sl).map((y) => y.from)).toEqual(["2024-03-01", "2025-03-01", "2026-03-01", "2027-03-01", "2028-03-01"]);
    expect(yearlySchedule({ ...sl, lifeMonths: 30 })).toHaveLength(3);
  });

  it("none or missing inputs keep the asset at cost", () => {
    expect(bookValue({ ...sl, method: "none" }, "2030-01-01")).toBe(12000);
    expect(bookValue({ ...sl, lifeMonths: null }, "2030-01-01")).toBe(12000);
    expect(bookValue({ ...sl, purchaseDate: null }, "2030-01-01")).toBe(12000);
    expect(yearlySchedule({ ...sl, method: "none" })).toEqual([]);
  });

  it("rounds to the currency's decimals", () => {
    const omr: DepreciationInput = { method: "straight_line", cost: 1000, salvage: 0, lifeMonths: 7, purchaseDate: "2026-01-01" };
    expect(bookValue(omr, "2026-01-31", 3)).toBe(857.143);
  });

  it("disposal gain or loss against book value", () => {
    expect(disposalResult(sl, "2025-02-28", 10500)).toBe(500);
    expect(disposalResult(sl, "2025-02-28", 9000)).toBe(-1000);
  });
});
