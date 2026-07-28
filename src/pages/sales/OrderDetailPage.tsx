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
import { Badge, Button, ErrorState, LoadingState } from "../../components/ui";
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

  const createInvoice = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc("create_invoice_from_order", {
        p_order_id: id,
      });
      if (error) throw wrapDbError(error);
      return data as unknown as Invoice;
    },
    onSuccess: (invoice) => {
      void qc.invalidateQueries({ queryKey: ["sales_orders"] });
      void qc.invalidateQueries({ queryKey: ["invoices"] });
      void qc.invalidateQueries({ queryKey: ["sales_summary"] });
      navigate(`/sales/invoices/${invoice.id}`);
    },
  });

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
          <Button
            loading={createInvoice.isPending}
            onClick={() => {
              setError("");
              createInvoice.mutate(doc.id, {
                onError: (err) =>
                  setError(err instanceof Error ? err.message : t("sales.actionFailed")),
              });
            }}
          >
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
  );
}
