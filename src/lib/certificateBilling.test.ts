import { describe, expect, it } from "vitest";
import {
  BILLING_FILTER_STATES,
  certificateBillingState,
  indexBillingRows,
  parseBillingFilter,
  partitionForInvoice,
  type CertificateBillingRow,
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

describe("certificateBillingState", () => {
  it("reads as not invoiced when no invoice bills the certificate", () => {
    expect(certificateBillingState(null, TODAY)).toBe("unbilled");
    expect(certificateBillingState(undefined, TODAY)).toBe("unbilled");
  });

  it("shows a draft distinctly — a claim, but not yet money owed", () => {
    expect(certificateBillingState(row({ status: "draft" }), TODAY)).toBe("draft");
  });

  it("is invoiced while an issued or partially paid invoice is within its terms", () => {
    expect(certificateBillingState(row({ status: "issued" }), TODAY)).toBe("invoiced");
    expect(certificateBillingState(row({ status: "partially_paid" }), TODAY)).toBe("invoiced");
    // Due today is not overdue yet — same rule as the invoice list.
    expect(certificateBillingState(row({ due_date: TODAY }), TODAY)).toBe("invoiced");
  });

  it("turns overdue the day after the due date, for unsettled invoices only", () => {
    expect(certificateBillingState(row({ due_date: "2026-08-31" }), TODAY)).toBe("overdue");
    expect(
      certificateBillingState(row({ status: "partially_paid", due_date: "2026-08-31" }), TODAY),
    ).toBe("overdue");
    expect(certificateBillingState(row({ status: "paid", due_date: "2020-01-01" }), TODAY)).toBe(
      "paid",
    );
    expect(certificateBillingState(row({ status: "draft", due_date: "2020-01-01" }), TODAY)).toBe(
      "draft",
    );
  });

  it("treats a missing due date as never overdue", () => {
    expect(certificateBillingState(row({ due_date: null }), TODAY)).toBe("invoiced");
  });
});

describe("indexBillingRows", () => {
  it("keys rows by certificate id and tolerates an absent result", () => {
    const map = indexBillingRows([row(), row({ certificate_id: "c2", invoice_id: "i2" })]);
    expect(map.get("c2")?.invoice_id).toBe("i2");
    expect(indexBillingRows(null).size).toBe(0);
  });
});

describe("billing filter", () => {
  it("parses only known values and falls back to all", () => {
    expect(parseBillingFilter("unbilled")).toBe("unbilled");
    expect(parseBillingFilter("paid")).toBe("paid");
    expect(parseBillingFilter("nope")).toBe("all");
    expect(parseBillingFilter(null)).toBe("all");
  });

  it("maps 'invoiced' onto drafts too, since a draft is already a claim", () => {
    expect(BILLING_FILTER_STATES.invoiced).toEqual(["draft", "invoiced"]);
    expect(BILLING_FILTER_STATES.unbilled).toEqual(["unbilled"]);
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

describe("partitionForInvoice", () => {
  it("bills the customer with the most certificates and names the rest as skipped", () => {
    const certs = [
      cert({ id: "a1" }),
      cert({ id: "a2" }),
      cert({ id: "b1", customer_id: "cust-b", customer_name: "Beta" }),
    ];
    const p = partitionForInvoice(certs, new Map());
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

  it("skips a certificate with no customer to bill", () => {
    const certs = [cert({ id: "a1" }), cert({ id: "n1", customer_id: null, customer_name: null })];
    const p = partitionForInvoice(certs, new Map());
    expect(p.eligible.map((c) => c.id)).toEqual(["a1"]);
    expect(p.skipped[0].reason).toEqual({ kind: "no_customer" });
  });

  it("has no customer at all when nothing is billable", () => {
    const p = partitionForInvoice([cert({ customer_id: null, customer_name: null })], new Map());
    expect(p.customerId).toBeNull();
    expect(p.eligible).toEqual([]);
    expect(p.skipped).toHaveLength(1);
  });
});
