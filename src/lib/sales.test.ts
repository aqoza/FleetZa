import { describe, expect, it } from "vitest";
import {
  balanceDue,
  computeLine,
  effectiveInvoiceStatus,
  effectiveQuoteStatus,
  isInvoiceOverdue,
  isQuoteExpired,
  roundTo,
  sumLines,
  winRate,
} from "./sales";

describe("roundTo()", () => {
  it("rounds to the requested scale", () => {
    expect(roundTo(1.6665, 2)).toBe(1.67);
    expect(roundTo(1.85175, 3)).toBe(1.852);
    expect(roundTo(1234.5, 0)).toBe(1235);
  });

  it("rounds halves away from zero, matching Postgres round(numeric, int)", () => {
    expect(roundTo(0.125, 2)).toBe(0.13);
    expect(roundTo(2.5, 0)).toBe(3);
    expect(roundTo(-2.5, 0)).toBe(-3);
    expect(roundTo(-0.125, 2)).toBe(-0.13);
  });

  it("is not fooled by binary-float artifacts", () => {
    // 1.005 is really 1.00499999999999989 in IEEE-754; Math.round(v*100)/100
    // returns 1.00 here, which would put a cent's difference between the
    // previewed total and the one the database stores.
    expect(roundTo(1.005, 2)).toBe(1.01);
    expect(roundTo(8.165, 2)).toBe(8.17);
    expect(roundTo(0.1 * 3, 2)).toBe(0.3);
  });

  it("survives non-finite input instead of producing NaN money", () => {
    expect(roundTo(Number.NaN, 2)).toBe(0);
    expect(roundTo(Number.POSITIVE_INFINITY, 2)).toBe(0);
  });
});

describe("computeLine()", () => {
  it("matches the database for a discounted, taxed line (2-decimal currency)", () => {
    // Same inputs as the migration's round-trip check: 2 × 100, −10%, +5% VAT.
    const line = computeLine(
      { quantity: 2, unit_price: 100, discount_percent: 10, tax_rate: 5 },
      2,
    );
    expect(line).toEqual({ gross: 200, discount: 20, net: 180, tax: 9, total: 189 });
  });

  it("rounds tax to the currency's minor units, not the raw product", () => {
    // 33.33 × 5% = 1.6665 → 1.67, so the line totals 35.00 exactly.
    const line = computeLine({ quantity: 1, unit_price: 33.33, tax_rate: 5 }, 2);
    expect(line.net).toBe(33.33);
    expect(line.tax).toBe(1.67);
    expect(line.total).toBe(35);
  });

  it("keeps three decimals for dinar currencies (OMR/KWD/BHD/JOD)", () => {
    // The home market: rounding this to 2 would bill 1.85 instead of 1.852.
    const line = computeLine({ quantity: 3, unit_price: 12.345, tax_rate: 5 }, 3);
    expect(line.gross).toBe(37.035);
    expect(line.tax).toBe(1.852);
    expect(line.total).toBe(38.887);
  });

  it("handles zero-decimal currencies (JPY, IQD, LBP…)", () => {
    const line = computeLine({ quantity: 3, unit_price: 1000.4, tax_rate: 10 }, 0);
    expect(line.gross).toBe(3001);
    expect(line.tax).toBe(300);
    expect(line.total).toBe(3301);
  });

  it("applies tax to the discounted net, not the gross", () => {
    const line = computeLine(
      { quantity: 1, unit_price: 100, discount_percent: 50, tax_rate: 10 },
      2,
    );
    expect(line.net).toBe(50);
    expect(line.tax).toBe(5); // not 10
  });

  it("treats missing discount and tax as zero", () => {
    const line = computeLine({ quantity: 2, unit_price: 25 }, 2);
    expect(line).toEqual({ gross: 50, discount: 0, net: 50, tax: 0, total: 50 });
  });

  it("clamps out-of-range percentages instead of inventing negative money", () => {
    expect(computeLine({ quantity: 1, unit_price: 100, discount_percent: 150 }, 2).net).toBe(0);
    expect(computeLine({ quantity: 1, unit_price: 100, discount_percent: -20 }, 2).net).toBe(100);
  });

  it("survives a blank line in the editor (empty quantity/price)", () => {
    const line = computeLine({ quantity: Number.NaN, unit_price: Number.NaN }, 2);
    expect(line.total).toBe(0);
  });
});

describe("sumLines()", () => {
  it("rolls up the same way the document trigger does", () => {
    const totals = sumLines(
      [
        { line_net: 180, line_discount: 20, line_tax: 9 },
        { line_net: 33.33, line_discount: 0, line_tax: 1.67 },
      ],
      2,
    );
    // Exactly the totals the migration's round-trip check produced in SQL.
    expect(totals).toEqual({
      subtotal: 213.33,
      discountTotal: 20,
      taxTotal: 10.67,
      total: 224,
    });
  });

  it("does not accumulate float drift across many lines", () => {
    const lines = Array.from({ length: 10 }, () => ({
      line_net: 0.1,
      line_discount: 0,
      line_tax: 0.07,
    }));
    const totals = sumLines(lines, 2);
    expect(totals.subtotal).toBe(1);
    expect(totals.taxTotal).toBe(0.7);
    expect(totals.total).toBe(1.7);
  });

  it("returns zeroes for an empty document", () => {
    expect(sumLines([])).toEqual({
      subtotal: 0,
      discountTotal: 0,
      taxTotal: 0,
      total: 0,
    });
  });
});

describe("quote expiry (derived, not stored)", () => {
  const now = "2026-07-26";

  it("expires a sent quote once its validity date has passed", () => {
    expect(isQuoteExpired({ status: "sent", valid_until: "2026-07-25" }, now)).toBe(true);
    expect(effectiveQuoteStatus({ status: "sent", valid_until: "2026-07-25" }, now)).toBe(
      "expired",
    );
  });

  it("treats the validity date itself as still valid", () => {
    expect(isQuoteExpired({ status: "sent", valid_until: now }, now)).toBe(false);
  });

  it("never expires a quote that was never sent, or one already decided", () => {
    expect(isQuoteExpired({ status: "draft", valid_until: "2020-01-01" }, now)).toBe(false);
    expect(isQuoteExpired({ status: "accepted", valid_until: "2020-01-01" }, now)).toBe(false);
    expect(effectiveQuoteStatus({ status: "accepted", valid_until: "2020-01-01" }, now)).toBe(
      "accepted",
    );
  });

  it("never expires an open-ended quote", () => {
    expect(isQuoteExpired({ status: "sent", valid_until: null }, now)).toBe(false);
  });
});

describe("invoice settlement", () => {
  const now = "2026-07-26";

  it("computes the outstanding balance", () => {
    expect(balanceDue({ total: 224, amount_paid: 100 })).toBe(124);
    expect(balanceDue({ total: 224, amount_paid: 224 })).toBe(0);
  });

  it("marks unsettled invoices overdue after the due date", () => {
    expect(isInvoiceOverdue({ status: "issued", due_date: "2026-07-25" }, now)).toBe(true);
    expect(isInvoiceOverdue({ status: "partially_paid", due_date: "2026-07-25" }, now)).toBe(true);
    expect(effectiveInvoiceStatus({ status: "issued", due_date: "2026-07-25" }, now)).toBe(
      "overdue",
    );
  });

  it("is not overdue on the due date itself", () => {
    expect(isInvoiceOverdue({ status: "issued", due_date: now }, now)).toBe(false);
  });

  it("never marks drafts, paid or void invoices overdue", () => {
    for (const status of ["draft", "paid", "void"] as const) {
      expect(isInvoiceOverdue({ status, due_date: "2020-01-01" }, now)).toBe(false);
      expect(effectiveInvoiceStatus({ status, due_date: "2020-01-01" }, now)).toBe(status);
    }
  });

  it("never marks an invoice with no due date overdue", () => {
    expect(isInvoiceOverdue({ status: "issued", due_date: null }, now)).toBe(false);
  });
});

describe("winRate()", () => {
  it("is the accepted share of decided quotes", () => {
    expect(winRate({ accepted_quotes_90d: 3, decided_quotes_90d: 4 })).toBe(0.75);
  });

  it("returns null rather than 0% when nothing has been decided", () => {
    // A brand-new pipeline showing "0% win rate" would read as failure.
    expect(winRate({ accepted_quotes_90d: 0, decided_quotes_90d: 0 })).toBeNull();
  });

  it("is 0 only when decided quotes were genuinely all lost", () => {
    expect(winRate({ accepted_quotes_90d: 0, decided_quotes_90d: 5 })).toBe(0);
  });
});
