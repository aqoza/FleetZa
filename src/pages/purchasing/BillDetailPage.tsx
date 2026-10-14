import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, CheckCircle2, FileText, Pencil, Plus, Trash2 } from "lucide-react";
import { getCountry } from "../../../shared/countries";
import { deleteRow, insertRow, listRows, updateRow } from "../../lib/db";
import { ltrText } from "../../lib/bidi";
import { formatDate, formatMoney } from "../../lib/format";
import { paymentMethods } from "../../lib/labels";
import { billBalance, billPayable } from "../../lib/purchasing";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useI18n, useT } from "../../i18n";
import { Badge, Bdi, Button, Card, EmptyState, ErrorState, Field, Input, LoadingState, Ltr, Modal, PageHeader, Select, Textarea } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { BackLink, TotalsPanel, taxHeading } from "../sales/shared";
import { todayIso } from "../employees/shared";
import { BillForm } from "./BillForm";
import { DueNote } from "./DueNote";
import { billStatus, supplierName } from "./labels";
import { LineTable } from "./LineTable";
import { BILL_SELECT, LINE_SELECT, type BillLine, type VendorBill, type VendorPayment } from "./types";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
      <dt className="text-ink-3">{label}</dt>
      <dd className="text-end text-ink">{children}</dd>
    </div>
  );
}

export default function BillDetailPage() {
  const { billId = "" } = useParams();
  const t = useT();
  const { language } = useI18n();
  const tenant = useTenant();
  const { isManager } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState(false);
  const [confirm, setConfirm] = useState<"void" | "delete" | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [deletingPayment, setDeletingPayment] = useState<VendorPayment | null>(null);
  const [actionError, setActionError] = useState("");

  const billQ = useQuery({
    queryKey: ["vendor_bills", "one", billId],
    queryFn: async () => (await listRows<VendorBill>("vendor_bills", (q) => q.select(BILL_SELECT).eq("id", billId).limit(1)))[0] ?? null,
  });
  const linesKey = ["vendor_bill_lines", billId];
  const linesQ = useQuery({
    queryKey: linesKey,
    queryFn: () =>
      listRows<BillLine>("vendor_bill_lines", (q) =>
        q.select(LINE_SELECT).eq("vendor_bill_id", billId).order("sort_order").order("created_at").limit(500),
      ),
  });
  const paymentsKey = ["vendor_payments", billId];
  const paymentsQ = useQuery({
    queryKey: paymentsKey,
    queryFn: () =>
      listRows<VendorPayment>("vendor_payments", (q) =>
        q.eq("vendor_bill_id", billId).order("paid_at", { ascending: false }).order("created_at", { ascending: false }).limit(200),
      ),
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["vendor_bills"] });
    void qc.invalidateQueries({ queryKey: paymentsKey });
  };
  const fail = (e: unknown) => {
    setConfirm(null);
    setDeletingPayment(null);
    setActionError(e instanceof Error ? e.message : String(e));
  };

  const approve = useMutation({
    mutationFn: () => updateRow("vendor_bills", billId, { status: "open" }),
    onSuccess: () => {
      setActionError("");
      refresh();
      void qc.invalidateQueries({ queryKey: linesKey });
      toast.success(t("purchasing.bill.approved"));
    },
    onError: fail,
  });
  const voidBill = useMutation({
    mutationFn: () => updateRow("vendor_bills", billId, { status: "void", void_reason: voidReason.trim() || null }),
    onSuccess: () => {
      setActionError("");
      setConfirm(null);
      refresh();
      toast.success(t("purchasing.bill.voided"));
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: () => deleteRow("vendor_bills", billId),
    onSuccess: () => {
      refresh();
      toast.success(t("toast.deleted"));
      navigate("/purchasing/bills");
    },
    onError: fail,
  });
  const removePayment = useMutation({
    mutationFn: (id: string) => deleteRow("vendor_payments", id),
    onSuccess: () => {
      setActionError("");
      setDeletingPayment(null);
      refresh();
      toast.success(t("purchasing.paymentDeleted"));
    },
    onError: fail,
  });

  const back = <BackLink to="/purchasing/bills" label={t("purchasing.tab.bills")} />;
  if (billQ.isLoading) return <LoadingState />;
  if (billQ.error) return <ErrorState message={(billQ.error as Error).message} />;
  const bill = billQ.data;
  if (!bill) {
    return (
      <>
        {back}
        <EmptyState icon={<FileText className="h-10 w-10" />} title={t("purchasing.billNotFound")} />
      </>
    );
  }

  const lines = linesQ.data ?? [];
  const payments = paymentsQ.data ?? [];
  const st = billStatus[bill.status];
  const draft = bill.status === "draft";
  const payable = billPayable(bill.status);
  const balance = billBalance(bill, bill.currency_decimals);
  const country = getCountry(tenant.country);
  const taxLabel = taxHeading(t, country.tax.label, lines.map((l) => Number(l.tax_rate)));
  const money = (v: number) => formatMoney(v, bill.currency);
  // Payments can be undone while the bill is still live; a void bill has none.
  const paymentsEditable = isManager && (payable || bill.status === "paid");

  return (
    <>
      {back}
      <PageHeader
        title={bill.doc_number ?? t("purchasing.bill")}
        description={supplierName(bill.supplier, language)}
        badge={<Badge tone={st.tone}>{t(st.labelKey)}</Badge>}
        actions={
          isManager ? (
            <div className="flex flex-wrap gap-2">
              {draft && (
                <Button loading={approve.isPending} disabled={lines.length === 0} onClick={() => approve.mutate()}>
                  <CheckCircle2 className="h-4 w-4" /> {t("purchasing.bill.approve")}
                </Button>
              )}
              {payable && (
                <Button onClick={() => setPaying(true)}>
                  <Plus className="h-4 w-4" /> {t("purchasing.recordPayment")}
                </Button>
              )}
              {draft && (
                <Button variant="secondary" onClick={() => setEditing(true)}>
                  <Pencil className="h-4 w-4" /> {t("purchasing.edit")}
                </Button>
              )}
              {(draft || (payable && payments.length === 0)) && (
                <Button variant="ghost" onClick={() => { setVoidReason(""); setConfirm("void"); }}>
                  <Ban className="h-4 w-4" /> {t("purchasing.bill.void")}
                </Button>
              )}
              {draft && (
                <Button variant="ghost" onClick={() => setConfirm("delete")} aria-label={t("action.delete")} title={t("action.delete")}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ) : undefined
        }
      />
      {actionError && (
        <div className="mb-4">
          <ErrorState message={actionError} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 lg:col-span-2">
          <Card className="p-4 sm:p-5">
            <h2 className="mb-3 text-base font-semibold text-ink">{t("purchasing.lines")}</h2>
            {linesQ.isLoading ? (
              <LoadingState />
            ) : (
              <LineTable
                table="vendor_bill_lines"
                parentColumn="vendor_bill_id"
                parentId={bill.id}
                lines={lines}
                currency={bill.currency}
                decimals={bill.currency_decimals}
                editable={draft && isManager}
                queryKey={linesKey}
              />
            )}
            <div className="mt-4 flex justify-end">
              <div className="w-full max-w-xs">
                <TotalsPanel doc={{ ...bill, subtotal: Number(bill.subtotal), discount_total: Number(bill.discount_total),
                  tax_total: Number(bill.tax_total), total: Number(bill.total) }} taxLabel={taxLabel} />
                {!draft && bill.status !== "void" && (
                  <dl className="mt-2 space-y-1 border-t border-line pt-2 text-sm tabular-nums">
                    <div className="flex justify-between gap-4">
                      <dt className="text-ink-3">{t("purchasing.payments")}</dt>
                      <dd className="text-ink"><Ltr>{money(Number(bill.amount_paid))}</Ltr></dd>
                    </div>
                    <div className="flex justify-between gap-4 font-semibold">
                      <dt className="text-ink">{t("purchasing.col.balance")}</dt>
                      <dd className="text-ink"><Ltr>{money(balance)}</Ltr></dd>
                    </div>
                  </dl>
                )}
              </div>
            </div>
          </Card>

          {!draft && (
            <Card className="p-4 sm:p-5">
              <h2 className="mb-3 text-base font-semibold text-ink">{t("purchasing.payments")}</h2>
              {paymentsQ.isLoading ? (
                <LoadingState />
              ) : payments.length === 0 ? (
                <p className="text-sm text-ink-3">{t("purchasing.noPayments")}</p>
              ) : (
                <ul className="divide-y divide-line">
                  {payments.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-ink tabular-nums"><Ltr>{money(Number(p.amount))}</Ltr></div>
                        <div className="text-xs text-ink-3">
                          <Ltr>{formatDate(p.paid_at)}</Ltr> · {t(paymentMethods[p.method])}
                          {p.reference && <> · <Ltr>{p.reference}</Ltr></>}
                        </div>
                        {p.notes && <p className="text-xs text-ink-2" dir="auto">{p.notes}</p>}
                      </div>
                      {paymentsEditable && (
                        <button type="button"
                          className="rounded-md p-1.5 text-ink-3 transition-colors hover:bg-serious-soft hover:text-serious"
                          onClick={() => setDeletingPayment(p)}
                          aria-label={t("purchasing.deletePayment")} title={t("purchasing.deletePayment")}>
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>

        <Card className="h-fit p-4 sm:p-5">
          <h2 className="mb-2 text-base font-semibold text-ink">{t("purchasing.details")}</h2>
          <dl className="divide-y divide-line">
            <Row label={t("purchasing.f.supplier")}>
              {bill.supplier ? (
                <Link to={`/suppliers/${bill.supplier.id}`} className="text-brand-700 hover:underline">
                  <Bdi>{supplierName(bill.supplier, language)}</Bdi>
                </Link>
              ) : t("common.dash")}
            </Row>
            {bill.order && (
              <Row label={t("purchasing.col.order")}>
                <Link to={`/purchasing/orders/${bill.order.id}`} className="text-brand-700 hover:underline">
                  <Ltr>{bill.order.doc_number ?? ""}</Ltr>
                </Link>
              </Row>
            )}
            {bill.supplier_invoice_number && (
              <Row label={t("purchasing.f.supplierInvoice")}><Ltr>{bill.supplier_invoice_number}</Ltr></Row>
            )}
            <Row label={t("purchasing.f.billDate")}><Ltr>{formatDate(bill.bill_date)}</Ltr></Row>
            <Row label={t("purchasing.f.dueDate")}>
              {bill.due_date ? (
                <span className="inline-flex flex-col items-end">
                  <Ltr>{formatDate(bill.due_date)}</Ltr>
                  <DueNote bill={bill} today={todayIso()} />
                </span>
              ) : t("common.dash")}
            </Row>
          </dl>
          {bill.status === "void" && bill.void_reason && (
            <p className="mt-3 rounded-lg bg-canvas px-3 py-2 text-xs text-ink-2" dir="auto">{bill.void_reason}</p>
          )}
          {bill.notes && <p className="mt-3 whitespace-pre-line text-sm text-ink-2" dir="auto">{bill.notes}</p>}
        </Card>
      </div>

      <Modal title={t("purchasing.edit")} open={editing} onClose={() => setEditing(false)}>
        {editing && <BillForm bill={bill} onDone={() => setEditing(false)} />}
      </Modal>
      <Modal title={t("purchasing.recordPayment")} open={paying} onClose={() => setPaying(false)}>
        {paying && (
          <PaymentForm bill={bill} balance={balance} onDone={(saved) => {
            setPaying(false);
            if (saved) refresh();
          }} />
        )}
      </Modal>
      <Modal title={t("purchasing.deletePayment")} open={!!deletingPayment} onClose={() => setDeletingPayment(null)}>
        {deletingPayment && (
          <div className="space-y-4">
            <p className="text-sm text-ink-2">
              {t("purchasing.confirmDeletePayment", { amount: ltrText(money(Number(deletingPayment.amount))) })}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeletingPayment(null)}>{t("action.cancel")}</Button>
              <Button variant="danger" loading={removePayment.isPending} onClick={() => removePayment.mutate(deletingPayment.id)}>
                {t("action.delete")}
              </Button>
            </div>
          </div>
        )}
      </Modal>
      <Modal title={t("action.confirm")} open={!!confirm} onClose={() => setConfirm(null)}>
        {confirm && (
          <div className="space-y-4">
            <p className="text-sm text-ink-2">
              {confirm === "void"
                ? t("purchasing.bill.confirmVoid")
                : t("purchasing.bill.confirmDelete", { number: ltrText(bill.doc_number ?? "") })}
            </p>
            {confirm === "void" && (
              <Field label={t("purchasing.bill.voidReason")}>
                <Input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} maxLength={500} dir="auto" />
              </Field>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirm(null)}>{t("action.cancel")}</Button>
              <Button variant="danger" loading={voidBill.isPending || remove.isPending}
                onClick={() => (confirm === "void" ? voidBill.mutate() : remove.mutate())}>
                {t("action.confirm")}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

function PaymentForm({ bill, balance, onDone }: { bill: VendorBill; balance: number; onDone: (saved: boolean) => void }) {
  const t = useT();
  const toast = useToast();
  const [amount, setAmount] = useState(String(balance));
  const [method, setMethod] = useState<VendorPayment["method"]>("bank_transfer");
  const [paidAt, setPaidAt] = useState(todayIso());
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const step = (1 / 10 ** bill.currency_decimals).toFixed(bill.currency_decimals);

  const save = useMutation({
    mutationFn: () =>
      insertRow<VendorPayment>("vendor_payments", {
        vendor_bill_id: bill.id,
        amount: Number(amount),
        method,
        paid_at: paidAt,
        reference: reference.trim() || null,
        notes: notes.trim() || null,
      }),
    onSuccess: () => {
      toast.success(t("purchasing.paymentRecorded"));
      onDone(true);
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (!(Number(amount) > 0)) return;
    save.mutate();
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label={t("purchasing.p.amount")} required hint={t("purchasing.p.balanceHint", { amount: ltrText(formatMoney(balance, bill.currency)) })}>
        <Input type="number" min={step} max={balance} step={step} required className="tabular-nums" dir="ltr"
          value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("purchasing.p.method")}>
          <Select value={method} onChange={(e) => setMethod(e.target.value as VendorPayment["method"])}>
            {Object.entries(paymentMethods).map(([value, labelKey]) => (
              <option key={value} value={value}>{t(labelKey)}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("purchasing.p.paidAt")} required>
          <Input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} required dir="ltr" />
        </Field>
      </div>
      <Field label={t("purchasing.p.reference")}>
        <Input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={200} dir="ltr" />
      </Field>
      <Field label={t("purchasing.p.notes")}>
        <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
      </Field>
      {error && <ErrorState message={error} />}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => onDone(false)}>{t("action.cancel")}</Button>
        <Button type="submit" loading={save.isPending}>{t("purchasing.recordPayment")}</Button>
      </div>
    </form>
  );
}
