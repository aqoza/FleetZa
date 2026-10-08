import { describe, expect, it } from "vitest";
import { supplierNames, supplierStatus, supplierTypes } from "./labels";

describe("supplierNames", () => {
  it("leads with the Arabic name on an Arabic page when one exists", () => {
    expect(supplierNames({ name: "Gulf Parts", name_ar: "قطع الخليج" }, "ar")).toEqual({
      primary: "قطع الخليج",
      secondary: "Gulf Parts",
    });
  });

  it("keeps the registered name first in English", () => {
    expect(supplierNames({ name: "Gulf Parts", name_ar: "قطع الخليج" }, "en")).toEqual({
      primary: "Gulf Parts",
      secondary: "قطع الخليج",
    });
  });

  it("falls back to the registered name when there is no Arabic one", () => {
    expect(supplierNames({ name: "Gulf Parts", name_ar: null }, "ar")).toEqual({
      primary: "Gulf Parts",
      secondary: null,
    });
  });
});

describe("supplier label maps", () => {
  it("cover every value the database allows", () => {
    // Mirrors the check constraints on public.suppliers.
    expect(Object.keys(supplierTypes).sort()).toEqual(
      ["carrier", "equipment", "fuel", "insurance", "leasing", "other", "parts", "service", "utilities"],
    );
    expect(Object.keys(supplierStatus).sort()).toEqual(["active", "blocked", "inactive"]);
  });
});
