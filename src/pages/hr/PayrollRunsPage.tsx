import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, Plus } from "lucide-react";
import { insertRow, listPage } from "../../lib/db";
import { formatDate, formatMoney } from "../../lib/format";
import { monthBounds, type PayrollStatus } from "../../lib/hr";
import { useTenant } from "../../context/AuthContext";
import { useT, useTp } from "../../i18n";
import {
  Badge, Button, EmptyState, ErrorState, Field, Input, LoadingState, Ltr, Modal, Pagination, Select, Textarea,
} from "../../components/ui";
import { useToast } from "../../components/Toast";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { todayIso } from "../employees/shared";
import { payrollStatus } from "./labels";
import type { PayrollRun } from "./types";

const PAGE_SIZE = 25;

function NewRunForm({ onDone }: { onDone: (run: PayrollRun) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const initial = monthBounds(todayIso());
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [payDate, setPayDate] = useState(initial.end);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const periodOk = start !== "" && end !== "" && end >= start;

  const create = useMutation({
    mutationFn: () =>
      insertRow<PayrollRun>("payroll_runs", {
        period_start: start,
        period_end: end,
        pay_date: payDate || null,
        notes: notes.trim() || null,
      }),
    onSuccess: (run) => {
      void qc.invalidateQueries({ queryKey: ["payroll_runs"] });
      toast.success(t("hr.runCreated"));
      onDone(run);
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (periodOk) create.mutate();
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label={t("hr.month")} hint={t("hr.monthHint")}>
        <Input
          type="month"
          value={start.slice(0, 7)}
          onChange={(e) => {
            if (!e.target.value) return;
            const b = monthBounds(`${e.target.value}-01`);
            setStart(b.start);
            setEnd(b.end);
            setPayDate(b.end);
          }}
          dir="ltr"
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("hr.periodStart")} required>
          <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} required dir="ltr" />
        </Field>
        <Field label={t("hr.periodEnd")} required error={periodOk ? undefined : t("hr.endBeforeStart")}>
          <Input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} required dir="ltr" />
        </Field>
      </div>
      <Field label={t("hr.payDate")}>
        <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} dir="ltr" />
      </Field>
      <Field label={t("hr.notes")}>
        <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
      </Field>
      {error && <ErrorState message={error} />}
      <div className="flex justify-end gap-2">
        <Button type="submit" loading={create.isPending} disabled={!periodOk}>{t("hr.createRun")}</Button>
      </div>
    </form>
  );
}

export default function PayrollRunsPage() {
  const t = useT();
  const tp = useTp();
  const tenant = useTenant();
  const navigate = useNavigate();
  const [status, setStatus] = useState<"all" | PayrollStatus>("all");
  const [page, setPage] = useState(0);
  const [creating, setCreating] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["payroll_runs", { page, status }],
    queryFn: () =>
      listPage<PayrollRun>("payroll_runs", page, PAGE_SIZE, (q) => {
        let f = q.select("*");
        if (status !== "all") f = f.eq("status", status);
        return f.order("period_start", { ascending: false }).order("number", { ascending: false });
      }),
  });
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;

  const columns: Array<DataTableColumn<PayrollRun>> = [
    {
      id: "number",
      header: t("hr.run"),
      cell: (r) => (
        <Link to={`/hr/payroll/${r.id}`} className="font-medium text-brand-700 hover:underline">
          <Ltr>{r.doc_number ?? "—"}</Ltr>
        </Link>
      ),
      sortValue: (r) => r.number,
      exportValue: (r) => r.doc_number ?? "",
    },
    {
      id: "period",
      header: t("hr.period"),
      cell: (r) => (
        <span className="text-ink-2 tabular-nums">
          {formatDate(r.period_start, tenant.timezone)} – {formatDate(r.period_end, tenant.timezone)}
        </span>
      ),
      sortValue: (r) => r.period_start,
      exportValue: (r) => `${r.period_start} – ${r.period_end}`,
    },
    {
      id: "employees",
      header: t("hr.employees"),
      align: "end",
      minBreakpoint: "md",
      cell: (r) => <span className="tabular-nums"><Ltr>{r.employee_count}</Ltr></span>,
      sortValue: (r) => r.employee_count,
    },
    {
      id: "net",
      header: t("hr.totalNet"),
      align: "end",
      cell: (r) => <span className="font-medium tabular-nums">{formatMoney(Number(r.total_net), r.currency ?? tenant.currency)}</span>,
      sortValue: (r) => Number(r.total_net),
      exportValue: (r) => Number(r.total_net),
    },
    {
      id: "payDate",
      header: t("hr.payDate"),
      minBreakpoint: "lg",
      cell: (r) => <span className="text-ink-2 tabular-nums">{r.pay_date ? formatDate(r.pay_date, tenant.timezone) : "—"}</span>,
      sortValue: (r) => r.pay_date,
    },
    {
      id: "status",
      header: t("common.status"),
      cell: (r) => <Badge tone={payrollStatus[r.status].tone}>{t(payrollStatus[r.status].labelKey)}</Badge>,
      sortValue: (r) => r.status,
      exportValue: (r) => r.status,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as typeof status);
            setPage(0);
          }}
          className="max-w-44"
        >
          <option value="all">{t("hr.allStatuses")}</option>
          {(Object.keys(payrollStatus) as PayrollStatus[]).map((s) => (
            <option key={s} value={s}>{t(payrollStatus[s].labelKey)}</option>
          ))}
        </Select>
        <div className="ms-auto">
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> {t("hr.newRun")}
          </Button>
        </div>
      </div>
      {isLoading && <LoadingState />}
      {error && <ErrorState message={(error as Error).message} />}
      {!isLoading && !error && (
        <DataTable<PayrollRun>
          tableId="hr-payroll-runs"
          exportName="payroll-runs"
          rows={rows}
          rowKey={(r) => r.id}
          onRowClick={(r) => navigate(`/hr/payroll/${r.id}`)}
          columns={columns}
          toolbar={total > 0 ? <span className="text-sm text-ink-3 tabular-nums">{tp("hr.runCount", total)}</span> : undefined}
          empty={
            <EmptyState
              icon={<Banknote className="h-10 w-10" />}
              title={t("hr.noRunsTitle")}
              description={t("hr.noRunsDesc")}
            />
          }
          footer={<Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />}
        />
      )}
      <Modal title={t("hr.newRun")} open={creating} onClose={() => setCreating(false)}>
        <NewRunForm
          onDone={(run) => {
            setCreating(false);
            navigate(`/hr/payroll/${run.id}`);
          }}
        />
      </Modal>
    </div>
  );
}
