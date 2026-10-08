import { describe, expect, it } from "vitest";
import { computeGratuity, ksaResignationFactor, schemeForCountry, serviceDays } from "./gratuity";

describe("serviceDays", () => {
  it("counts both ends", () => {
    expect(serviceDays("2024-01-01", "2024-01-01")).toBe(1);
    expect(serviceDays("2023-01-01", "2023-12-31")).toBe(365);
  });
  it("is 0 when reversed or invalid", () => {
    expect(serviceDays("2024-02-01", "2024-01-01")).toBe(0);
    expect(serviceDays("nope", "2024-01-01")).toBe(0);
  });
});

describe("UAE gratuity", () => {
  const base = { scheme: "uae" as const, monthlyWage: 3650, reason: "termination" as const };

  it("pays nothing under one year", () => {
    const r = computeGratuity({ ...base, startDate: "2025-01-01", endDate: "2025-12-30" });
    expect(r.amount).toBe(0);
  });

  it("pays 21 days per year for the first five years", () => {
    // 3 years exactly (1095 days): daily = 3650 * 12 / 365 = 120; 120 * 21 * 3 = 7560
    const r = computeGratuity({ ...base, startDate: "2020-01-01", endDate: "2022-12-30" });
    expect(r.serviceDays).toBe(1095);
    expect(r.amount).toBeCloseTo(7560, 6);
  });

  it("pays 30 days per year after five, pro-rata", () => {
    // 7.5 years = 2737.5 days → use 2738 days: years = 7.50137
    const r = computeGratuity({ ...base, startDate: "2015-01-01", endDate: "2022-07-01" });
    const years = r.serviceDays / 365;
    expect(r.amount).toBeCloseTo(120 * (21 * 5 + 30 * (years - 5)), 6);
  });

  it("does not reduce on resignation", () => {
    const a = computeGratuity({ ...base, startDate: "2020-01-01", endDate: "2022-12-30" });
    const b = computeGratuity({ ...base, reason: "resignation", startDate: "2020-01-01", endDate: "2022-12-30" });
    expect(b.amount).toBe(a.amount);
  });

  it("caps at two years' wage", () => {
    const r = computeGratuity({ ...base, startDate: "1990-01-01", endDate: "2024-12-31" });
    expect(r.capped).toBe(true);
    expect(r.amount).toBe(3650 * 24);
  });
});

describe("KSA gratuity", () => {
  const base = { scheme: "ksa" as const, monthlyWage: 10000 };

  it("pays half a month per year for the first five, a month after", () => {
    const r = computeGratuity({ ...base, reason: "termination", startDate: "2014-01-01", endDate: "2023-12-29" });
    // 3650 days = 10 years: 0.5 * 5 + 5 = 7.5 months
    expect(r.serviceDays).toBe(3650);
    expect(r.amount).toBeCloseTo(75000, 6);
  });

  it("pro-rates part years", () => {
    const r = computeGratuity({ ...base, reason: "termination", startDate: "2023-01-01", endDate: "2023-07-01" });
    expect(r.amount).toBeCloseTo(10000 * 0.5 * (182 / 365), 6);
  });

  it("applies the resignation reductions", () => {
    expect(ksaResignationFactor(1.9)).toBe(0);
    expect(ksaResignationFactor(2)).toBeCloseTo(1 / 3);
    expect(ksaResignationFactor(5)).toBeCloseTo(2 / 3);
    expect(ksaResignationFactor(10)).toBe(1);
    // 3 years, resigned: 1.5 months * 1/3 = 0.5 month
    const r = computeGratuity({ ...base, reason: "resignation", startDate: "2020-01-01", endDate: "2022-12-30" });
    expect(r.fullAmount).toBeCloseTo(15000, 6);
    expect(r.amount).toBeCloseTo(5000, 6);
    const short = computeGratuity({ ...base, reason: "resignation", startDate: "2023-01-01", endDate: "2023-12-31" });
    expect(short.amount).toBe(0);
  });

  it("treats a missing wage as zero", () => {
    expect(computeGratuity({ ...base, monthlyWage: Number.NaN, reason: "termination", startDate: "2020-01-01", endDate: "2024-01-01" }).amount).toBe(0);
  });
});

describe("schemeForCountry", () => {
  it("uses UAE rules for AE only", () => {
    expect(schemeForCountry("AE")).toBe("uae");
    expect(schemeForCountry("ae")).toBe("uae");
    expect(schemeForCountry("SA")).toBe("ksa");
    expect(schemeForCountry(null)).toBe("ksa");
  });
});
