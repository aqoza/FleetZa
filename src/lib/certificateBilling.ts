/**
 * Certificate billing — one source of truth for "has this certificate been
 * invoiced, and has that invoice been paid", shared by every surface that
 * shows it: the certificates list, the vehicle page, the invoice dialog.
 *
 * The state is DERIVED from the invoice that bills the certificate, never
 * stored. `certificate_billing_status()` (SQL) returns that invoice for a set
 * of certificate ids through the same `app.certificate_invoice_id()` the
 * database's own double-billing guard and its reports use, so a badge here
 * can never disagree with what the server would refuse. No row ⇒ not
 * invoiced.
 *
 * The rules, which match the sales module's own definitions:
 *   - a voided invoice never happened, so its certificates read as unbilled;
 *   - a DRAFT counts as a claim — two people preparing invoices cannot both
 *     pick up the same certificate — but is shown distinctly, because a draft
 *     is not yet money owed;
 *   - "overdue" is the same overlay the invoice list uses (lib/sales.ts): an
 *     issued or partially paid invoice past its due date.
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

export type CertificateBillingState = "unbilled" | "draft" | "invoiced" | "overdue" | "paid";

/**
 * The single state to show for a certificate's billing. `now` is a
 * YYYY-MM-DD string, as in lib/sales.ts, so date-only comparisons stay
 * date-only; tests pin it, callers leave it to default to today.
 */
export function certificateBillingState(
  row: CertificateBillingRow | null | undefined,
  now?: string,
): CertificateBillingState {
  if (!row) return "unbilled";
  if (row.status === "paid") return "paid";
  if (row.status === "draft") return "draft";
  const overdue = isInvoiceOverdue(
    { status: row.status as InvoiceStatus, due_date: row.due_date },
    now,
  );
  return overdue ? "overdue" : "invoiced";
}

/**
 * Label key + badge tone per state, in the shape src/lib/labels.ts uses.
 * "unbilled" is amber, not red: it is work to do, not a failure. Red is
 * reserved for an invoice that was raised and is now late.
 */
export const certificateBillingMeta: Record<
  CertificateBillingState,
  { labelKey: MessageKey; tone: BadgeTone }
> = {
  unbilled: { labelKey: "slCertificates.billing.unbilled", tone: "yellow" },
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

/**
 * The certificates list's billing filter. Each value maps onto the
 * `billing_state` computed column the list filters on server-side — the
 * column is coarse (unbilled · draft · invoiced · paid), so "invoiced" here
 * means "an invoice exists and is not settled", drafts included.
 */
export type BillingFilter = "all" | "unbilled" | "invoiced" | "paid";

export const BILLING_FILTER_STATES: Record<Exclude<BillingFilter, "all">, string[]> = {
  unbilled: ["unbilled"],
  invoiced: ["draft", "invoiced"],
  paid: ["paid"],
};

const BILLING_FILTERS = new Set<string>(["all", "unbilled", "invoiced", "paid"]);

export function parseBillingFilter(raw: string | null | undefined): BillingFilter {
  return raw && BILLING_FILTERS.has(raw) ? (raw as BillingFilter) : "all";
}

/**
 * The minimal shape the invoice dialog needs of a certificate, so it can be
 * fed from the certificates list (embedded vehicle/customer), the pending-
 * invoice report (flat columns) or a just-renewed row, without each caller
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

/** Why the dialog will not put a certificate on the invoice. */
export type InvoiceSkipReason =
  | { kind: "invoiced"; row: CertificateBillingRow }
  | { kind: "other_customer"; customerName: string | null }
  | { kind: "no_customer" };

export interface InvoicePartition {
  /** The one customer the invoice is for — the most common among the selection. */
  customerId: string | null;
  customerName: string | null;
  eligible: InvoiceableCertificate[];
  skipped: Array<{ cert: InvoiceableCertificate; reason: InvoiceSkipReason }>;
}

/**
 * Split a selection into what one invoice can bill and what it cannot: an
 * invoice is for one customer, and a certificate already on a non-void
 * invoice is not billed again. When the selection spans customers, the
 * customer with the most certificates wins and the rest are listed as
 * skipped with the customer they belong to — the operator sees exactly what
 * happened rather than a bare error.
 */
export function partitionForInvoice(
  certs: InvoiceableCertificate[],
  billing: Map<string, CertificateBillingRow>,
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
    const row = billing.get(cert.id);
    if (row) skipped.push({ cert, reason: { kind: "invoiced", row } });
    else if (!cert.customer_id) skipped.push({ cert, reason: { kind: "no_customer" } });
    else if (cert.customer_id !== customerId)
      skipped.push({ cert, reason: { kind: "other_customer", customerName: cert.customer_name } });
    else eligible.push(cert);
  }
  return { customerId, customerName, eligible, skipped };
}
