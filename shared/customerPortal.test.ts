import { describe, expect, it } from "vitest";
import { balanceByCurrency, linkState, nextRequestStatuses, portalUrl } from "./customerPortal";

describe("customer portal", () => {
  it("open requests move anywhere but back to new", () => {
    expect(nextRequestStatuses("new")).toEqual(["in_review", "scheduled", "done", "rejected"]);
    expect(nextRequestStatuses("scheduled")).toEqual(["in_review", "done", "rejected"]);
  });

  it("closed requests only reopen to in review", () => {
    expect(nextRequestStatuses("done")).toEqual(["in_review"]);
    expect(nextRequestStatuses("rejected")).toEqual(["in_review"]);
  });

  it("revoked wins over expiry", () => {
    const now = "2026-10-09T12:00:00Z";
    expect(linkState({ active: false, expires_at: "2020-01-01T00:00:00Z" }, now)).toBe("revoked");
    expect(linkState({ active: true, expires_at: "2026-10-09T11:59:59Z" }, now)).toBe("expired");
    expect(linkState({ active: true, expires_at: null }, now)).toBe("active");
  });

  it("builds the public link", () => {
    expect(portalUrl("https://fleetza.pages.dev", "abc")).toBe("https://fleetza.pages.dev/portal/abc");
  });

  it("sums open balances per currency", () => {
    expect(balanceByCurrency([
      { balance: "10.5", currency: "OMR" }, { balance: 0, currency: "OMR" }, { balance: 4.25, currency: "OMR" },
      { balance: 100, currency: "USD" },
    ])).toEqual([["OMR", 14.75], ["USD", 100]]);
  });
});
