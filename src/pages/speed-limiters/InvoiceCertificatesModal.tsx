/**
 * One draft invoice for a set of certificates — the consolidated renewal
 * bill. A customer brings ten or a hundred vehicles, every one gets a renewed
 * certificate, and the customer expects one invoice with a line per vehicle
 * naming the plate and the certificate number.
 *
 * Fed from wherever a set of certificates is in hand: the certificates list's
 * selection, the run a bulk renewal just finished, a customer's row on the
 * pending-invoice report, the current certificate on a vehicle page. It
 * resolves what can be billed against what already is, offers the rest of the
 * customer's uninvoiced certificates (a hundred-vehicle renewal never fits one
 * page of the list), and hands the result to create_invoice_from_certificates
 * — one RPC, one transaction, one document number.
 */
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getCountry } from "../../../shared/countries";
import { getRow, wrapDbError } from "../../lib/db";
import { supabase } from "../../lib/supabase";
import { formatMoney } from "../../lib/format";
import { computeLine, roundTo } from "../../lib/sales";
import {
  indexBillingRows,
  partitionForInvoice,
  type CertificateBillingRow,
  type InvoiceableCertificate,
  type InvoiceSkipReason,
} from "../../lib/certificateBilling";
import { useProductPicker } from "../../lib/pickers";
import type { Invoice, Product } from "../../lib/types";
import { useTenant } from "../../context/AuthContext";
import { useT, type Translate } from "../../i18n";
import { Combobox } from "../../components/Combobox";
import { useToast } from "../../components/Toast";
import {
  Button, ErrorState, Field, Input, LoadingState, Modal,
} from "../../components/ui";
import { useDefaultTaxRate } from "../sales/shared";

/** One row of sales_report_certificates_pending_invoice(). */
interface PendingCertificateRow {
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

/** The invoice behind each of a set of certificates; absent ⇒ not invoiced. */
export function useCertificateBilling(ids: string[], enabled = true) {
  return useQuery({
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
}

export function InvoiceCertificatesModal({
  certificates,
  onClose,
}: {
  /** The selection to bill; null closes the dialog. */
  certificates: InvoiceableCertificate[] | null;
  onClose: () => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const open = certificates !== null;
  return (
    <Modal
      title={t("slCertificates.invoiceTitle", { count: certificates?.length ?? 0 })}
      open={open}
      onClose={onClose}
      busy={busy}
      busyTitle={t("slCertificates.invoiceCloseBlocked")}
      wide
    >
      {/* Mounted per opening so every selection starts from a clean form. */}
      {certificates && (
        <InvoiceForm certs={certificates} onDone={onClose} onBusyChange={setBusy} />
      )}
    </Modal>
  );
}

function skipLabel(t: Translate, reason: InvoiceSkipReason): string {
  switch (reason.kind) {
    case "invoiced":
      return t("slCertificates.invoiceSkipInvoiced", { number: reason.row.doc_number ?? "" });
    case "other_customer":
      return t("slCertificates.invoiceSkipOtherCustomer", {
        name: reason.customerName ?? t("common.dash"),
      });
    case "no_customer":
      return t("slCertificates.invoiceSkipNoCustomer");
  }
}

function InvoiceForm({
  certs,
  onDone,
  onBusyChange,
}: {
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

  const ids = useMemo(() => certs.map((c) => c.id), [certs]);
  const billingQ = useCertificateBilling(ids);
  const partition = useMemo(
    () => partitionForInvoice(certs, indexBillingRows(billingQ.data)),
    [certs, billingQ.data],
  );

  // Everything else this customer has not invoiced yet. Offered, never
  // assumed: the operator chose these certificates for a reason.
  const othersQ = useQuery({
    queryKey: ["sales_report", "sales_report_certificates_pending_invoice", partition.customerId],
    enabled: partition.customerId !== null,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("sales_report_certificates_pending_invoice", {
        p_customer_id: partition.customerId as string,
      });
      if (error) throw wrapDbError(error);
      return (data ?? []) as PendingCertificateRow[];
    },
  });
  const selectedIds = useMemo(() => new Set(ids), [ids]);
  const others = useMemo<InvoiceableCertificate[]>(
    () =>
      (othersQ.data ?? [])
        .filter((r) => !selectedIds.has(r.certificate_id))
        .map((r) => ({
          id: r.certificate_id,
          certificate_number: r.certificate_number,
          customer_id: r.customer_id,
          customer_name: r.customer_name,
          vehicle_id: r.vehicle_id,
          vehicle_name: r.vehicle_name,
          license_plate: r.license_plate,
        })),
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
  const [error, setError] = useState("");

  const lines = includeOthers ? [...partition.eligible, ...others] : partition.eligible;

  // Every line is identical, so the document total is one line's total (rounded
  // the way the DB rounds it) times the line count — re-rounded to strip float
  // residue, as lib/sales.ts does when it sums lines.
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

  const create = useMutation({
    mutationFn: async () => {
      const { data, error: rpcError } = await supabase.rpc("create_invoice_from_certificates", {
        p_certificate_ids: lines.map((c) => c.id),
        p_description: description.trim() || undefined,
        p_unit_price: Number(unitPrice) || 0,
        p_tax_rate: Number(taxRate) || 0,
        p_product_id: productId || undefined,
      });
      if (rpcError) throw wrapDbError(rpcError);
      return data as unknown as Invoice;
    },
    onSuccess: (invoice) => {
      void qc.invalidateQueries({ queryKey: ["invoices"] });
      void qc.invalidateQueries({ queryKey: ["speed_limiter_certificates"] });
      void qc.invalidateQueries({ queryKey: ["certificate_billing_status"] });
      void qc.invalidateQueries({ queryKey: ["sales_summary"] });
      void qc.invalidateQueries({ queryKey: ["sales_report"] });
      toast.success(
        t("slCertificates.invoiceCreated", { number: invoice.doc_number, count: lines.length }),
      );
      onDone();
      navigate(`/sales/invoices/${invoice.id}`);
    },
    onError: (err) =>
      setError(err instanceof Error ? err.message : t("slCertificates.invoiceFailed")),
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

  if (billingQ.isLoading) return <LoadingState />;
  if (billingQ.error) return <ErrorState message={(billingQ.error as Error).message} />;

  const { skipped } = partition;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && <ErrorState message={error} />}
      <p className="text-sm text-ink-2">
        {t("slCertificates.invoiceLead", {
          customer: partition.customerName ?? t("common.dash"),
        })}
      </p>

      {lines.length > 0 && (
        <div className="rounded-lg bg-canvas p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-3">
            {t("slCertificates.invoiceEligible", { count: lines.length })}
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
            {skipped.map(({ cert, reason }) => (
              <li key={cert.id} className="flex justify-between gap-4">
                <span className="font-medium text-ink">{cert.certificate_number}</span>
                {reason.kind === "invoiced" ? (
                  <Link
                    to={`/sales/invoices/${reason.row.invoice_id}`}
                    className="text-end font-medium text-brand-700 hover:underline"
                  >
                    {skipLabel(t, reason)}
                  </Link>
                ) : (
                  <span className="text-end text-ink-3">{skipLabel(t, reason)}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {partition.customerId && others.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line p-3">
          <span className="text-sm text-ink-2">
            {t("slCertificates.invoiceOthersPending", {
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
                {t("slCertificates.invoiceConfirm")}
              </Button>
            </div>
          </div>
        </>
      )}
    </form>
  );
}
