/**
 * Sales document logic — the client-side mirror of the SQL that actually owns
 * these numbers (`app.compute_line_amounts` / `app.apply_doc_totals` in
 * supabase/migrations/…_sales_billing.sql).
 *
 * The database is authoritative: it recomputes every amount on write. These
 * helpers exist so a line editor can show the total *before* saving, and so
 * "expired" / "overdue" — which are derived from dates rather than stored (no
 * scheduler exists yet, see docs/ARCHITECTURE_REVIEW.md §5-G) — are computed
 * the same way on every surface.
 *
 * Keep the two in step: if the rounding rule changes here, change it there.
 */
import type { Invoice, InvoiceStatus, Quote, QuoteStatus, SalesSummary } from "./types";

/**
 * Round half-away-from-zero to `decimals`, matching Postgres `round(numeric, int)`.
 * The exponent-shift avoids binary-float artifacts (0.1 * 3 = 0.30000000000000004)
 * that a naive `Math.round(v * 100) / 100` inherits.
 */
export function roundTo(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return 0;
  const d = Math.max(0, Math.min(10, Math.trunc(decimals)));
  const shift = (v: number, by: number): number => {
    const s = String(v);
    // Values already in exponent form can't take another suffix — scale directly.
    if (s.includes("e") || s.includes("E")) return v * 10 ** by;
    return Number(`${s}e${by}`);
  };
  const scaled = shift(value, d);
  const rounded = Math.sign(scaled) * Math.round(Math.abs(scaled));
  return shift(rounded, -d);
}

export interface LineInput {
  quantity: number;
  unit_price: number;
  discount_percent?: number;
  tax_rate?: number;
}

export interface LineAmounts {
  gross: number;
  discount: number;
  net: number;
  tax: number;
  total: number;
}

/**
 * Line amounts, rounded at each step to the document's currency minor units —
 * the same order of operations the DB trigger uses, so a previewed total and
 * the saved total always match. Tax applies to the *net* (post-discount).
 */
export function computeLine(line: LineInput, decimals: number): LineAmounts {
  const qty = Number.isFinite(line.quantity) ? line.quantity : 0;
  const price = Number.isFinite(line.unit_price) ? line.unit_price : 0;
  const discountPct = clampPercent(line.discount_percent);
  const taxPct = clampPercent(line.tax_rate);

  const gross = roundTo(qty * price, decimals);
  const discount = roundTo((gross * discountPct) / 100, decimals);
  // Re-round the sums too. Their operands are already at the currency's scale,
  // so this changes no value — it only strips the IEEE-754 residue that plain
  // float arithmetic leaves behind (37.035 + 1.852 = 38.88699999999999), which
  // Postgres `numeric` never produces.
  const net = roundTo(gross - discount, decimals);
  const tax = roundTo((net * taxPct) / 100, decimals);
  return { gross, discount, net, tax, total: roundTo(net + tax, decimals) };
}

function clampPercent(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

export interface DocumentTotals {
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
}

/**
 * Roll up already-computed lines the way `app.apply_doc_totals` does. Each
 * accumulator is re-rounded to the currency scale for the same reason
 * `computeLine` re-rounds its sums: summing floats drifts, summing numerics
 * does not.
 */
export function sumLines(
  lines: Array<{ line_net: number; line_discount: number; line_tax: number }>,
  decimals = 2,
): DocumentTotals {
  let subtotal = 0;
  let discountTotal = 0;
  let taxTotal = 0;
  for (const l of lines) {
    subtotal += l.line_net;
    discountTotal += l.line_discount;
    taxTotal += l.line_tax;
  }
  subtotal = roundTo(subtotal, decimals);
  discountTotal = roundTo(discountTotal, decimals);
  taxTotal = roundTo(taxTotal, decimals);
  return { subtotal, discountTotal, taxTotal, total: roundTo(subtotal + taxTotal, decimals) };
}

// --- Derived document state ---------------------------------------------

/** Today as a YYYY-MM-DD string, so date-only comparisons stay date-only. */
function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** A sent quote past its validity date reads as expired without a cron job. */
export function isQuoteExpired(
  quote: Pick<Quote, "status" | "valid_until">,
  now = today(),
): boolean {
  return quote.status === "sent" && quote.valid_until !== null && quote.valid_until < now;
}

/** The status to *show* for a quote (stored status + the expiry overlay). */
export function effectiveQuoteStatus(
  quote: Pick<Quote, "status" | "valid_until">,
  now = today(),
): QuoteStatus {
  return isQuoteExpired(quote, now) ? "expired" : quote.status;
}

export function balanceDue(invoice: Pick<Invoice, "total" | "amount_paid">): number {
  return invoice.total - invoice.amount_paid;
}

/** An unsettled invoice past its due date. Void/paid invoices never are. */
export function isInvoiceOverdue(
  invoice: Pick<Invoice, "status" | "due_date">,
  now = today(),
): boolean {
  if (invoice.status !== "issued" && invoice.status !== "partially_paid") return false;
  return invoice.due_date !== null && invoice.due_date < now;
}

/** Stored status widened with the derived "overdue" state for display. */
export function effectiveInvoiceStatus(
  invoice: Pick<Invoice, "status" | "due_date">,
  now = today(),
): InvoiceStatus | "overdue" {
  return isInvoiceOverdue(invoice, now) ? "overdue" : invoice.status;
}

/**
 * Share of *decided* quotes (accepted / declined / expired) that were accepted.
 * Undecided quotes are excluded so a big open pipeline can't drag the rate down.
 * Returns null when nothing has been decided yet — "0%" would be a lie.
 */
export function winRate(
  summary: Pick<SalesSummary, "accepted_quotes_90d" | "decided_quotes_90d">,
): number | null {
  if (!summary.decided_quotes_90d) return null;
  return summary.accepted_quotes_90d / summary.decided_quotes_90d;
}
