import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Banknote, Calculator, CheckCircle2, FileText, Pencil, Trash2, Users, Wallet, XCircle } from "lucide-react";
import { deleteRow, getRow, listPage, updateRow, wrapDbError } from "../../lib/db";
import { supabase } from "../../lib/supabase";
import { formatDate, formatMoney } from "../../lib/format";
import { payrollEditable } from "../../lib/hr";
import { useTenant } from "../../context/AuthContext";
import { useT, useTp } from "../../i18n";
import {
  Badge, Bdi, Button, EmptyState, ErrorState, Field, Input, LoadingState, Ltr, Modal, PageHeader, Pagination, StatCard,
} from "../../components/ui";
import { useToast } from "../../components/Toast";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { todayIso } from "../employees/shared";
import { payrollStatus } from "./labels";
import type { PayrollRun, Payslip } from "./types";

const PAGE_SIZE = 50;

type RunAction = "calculate" | "approve" | "pay" | "cancel";

const RPC: Record<RunAction, "payroll_calculate" | "payroll_approve" | "payroll_mark_paid" | "payroll_cancel"> = {
  calculate: "payroll_calculate",
  approve: "payroll_approve",
  pay: "payroll_mark_paid",
  cancel: "payroll_cancel",
};

function AdjustForm({ slip, currency, onDone }: { slip: Payslip; currency: string; onDone: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [overtime, setOvertime] = useState(String(Number(slip.overtime_hours)));
  const [bonus, setBonus] = useState(String(Number(slip.bonus)));
  const [deductions, setDeductions] = useState(String(Number(slip.deductions)));
  const [note, setNote] = useState(slip.deduction_note ?? "");
  const [error, setError] = useState("");
  const num = (s: string) => (s.trim() === "" ? 0 : Number(s));
  const valid = [overtime, bonus, deductions].every((s) => Number.isFinite(num(s)) && num(s) >= 0) && num(overtime) <= 400;

  const save = useMutation({
    mutationFn: () =>
      updateRow<Payslip>("payslips", slip.id, {
        overtime_hours: num(overtime),
        bonus: num(bonus),
        deductions: num(deductions),
        deduction_note: note.trim() || null,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["payslips"] });
      void qc.invalidateQueries({ queryKey: ["payroll_runs"] });
      toast.success(t("toast.saved"));
      onDone();
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (valid) save.mutate();
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-ink-2">
        <Bdi>{slip.employee_name}</Bdi> · {t("hr.hourlyRateLine", { rate: formatMoney(Number(slip.hourly_rate), currency), multiplier: Number(slip.overtime_multiplier) })}
      </p>
      <div className="grid grid-cols-3 gap-3">
        <Field label={t("hr.overtimeHours")}>
          <Input type="number" inputMode="decimal" min={0} max={400} step="0.25" value={overtime} onChange={(e) => setOvertime(e.target.value)} dir="ltr" />
        </Field>
        <Field label={t("hr.bonus")}>
          <Input type="number" inputMode="decimal" min={0} step="0.01" value={bonus} onChange={(e) => setBonus(e.target.value)} dir="ltr" />
        </Field>
        <Field label={t("hr.otherDeductions")}>
          <Input type="number" inputMode="decimal" min={0} step="0.01" value={deductions} onChange={(e) => setDeductions(e.target.value)} dir="ltr" />
        </Field>
      </div>
      <Field label={t("hr.deductionNote")}>
        <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      </Field>
      {!valid && <p className="text-sm text-serious">{t("hr.adjustInvalid")}</p>}
      {error && <ErrorState message={error} />}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>{t("action.cancel")}</Button>
        <Button type="submit" loading={save.isPending} disabled={!valid}>{t("action.save")}</Button>
      </div>
    </form>
  );
}

function RunFields({ run, onDone }: { run: PayrollRun; onDone: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [payDate, setPayDate] = useState(run.pay_date ?? "");
  const [notes, setNotes] = useState(run.notes ?? "");
  const [error, setError] = useState("");
  const save = useMutation({
    mutationFn: () => updateRow<PayrollRun>("payroll_runs", run.id, { pay_date: payDate || null, notes: notes.trim() || null }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["payroll_runs"] });
      toast.success(t("toast.saved"));
      onDone();
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });
  return (
    <div className="space-y-4">
      <Field label={t("hr.payDate")}>
        <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} dir="ltr" />
      </Field>
      <Field label={t("hr.notes")}>
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
      </Field>
      {error && <ErrorState message={error} />}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>{t("action.cancel")}</Button>
        <Button loading={save.isPending} onClick={() => save.mutate()}>{t("action.save")}</Button>
      </div>
    </div>
  );
}

export default function PayrollRunPage() {
  const t = useT();
  const tp = useTp();
  const tenant = useTenant();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { runId = "" } = useParams();
  const [page, setPage] = useState(0);
  const [adjusting, setAdjusting] = useState<Payslip | null>(null);
  const [editingRun, setEditingRun] = useState(false);
  const [confirm, setConfirm] = useState<RunAction | "delete" | null>(null);
  const [paidAt, setPaidAt] = useState(todayIso());
  const [actionError, setActionError] = useState("");

  const runQ = useQuery({ queryKey: ["payroll_runs", runId], queryFn: () => getRow<PayrollRun>("payroll_runs", runId) });
  const slipsQ = useQuery({
    queryKey: ["payslips", runId, page],
    queryFn: () =>
      listPage<Payslip>("payslips", page, PAGE_SIZE, (q) => q.select("*").eq("run_id", runId).order("employee_name")),
    enabled: !!runQ.data,
  });
  useEffect(() => {
    if (runQ.data?.pay_date) setPaidAt(runQ.data.pay_date);
  }, [runQ.data?.pay_date]);

  const act = useMutation({
    mutationFn: async (action: RunAction | "delete") => {
      if (action === "delete") return deleteRow("payroll_runs", runId);
      const args = action === "pay" ? { p_run: runId, p_paid_at: paidAt } : { p_run: runId };
      const { error } = await supabase.rpc(RPC[action], args as { p_run: string });
      if (error) throw wrapDbError(error);
    },
    onSuccess: (_d, action) => {
      setActionError("");
      setConfirm(null);
      void qc.invalidateQueries({ queryKey: ["payroll_runs"] });
      void qc.invalidateQueries({ queryKey: ["payslips"] });
      if (action === "delete") {
        toast.success(t("toast.deleted"));
        navigate("/hr/payroll");
      } else {
        toast.success(t(`hr.done.${action}` as "hr.done.calculate"));
      }
    },
    onError: (e) => {
      setConfirm(null);
      setActionError(e instanceof Error ? e.message : String(e));
    },
  });

  if (runQ.isLoading) return <LoadingState />;
  if (runQ.error) return <ErrorState message={(runQ.error as Error).message} />;
  const run = runQ.data;
  if (!run) {
    return (
      <EmptyState
        icon={<Banknote className="h-10 w-10" />}
        title={t("hr.runNotFound")}
        action={<Link to="/hr/payroll" className="text-sm font-medium text-brand-700 hover:underline">{t("hr.tab.payroll")}</Link>}
      />
    );
  }

  const currency = run.currency ?? tenant.currency;
  const money = (n: number) => formatMoney(n, currency);
  const editable = payrollEditable(run.status);
  const st = payrollStatus[run.status];
  const slips = slipsQ.data?.rows ?? [];
  const total = slipsQ.data?.total ?? 0;

  const columns: Array<DataTableColumn<Payslip>> = [
    {
      id: "employee",
      header: t("hr.employee"),
      cell: (p) => (
        <>
          <Link to={`/hr/payslips/${p.id}`} className="font-medium text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()}>
            <Bdi>{p.employee_name}</Bdi>
          </Link>
          <div className="text-xs text-ink-3">
            {p.employee_number && <Ltr>{p.employee_number}</Ltr>}
            {p.paid_days < p.period_days && <> · {t("hr.partialPeriod", { paid: p.paid_days, days: p.period_days })}</>}
          </div>
        </>
      ),
      sortValue: (p) => p.employee_name,
      exportValue: (p) => p.employee_name,
    },
    {
      id: "basic",
      header: t("hr.basic"),
      align: "end",
      minBreakpoint: "lg",
      cell: (p) => <span className="tabular-nums">{money(Number(p.basic))}</span>,
      sortValue: (p) => Number(p.basic),
      exportValue: (p) => Number(p.basic),
    },
    {
      id: "allowances",
      header: t("hr.allowances"),
      align: "end",
      minBreakpoint: "lg",
      cell: (p) => <span className="tabular-nums">{money(Number(p.housing) + Number(p.transport) + Number(p.other_allowances))}</span>,
      sortValue: (p) => Number(p.housing) + Number(p.transport) + Number(p.other_allowances),
      exportValue: (p) => Number(p.housing) + Number(p.transport) + Number(p.other_allowances),
    },
    {
      id: "overtime",
      header: t("hr.overtime"),
      align: "end",
      minBreakpoint: "xl",
      cell: (p) => (
        <span className="tabular-nums">
          {money(Number(p.overtime_amount))}
          {Number(p.overtime_hours) > 0 && <span className="block text-xs text-ink-3"><Ltr>{t("hr.hoursShort", { hours: Number(p.overtime_hours) })}</Ltr></span>}
        </span>
      ),
      sortValue: (p) => Number(p.overtime_amount),
      exportValue: (p) => Number(p.overtime_amount),
    },
    {
      id: "gross",
      header: t("hr.gross"),
      align: "end",
      minBreakpoint: "md",
      cell: (p) => <span className="tabular-nums">{money(Number(p.gross))}</span>,
      sortValue: (p) => Number(p.gross),
      exportValue: (p) => Number(p.gross),
    },
    {
      id: "deductions",
      header: t("hr.deductions"),
      align: "end",
      minBreakpoint: "md",
      cell: (p) => (
        <span className="tabular-nums text-ink-2">
          {money(Number(p.unpaid_leave_deduction) + Number(p.social_insurance_employee) + Number(p.deductions))}
        </span>
      ),
      sortValue: (p) => Number(p.unpaid_leave_deduction) + Number(p.social_insurance_employee) + Number(p.deductions),
      exportValue: (p) => Number(p.unpaid_leave_deduction) + Number(p.social_insurance_employee) + Number(p.deductions),
    },
    {
      id: "net",
      header: t("hr.net"),
      align: "end",
      cell: (p) => <span className="font-semibold tabular-nums">{money(Number(p.net))}</span>,
      sortValue: (p) => Number(p.net),
      exportValue: (p) => Number(p.net),
    },
    {
      id: "iban",
      header: t("hr.iban"),
      defaultHidden: true,
      cell: (p) => <Ltr className="font-mono text-xs">{p.iban ?? "—"}</Ltr>,
      exportValue: (p) => p.iban ?? "",
      dir: "ltr",
    },
    ...(editable
      ? [
          {
            id: "edit",
            header: t("common.actions"),
            align: "end" as const,
            cell: (p: Payslip) => (
              <Button
                variant="ghost"
                className="px-2 py-1"
                onClick={(e) => {
                  e.stopPropagation();
                  setAdjusting(p);
                }}
                aria-label={t("hr.adjust")}
                title={t("hr.adjust")}
              >
                <Pencil className="h-4 w-4" />
              </Button>
            ),
          },
        ]
      : []),
  ];

  const confirmText: Record<RunAction | "delete", string> = {
    calculate: run.status === "calculated" ? t("hr.confirm.recalculate") : t("hr.confirm.calculate"),
    approve: t("hr.confirm.approve"),
    pay: t("hr.confirm.pay"),
    cancel: t("hr.confirm.cancel"),
    delete: t("hr.confirm.delete"),
  };

  return (
    <>
      <Link to="/hr/payroll" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink print:hidden">
        <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" /> {t("hr.tab.payroll")}
      </Link>
      <PageHeader
        title={run.doc_number ?? t("hr.run")}
        description={`${formatDate(run.period_start, tenant.timezone)} – ${formatDate(run.period_end, tenant.timezone)}${
          run.pay_date ? ` · ${t("hr.paysOn", { date: formatDate(run.pay_date, tenant.timezone) })}` : ""
        }`}
        badge={<Badge tone={st.tone}>{t(st.labelKey)}</Badge>}
        actions={
          <div className="flex flex-wrap gap-2">
            {editable && (
              <Button variant="secondary" onClick={() => setEditingRun(true)}>
                <Pencil className="h-4 w-4" /> {t("action.edit")}
              </Button>
            )}
            {editable && (
              <Button variant={run.status === "draft" ? "primary" : "secondary"} onClick={() => setConfirm("calculate")}>
                <Calculator className="h-4 w-4" /> {run.status === "calculated" ? t("hr.recalculate") : t("hr.calculate")}
              </Button>
            )}
            {run.status === "calculated" && (
              <Button onClick={() => setConfirm("approve")}>
                <CheckCircle2 className="h-4 w-4" /> {t("hr.approve")}
              </Button>
            )}
            {run.status === "approved" && (
              <Button onClick={() => setConfirm("pay")}>
                <Wallet className="h-4 w-4" /> {t("hr.markPaid")}
              </Button>
            )}
            {editable && (
              <Button variant="ghost" onClick={() => setConfirm("cancel")}>
                <XCircle className="h-4 w-4" /> {t("hr.cancelRun")}
              </Button>
            )}
            {(run.status === "draft" || run.status === "canceled") && (
              <Button variant="ghost" onClick={() => setConfirm("delete")} aria-label={t("action.delete")} title={t("action.delete")}>
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        }
      />
      {actionError && (
        <div className="mb-4">
          <ErrorState message={actionError} />
        </div>
      )}

      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={<Users className="h-5 w-5" />} tone="slate" label={t("hr.employees")} value={<Ltr>{run.employee_count}</Ltr>} />
        <StatCard icon={<Banknote className="h-5 w-5" />} tone="blue" label={t("hr.totalGross")} value={money(Number(run.total_gross))} />
        <StatCard
          icon={<Wallet className="h-5 w-5" />}
          tone="green"
          label={t("hr.totalNet")}
          value={money(Number(run.total_net))}
          sub={t("hr.deductionsSub", { amount: money(Number(run.total_deductions)) })}
        />
        <StatCard
          icon={<FileText className="h-5 w-5" />}
          tone="violet"
          label={t("hr.employerCost")}
          value={money(Number(run.total_employer_cost))}
          sub={t("hr.employerCostSub")}
        />
      </div>

      {run.notes && <p className="mb-4 whitespace-pre-line text-sm text-ink-2" dir="auto">{run.notes}</p>}

      {slipsQ.isLoading && <LoadingState />}
      {slipsQ.error && <ErrorState message={(slipsQ.error as Error).message} />}
      {!slipsQ.isLoading && !slipsQ.error && (
        <DataTable<Payslip>
          tableId="hr-payslips"
          exportName={`payslips-${run.doc_number ?? run.id}`}
          rows={slips}
          rowKey={(p) => p.id}
          onRowClick={(p) => navigate(`/hr/payslips/${p.id}`)}
          columns={columns}
          toolbar={total > 0 ? <span className="text-sm text-ink-3 tabular-nums">{tp("hr.slipCount", total)}</span> : undefined}
          empty={
            <EmptyState
              icon={<Calculator className="h-10 w-10" />}
              title={run.status === "draft" ? t("hr.notCalculatedTitle") : t("hr.noSlips")}
              description={run.status === "draft" ? t("hr.notCalculatedDesc") : undefined}
            />
          }
          footer={<Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />}
        />
      )}
      <p className="mt-3 text-xs text-ink-3">{t("hr.wpsNote")}</p>

      <Modal title={t("hr.adjust")} open={!!adjusting} onClose={() => setAdjusting(null)}>
        {adjusting && <AdjustForm slip={adjusting} currency={currency} onDone={() => setAdjusting(null)} />}
      </Modal>
      <Modal title={t("action.edit")} open={editingRun} onClose={() => setEditingRun(false)}>
        <RunFields run={run} onDone={() => setEditingRun(false)} />
      </Modal>
      <Modal title={t("action.confirm")} open={!!confirm} onClose={() => setConfirm(null)}>
        {confirm && (
          <div className="space-y-4">
            <p className="text-sm text-ink-2">{confirmText[confirm]}</p>
            {confirm === "pay" && (
              <Field label={t("hr.paidOn")}>
                <Input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} dir="ltr" />
              </Field>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirm(null)}>{t("action.cancel")}</Button>
              <Button
                variant={confirm === "delete" || confirm === "cancel" ? "danger" : "primary"}
                loading={act.isPending}
                onClick={() => act.mutate(confirm)}
              >
                {t("action.confirm")}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
