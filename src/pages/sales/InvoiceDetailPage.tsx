import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Plus, Send, Trash2 } from "lucide-react";
import { deleteRow, insertRow, listRows, updateRow } from "../../lib/db";
import { daysUntil, formatDate, formatMoney } from "../../lib/format";
import { invoiceStatus, paymentMethods } from "../../lib/labels";
import { balanceDue, effectiveInvoiceStatus, isInvoiceOverdue } from "../../lib/sales";
import type { Invoice, Payment } from "../../lib/types";
import { useAuth } from "../../context/AuthContext";
import { useT, type MessageKey } from "../../i18n";
import {
  Button, ErrorState, Field, Input, LoadingState, Modal, Select, Textarea,
  type BadgeTone,
} from "../../components/ui";
import { DocumentDetailShell, type ShellRenderArgs } from "./DocumentDetailShell";
import { InfoRow, SectionCard } from "./shared";

const statusMetaWithOverdue: Record<string, { labelKey: MessageKey; tone: BadgeTone }> = {
  ...invoiceStatus,
  overdue: { labelKey: "enum.invoiceStatus.overdue", tone: "red" },
};

export default function InvoiceDetailPage() {
  const t = useT();
  const { invoiceId = "" } = useParams();
  const { isManager } = useAuth();
  const [paying, setPaying] = useState(false);
  const [voiding, setVoiding] = useState(false);

  const paymentsQ = useQuery({
    queryKey: ["payments", invoiceId],
    queryFn: () =>
      listRows<Payment>("payments", (q) =>
        q.eq("invoice_id", invoiceId).order("paid_at", { ascending: false }),
      ),
    enabled: Boolean(invoiceId),
  });

  function actions({ doc, patch, patching, setError }: ShellRenderArgs<Invoice>) {
    if (!isManager) return null;
    return (
      <>
        {doc.status === "draft" && (
          <Button
            loading={patching}
            title={t("sales.invoices.issueHint")}
            onClick={() => {
              setError("");
              patch({ status: "issued" });
            }}
          >
            <Send className="h-4 w-4 rtl:-scale-x-100" /> {t("sales.invoices.issue")}
          </Button>
        )}
        {(doc.status === "issued" || doc.status === "partially_paid") && (
          <>
            <Button onClick={() => setPaying(true)} disabled={patching}>
              <Plus className="h-4 w-4" /> {t("sales.payments.record")}
            </Button>
            <Button variant="ghost" disabled={patching} onClick={() => setVoiding(true)}>
              <Ban className="h-4 w-4" /> {t("sales.invoices.void")}
            </Button>
          </>
        )}
        {doc.status === "draft" && (
          <Button variant="ghost" disabled={patching} onClick={() => setVoiding(true)}>
            <Ban className="h-4 w-4" /> {t("sales.invoices.void")}
          </Button>
        )}
      </>
    );
  }

  return (
    <DocumentDetailShell<Invoice>
      id={invoiceId}
      table="invoices"
      linesTable="invoice_lines"
      parentColumn="invoice_id"
      routeBase="/sales/invoices"
      backLabel={t("sales.invoices.title")}
      notFoundMessage={t("sales.invoices.notFound")}
      statusMeta={statusMetaWithOverdue}
      effectiveStatus={(i) => effectiveInvoiceStatus(i)}
      dateColumn="due_date"
      dateLabel={t("sales.doc.dueDate")}
      editTitle={t("sales.invoices.edit")}
      deleteTitle={t("sales.invoices.delete")}
      deleteConfirm={(i) => t("sales.invoices.deleteConfirm", { number: i.doc_number })}
      isEditable={(i) => i.status === "draft"}
      isDeletable={(i) => i.status === "draft"}
      totalsExtra={(i) => ({ paid: i.amount_paid, balance: balanceDue(i) })}
      detailRows={(i) => {
        const days = i.due_date ? daysUntil(i.due_date) : null;
        return (
          <>
            <InfoRow label={t("sales.doc.issueDate")} value={formatDate(i.issue_date)} />
            <InfoRow
              label={t("sales.doc.dueDate")}
              value={
                <span className={isInvoiceOverdue(i) ? "text-serious" : undefined}>
                  {formatDate(i.due_date)}
                  {days !== null && (i.status === "issued" || i.status === "partially_paid") && (
                    <span className="ms-2 text-xs">
                      {days < 0
                        ? t("sales.invoices.overdueBy", { days: Math.abs(days) })
                        : t("sales.invoices.dueIn", { days })}
                    </span>
                  )}
                </span>
              }
            />
            {i.sales_order_id && (
              <InfoRow
                label={t("sales.orders.title")}
                value={
                  <Link
                    to={`/sales/orders/${i.sales_order_id}`}
                    className="text-brand-700 hover:underline"
                  >
                    {t("sales.doc.createdFromOrder", { number: "" }).trim()}
                  </Link>
                }
              />
            )}
            {i.void_reason && (
              <InfoRow label={t("sales.invoices.voidReason")} value={i.void_reason} />
            )}
          </>
        );
      }}
      actions={actions}
      afterLines={({ doc, refresh }) => (
        <>
          <SectionCard
            title={t("sales.payments.title")}
            actions={
              isManager && (doc.status === "issued" || doc.status === "partially_paid") ? (
                <Button variant="secondary" onClick={() => setPaying(true)}>
                  <Plus className="h-4 w-4" /> {t("sales.payments.record")}
                </Button>
              ) : undefined
            }
          >
            <PaymentsList
              invoice={doc}
              payments={paymentsQ.data ?? []}
              isLoading={paymentsQ.isLoading}
              error={paymentsQ.error}
              canEdit={isManager}
              onChanged={refresh}
            />
          </SectionCard>

          <PaymentModal
            open={paying}
            onClose={() => setPaying(false)}
            invoice={doc}
            onSaved={refresh}
          />
          <VoidModal
            open={voiding}
            onClose={() => setVoiding(false)}
            invoice={doc}
            onSaved={refresh}
          />
        </>
      )}
    />
  );
}

function PaymentsList({
  invoice,
  payments,
  isLoading,
  error,
  canEdit,
  onChanged,
}: {
  invoice: Invoice;
  payments: Payment[];
  isLoading: boolean;
  error: unknown;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [deleting, setDeleting] = useState<Payment | null>(null);
  const [failure, setFailure] = useState("");

  const remove = useMutation({
    mutationFn: (id: string) => deleteRow("payments", id),
    onSuccess: () => {
      setFailure("");
      void qc.invalidateQueries({ queryKey: ["payments", invoice.id] });
      setDeleting(null);
      onChanged();
    },
    onError: (err) => {
      setFailure(err instanceof Error ? err.message : t("sales.deleteFailed"));
      setDeleting(null);
    },
  });

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={(error as Error).message} />;
  if (invoice.status === "draft") {
    return <p className="py-4 text-center text-sm text-ink-3">{t("sales.payments.unavailable")}</p>;
  }
  if (payments.length === 0) {
    return <p className="py-4 text-center text-sm text-ink-3">{t("sales.payments.none")}</p>;
  }

  return (
    <>
      {failure && (
        <div className="mb-3">
          <ErrorState message={failure} />
        </div>
      )}
      <ul className="divide-y divide-line">
        {payments.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <div className="text-sm font-medium text-ink tabular-nums">
                {formatMoney(p.amount, invoice.currency)}
              </div>
              <div className="text-xs text-ink-3">
                {formatDate(p.paid_at)} · {t(paymentMethods[p.method])}
                {p.reference ? ` · ${p.reference}` : ""}
              </div>
            </div>
            {canEdit && (
              <button
                type="button"
                className="rounded-md p-1.5 text-ink-3 transition-colors hover:bg-serious-soft hover:text-serious"
                onClick={() => setDeleting(p)}
                aria-label={t("sales.payments.delete")}
                title={t("sales.payments.delete")}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </li>
        ))}
      </ul>

      <Modal
        title={t("sales.payments.delete")}
        open={deleting !== null}
        onClose={() => setDeleting(null)}
      >
        {deleting && (
          <>
            <p className="text-sm text-ink-2">
              {t("sales.payments.deleteConfirm", {
                amount: formatMoney(deleting.amount, invoice.currency),
              })}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeleting(null)}>
                {t("action.cancel")}
              </Button>
              <Button
                variant="danger"
                loading={remove.isPending}
                onClick={() => remove.mutate(deleting.id)}
              >
                {t("action.delete")}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}

function PaymentModal({
  open,
  onClose,
  invoice,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  invoice: Invoice;
  onSaved: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const balance = balanceDue(invoice);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<Payment["method"]>("bank_transfer");
  const [paidAt, setPaidAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState("");
  const [error, setError] = useState("");

  const save = useMutation({
    mutationFn: () =>
      insertRow<Payment>("payments", {
        invoice_id: invoice.id,
        amount: Number(amount),
        method,
        paid_at: paidAt,
        reference: reference.trim() || null,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["payments", invoice.id] });
      setAmount("");
      setReference("");
      setError("");
      onSaved();
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("sales.saveFailed")),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    save.mutate();
  }

  return (
    <Modal title={t("sales.payments.record")} open={open} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <ErrorState message={error} />}
        <Field label={t("sales.payments.amount")} required>
          <Input
            type="number" min={0.0001} step="0.0001" required
            className="tabular-nums"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <button
          type="button"
          className="text-xs font-medium text-brand-700 hover:underline"
          onClick={() => setAmount(String(balance))}
        >
          {t("sales.payments.settleFull", {
            amount: formatMoney(balance, invoice.currency),
          })}
        </button>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("sales.payments.method")}>
            <Select
              value={method}
              onChange={(e) => setMethod(e.target.value as Payment["method"])}
            >
              {Object.entries(paymentMethods).map(([value, labelKey]) => (
                <option key={value} value={value}>{t(labelKey)}</option>
              ))}
            </Select>
          </Field>
          <Field label={t("sales.payments.paidAt")}>
            <Input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
          </Field>
        </div>
        <Field label={t("sales.payments.reference")}>
          <Input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder={t("sales.payments.referencePlaceholder")}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("action.cancel")}
          </Button>
          <Button type="submit" loading={save.isPending}>{t("sales.payments.record")}</Button>
        </div>
      </form>
    </Modal>
  );
}

function VoidModal({
  open,
  onClose,
  invoice,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  invoice: Invoice;
  onSaved: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  const voidIt = useMutation({
    mutationFn: () =>
      updateRow("invoices", invoice.id, {
        status: "void",
        void_reason: reason.trim() || null,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["invoices"] });
      void qc.invalidateQueries({ queryKey: ["sales_summary"] });
      setReason("");
      setError("");
      onSaved();
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("sales.actionFailed")),
  });

  return (
    <Modal title={t("sales.invoices.void")} open={open} onClose={onClose}>
      {error && <ErrorState message={error} />}
      <p className="text-sm text-ink-2">
        {t("sales.invoices.voidConfirm", { number: invoice.doc_number })}
      </p>
      <div className="mt-4">
        <Field label={t("sales.invoices.voidReason")}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>{t("action.cancel")}</Button>
        <Button variant="danger" loading={voidIt.isPending} onClick={() => voidIt.mutate()}>
          {t("sales.invoices.void")}
        </Button>
      </div>
    </Modal>
  );
}
