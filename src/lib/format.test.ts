import { describe, expect, it } from "vitest";
import {
  computeEfficiency,
  daysUntil,
  displayToKm,
  displayToLiters,
  efficiencyLabel,
  formatDistance,
  formatMoney,
  formatVolume,
  kmToDisplay,
  litersToDisplay,
} from "./format";
import type { Tenant } from "./types";

const tenant = (over: Partial<Tenant> = {}): Tenant => ({
  id: "t1",
  name: "Test",
  archetype: "fleet_operator",
  country: "US",
  currency: "USD",
  distance_unit: "km",
  volume_unit: "L",
  timezone: "UTC",
  tax_registration_number: null,
  address: null,
  phone: null,
  created_at: "2026-01-01T00:00:00Z",
  ...over,
});

describe("distance conversion", () => {
  it("is identity for km", () => {
    expect(kmToDisplay(100, "km")).toBe(100);
    expect(displayToKm(100, "km")).toBe(100);
  });

  it("converts km <-> miles", () => {
    expect(kmToDisplay(160.9344, "mi")).toBeCloseTo(100, 6);
    expect(displayToKm(100, "mi")).toBeCloseTo(160.9344, 4);
  });

  it("round-trips", () => {
    expect(displayToKm(kmToDisplay(12345.6, "mi"), "mi")).toBeCloseTo(12345.6, 6);
  });
});

describe("volume conversion", () => {
  it("is identity for liters", () => {
    expect(litersToDisplay(50, "L")).toBe(50);
    expect(displayToLiters(50, "L")).toBe(50);
  });

  it("converts liters <-> US gallons", () => {
    expect(litersToDisplay(3.785411784, "gal")).toBeCloseTo(1, 9);
    expect(displayToLiters(1, "gal")).toBeCloseTo(3.785411784, 9);
  });
});

describe("formatMoney", () => {
  it("formats known currency", () => {
    expect(formatMoney(1234.5, "USD")).toMatch(/1,?234\.50/);
  });

  it("returns em dash for null/undefined", () => {
    expect(formatMoney(null, "USD")).toBe("—");
    expect(formatMoney(undefined, "EUR")).toBe("—");
  });

  it("falls back for a bogus currency code", () => {
    expect(formatMoney(10, "XXXX")).toBe("XXXX 10.00");
  });
});

describe("formatDistance / formatVolume", () => {
  it("renders in tenant units", () => {
    expect(formatDistance(160.9344, "mi")).toBe("100 mi");
    expect(formatVolume(3.785411784, "gal")).toBe("1 gal");
  });

  it("em dash on null", () => {
    expect(formatDistance(null, "km")).toBe("—");
    expect(formatVolume(undefined, "L")).toBe("—");
  });
});

describe("daysUntil", () => {
  it("is 0-or-1 for today/tomorrow boundaries and negative for the past", () => {
    const today = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    expect(daysUntil(iso(new Date(today.getTime() + 5 * 86_400_000)))).toBeGreaterThanOrEqual(4);
    expect(daysUntil(iso(new Date(today.getTime() - 5 * 86_400_000)))).toBeLessThan(0);
  });
});

describe("computeEfficiency", () => {
  it("computes L/100km for metric tenants", () => {
    // 50 L over 500 km = 10 L/100km
    expect(computeEfficiency(500, 50, tenant())).toBeCloseTo(10, 6);
  });

  it("computes MPG for mi+gal tenants", () => {
    const t = tenant({ distance_unit: "mi", volume_unit: "gal" });
    // 160.9344 km = 100 mi; 7.570823568 L = 2 gal -> 50 MPG
    expect(computeEfficiency(160.9344, 7.570823568, t)).toBeCloseTo(50, 6);
  });

  it("uses L/100km for mixed unit tenants", () => {
    const t = tenant({ distance_unit: "mi", volume_unit: "L" });
    expect(computeEfficiency(200, 20, t)).toBeCloseTo(10, 6);
    expect(efficiencyLabel(t)).toBe("L/100km");
  });

  it("returns null for non-positive inputs", () => {
    expect(computeEfficiency(0, 50, tenant())).toBeNull();
    expect(computeEfficiency(100, 0, tenant())).toBeNull();
    expect(computeEfficiency(-5, 10, tenant())).toBeNull();
  });

  it("labels MPG only for mi+gal", () => {
    expect(efficiencyLabel(tenant({ distance_unit: "mi", volume_unit: "gal" }))).toBe("MPG");
    expect(efficiencyLabel(tenant())).toBe("L/100km");
  });
});
