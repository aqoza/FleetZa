/**
 * One document for a set of certificates — the renewal quote before the
 * work, the consolidated invoice after it. A customer brings ten or a hundred
 * vehicles; every one is coming up for renewal or has just been renewed; the
 * customer expects one quote, later one invoice, with a line per vehicle
 * naming the plate and the certificate number.
 *
 * Fed from wherever a set of certificates is in hand: the certificates list's
 * selection, the run a bulk renewal just finished, a customer's row on a
 * sales worklist, the current certificate on a vehicle page. It resolves
 * what can go on the document against what already is (already on INV-x /
 * QT-x / SO-x, another customer, no customer), offers the rest of the
 * customer's certificates in the same state (a hundred-vehicle renewal never
 * fits one page of the list), and hands the result to one RPC — one
 * transaction, one document number. A quote can also be sent in the same
 * step, with the customer's link ready to paste.
 */
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, ExternalLink } from "lucide-react";
import { getCountry } from "../../../shared/countries";
import { getRow, updateRow, wrapDbError } from "../../lib/db";
import { supabase } from "../../lib/supabase";
import { formatMoney } from "../../lib/format";
import { computeLine, roundTo } from "../../lib/sales";
import {
  indexBillingRows,
  indexQuoteRows,
  partitionForDocument,
  EMPTY_TRACKING,
  type CertificateBillingRow,
  type CertificateDocumentKind,
  type CertificateQuoteRow,
  type CertificateTracking,
  type InvoiceableCertificate,
  type InvoiceSkipReason,
} from "../../lib/certificateBilling";
import { useProductPicker } from "../../lib/pickers";
import type { Invoice, Product, Quote } from "../../lib/types";
import { useTenant } from "../../context/AuthContext";
import { useT, type MessageKey, type Translate } from "../../i18n";
import { Combobox } from "../../components/Combobox";
import { useToast } from "../../components/Toast";
import {
  Button, ErrorState, Field, Input, LoadingState, Modal,
} from "../../components/ui";
import { useDefaultTaxRate } from "../sales/shared";

/** One row of the two worklist RPCs (pending invoice / renewals to quote). */
export interface CertificateWorklistRow {
  certificate_id: string;
  certificate_number: string;
  issued_at: string;
  expires_at: string;
  customer_id: string | null;
  customer_name: string | null;
  vehicle_id: string | null;
  vehicle_name: string | null;
  license_plate: string | null;
}

export function worklistRowToCertificate(r: CertificateWorklistRow): InvoiceableCertificate {
  return {
    id: r.certificate_id,
    certificate_number: r.certificate_number,
    customer_id: r.customer_id,
    customer_name: r.customer_name,
    vehicle_id: r.vehicle_id,
    vehicle_name: r.vehicle_name,
    license_plate: r.license_plate,
  };
}

/** Days ahead the "renewals to quote" worklist looks — the list's outer band. */
export const RENEWAL_WINDOW_DAYS = 90;

/**
 * Everything the chain knows about a set of certificates: the invoice, the
 * live order and the open quote behind each. Two bounded RPCs keyed by the
 * caller's ids; absent rows mean nothing yet. Both read through the same
 * definitions the database's guard and reports use.
 */
export function useCertificateTracking(ids: string[], enabled = true) {
  const invoicesQ = useQuery({
    queryKey: ["certificate_billing_status", ids],
    enabled: enabled && ids.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("certificate_billing_status", {
        p_certificate_ids: ids,
      });
      if (error) throw wrapDbError(error);
      return (data ?? []) as CertificateBillingRow[];
    },
  });
  const quotesQ = useQuery({
    queryKey: ["certificate_quote_status", ids],
    enabled: enabled && ids.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("certificate_quote_status", {
        p_certificate_ids: ids,
      });
      if (error) throw wrapDbError(error);
      return (data ?? []) as CertificateQuoteRow[];
    },
  });
  const tracking = useMemo<CertificateTracking>(
    () =>
      invoicesQ.data === undefined && quotesQ.data === undefined
        ? EMPTY_TRACKING
        : { invoices: indexBillingRows(invoicesQ.data), quotes: indexQuoteRows(quotesQ.data) },
    [invoicesQ.data, quotesQ.data],
  );
  return {
    tracking,
    isLoading: invoicesQ.isLoading || quotesQ.isLoading,
    error: (invoicesQ.error ?? quotesQ.error) as Error | null,
  };
}

export function CertificateDocumentModal({
  kind,
  certificates,
  onClose,
}: {
  kind: CertificateDocumentKind;
  /** The selection to put on the document; null closes the dialog. */
  certificates: InvoiceableCertificate[] | null;
  onClose: () => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const copy = COPY[kind];
  return (
    <Modal
      title={t(copy.title, { count: certificates?.length ?? 0 })}
      open={certificates !== null}
      onClose={onClose}
      busy={busy}
      busyTitle={t(copy.closeBlocked)}
      wide
    >
      {/* Mounted per opening so every selection starts from a clean form. */}
      {certificates && (
        <DocumentForm kind={kind} certs={certificates} onDone={onClose} onBusyChange={setBusy} />
      )}
    </Modal>
  );
}

/** The strings that differ between the two documents. */
const COPY: Record<
  CertificateDocumentKind,
  {
    title: MessageKey;
    lead: MessageKey;
    eligible: MessageKey;
    others: MessageKey;
    confirm: MessageKey;
    created: MessageKey;
    failed: MessageKey;
    closeBlocked: MessageKey;
  }
> = {
  invoice: {
    title: "slCertificates.invoiceTitle",
    lead: "slCertificates.invoiceLead",
    eligible: "slCertificates.invoiceEligible",
    others: "slCertificates.invoiceOthersPending",
    confirm: "slCertificates.invoiceConfirm",
    created: "slCertificates.invoiceCreated",
    failed: "slCertificates.invoiceFailed",
    closeBlocked: "slCertificates.invoiceCloseBlocked",
  },
  quote: {
    title: "slCertificates.quoteTitle",
    lead: "slCertificates.quoteLead",
    eligible: "slCertificates.quoteEligible",
    others: "slCertificates.quoteOthersPending",
    confirm: "slCertificates.quoteConfirm",
    created: "slCertificates.quoteCreated",
    failed: "slCertificates.quoteFailed",
    closeBlocked: "slCertificates.quoteCloseBlocked",
  },
};

function skipLabel(t: Translate, reason: InvoiceSkipReason): string {
  switch (reason.kind) {
    case "invoiced":
      return t("slCertificates.invoiceSkipInvoiced", { number: reason.row.doc_number ?? "" });
    case "ordered":
      return t("slCertificates.skipOrdered", { number: reason.row.order_number ?? "" });
    case "quoted":
      return t("slCertificates.skipQuoted", { number: reason.row.quote_number ?? "" });
    case "other_customer":
      return t("slCertificates.invoiceSkipOtherCustomer", {
        name: reason.customerName ?? t("common.dash"),
      });
    case "no_customer":
      return t("slCertificates.invoiceSkipNoCustomer");
  }
}

function skipLink(reason: InvoiceSkipReason): string | null {
  switch (reason.kind) {
    case "invoiced":
      return `/sales/invoices/${reason.row.invoice_id}`;
    case "ordered":
      return `/sales/orders/${reason.row.order_id}`;
    case "quoted":
      return `/sales/quotes/${reason.row.quote_id}`;
    default:
      return null;
  }
}

/** A quote that was created and sent in one step — the link is the deliverable. */
interface SentQuote {
  id: string;
  doc_number: string;
  url: string;
}

function DocumentForm({
  kind,
  certs,
  onDone,
  onBusyChange,
}: {
  kind: CertificateDocumentKind;
  certs: InvoiceableCertificate[];
  onDone: () => void;
  /** Reports the in-flight write upward so the dialog can refuse to close. */
  onBusyChange: (busy: boolean) => void;
}) {
  const t = useT();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const tenant = useTenant();
  const decimals = getCountry(tenant.country).currencyDecimals;
  const defaultTax = useDefaultTaxRate();
  const copy = COPY[kind];

  const ids = useMemo(() => certs.map((c) => c.id), [certs]);
  const { tracking, isLoading, error: trackingError } = useCertificateTracking(ids);
  const partition = useMemo(
    () => partitionForDocument(kind, certs, tracking),
    [kind, certs, tracking],
  );

  // Everything else this customer has in the same state — not yet invoiced,
  // or due for renewal and not yet quoted. Offered, never assumed: the
  // operator chose these certificates for a reason.
  const othersQ = useQuery({
    queryKey: ["sales_report", kind === "invoice" ? "pending_invoice" : "renewals_to_quote", partition.customerId],
    enabled: partition.customerId !== null,
    queryFn: async () => {
      const { data, error } =
        kind === "invoice"
          ? await supabase.rpc("sales_report_certificates_pending_invoice", {
              p_customer_id: partition.customerId as string,
            })
          : await supabase.rpc("sales_report_renewals_to_quote", {
              p_days: RENEWAL_WINDOW_DAYS,
              p_customer_id: partition.customerId as string,
            });
      if (error) throw wrapDbError(error);
      return (data ?? []) as CertificateWorklistRow[];
    },
  });
  const selectedIds = useMemo(() => new Set(ids), [ids]);
  const others = useMemo<InvoiceableCertificate[]>(
    () =>
      (othersQ.data ?? [])
        .filter((r) => !selectedIds.has(r.certificate_id))
        .map(worklistRowToCertificate),
    [othersQ.data, selectedIds],
  );
  const [includeOthers, setIncludeOthers] = useState(false);

  const [productId, setProductId] = useState("");
  const catalogPicker = useProductPicker(productId);
  const [description, setDescription] = useState(() =>
    t("slCertificates.invoiceDefaultDescription"),
  );
  const [unitPrice, setUnitPrice] = useState("");
  const [taxRate, setTaxRate] = useState(() => String(defaultTax));
  const [sendNow, setSendNow] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState<SentQuote | null>(null);
  const [copied, setCopied] = useState(false);

  const lines = includeOthers ? [...partition.eligible, ...others] : partition.eligible;

  // Every line is identical, so the document total is one line's total
  // (rounded the way the DB rounds it) times the line count — re-rounded to
  // strip float residue, as lib/sales.ts does when it sums lines.
  const linePreview = computeLine(
    { quantity: 1, unit_price: Number(unitPrice) || 0, tax_rate: Number(taxRate) || 0 },
    decimals,
  );
  const total = roundTo(linePreview.total * lines.length, decimals);

  /** Same as the line editor: the chosen catalog row is fetched, not looked up
   *  in memory, so the prefilled price and tax come from the record itself. */
  async function pickProduct(id: string) {
    setProductId(id);
    if (!id) return;
    try {
      const product = await getRow<Product>("products", id);
      if (!product) return;
      setDescription(product.name);
      setUnitPrice(String(product.unit_price));
      setTaxRate(String(product.tax_rate));
    } catch (err) {
      toast.error(err instanceof Error ? err : t("common.error"));
    }
  }

  function invalidate() {
    void qc.invalidateQueries({ queryKey: ["quotes"] });
    void qc.invalidateQueries({ queryKey: ["invoices"] });
    void qc.invalidateQueries({ queryKey: ["speed_limiter_certificates"] });
    void qc.invalidateQueries({ queryKey: ["certificate_billing_status"] });
    void qc.invalidateQueries({ queryKey: ["certificate_quote_status"] });
    void qc.invalidateQueries({ queryKey: ["sales_summary"] });
    void qc.invalidateQueries({ queryKey: ["sales_report"] });
  }

  const create = useMutation({
    mutationFn: async () => {
      const args = {
        p_certificate_ids: lines.map((c) => c.id),
        p_description: description.trim() || undefined,
        p_unit_price: Number(unitPrice) || 0,
        p_tax_rate: Number(taxRate) || 0,
        p_product_id: productId || undefined,
      };
      if (kind === "invoice") {
        const { data, error: rpcError } = await supabase.rpc(
          "create_invoice_from_certificates",
          args,
        );
        if (rpcError) throw wrapDbError(rpcError);
        return { kind: "invoice" as const, doc: data as unknown as Invoice };
      }
      const { data, error: rpcError } = await supabase.rpc("create_quote_from_certificates", args);
      if (rpcError) throw wrapDbError(rpcError);
      let quote = data as unknown as Quote;
      // Sending is the same status change the quote page makes; the RPC
      // leaves a draft so a quote can still be reviewed first.
      if (sendNow) quote = await updateRow<Quote>("quotes", quote.id, { status: "sent" });
      return { kind: "quote" as const, doc: quote };
    },
    onSuccess: (result) => {
      invalidate();
      if (result.kind === "invoice") {
        toast.success(
          t("slCertificates.invoiceCreated", {
            number: result.doc.doc_number,
            count: lines.length,
          }),
        );
        onDone();
        navigate(`/sales/invoices/${result.doc.id}`);
        return;
      }
      if (result.doc.status === "sent") {
        const url = `${location.origin}/q/${result.doc.public_token}`;
        // Best effort: the clipboard may refuse a write outside a click, so
        // the link is also shown with its own Copy button.
        void navigator.clipboard?.writeText(url).catch(() => undefined);
        setSent({ id: result.doc.id, doc_number: result.doc.doc_number, url });
        toast.success(t("slCertificates.quoteSent", { number: result.doc.doc_number }));
        return;
      }
      toast.success(
        t("slCertificates.quoteCreated", { number: result.doc.doc_number, count: lines.length }),
      );
      onDone();
      navigate(`/sales/quotes/${result.doc.id}`);
    },
    onError: (err) => setError(err instanceof Error ? err.message : t(copy.failed)),
  });

  const busy = create.isPending;
  useEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    create.mutate();
  }

  if (isLoading) return <LoadingState />;
  if (trackingError) return <ErrorState message={trackingError.message} />;

  if (sent) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-ink-2">
          {t("slCertificates.quoteSentLead", { number: sent.doc_number })}
        </p>
        <code
          dir="ltr"
          className="block truncate rounded-lg bg-canvas px-3 py-2 text-xs text-ink-2"
        >
          {sent.url}
        </code>
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              void navigator.clipboard.writeText(sent.url);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2000);
            }}
          >
            <Copy className="h-4 w-4" />
            {copied ? t("sales.quotes.linkCopied") : t("sales.quotes.copyLink")}
          </Button>
          <Button
            onClick={() => {
              onDone();
              navigate(`/sales/quotes/${sent.id}`);
            }}
          >
            <ExternalLink className="h-4 w-4 rtl:-scale-x-100" />
            {t("slCertificates.openQuote", { number: sent.doc_number })}
          </Button>
        </div>
      </div>
    );
  }

  const { skipped } = partition;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && <ErrorState message={error} />}
      <p className="text-sm text-ink-2">
        {t(copy.lead, { customer: partition.customerName ?? t("common.dash") })}
      </p>

      {lines.length > 0 && (
        <div className="rounded-lg bg-canvas p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-3">
            {t(copy.eligible, { count: lines.length })}
          </h3>
          <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto text-sm text-ink-2">
            {lines.map((c) => (
              <li key={c.id} className="flex justify-between gap-4">
                <span className="font-medium text-ink">{c.certificate_number}</span>
                {/* <bdi>: a plate is digits + Latin letters and would be
                    reordered inside an RTL paragraph. */}
                <span className="text-end text-ink-3">
                  <bdi>{c.license_plate ?? c.vehicle_name ?? t("common.dash")}</bdi>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {skipped.length > 0 && (
        <div className="rounded-lg bg-canvas p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-3">
            {t("slCertificates.invoiceSkipped", { count: skipped.length })}
          </h3>
          <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto text-sm text-ink-2">
            {skipped.map(({ cert, reason }) => {
              const to = skipLink(reason);
              return (
                <li key={cert.id} className="flex justify-between gap-4">
                  <span className="font-medium text-ink">{cert.certificate_number}</span>
                  {to ? (
                    <Link to={to} className="text-end font-medium text-brand-700 hover:underline">
                      {skipLabel(t, reason)}
                    </Link>
                  ) : (
                    <span className="text-end text-ink-3">{skipLabel(t, reason)}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {partition.customerId && others.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line p-3">
          <span className="text-sm text-ink-2">
            {t(copy.others, {
              name: partition.customerName ?? t("common.dash"),
              count: others.length,
            })}
          </span>
          <Button type="button" variant="secondary" onClick={() => setIncludeOthers((v) => !v)}>
            {includeOthers
              ? t("slCertificates.invoiceOnlySelected")
              : t("slCertificates.invoiceAddOthers")}
          </Button>
        </div>
      )}

      {lines.length === 0 ? (
        <>
          <ErrorState message={t("slCertificates.invoiceNoneEligible")} />
          <div className="flex justify-end">
            <Button type="button" variant="secondary" onClick={onDone}>
              {t("action.close")}
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={t("slCertificates.invoiceCatalogItem")}
              hint={t("slCertificates.invoiceCatalogHint")}
            >
              <Combobox
                {...catalogPicker}
                value={productId}
                onChange={(v) => void pickProduct(v)}
                placeholder={t("sales.lines.customLine")}
              />
            </Field>
            <Field
              label={t("slCertificates.invoiceDescription")}
              hint={t("slCertificates.invoiceDescriptionHint")}
              required
            >
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
              />
            </Field>
            <Field label={t("slCertificates.invoiceUnitPrice")} required>
              <Input
                type="number" min={0} step="0.0001" required
                className="text-end tabular-nums"
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
              />
            </Field>
            <Field label={t("slCertificates.invoiceTaxRate")}>
              <Input
                type="number" min={0} max={100} step="0.01"
                className="text-end tabular-nums"
                value={taxRate}
                onChange={(e) => setTaxRate(e.target.value)}
              />
            </Field>
          </div>
          {kind === "quote" && (
            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line p-3 text-sm text-ink-2">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded border-line"
                checked={sendNow}
                onChange={(e) => setSendNow(e.target.checked)}
              />
              <span>
                <span className="font-medium text-ink">{t("slCertificates.quoteSendNow")}</span>
                <span className="mt-0.5 block text-xs text-ink-3">
                  {t("slCertificates.quoteSendNowHint")}
                </span>
              </span>
            </label>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-ink-2 tabular-nums">
              {t("slCertificates.invoicePreview", {
                count: lines.length,
                total: formatMoney(total, tenant.currency),
              })}
            </span>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={onDone} disabled={busy}>
                {t("action.cancel")}
              </Button>
              <Button type="submit" loading={busy}>
                {kind === "quote" && sendNow
                  ? t("slCertificates.quoteConfirmSend")
                  : t(copy.confirm)}
              </Button>
            </div>
          </div>
        </>
      )}
    </form>
  );
}
