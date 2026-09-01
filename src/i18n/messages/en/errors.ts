// Friendly messages for database errors surfaced by src/lib/db.ts — the raw
// PostgREST/Postgres text stays in the console, users see these instead.
// Arabic lives in ../ar/errors.ts and MUST stay complete.
export const enErrors = {
  "errors.duplicate": "This record conflicts with one that already exists (duplicate value).",
  "errors.referenced": "This record is referenced by other records and cannot be changed this way.",
  "errors.forbidden": "You don't have permission to do this.",
  "errors.vehicleHasCertificates":
    "This vehicle has issued certificates and cannot be deleted. Retire it instead.",
  "errors.vehicleHasCompletedJobs":
    "This vehicle has completed jobs on record and cannot be deleted. Retire it instead.",
  "errors.vehicleHasCompletedWorkOrders":
    "This vehicle has completed work orders on record and cannot be deleted. Retire it instead.",
  "errors.customerHasCertificates":
    "This customer has issued certificates and cannot be deleted. Mark them inactive instead.",
  "errors.customerHasCompletedJobs":
    "This customer has completed jobs on record and cannot be deleted. Mark them inactive instead.",
  "errors.illegalJobTransition": "That status change isn't allowed from the job's current state.",
  "errors.jobNotCertifiable":
    "A certificate can only be issued for a completed installation, replacement or inspection job.",
  "errors.jobNotFound": "Job not found.",
  "errors.certAlreadyIssued": "A valid certificate has already been issued for this job.",

  // Sales & billing documents (see supabase/migrations/…_sales_billing.sql)
  "errors.customerHasInvoices":
    "This customer has issued invoices and cannot be deleted. Mark them inactive instead.",
  "errors.docNotEditable":
    "This document is no longer a draft, so its line items can't be changed. Revise it to make a new version.",
  "errors.docLocked":
    "This document has been issued and can no longer be edited. Revise it to make a new version.",
  "errors.docNotDeletable":
    "Only draft documents can be deleted — cancel or void this one instead so the numbering stays intact.",
  "errors.emptyDocument": "Add at least one line item before issuing this document.",
  "errors.illegalQuoteTransition":
    "That status change isn't allowed from the quote's current state.",
  "errors.illegalOrderTransition":
    "That status change isn't allowed from the order's current state.",
  "errors.illegalInvoiceTransition":
    "That status change isn't allowed from the invoice's current state.",
  "errors.quoteNotFound": "Quote not found.",
  "errors.quoteNotConvertible": "Only an accepted quote can be turned into a sales order.",
  "errors.quoteAlreadyConverted": "This quote has already been converted to a sales order.",
  "errors.quoteNotRevisable": "A draft quote can be edited directly — no revision needed.",
  "errors.orderNotFound": "Sales order not found.",
  "errors.orderNotInvoiceable": "Confirm the sales order before invoicing it.",
  "errors.invoiceExceedsOrder":
    "That is more than the order has left to invoice. Reduce the quantity and try again.",
  "errors.nothingToInvoice":
    "This order is fully invoiced — there is nothing left to bill.",
  "errors.invoiceNotFound": "Invoice not found.",
  "errors.invoiceNotPayable": "Issue the invoice before recording a payment against it.",
  "errors.paymentExceedsBalance": "That payment is larger than the invoice's outstanding balance.",

  // Certificate billing (see supabase/migrations/…_certificate_billing.sql)
  "errors.certAlreadyInvoiced":
    "One of these certificates is already on an invoice. Void that invoice first if it was raised in error.",
  "errors.certsMultipleCustomers":
    "An invoice bills one customer — select certificates that belong to a single customer.",
  "errors.certNoCustomer":
    "This certificate has no customer to bill. Set the vehicle's owner first.",
  "errors.certificateNotFound": "Certificate not found.",
  "errors.noCertificates": "Select at least one certificate to invoice.",
} as const;
