import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Check, FileCheck2, PackageCheck, ReceiptText } from "lucide-react";
import { listRows, wrapDbError } from "../../lib/db";
import { supabase } from "../../lib/supabase";
import { formatDate, formatMoney } from "../../lib/format";
import { invoiceStatus, salesOrderStatus } from "../../lib/labels";
import type { Invoice, SalesOrder } from "../../lib/types";
import { useAuth } from "../../context/AuthContext";
import { useModules } from "../../context/ModulesContext";
import { useT } from "../../i18n";
import { Badge, Button, ErrorState, Field, Input, LoadingState, Modal } from "../../components/ui";
import { DocumentDetailShell, type ShellRenderArgs } from "./DocumentDetailShell";
import { InfoRow, SectionCard } from "./shared";

export default function OrderDetailPage() {
  const t = useT();
  const { orderId = "" } = useParams();
  const { isManager } = useAuth();
  const { isEnabled } = useModules();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const billingOn = isEnabled("billing");

  const invoicesQ = useQuery({
    queryKey: ["invoices", "order", orderId],
    queryFn: () =>
      listRows<Invoice>("invoices", (q) =>
        q.eq("sales_order_id", orderId).order("issue_date", { ascending: false }),
      ),
    enabled: billingOn && Boolean(orderId),
  });

  /** Order whose partial-invoice dialog is open. */
  const [invoicing, setInvoicing] = useState<string | null>(null);

  function actions({ doc, patch, patching, setError }: ShellRenderArgs<SalesOrder>) {
    if (!isManager) return null;
    const run = (values: Record<string, unknown>) => {
      setError("");
      patch(values);
    };
    return (
      <>
        {doc.status === "draft" && (
          <Button onClick={() => run({ status: "confirmed" })} loading={patching}>
            <Check className="h-4 w-4" /> {t("sales.orders.confirm")}
          </Button>
        )}
        {doc.status === "confirmed" && (
          <Button onClick={() => run({ status: "fulfilled" })} loading={patching}>
            <PackageCheck className="h-4 w-4" /> {t("sales.orders.fulfil")}
          </Button>
        )}
        {doc.status === "fulfilled" && (
          <Button variant="secondary" disabled={patching} onClick={() => run({ status: "closed" })}>
            <FileCheck2 className="h-4 w-4" /> {t("sales.orders.close")}
          </Button>
        )}
        {billingOn && (doc.status === "confirmed" || doc.status === "fulfilled") && (
          <Button onClick={() => setInvoicing(doc.id)}>
            <ReceiptText className="h-4 w-4" /> {t("sales.orders.invoice")}
          </Button>
        )}
        {(doc.status === "draft" || doc.status === "confirmed") && (
          <Button variant="ghost" disabled={patching} onClick={() => run({ status: "canceled" })}>
            <Ban className="h-4 w-4" /> {t("sales.orders.cancel")}
          </Button>
        )}
      </>
    );
  }

  return (
    <>
    <DocumentDetailShell<SalesOrder>
      id={orderId}
      table="sales_orders"
      linesTable="sales_order_lines"
      parentColumn="sales_order_id"
      routeBase="/sales/orders"
      backLabel={t("sales.orders.title")}
      notFoundMessage={t("sales.orders.notFound")}
      statusMeta={salesOrderStatus}
      dateColumn="expected_date"
      dateLabel={t("sales.doc.expectedDate")}
      editTitle={t("sales.orders.edit")}
      deleteTitle={t("sales.orders.delete")}
      deleteConfirm={(o) => t("sales.orders.deleteConfirm", { number: o.doc_number })}
      isEditable={(o) => o.status === "draft"}
      isDeletable={(o) => o.status === "draft" || o.status === "canceled"}
      purchaseOrder="full"
      detailRows={(o) => (
        <>
          <InfoRow label={t("sales.doc.orderDate")} value={formatDate(o.order_date)} />
          {o.customer_po_number && (
            <InfoRow
              label={t("sales.doc.poNumber")}
              value={
                o.customer_po_url ? (
                  <a
                    href={o.customer_po_url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-brand-700 hover:underline"
                  >
                    {o.customer_po_number}
                  </a>
                ) : (
                  o.customer_po_number
                )
              }
            />
          )}
          {o.customer_po_date && (
            <InfoRow label={t("sales.doc.poDate")} value={formatDate(o.customer_po_date)} />
          )}
          {o.job_id && (
            <InfoRow
              label={t("sales.doc.linkedJob")}
              value={
                <Link
                  to={`/speed-limiters/jobs/${o.job_id}`}
                  className="text-brand-700 hover:underline"
                >
                  {t("sales.doc.linkedJob")}
                </Link>
              }
            />
          )}
          {o.expected_date && (
            <InfoRow label={t("sales.doc.expectedDate")} value={formatDate(o.expected_date)} />
          )}
          {o.quote_id && (
            <InfoRow
              label={t("sales.quotes.title")}
              value={
                <Link to={`/sales/quotes/${o.quote_id}`} className="text-brand-700 hover:underline">
                  {t("sales.doc.createdFromQuote", { number: "" }).trim()}
                </Link>
              }
            />
          )}
        </>
      )}
      actions={actions}
      panels={({ doc }) =>
        billingOn ? (
          <SectionCard title={t("sales.orders.invoices")}>
            <div className="mb-3 space-y-1.5 text-sm tabular-nums">
              <div className="flex justify-between gap-4">
                <span className="text-ink-2">{t("sales.orders.invoiced")}</span>
                <span className="text-ink">{formatMoney(doc.invoiced_total, doc.currency)}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-ink-2">{t("sales.orders.unbilled")}</span>
                <span className="font-medium text-ink">
                  {formatMoney(Math.max(doc.total - doc.invoiced_total, 0), doc.currency)}
                </span>
              </div>
            </div>
            {invoicesQ.isLoading ? (
              <LoadingState />
            ) : invoicesQ.error ? (
              <ErrorState message={(invoicesQ.error as Error).message} />
            ) : (invoicesQ.data ?? []).length === 0 ? (
              <p className="py-4 text-center text-sm text-ink-3">{t("sales.orders.noInvoices")}</p>
            ) : (
              <ul className="divide-y divide-line">
                {(invoicesQ.data ?? []).map((inv) => {
                  const meta = invoiceStatus[inv.status];
                  return (
                    <li key={inv.id} className="flex items-center justify-between gap-3 py-2.5">
                      <Link
                        to={`/sales/invoices/${inv.id}`}
                        className="text-sm font-medium text-brand-700 hover:underline tabular-nums"
                      >
                        {inv.doc_number}
                      </Link>
                      <div className="flex items-center gap-2">
                        <Badge tone={meta.tone}>{t(meta.labelKey)}</Badge>
                        <span className="text-sm text-ink tabular-nums">
                          {formatMoney(inv.total, inv.currency)}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </SectionCard>
        ) : null
      }
      />
      {/* Partial invoicing lives in its own dialog: billing part of an order
          is a decision about quantities, not a single button press. */}
      <Modal
        title={t("sales.orders.invoice")}
        open={invoicing !== null}
        onClose={() => setInvoicing(null)}
        wide
      >
        {invoicing && (
          <PartialInvoiceForm
            orderId={invoicing}
            onDone={(invoice) => {
              setInvoicing(null);
              if (!invoice?.id) return;
              void qc.invalidateQueries({ queryKey: ["sales_orders"] });
              void qc.invalidateQueries({ queryKey: ["invoices"] });
              void qc.invalidateQueries({ queryKey: ["sales_summary"] });
              void qc.invalidateQueries({ queryKey: ["sales_order_line_balance"] });
              navigate(`/sales/invoices/${invoice.id}`);
            }}
          />
        )}
      </Modal>
    </>
  );
}

/**
 * Bill part of an order.
 *
 * A fleet PO is "50 x installation" and the dealer invoices 20 vehicles now
 * and 30 next month, so the unit is quantity per line. Remaining quantity is
 * read from `sales_order_line_balance` — derived from the invoice lines
 * themselves, so it cannot drift from what has actually been billed — and the
 * database re-checks every quantity before writing, so a stale dialog is
 * refused rather than allowed to overbill.
 */
function PartialInvoiceForm({
  orderId,
  onDone,
}: {
  orderId: string;
  onDone: (invoice: Invoice) => void;
}) {
  const t = useT();
  const [error, setError] = useState("");
  const [qty, setQty] = useState<Record<string, string>>({});

  const balanceQ = useQuery({
    queryKey: ["sales_order_line_balance", orderId],
    queryFn: async () => {
      const { data, error: rpcError } = await supabase.rpc("sales_order_line_balance", {
        p_order_id: orderId,
      });
      if (rpcError) throw wrapDbError(rpcError);
      return (data ?? []) as unknown as Array<{
        line_id: string;
        description: string;
        quantity: number;
        invoiced_quantity: number;
        remaining_quantity: number;
      }>;
    },
  });

  const rows = balanceQ.data ?? [];
  // Seeded to the full remaining amount: billing everything left is the common
  // case, and anything else is a deliberate edit.
  const valueFor = (lineId: string, remaining: number) =>
    qty[lineId] ?? String(remaining);

  const create = useMutation({
    mutationFn: async () => {
      const lines = rows
        .map((r) => ({
          line_id: r.line_id,
          quantity: Number(valueFor(r.line_id, Number(r.remaining_quantity))),
        }))
        .filter((l) => Number.isFinite(l.quantity) && l.quantity > 0);
      const { data, error: rpcError } = await supabase.rpc("create_invoice_from_order", {
        p_order_id: orderId,
        p_lines: lines,
      });
      if (rpcError) throw wrapDbError(rpcError);
      return data as unknown as Invoice;
    },
    onSuccess: onDone,
    onError: (err) =>
      setError(err instanceof Error ? err.message : t("sales.actionFailed")),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    create.mutate();
  }

  if (balanceQ.isLoading) return <LoadingState />;
  if (balanceQ.error) return <ErrorState message={(balanceQ.error as Error).message} />;

  const anythingLeft = rows.some((r) => Number(r.remaining_quantity) > 0);

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && <ErrorState message={error} />}
      <p className="text-sm text-ink-2">{t("sales.orders.partialLead")}</p>
      {!anythingLeft ? (
        <p className="py-4 text-center text-sm text-ink-3">{t("sales.orders.nothingLeftToInvoice")}</p>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const remaining = Number(r.remaining_quantity);
            return (
              <div key={r.line_id} className="rounded-lg border border-line p-3">
                <p className="text-sm font-medium text-ink">{r.description}</p>
                <p className="mt-0.5 text-xs text-ink-3">
                  {t("sales.orders.lineBalance", {
                    ordered: String(Number(r.quantity)),
                    invoiced: String(Number(r.invoiced_quantity)),
                    remaining: String(remaining),
                  })}
                </p>
                <div className="mt-2 max-w-[10rem]">
                  <Field label={t("sales.orders.invoiceQty")}>
                    <Input
                      type="number"
                      min={0}
                      max={remaining}
                      step="any"
                      disabled={remaining <= 0}
                      value={remaining <= 0 ? "0" : valueFor(r.line_id, remaining)}
                      onChange={(e) =>
                        setQty((q) => ({ ...q, [r.line_id]: e.target.value }))
                      }
                    />
                  </Field>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => onDone({} as Invoice)}>
          {t("action.cancel")}
        </Button>
        <Button type="submit" loading={create.isPending} disabled={!anythingLeft}>
          {t("sales.orders.invoice")}
        </Button>
      </div>
    </form>
  );
}
