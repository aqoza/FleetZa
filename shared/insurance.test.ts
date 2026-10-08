import { describe, expect, it } from "vitest";
import {
  CLAIM_TRANSITIONS,
  annualPremium,
  claimShortfall,
  coverOn,
  daysBetween,
  lossRatio,
  policyCovers,
  policyStatus,
  premiumByYear,
} from "./insurance";

const base = { start_date: "2026-01-01", end_date: "2026-12-31", canceled_at: null };

describe("policyStatus", () => {
  it("derives the status from the dates", () => {
    expect(policyStatus(base, "2026-06-01")).toBe("active");
    expect(policyStatus(base, "2026-12-01")).toBe("expiring");
    expect(policyStatus(base, "2026-12-31")).toBe("expiring");
    expect(policyStatus(base, "2027-01-01")).toBe("expired");
    expect(policyStatus(base, "2025-12-31")).toBe("upcoming");
    expect(policyStatus({ ...base, canceled_at: "2026-03-01" }, "2026-02-01")).toBe("canceled");
  });
});

describe("policyCovers", () => {
  it("stops at the cancellation date", () => {
    const p = { ...base, canceled_at: "2026-03-01" };
    expect(policyCovers(p, "2026-03-01")).toBe(true);
    expect(policyCovers(p, "2026-03-02")).toBe(false);
    expect(policyCovers(base, "2025-12-31")).toBe(false);
  });
});

describe("premiums", () => {
  it("annualizes by frequency", () => {
    expect(annualPremium(100, "monthly")).toBe(1200);
    expect(annualPremium(300, "quarterly")).toBe(1200);
    expect(annualPremium(600, "semi_annual")).toBe(1200);
    expect(annualPremium(1200, "annual")).toBe(1200);
  });

  it("spreads a policy across calendar years and stops at cancellation", () => {
    const p = { start_date: "2025-07-01", end_date: "2026-06-30", canceled_at: null, premium: 365, premium_frequency: "annual" as const };
    const m = premiumByYear([p], [2025, 2026]);
    expect(m.get(2025)).toBe(184);
    expect(m.get(2026)).toBe(181);
    const c = premiumByYear([{ ...p, canceled_at: "2025-12-31" }], [2025, 2026]);
    expect(c.get(2025)).toBe(184);
    expect(c.get(2026)).toBe(0);
  });

  it("computes the loss ratio as a percentage", () => {
    expect(lossRatio(500, 2000)).toBe(25);
    expect(lossRatio(1, 3)).toBe(33.3);
    expect(lossRatio(100, 0)).toBeNull();
  });
});

describe("cover rows and claims", () => {
  it("checks a vehicle's cover on a day", () => {
    expect(coverOn({ added_on: "2026-01-10", removed_on: null }, "2026-01-10")).toBe(true);
    expect(coverOn({ added_on: "2026-01-10", removed_on: "2026-02-01" }, "2026-02-02")).toBe(false);
    expect(coverOn({ added_on: "2026-01-10", removed_on: null }, "2026-01-09")).toBe(false);
  });

  it("allows only the database's transitions", () => {
    expect(CLAIM_TRANSITIONS.draft).toEqual(["submitted", "withdrawn"]);
    expect(CLAIM_TRANSITIONS.under_review).toContain("approved");
    expect(CLAIM_TRANSITIONS.rejected).toEqual([]);
  });

  it("computes the shortfall from paid, else approved", () => {
    expect(claimShortfall({ amount_claimed: 4200, amount_approved: 3950, amount_paid: null })).toBe(250);
    expect(claimShortfall({ amount_claimed: 4200, amount_approved: 3950, amount_paid: 3900 })).toBe(300);
    expect(claimShortfall({ amount_claimed: 4200, amount_approved: null, amount_paid: null })).toBeNull();
  });

  it("counts days between dates", () => {
    expect(daysBetween("2026-02-28", "2026-03-01")).toBe(1);
    expect(daysBetween("2026-03-01", "2026-02-28")).toBe(-1);
  });
});
