import { describe, expect, it } from "vitest";
import {
  daysBetween, documentBucket, employeeDocuments, employeeName, monthlyPackage, nextDocument,
  orgChart, yearsOfService,
} from "./employees";

const TODAY = "2026-10-08";

describe("documentBucket", () => {
  it("buckets by the scanner's 60/30/7/0 thresholds", () => {
    expect(documentBucket(null, TODAY)).toBe("none");
    expect(documentBucket("2026-10-07", TODAY)).toBe("expired");
    expect(documentBucket("2026-10-08", TODAY)).toBe("d7");
    expect(documentBucket("2026-10-15", TODAY)).toBe("d7");
    expect(documentBucket("2026-10-16", TODAY)).toBe("d30");
    expect(documentBucket("2026-11-07", TODAY)).toBe("d30");
    expect(documentBucket("2026-11-08", TODAY)).toBe("d60");
    expect(documentBucket("2026-12-07", TODAY)).toBe("d60");
    expect(documentBucket("2026-12-08", TODAY)).toBe("ok");
  });

  it("counts calendar days across a DST-free UTC clock", () => {
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2);
    expect(daysBetween("2026-10-08", "2026-10-01")).toBe(-7);
  });
});

describe("employeeDocuments", () => {
  const e = {
    passport_expiry: "2028-01-01",
    residence_permit_expiry: "2026-10-20",
    work_permit_expiry: null,
  };

  it("lists dated documents soonest first and skips undated ones", () => {
    const docs = employeeDocuments(e, TODAY);
    expect(docs.map((d) => d.kind)).toEqual(["residence_permit", "passport"]);
    expect(docs[0]).toMatchObject({ days: 12, bucket: "d30" });
  });

  it("nextDocument is the most urgent one, or null", () => {
    expect(nextDocument(e, TODAY)?.kind).toBe("residence_permit");
    expect(
      nextDocument({ passport_expiry: null, residence_permit_expiry: null, work_permit_expiry: null }, TODAY),
    ).toBeNull();
  });
});

describe("employeeName", () => {
  it("joins first and last name, tolerating a missing last name", () => {
    expect(employeeName({ first_name: "Aisha", last_name: "Al Harthy" })).toBe("Aisha Al Harthy");
    expect(employeeName({ first_name: "Ravi", last_name: null })).toBe("Ravi");
  });

  it("leads with the Arabic name on an Arabic page", () => {
    expect(employeeName({ first_name: "Aisha", last_name: "Al Harthy", name_ar: "عائشة الحارثي" }, "ar"))
      .toBe("عائشة الحارثي");
    expect(employeeName({ first_name: "Ravi", last_name: null, name_ar: null }, "ar")).toBe("Ravi");
  });
});

describe("monthlyPackage", () => {
  it("adds basic and allowances, and is null when nothing is set", () => {
    expect(
      monthlyPackage({ basic_salary: 500, housing_allowance: 150, transport_allowance: null, other_allowance: 25.5 }),
    ).toBe(675.5);
    expect(
      monthlyPackage({ basic_salary: null, housing_allowance: null, transport_allowance: null, other_allowance: null }),
    ).toBeNull();
  });
});

describe("yearsOfService", () => {
  it("counts completed years, stopping at termination", () => {
    expect(yearsOfService("2020-10-09", TODAY)).toBe(5);
    expect(yearsOfService("2020-10-08", TODAY)).toBe(6);
    expect(yearsOfService("2026-01-01", TODAY)).toBe(0);
    expect(yearsOfService("2015-02-01", TODAY, "2019-01-31")).toBe(3);
    expect(yearsOfService(null, TODAY)).toBeNull();
  });
});

describe("orgChart", () => {
  const e = (id: string, manager_id: string | null) => ({ id, manager_id, name: id });
  const name = (x: { name: string }) => x.name;

  it("orders managers before their reports, depth-first, siblings by name", () => {
    const rows = orgChart([e("c", "a"), e("a", null), e("b", "a"), e("d", "b")], name);
    expect(rows.map((r) => [r.employee.id, r.depth])).toEqual([
      ["a", 0], ["b", 1], ["d", 2], ["c", 1],
    ]);
  });

  it("promotes employees whose manager is missing to roots", () => {
    const rows = orgChart([e("x", "gone"), e("y", null)], name);
    expect(rows.map((r) => [r.employee.id, r.depth])).toEqual([["x", 0], ["y", 0]]);
  });

  it("never loops on a reporting cycle and keeps everyone", () => {
    const rows = orgChart([e("p", "q"), e("q", "p"), e("r", "p")], name);
    expect(rows.map((r) => r.employee.id).sort()).toEqual(["p", "q", "r"]);
    expect(new Set(rows.map((r) => r.employee.id)).size).toBe(3);
  });
});
