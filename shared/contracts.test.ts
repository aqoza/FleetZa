import { describe, expect, it } from "vitest";
import { isBillingDue, isEndingSoon, mrr, nextPeriod, projectBillings, type RevenueTerms } from "./contracts";

const c = (o: Partial<RevenueTerms>): RevenueTerms => ({
  status: "active", billing_frequency: "monthly", next_billing_date: "2026-10-01", end_date: null, recurring_amount: 100, ...o,
});

describe("billing periods", () => {
  it("bills a month at a time and clamps month ends like Postgres", () => {
    expect(nextPeriod(c({}))).toEqual({ start: "2026-10-01", end: "2026-10-31", next: "2026-11-01" });
    expect(nextPeriod(c({ next_billing_date: "2026-01-31" }))).toEqual({ start: "2026-01-31", end: "2026-02-27", next: "2026-02-28" });
  });
  it("caps the last period at the end date and stops after it", () => {
    expect(nextPeriod(c({ billing_frequency: "quarterly", end_date: "2026-11-15" }))).toEqual({ start: "2026-10-01", end: "2026-11-15", next: "2027-01-01" });
    expect(nextPeriod(c({ next_billing_date: "2026-12-01", end_date: "2026-11-30" }))).toBeNull();
    expect(nextPeriod(c({ next_billing_date: null }))).toBeNull();
  });
  it("bills one-time contracts once for the whole term", () => {
    expect(nextPeriod(c({ billing_frequency: "one_time", end_date: "2027-03-31" }))).toEqual({ start: "2026-10-01", end: "2027-03-31", next: null });
  });
});

describe("revenue", () => {
  it("normalizes every frequency to a monthly figure", () => {
    expect(mrr(c({ recurring_amount: 300, billing_frequency: "quarterly" }))).toBe(100);
    expect(mrr(c({ recurring_amount: 1200, billing_frequency: "annual", vehicle_amount: 1200 }))).toBe(200);
    expect(mrr(c({ billing_frequency: "one_time" }))).toBe(0);
    expect(mrr(c({ status: "draft" }))).toBe(0);
  });
  it("projects billings by month, counting overdue periods in the first month", () => {
    const p = projectBillings([
      c({ next_billing_date: "2026-08-15" }),
      c({ billing_frequency: "quarterly", next_billing_date: "2026-11-01", recurring_amount: 900 }),
      c({ status: "expired", next_billing_date: "2026-10-01" }),
    ], "2026-10", 3);
    expect(p).toEqual([
      { month: "2026-10", amount: 300, count: 3 },
      { month: "2026-11", amount: 1000, count: 2 },
      { month: "2026-12", amount: 100, count: 1 },
    ]);
  });
  it("flags billing due and contracts in their notice window", () => {
    expect(isBillingDue(c({ next_billing_date: "2026-10-09" }), "2026-10-09")).toBe(true);
    expect(isBillingDue(c({ next_billing_date: "2026-10-10" }), "2026-10-09")).toBe(false);
    expect(isEndingSoon({ status: "active", end_date: "2026-12-01", notice_days: 60 }, "2026-10-09")).toBe(true);
    expect(isEndingSoon({ status: "active", end_date: "2026-12-01", notice_days: 10 }, "2026-10-09")).toBe(false);
  });
});
