/**
 * Certificate billing — one source of truth for "where is this certificate
 * in the commercial chain": quoted, ordered, invoiced, paid, or none of
 * those. Shared by every surface that shows it: the certificates list, the
 * vehicle page, the sales worklists, the quote/invoice dialog.
 *
 * The state is DERIVED from the documents that name the certificate, never
 * stored. Two RPCs return them for a set of certificate ids —
 * `certificate_billing_status()` (the invoice) and `certificate_quote_status()`
 * (the open quote and the live order) — through the same
 * `app.certificate_*_id()` definitions the database's own double-billing
 * guard, computed column and reports use, so a badge here can never disagree
 * with what the server would refuse or count. No row ⇒ nothing yet.
 *
 * The rules, which match the sales module's own definitions:
 *   - an invoice always wins — that is what is owed; a voided one never
 *     happened, so its certificates read as if it were not there;
 *   - a DRAFT invoice counts as a claim (two people cannot both pick up the
 *     same certificate) but is shown distinctly, because it is not yet money
 *     owed; "overdue" is the invoice list's overlay (lib/sales.ts);
 *   - before an invoice, a live order outranks an open quote (draft, sent,
 *     accepted); a declined, expired or canceled quote leaves the
 *     certificate free to quote again.
 *
 * Pure logic only — no React, no db layer — so it is cheap to unit-test.
 */
import type { BadgeTone } from "../components/ui";
import type { MessageKey } from "../i18n";
import { isInvoiceOverdue } from "./sales";
import type { InvoiceStatus } from "./types";

/** One row of `certificate_billing_status()`: the invoice behind a certificate. */
export interface CertificateBillingRow {
  certificate_id: string;
  invoice_id: string;
  doc_number: string | null;
  /** The invoice's stored status (never "void" — those rows are not returned). */
  status: string;
  due_date: string | null;
  total: number;
  amount_paid: number;
  currency: string;
}

/**
 * One row of `certificate_quote_status()`: the open quote and/or the live
 * order that name a certificate. Either half may be null; a row exists only
 * when at least one does.
 */
export interface CertificateQuoteRow {
  certificate_id: string;
  quote_id: string | null;
  quote_number: string | null;
  quote_status: string | null;
  valid_until: string | null;
  order_id: string | null;
  order_number: string | null;
  order_status: string | null;
}

/** Everything known about a set of certificates, keyed by certificate id. */
export interface CertificateTracking {
  invoices: Map<string, CertificateBillingRow>;
  quotes: Map<string, CertificateQuoteRow>;
}

export const EMPTY_TRACKING: CertificateTracking = { invoices: new Map(), quotes: new Map() };

export type CertificateBillingState =
  | "unbilled"
  | "quoted"
  | "ordered"
  | "draft"
  | "invoiced"
  | "overdue"
  | "paid";

/**
 * The single state to show for a certificate. `now` is a YYYY-MM-DD string,
 * as in lib/sales.ts, so date-only comparisons stay date-only; tests pin it,
 * callers leave it to default to today.
 */
export function certificateBillingState(
  invoice: CertificateBillingRow | null | undefined,
  quote?: CertificateQuoteRow | null,
  now?: string,
): CertificateBillingState {
  if (invoice) {
    if (invoice.status === "paid") return "paid";
    if (invoice.status === "draft") return "draft";
    const overdue = isInvoiceOverdue(
      { status: invoice.status as InvoiceStatus, due_date: invoice.due_date },
      now,
    );
    return overdue ? "overdue" : "invoiced";
  }
  if (quote?.order_id) return "ordered";
  if (quote?.quote_id) return "quoted";
  return "unbilled";
}

/**
 * Label key + badge tone per state, in the shape src/lib/labels.ts uses.
 * "unbilled" is amber, not red: it is work to do, not a failure. Red is
 * reserved for an invoice that was raised and is now late. Quoted and
 * ordered share a tone — both mean "in hand, not yet billed".
 */
export const certificateBillingMeta: Record<
  CertificateBillingState,
  { labelKey: MessageKey; tone: BadgeTone }
> = {
  unbilled: { labelKey: "slCertificates.billing.unbilled", tone: "yellow" },
  quoted: { labelKey: "slCertificates.billing.quoted", tone: "purple" },
  ordered: { labelKey: "slCertificates.billing.ordered", tone: "purple" },
  draft: { labelKey: "slCertificates.billing.draft", tone: "slate" },
  invoiced: { labelKey: "slCertificates.billing.invoiced", tone: "blue" },
  overdue: { labelKey: "slCertificates.billing.overdue", tone: "red" },
  paid: { labelKey: "slCertificates.billing.paid", tone: "green" },
};

/** Index an RPC result by certificate id, for O(1) lookups per table row. */
export function indexBillingRows(
  rows: CertificateBillingRow[] | null | undefined,
): Map<string, CertificateBillingRow> {
  return new Map((rows ?? []).map((r) => [r.certificate_id, r]));
}

export function indexQuoteRows(
  rows: CertificateQuoteRow[] | null | undefined,
): Map<string, CertificateQuoteRow> {
  return new Map((rows ?? []).map((r) => [r.certificate_id, r]));
}

/**
 * The document a certificate's badge should link to — the one the state
 * came from: the invoice if there is one, else the order, else the quote.
 */
export function certificateTrackingLink(
  invoice: CertificateBillingRow | null | undefined,
  quote?: CertificateQuoteRow | null,
): { to: string; number: string } | null {
  if (invoice) return { to: `/sales/invoices/${invoice.invoice_id}`, number: invoice.doc_number ?? "" };
  if (quote?.order_id) return { to: `/sales/orders/${quote.order_id}`, number: quote.order_number ?? "" };
  if (quote?.quote_id) return { to: `/sales/quotes/${quote.quote_id}`, number: quote.quote_number ?? "" };
  return null;
}

/**
 * The certificates list's billing filter. Each value maps onto the
 * `billing_state` computed column the list filters on server-side. The
 * column is coarse — unbilled · quoted · ordered · draft · invoiced · paid —
 * so "invoiced" here means "an invoice exists and is not settled", drafts
 * included, and "not invoiced" is everything before an invoice.
 */
export type BillingFilter = "all" | "unquoted" | "quoted" | "unbilled" | "invoiced" | "paid";

export const BILLING_FILTER_STATES: Record<Exclude<BillingFilter, "all">, string[]> = {
  /** Nothing at all — the renewals still to quote. */
  unquoted: ["unbilled"],
  /** Spoken for, not yet billed. */
  quoted: ["quoted", "ordered"],
  /** No invoice, whatever else exists. */
  unbilled: ["unbilled", "quoted", "ordered"],
  invoiced: ["draft", "invoiced"],
  paid: ["paid"],
};

const BILLING_FILTERS = new Set<string>(Object.keys(BILLING_FILTER_STATES).concat("all"));

export function parseBillingFilter(raw: string | null | undefined): BillingFilter {
  return raw && BILLING_FILTERS.has(raw) ? (raw as BillingFilter) : "all";
}

/**
 * The minimal shape the quote/invoice dialog needs of a certificate, so it
 * can be fed from the certificates list (embedded vehicle/customer), the
 * worklist RPCs (flat columns) or a just-renewed row, without each caller
 * carrying a full join.
 */
export interface InvoiceableCertificate {
  id: string;
  certificate_number: string;
  customer_id: string | null;
  customer_name: string | null;
  vehicle_id: string | null;
  vehicle_name: string | null;
  license_plate: string | null;
}

/** Which document the dialog is raising. */
export type CertificateDocumentKind = "invoice" | "quote";

/** Why the dialog will not put a certificate on the document. */
export type InvoiceSkipReason =
  | { kind: "invoiced"; row: CertificateBillingRow }
  | { kind: "ordered"; row: CertificateQuoteRow }
  | { kind: "quoted"; row: CertificateQuoteRow }
  | { kind: "other_customer"; customerName: string | null }
  | { kind: "no_customer" };

export interface InvoicePartition {
  /** The one customer the document is for — the most common among the selection. */
  customerId: string | null;
  customerName: string | null;
  eligible: InvoiceableCertificate[];
  skipped: Array<{ cert: InvoiceableCertificate; reason: InvoiceSkipReason }>;
}

/**
 * Split a selection into what one document can carry and what it cannot.
 * A document is for one customer; when the selection spans customers, the
 * customer with the most certificates wins and the rest are listed as
 * skipped with the customer they belong to — the operator sees exactly what
 * happened rather than a bare error.
 *
 * An invoice skips certificates already on a non-void invoice (the database
 * would refuse them anyway). A quote is a proposal, not a claim, so the
 * database does not refuse a second one — but a certificate that is already
 * invoiced, on a live order or on an open quote is not quoted again from
 * here; the existing document is what to revise.
 */
export function partitionForDocument(
  kind: CertificateDocumentKind,
  certs: InvoiceableCertificate[],
  tracking: CertificateTracking,
): InvoicePartition {
  const counts = new Map<string, number>();
  for (const c of certs) {
    if (c.customer_id) counts.set(c.customer_id, (counts.get(c.customer_id) ?? 0) + 1);
  }
  let customerId: string | null = null;
  let best = 0;
  for (const [id, n] of counts) {
    if (n > best) {
      best = n;
      customerId = id;
    }
  }
  const customerName = certs.find((c) => c.customer_id === customerId)?.customer_name ?? null;

  const eligible: InvoiceableCertificate[] = [];
  const skipped: InvoicePartition["skipped"] = [];
  for (const cert of certs) {
    const invoice = tracking.invoices.get(cert.id);
    const quote = tracking.quotes.get(cert.id);
    if (invoice) skipped.push({ cert, reason: { kind: "invoiced", row: invoice } });
    else if (kind === "quote" && quote?.order_id)
      skipped.push({ cert, reason: { kind: "ordered", row: quote } });
    else if (kind === "quote" && quote?.quote_id)
      skipped.push({ cert, reason: { kind: "quoted", row: quote } });
    else if (!cert.customer_id) skipped.push({ cert, reason: { kind: "no_customer" } });
    else if (cert.customer_id !== customerId)
      skipped.push({ cert, reason: { kind: "other_customer", customerName: cert.customer_name } });
    else eligible.push(cert);
  }
  return { customerId, customerName, eligible, skipped };
}

/** The invoice-only partition — kept for callers that never quote. */
export function partitionForInvoice(
  certs: InvoiceableCertificate[],
  billing: Map<string, CertificateBillingRow>,
): InvoicePartition {
  return partitionForDocument("invoice", certs, { invoices: billing, quotes: new Map() });
}
