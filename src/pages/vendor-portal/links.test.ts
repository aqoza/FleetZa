import { describe, expect, it } from "vitest";
import { linkState, outstandingByCurrency, vendorLinkUrl } from "./links";

describe("vendor portal links", () => {
  const now = "2026-10-08T12:00:00.000Z";
  it("revoked wins over expiry", () => {
    expect(linkState({ active: false, expires_at: "2027-01-01T00:00:00+00:00" }, now)).toBe("revoked");
  });
  it("expires by instant, across timestamp formats", () => {
    expect(linkState({ active: true, expires_at: "2026-10-08T11:59:59+00:00" }, now)).toBe("expired");
    expect(linkState({ active: true, expires_at: "2026-10-08T12:00:01+00:00" }, now)).toBe("active");
    expect(linkState({ active: true, expires_at: null }, now)).toBe("active");
  });
  it("builds the public URL", () => {
    expect(vendorLinkUrl("abc", "https://fleetza.pages.dev")).toBe("https://fleetza.pages.dev/vendor/abc");
  });
  it("sums what is outstanding per currency, skipping void and settled bills", () => {
    expect(
      outstandingByCurrency([
        { status: "open", balance: 10.1, currency: "OMR" },
        { status: "partially_paid", balance: 0.2, currency: "OMR" },
        { status: "void", balance: 99, currency: "OMR" },
        { status: "paid", balance: 0, currency: "USD" },
        { status: "open", balance: 5, currency: "USD" },
      ]),
    ).toEqual([["OMR", 10.3], ["USD", 5]]);
  });
});
