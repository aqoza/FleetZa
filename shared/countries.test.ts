import { describe, expect, it } from "vitest";
import {
  COUNTRIES,
  getCountry,
  isSupportedCountry,
  middleEastCountries,
  otherCountries,
  taxBreakdown,
} from "./countries";

const VALID_RENEWAL_TYPES = [
  "registration",
  "insurance",
  "permit",
  "emission_test",
  "roadworthiness",
  "other",
];

const middleEast = middleEastCountries();

describe("COUNTRIES registry", () => {
  it("keys every entry by its own code", () => {
    for (const [key, config] of Object.entries(COUNTRIES)) {
      expect(config.code).toBe(key);
    }
  });

  it("contains every middle-east and other entry exactly once", () => {
    const all = [...middleEast, ...otherCountries()];
    expect(Object.keys(COUNTRIES)).toHaveLength(all.length);
    for (const c of all) {
      expect(COUNTRIES[c.code]).toBe(c);
    }
  });
});

describe("middleEastCountries()", () => {
  it("is non-empty and sorted alphabetically by name", () => {
    expect(middleEast.length).toBeGreaterThan(0);
    const names = middleEast.map((c) => c.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it.each(middleEast)("$code ($name) has a valid config", (c) => {
    expect(c.code).toMatch(/^[A-Z]{2}$/);
    expect(c.region).toBe("middle-east");
    expect(c.name.length).toBeGreaterThan(0);
    expect(c.currency.length).toBeGreaterThan(0);
    expect(c.timezone.length).toBeGreaterThan(0);
    expect(c.locale.length).toBeGreaterThan(0);
    expect([0, 1, 6]).toContain(c.weekStart);
    expect(c.tax.rate).toBeGreaterThanOrEqual(0);
    expect(c.tax.label.length).toBeGreaterThan(0);
    expect(c.tax.registrationLabel.length).toBeGreaterThan(0);
    expect(c.regulations.renewals.length).toBeGreaterThan(0);
    for (const renewal of c.regulations.renewals) {
      expect(VALID_RENEWAL_TYPES).toContain(renewal.type);
      expect(renewal.label.length).toBeGreaterThan(0);
      expect(renewal.months).toBeGreaterThan(0);
    }
  });
});

describe("otherCountries()", () => {
  it("is non-empty, sorted by name, and tagged region 'other'", () => {
    const others = otherCountries();
    expect(others.length).toBeGreaterThan(0);
    const names = others.map((c) => c.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    for (const c of others) {
      expect(c.region).toBe("other");
    }
  });
});

describe("tax rates (verified standard rates)", () => {
  const RATES: ReadonlyArray<readonly [string, number]> = [
    ["AE", 5],
    ["SA", 15],
    ["BH", 10],
    ["OM", 5],
    ["EG", 14],
    ["JO", 16],
    ["IL", 18],
    ["TR", 20],
    ["LB", 11],
    ["QA", 0],
    ["KW", 0],
    ["IQ", 0],
  ];

  it.each(RATES)("%s has a standard rate of %d%%", (code, rate) => {
    expect(getCountry(code).tax.rate).toBe(rate);
  });
});

describe("currency minor-unit digits (engine vs Intl/CLDR)", () => {
  const DECIMALS: ReadonlyArray<readonly [string, number]> = [
    ["KW", 3], // KWD
    ["BH", 3], // BHD
    ["OM", 3], // OMR
    ["JO", 3], // JOD
    ["AE", 2], // AED
    ["SA", 2], // SAR
    ["IQ", 0], // IQD
  ];

  it.each(DECIMALS)("%s currency formats with %d fraction digits", (code, digits) => {
    const c = getCountry(code);
    const resolved = new Intl.NumberFormat(c.locale, {
      style: "currency",
      currency: c.currency,
    }).resolvedOptions();
    expect(resolved.maximumFractionDigits).toBe(digits);
    expect(c.currencyDecimals).toBe(digits);
  });
});

describe("locale date order", () => {
  it("en-AE formats dates day-first (dd/mm/yyyy)", () => {
    const formatted = new Intl.DateTimeFormat("en-AE").format(new Date(2026, 0, 31));
    expect(formatted).toBe("31/01/2026");
  });
});

describe("getCountry()", () => {
  it("resolves known codes case-insensitively", () => {
    expect(getCountry("AE").code).toBe("AE");
    expect(getCountry("ae").code).toBe("AE");
    expect(getCountry("sA").code).toBe("SA");
  });

  it("never throws and falls back to the generic config for unknown input", () => {
    for (const bad of ["ZZ", "", "!!", "USA", null, undefined]) {
      expect(() => getCountry(bad)).not.toThrow();
    }
    const fallback = getCountry("ZZ");
    expect(fallback.code).toBe("XX");
    expect(fallback.name).toBe("Other");
    expect(fallback.currency.length).toBeGreaterThan(0);
    expect(fallback.timezone.length).toBeGreaterThan(0);
    expect(fallback.tax.rate).toBe(0);
    expect(fallback.regulations.renewals.length).toBeGreaterThan(0);
    expect(getCountry(null)).toEqual(fallback);
    expect(getCountry(undefined)).toEqual(fallback);
  });
});

describe("isSupportedCountry()", () => {
  it("accepts known codes in any case", () => {
    expect(isSupportedCountry("AE")).toBe(true);
    expect(isSupportedCountry("ae")).toBe(true);
  });

  it("rejects unknown codes", () => {
    expect(isSupportedCountry("ZZ")).toBe(false);
    expect(isSupportedCountry("")).toBe(false);
  });
});

describe("taxBreakdown()", () => {
  it("adds tax on top of a net subtotal", () => {
    const b = taxBreakdown(100, 15);
    expect(b.subtotal).toBe(100);
    expect(b.taxRate).toBe(15);
    expect(b.taxAmount).toBe(15);
    expect(b.total).toBe(115);
  });

  it("rounds the tax amount to 2 decimals by default", () => {
    const b = taxBreakdown(33.33, 5);
    expect(b.taxAmount).toBeCloseTo(1.67, 2);
    expect(b.total).toBeCloseTo(35.0, 2);
  });

  it("keeps the default 2dp behavior for whole amounts", () => {
    const b = taxBreakdown(100, 15);
    expect(b.taxAmount).toBe(15);
    expect(b.total).toBe(115);
  });

  it("rounds to 3 decimals for 3-decimal currencies (BHD/OMR/JOD)", () => {
    const b = taxBreakdown(10.505, 10, 3);
    expect(b.taxAmount).toBeCloseTo(1.051, 3);
    expect(b.total).toBeCloseTo(11.556, 3);
  });

  it("rounds to whole units for 0-decimal currencies", () => {
    const exact = taxBreakdown(1000, 5, 0);
    expect(exact.taxAmount).toBe(50);
    expect(exact.total).toBe(1050);

    const rounded = taxBreakdown(999, 10, 0);
    expect(rounded.taxAmount).toBe(100);
    expect(rounded.total).toBe(1099);
  });

  it("treats a zero rate as no tax", () => {
    const b = taxBreakdown(100, 0);
    expect(b.taxAmount).toBe(0);
    expect(b.total).toBe(100);
  });

  it("treats a non-finite rate as no tax", () => {
    const b = taxBreakdown(100, NaN);
    expect(b.taxRate).toBe(0);
    expect(b.taxAmount).toBe(0);
    expect(b.total).toBe(100);
  });
});
