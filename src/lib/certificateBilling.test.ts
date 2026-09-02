import { describe, expect, it } from "vitest";
import {
  BILLING_FILTER_STATES,
  certificateBillingState,
  certificateTrackingLink,
  indexBillingRows,
  indexQuoteRows,
  parseBillingFilter,
  partitionForDocument,
  partitionForInvoice,
  type CertificateBillingRow,
  type CertificateQuoteRow,
  type InvoiceableCertificate,
} from "./certificateBilling";

const TODAY = "2026-09-01";

function row(overrides: Partial<CertificateBillingRow> = {}): CertificateBillingRow {
  return {
    certificate_id: "c1",
    invoice_id: "i1",
    doc_number: "INV-00001",
    status: "issued",
    due_date: "2026-10-01",
    total: 100,
    amount_paid: 0,
    currency: "OMR",
    ...overrides,
  };
}

function quoteRow(overrides: Partial<CertificateQuoteRow> = {}): CertificateQuoteRow {
  return {
    certificate_id: "c1",
    quote_id: "q1",
    quote_number: "QT-00001",
    quote_status: "sent",
    valid_until: "2026-10-01",
    order_id: null,
    order_number: null,
    order_status: null,
    ...overrides,
  };
}

describe("certificateBillingState", () => {
  it("reads as not invoiced when nothing names the certificate", () => {
    expect(certificateBillingState(null, null, TODAY)).toBe("unbilled");
    expect(certificateBillingState(undefined, undefined, TODAY)).toBe("unbilled");
  });

  it("is quoted with an open quote and ordered once an order exists", () => {
    expect(certificateBillingState(null, quoteRow(), TODAY)).toBe("quoted");
    expect(
      certificateBillingState(
        null,
        quoteRow({ order_id: "o1", order_number: "SO-00001", order_status: "confirmed" }),
        TODAY,
      ),
    ).toBe("ordered");
    // An order with no quote behind it (PO → job) is still ordered.
    expect(
      certificateBillingState(null, quoteRow({ quote_id: null, order_id: "o1" }), TODAY),
    ).toBe("ordered");
  });

  it("lets the invoice win over any quote or order", () => {
    expect(certificateBillingState(row({ status: "draft" }), quoteRow(), TODAY)).toBe("draft");
    expect(certificateBillingState(row(), quoteRow({ order_id: "o1" }), TODAY)).toBe("invoiced");
  });

  it("shows a draft distinctly — a claim, but not yet money owed", () => {
    expect(certificateBillingState(row({ status: "draft" }), null, TODAY)).toBe("draft");
  });

  it("is invoiced while an issued or partially paid invoice is within its terms", () => {
    expect(certificateBillingState(row({ status: "issued" }), null, TODAY)).toBe("invoiced");
    expect(certificateBillingState(row({ status: "partially_paid" }), null, TODAY)).toBe(
      "invoiced",
    );
    // Due today is not overdue yet — same rule as the invoice list.
    expect(certificateBillingState(row({ due_date: TODAY }), null, TODAY)).toBe("invoiced");
  });

  it("turns overdue the day after the due date, for unsettled invoices only", () => {
    expect(certificateBillingState(row({ due_date: "2026-08-31" }), null, TODAY)).toBe("overdue");
    expect(
      certificateBillingState(
        row({ status: "partially_paid", due_date: "2026-08-31" }),
        null,
        TODAY,
      ),
    ).toBe("overdue");
    expect(
      certificateBillingState(row({ status: "paid", due_date: "2020-01-01" }), null, TODAY),
    ).toBe("paid");
    expect(
      certificateBillingState(row({ status: "draft", due_date: "2020-01-01" }), null, TODAY),
    ).toBe("draft");
  });

  it("treats a missing due date as never overdue", () => {
    expect(certificateBillingState(row({ due_date: null }), null, TODAY)).toBe("invoiced");
  });
});

describe("certificateTrackingLink", () => {
  it("links to the document the state came from", () => {
    expect(certificateTrackingLink(row(), quoteRow())).toEqual({
      to: "/sales/invoices/i1",
      number: "INV-00001",
    });
    expect(certificateTrackingLink(null, quoteRow({ order_id: "o1", order_number: "SO-00001" })))
      .toEqual({ to: "/sales/orders/o1", number: "SO-00001" });
    expect(certificateTrackingLink(null, quoteRow())).toEqual({
      to: "/sales/quotes/q1",
      number: "QT-00001",
    });
    expect(certificateTrackingLink(null, null)).toBeNull();
  });
});

describe("indexing", () => {
  it("keys rows by certificate id and tolerates an absent result", () => {
    const map = indexBillingRows([row(), row({ certificate_id: "c2", invoice_id: "i2" })]);
    expect(map.get("c2")?.invoice_id).toBe("i2");
    expect(indexBillingRows(null).size).toBe(0);
    expect(indexQuoteRows([quoteRow({ certificate_id: "c9" })]).get("c9")?.quote_id).toBe("q1");
    expect(indexQuoteRows(undefined).size).toBe(0);
  });
});

describe("billing filter", () => {
  it("parses only known values and falls back to all", () => {
    expect(parseBillingFilter("unbilled")).toBe("unbilled");
    expect(parseBillingFilter("unquoted")).toBe("unquoted");
    expect(parseBillingFilter("quoted")).toBe("quoted");
    expect(parseBillingFilter("paid")).toBe("paid");
    expect(parseBillingFilter("nope")).toBe("all");
    expect(parseBillingFilter(null)).toBe("all");
  });

  it("maps each chip onto the computed column's states", () => {
    expect(BILLING_FILTER_STATES.unquoted).toEqual(["unbilled"]);
    expect(BILLING_FILTER_STATES.quoted).toEqual(["quoted", "ordered"]);
    // "Not invoiced" is everything before an invoice, quoted or not.
    expect(BILLING_FILTER_STATES.unbilled).toEqual(["unbilled", "quoted", "ordered"]);
    // A draft is already a claim, so it files under invoiced.
    expect(BILLING_FILTER_STATES.invoiced).toEqual(["draft", "invoiced"]);
    expect(BILLING_FILTER_STATES.paid).toEqual(["paid"]);
  });
});

function cert(overrides: Partial<InvoiceableCertificate> = {}): InvoiceableCertificate {
  return {
    id: "c1",
    certificate_number: "GOM-WO-202601",
    customer_id: "cust-a",
    customer_name: "Alpha",
    vehicle_id: "v1",
    vehicle_name: "MITSUBISHI L200",
    license_plate: "1234 AB",
    ...overrides,
  };
}

const NONE = { invoices: new Map(), quotes: new Map() };

describe("partitionForDocument", () => {
  it("bills the customer with the most certificates and names the rest as skipped", () => {
    const certs = [
      cert({ id: "a1" }),
      cert({ id: "a2" }),
      cert({ id: "b1", customer_id: "cust-b", customer_name: "Beta" }),
    ];
    const p = partitionForDocument("invoice", certs, NONE);
    expect(p.customerId).toBe("cust-a");
    expect(p.customerName).toBe("Alpha");
    expect(p.eligible.map((c) => c.id)).toEqual(["a1", "a2"]);
    expect(p.skipped).toEqual([
      { cert: certs[2], reason: { kind: "other_customer", customerName: "Beta" } },
    ]);
  });

  it("skips certificates already on an invoice, with the invoice attached", () => {
    const billed = row({ certificate_id: "a1" });
    const certs = [cert({ id: "a1" }), cert({ id: "a2" })];
    const p = partitionForInvoice(certs, indexBillingRows([billed]));
    expect(p.eligible.map((c) => c.id)).toEqual(["a2"]);
    expect(p.skipped[0].reason).toEqual({ kind: "invoiced", row: billed });
  });

  it("still invoices a certificate that was only quoted — the quote is the reason to bill", () => {
    const quoted = quoteRow({ certificate_id: "a1" });
    const p = partitionForDocument("invoice", [cert({ id: "a1" })], {
      invoices: new Map(),
      quotes: indexQuoteRows([quoted]),
    });
    expect(p.eligible.map((c) => c.id)).toEqual(["a1"]);
  });

  it("does not quote a certificate that is already quoted, ordered or invoiced", () => {
    const quoted = quoteRow({ certificate_id: "a1" });
    const ordered = quoteRow({ certificate_id: "a2", order_id: "o1", order_number: "SO-00001" });
    const billed = row({ certificate_id: "a3" });
    const certs = [cert({ id: "a1" }), cert({ id: "a2" }), cert({ id: "a3" }), cert({ id: "a4" })];
    const p = partitionForDocument("quote", certs, {
      invoices: indexBillingRows([billed]),
      quotes: indexQuoteRows([quoted, ordered]),
    });
    expect(p.eligible.map((c) => c.id)).toEqual(["a4"]);
    expect(p.skipped.map((s) => s.reason.kind)).toEqual(["quoted", "ordered", "invoiced"]);
  });

  it("skips a certificate with no customer to bill", () => {
    const certs = [cert({ id: "a1" }), cert({ id: "n1", customer_id: null, customer_name: null })];
    const p = partitionForDocument("quote", certs, NONE);
    expect(p.eligible.map((c) => c.id)).toEqual(["a1"]);
    expect(p.skipped[0].reason).toEqual({ kind: "no_customer" });
  });

  it("has no customer at all when nothing is billable", () => {
    const p = partitionForDocument("invoice", [cert({ customer_id: null, customer_name: null })], NONE);
    expect(p.customerId).toBeNull();
    expect(p.eligible).toEqual([]);
    expect(p.skipped).toHaveLength(1);
  });
});
