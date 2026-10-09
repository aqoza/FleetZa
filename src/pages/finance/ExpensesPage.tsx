import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, ReceiptText } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { deleteRow, insertRow, listPage, listRows, sanitizeSearch, updateRow, wrapDbError } from "../../lib/db";
import { formatDate, formatMoney } from "../../lib/format";
import { useSupplierPicker, useVehiclePicker } from "../../lib/pickers";
import { EXPENSE_STATUSES, nextExpenseStatuses, type ExpenseStatus } from "../../../shared/finance";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useI18n, useT } from "../../i18n";
import { Badge, Bdi, Button, EmptyState, ErrorState, Field, Input, LoadingState, Ltr, Modal, Pagination, Textarea } from "../../components/ui";
import { Combobox } from "../../components/Combobox";
import { useToast } from "../../components/Toast";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { FormActions, FormError, numOrNull, onSubmit, textOrNull, useSubmit } from "./forms";
import {
  EXPENSE_SELECT, accountName, accountOptions, expenseTone, todayIn, useAccounts, useFinanceSettings, type Expense, type GlAccount,
} from "./types";

const PAGE_SIZE = 25;
type Filter = "all" | ExpenseStatus;

export default function ExpensesPage() {
  const t = useT();
  const tenant = useTenant();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [creating, setCreating] = useState(false);
  const term = sanitizeSearch(search);
  const openId = params.get("expense");

  const countsQ = useQuery({
    queryKey: ["expenses", "counts"],
    queryFn: () => listRows<{ status: ExpenseStatus }>("expenses", (q) => q.select("status").limit(10000)),
  });
  const counts = useMemo(() => {
    const m = new Map<ExpenseStatus, number>();
    for (const r of countsQ.data ?? []) m.set(r.status, (m.get(r.status) ?? 0) + 1);
    return m;
  }, [countsQ.data]);

  const listQ = useQuery({
    queryKey: ["expenses", "list", { page, filter, term }],
    queryFn: () =>
      listPage<Expense>("expenses", page, PAGE_SIZE, (q) => {
        let f = q.select(EXPENSE_SELECT);
        if (filter !== "all") f = f.eq("status", filter);
        if (term) f = f.or(`doc_number.ilike.%${term}%,description.ilike.%${term}%,reference.ilike.%${term}%`);
        return f.order("expense_date", { ascending: false }).order("number", { ascending: false });
      }),
  });

  const open = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("expense", id);
    else next.delete("expense");
    setParams(next, { replace: true });
  };
  const pick = (f: Filter) => { setFilter(f); setPage(0); };
  const chip = (f: Filter, label: string, n: number) => (
    <button
      key={f}
      type="button"
      onClick={() => pick(f)}
      aria-pressed={filter === f}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${
        filter === f ? "border-brand-600 bg-brand-600 text-white" : "border-line bg-surface text-ink-2 hover:bg-canvas"
      }`}
    >
      {label}
      <Ltr className={`text-xs ${filter === f ? "text-white/80" : "text-ink-3"}`}>{String(n)}</Ltr>
    </button>
  );

  const columns: Array<DataTableColumn<Expense>> = [
    {
      id: "number",
      header: t("finance.exp.number"),
      cell: (x) => <Ltr className="whitespace-nowrap font-medium text-brand-700">{x.doc_number}</Ltr>,
      exportValue: (x) => x.doc_number ?? "",
    },
    {
      id: "date",
      header: t("finance.exp.date"),
      minBreakpoint: "sm",
      cell: (x) => <span className="whitespace-nowrap text-ink-2">{formatDate(x.expense_date)}</span>,
      sortValue: (x) => x.expense_date,
      exportValue: (x) => x.expense_date,
    },
    {
      id: "description",
      header: t("finance.exp.description"),
      cell: (x) => (
        <div className="min-w-0 max-w-72">
          <div className="truncate text-ink"><Bdi>{x.description}</Bdi></div>
          {(x.supplier || x.vehicle) && (
            <div className="truncate text-xs text-ink-3">
              <Bdi>{[x.supplier?.name, x.vehicle?.license_plate ?? x.vehicle?.name].filter(Boolean).join(" · ")}</Bdi>
            </div>
          )}
        </div>
      ),
      exportValue: (x) => x.description,
    },
    {
      id: "total",
      header: t("finance.exp.total"),
      align: "end",
      cell: (x) => <Ltr className="whitespace-nowrap text-ink">{formatMoney(x.total, tenant.currency)}</Ltr>,
      sortValue: (x) => x.total,
      exportValue: (x) => x.total,
    },
    {
      id: "status",
      header: t("finance.exp.status"),
      cell: (x) => <span className="whitespace-nowrap"><Badge tone={expenseTone[x.status]}>{t(`finance.expStatus.${x.status}`)}</Badge></span>,
      exportValue: (x) => x.status,
    },
  ];

  const refresh = () => {
    for (const k of ["expenses", "journal_entries", "finance_balances", "finance_monthly", "finance_pending"]) {
      void qc.invalidateQueries({ queryKey: [k] });
    }
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        {EXPENSE_STATUSES.map((s) => chip(s, t(`finance.expStatus.${s}`), counts.get(s) ?? 0))}
        {chip("all", t("finance.exp.all"), countsQ.data?.length ?? 0)}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} placeholder={t("finance.exp.search")}
          className="w-full sm:max-w-72" />
        {isManager && (
          <Button className="ms-auto" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> {t("finance.exp.new")}
          </Button>
        )}
      </div>
      {listQ.isLoading && <LoadingState />}
      {listQ.error && <ErrorState message={(listQ.error as Error).message} />}
      {listQ.data && (
        <DataTable<Expense>
          tableId="expenses"
          exportName="expenses"
          rows={listQ.data.rows}
          rowKey={(x) => x.id}
          columns={columns}
          onRowClick={(x) => open(x.id)}
          empty={<EmptyState icon={<ReceiptText className="h-10 w-10" />} title={t("finance.exp.empty")} description={t("finance.exp.emptyHint")} />}
          footer={<Pagination page={page} pageSize={PAGE_SIZE} total={listQ.data.total} onPage={setPage} />}
        />
      )}
      <Modal title={t("finance.exp.newTitle")} open={creating} onClose={() => setCreating(false)} wide>
        {creating && (
          <ExpenseForm
            onCancel={() => setCreating(false)}
            onDone={(id) => { setCreating(false); refresh(); toast.success(t("finance.saved")); open(id); }}
          />
        )}
      </Modal>
      <ExpenseModal id={openId} onClose={() => open(null)} onChanged={refresh} />
    </div>
  );
}

function ExpenseModal({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  const t = useT();
  const { language } = useI18n();
  const tenant = useTenant();
  const { isManager } = useAuth();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const accountsQ = useAccounts();
  const q = useQuery({
    queryKey: ["expenses", "one", id],
    enabled: !!id,
    queryFn: async () => (await listRows<Expense>("expenses", (b) => b.select(EXPENSE_SELECT).eq("id", id ?? "").limit(1)))[0] ?? null,
  });
  const x = q.data;
  const close = () => { setEditing(false); setRejecting(false); setReason(""); onClose(); };
  const fail = (err: unknown) => toast.error(err instanceof Error ? err.message : t("common.error"));
  const move = useMutation({
    mutationFn: async (status: ExpenseStatus) => {
      if (!x) return;
      await updateRow("expenses", x.id, status === "rejected" ? { status, rejection_reason: textOrNull(reason) } : { status });
    },
    onSuccess: () => { setRejecting(false); onChanged(); toast.success(t("finance.saved")); },
    onError: fail,
  });
  const post = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("finance_post_expense", { p_expense_id: id ?? "" });
      if (error) throw wrapDbError(error);
    },
    onSuccess: () => { onChanged(); toast.success(t("finance.exp.posted")); },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: () => deleteRow("expenses", id ?? ""),
    onSuccess: () => { onChanged(); close(); toast.success(t("finance.exp.deleted")); },
    onError: fail,
  });

  const account = (aid: string) => (accountsQ.data ?? []).find((a) => a.id === aid);
  const label = (a: GlAccount | undefined) => (a ? `${a.code} · ${accountName(a, language)}` : "—");
  const busy = move.isPending || post.isPending || remove.isPending;

  return (
    <Modal title={x?.doc_number ?? t("finance.exp.title")} open={!!id} onClose={close} wide busy={busy}>
      {q.isLoading && <LoadingState />}
      {q.error && <ErrorState message={(q.error as Error).message} />}
      {id && !q.isLoading && !x && <ErrorState message={t("finance.exp.notFound")} />}
      {x && editing && (
        <ExpenseForm expense={x} onCancel={() => setEditing(false)} onDone={() => { setEditing(false); onChanged(); toast.success(t("finance.saved")); }} />
      )}
      {x && !editing && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={expenseTone[x.status]}>{t(`finance.expStatus.${x.status}`)}</Badge>
            <span className="text-sm text-ink-2">{formatDate(x.expense_date)}</span>
          </div>
          <p className="text-ink"><Bdi>{x.description}</Bdi></p>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <Item label={t("finance.exp.category")}><Bdi>{label(account(x.category_account_id))}</Bdi></Item>
            <Item label={t("finance.exp.paidFrom")}><Bdi>{label(account(x.payment_account_id))}</Bdi></Item>
            {x.supplier && <Item label={t("finance.exp.supplier")}><Bdi>{x.supplier.name}</Bdi></Item>}
            {x.vehicle && <Item label={t("finance.exp.vehicle")}><Bdi>{x.vehicle.name}</Bdi>{x.vehicle.license_plate && <> · <Ltr>{x.vehicle.license_plate}</Ltr></>}</Item>}
            {x.reference && <Item label={t("finance.exp.reference")}><Ltr>{x.reference}</Ltr></Item>}
            <Item label={t("finance.exp.amount")}><Ltr>{formatMoney(x.amount, tenant.currency)}</Ltr></Item>
            <Item label={t("finance.exp.tax")}><Ltr>{formatMoney(x.tax_amount, tenant.currency)}</Ltr></Item>
            <Item label={t("finance.exp.total")}><Ltr className="font-semibold">{formatMoney(x.total, tenant.currency)}</Ltr></Item>
          </dl>
          {x.status === "rejected" && x.rejection_reason && (
            <p className="rounded-xl bg-serious-soft px-3 py-2 text-sm text-serious">{t("finance.exp.rejectedBecause", { reason: x.rejection_reason })}</p>
          )}
          {x.journal_entry_id && (
            <p className="text-sm text-ink-2">
              {t("finance.exp.postedAs")}{" "}
              <Link to={`/finance/journal/${x.journal_entry_id}`} className="font-medium text-brand-700 hover:underline">{t("finance.exp.viewEntry")}</Link>
            </p>
          )}
          {isManager && rejecting && (
            <Field label={t("finance.exp.rejectReason")}>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} />
            </Field>
          )}
          {isManager && (
            <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
              {rejecting ? (
                <>
                  <Button variant="secondary" onClick={() => setRejecting(false)}>{t("action.cancel")}</Button>
                  <Button variant="danger" loading={move.isPending} onClick={() => move.mutate("rejected")}>{t("finance.exp.reject")}</Button>
                </>
              ) : (
                <>
                  {x.status === "draft" && (
                    <>
                      <Button variant="ghost" className="me-auto text-serious" disabled={busy} onClick={() => remove.mutate()}>{t("action.delete")}</Button>
                      <Button variant="secondary" disabled={busy} onClick={() => setEditing(true)}>{t("action.edit")}</Button>
                    </>
                  )}
                  {nextExpenseStatuses(x.status).includes("rejected") && (
                    <Button variant="secondary" disabled={busy} onClick={() => setRejecting(true)}>{t("finance.exp.reject")}</Button>
                  )}
                  {x.status === "approved" && (
                    <Button variant="secondary" disabled={busy} loading={move.isPending} onClick={() => move.mutate("draft")}>{t("finance.exp.toDraft")}</Button>
                  )}
                  {x.status === "draft" && (
                    <Button disabled={busy} loading={move.isPending} onClick={() => move.mutate("approved")}>{t("finance.exp.approve")}</Button>
                  )}
                  {x.status === "approved" && (
                    <Button disabled={busy} loading={post.isPending} onClick={() => post.mutate()}>{t("finance.exp.post")}</Button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-ink-3">{label}</dt>
      <dd className="mt-0.5 text-ink">{children}</dd>
    </div>
  );
}

function ExpenseForm({ expense, onDone, onCancel }: { expense?: Expense; onDone: (id: string) => void; onCancel: () => void }) {
  const t = useT();
  const { language } = useI18n();
  const tenant = useTenant();
  const accountsQ = useAccounts();
  const settingsQ = useFinanceSettings();
  const x = expense;
  const [f, setF] = useState({
    expense_date: x?.expense_date ?? todayIn(tenant.timezone),
    category_account_id: x?.category_account_id ?? "",
    payment_account_id: x?.payment_account_id ?? "",
    supplier_id: x?.supplier_id ?? "",
    vehicle_id: x?.vehicle_id ?? "",
    description: x?.description ?? "",
    reference: x?.reference ?? "",
    amount: x ? String(x.amount) : "",
    tax_amount: x?.tax_amount ? String(x.tax_amount) : "",
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const suppliers = useSupplierPicker(f.supplier_id);
  const vehicles = useVehiclePicker(f.vehicle_id);
  const { error, saving, run } = useSubmit(onDone);
  const accounts = accountsQ.data ?? [];
  const categories = accountOptions(accounts, language, (a) => a.active && a.account_type === "expense");
  const payFrom = accountOptions(accounts, language, (a) => a.active && (a.account_type === "asset" || a.account_type === "liability"));
  const paymentId = f.payment_account_id || settingsQ.data?.accounts?.cash || "";
  const total = (numOrNull(f.amount) ?? 0) + (numOrNull(f.tax_amount) ?? 0);

  const submit = onSubmit(() => {
    if (!f.category_account_id || !paymentId) return;
    const values = {
      expense_date: f.expense_date,
      category_account_id: f.category_account_id,
      payment_account_id: paymentId,
      supplier_id: f.supplier_id || null,
      vehicle_id: f.vehicle_id || null,
      description: f.description.trim(),
      reference: textOrNull(f.reference),
      amount: numOrNull(f.amount) ?? 0,
      tax_amount: numOrNull(f.tax_amount) ?? 0,
    };
    void run(async () => (x
      ? (await updateRow<{ id: string }>("expenses", x.id, values)).id
      : (await insertRow<{ id: string }>("expenses", values)).id));
  });

  return (
    <form className="space-y-4" onSubmit={submit}>
      <Field label={t("finance.exp.description")} required>
        <Input value={f.description} onChange={(e) => set("description", e.target.value)} required maxLength={300} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("finance.exp.category")} required>
          <Combobox options={categories} value={f.category_account_id} onChange={(v) => set("category_account_id", v)} required clearable={false} />
        </Field>
        <Field label={t("finance.exp.paidFrom")} required>
          <Combobox options={payFrom} value={paymentId} onChange={(v) => set("payment_account_id", v)} required clearable={false} />
        </Field>
        <Field label={t("finance.exp.date")} required>
          <Input type="date" value={f.expense_date} onChange={(e) => set("expense_date", e.target.value)} required />
        </Field>
        <Field label={t("finance.exp.reference")}>
          <Input value={f.reference} onChange={(e) => set("reference", e.target.value)} maxLength={100} dir="ltr" />
        </Field>
        <Field label={t("finance.exp.supplier")}>
          <Combobox {...suppliers} value={f.supplier_id} onChange={(v) => set("supplier_id", v)} clearable />
        </Field>
        <Field label={t("finance.exp.vehicle")}>
          <Combobox {...vehicles} value={f.vehicle_id} onChange={(v) => set("vehicle_id", v)} clearable />
        </Field>
        <Field label={t("finance.exp.amount")} required>
          <Input type="number" min="0.001" step="any" inputMode="decimal" dir="ltr" value={f.amount} onChange={(e) => set("amount", e.target.value)} required />
        </Field>
        <Field label={t("finance.exp.tax")}>
          <Input type="number" min="0" step="any" inputMode="decimal" dir="ltr" value={f.tax_amount} onChange={(e) => set("tax_amount", e.target.value)} />
        </Field>
      </div>
      <p className="text-end text-sm text-ink-2">
        {t("finance.exp.total")}: <Ltr className="font-semibold text-ink">{formatMoney(total, tenant.currency)}</Ltr>
      </p>
      <FormError message={error} />
      <FormActions saving={saving} label={x ? t("action.save") : t("finance.exp.create")} onCancel={onCancel}
        disabled={!f.category_account_id || !paymentId} />
    </form>
  );
}
