import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarOff, Check, Plus, X } from "lucide-react";
import { listPage, wrapDbError } from "../../lib/db";
import { supabase } from "../../lib/supabase";
import { formatDate } from "../../lib/format";
import { employeeName } from "../../lib/employees";
import { leaveMoves, workdays, type LeaveStatus } from "../../lib/hr";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useI18n, useT, useTp } from "../../i18n";
import {
  Badge, Bdi, Button, Card, EmptyState, ErrorState, Field, Input, LoadingState, Ltr, Modal, Pagination, Select, Textarea,
} from "../../components/ui";
import { Combobox } from "../../components/Combobox";
import { useToast } from "../../components/Toast";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { useEmployeePicker } from "../employees/pickers";
import { todayIso } from "../employees/shared";
import { useLeaveBalances, useLeaveTypes, useMyEmployee, useWeekend } from "./hooks";
import { leaveStatus, leaveTypeName } from "./labels";
import { LEAVE_SELECT, type LeaveRequest } from "./types";

const PAGE_SIZE = 25;

function Balances({ employeeId, year }: { employeeId: string | null; year: number }) {
  const t = useT();
  const tp = useTp();
  const { language } = useI18n();
  const typesQ = useLeaveTypes();
  const balQ = useLeaveBalances(year, employeeId);
  if (!employeeId) return <p className="text-sm text-ink-3">{t("hr.balancesPick")}</p>;
  if (balQ.isLoading || typesQ.isLoading) return <LoadingState />;
  if (balQ.error) return <ErrorState message={(balQ.error as Error).message} />;
  const rows = balQ.data ?? [];
  if (rows.length === 0) return <p className="text-sm text-ink-3">{t("hr.balancesEmpty")}</p>;
  const types = new Map((typesQ.data ?? []).map((lt) => [lt.id, lt]));
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((b) => {
        const used = b.entitled > 0 ? Math.min(100, (Number(b.taken) / Number(b.entitled)) * 100) : 0;
        return (
          <div key={b.leave_type_id} className="rounded-xl border border-line p-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-sm font-medium text-ink">
                <Bdi>{leaveTypeName(types.get(b.leave_type_id), language)}</Bdi>
              </span>
              <span className="text-lg font-semibold text-ink tabular-nums">
                <Ltr>{Number(b.remaining)}</Ltr>
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-canvas">
              <div className="h-full rounded-full bg-brand-600" style={{ width: `${used}%` }} />
            </div>
            <div className="mt-1.5 text-xs text-ink-3">
              {t("hr.balanceLine", { taken: Number(b.taken), entitled: Number(b.entitled) })}
              {Number(b.pending) > 0 && <> · {tp("hr.balancePending", Number(b.pending))}</>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RequestForm({ ownEmployeeId, onDone }: { ownEmployeeId: string | null; onDone: () => void }) {
  const t = useT();
  const tp = useTp();
  const { language } = useI18n();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const weekend = useWeekend();
  const typesQ = useLeaveTypes(true);
  const [employeeId, setEmployeeId] = useState(isManager ? "" : (ownEmployeeId ?? ""));
  const picker = useEmployeePicker(employeeId, { activeOnly: true, enabled: isManager });
  const [typeId, setTypeId] = useState("");
  const [start, setStart] = useState(todayIso());
  const [end, setEnd] = useState(todayIso());
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const days = workdays(start, end, weekend);
  const datesOk = start !== "" && end !== "" && end >= start;

  const save = useMutation({
    mutationFn: async () => {
      const { error: e } = await supabase.rpc("request_leave", {
        p_employee: isManager ? employeeId : null,
        p_leave_type: typeId,
        p_start: start,
        p_end: end,
        p_reason: reason.trim() || null,
      });
      if (e) throw wrapDbError(e);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["leave_requests"] });
      void qc.invalidateQueries({ queryKey: ["leave_balances"] });
      toast.success(t("hr.leaveRequested"));
      onDone();
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!typeId || !datesOk || (isManager && !employeeId)) return;
    save.mutate();
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {isManager && (
        <Field label={t("hr.employee")} required>
          <Combobox {...picker} value={employeeId} onChange={setEmployeeId} required />
        </Field>
      )}
      <Field label={t("hr.leaveType")} required>
        <Select value={typeId} onChange={(e) => setTypeId(e.target.value)} required>
          <option value="">{t("hr.pickType")}</option>
          {(typesQ.data ?? []).map((lt) => (
            <option key={lt.id} value={lt.id}>{leaveTypeName(lt, language)}</option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("hr.startDate")} required>
          <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} required dir="ltr" />
        </Field>
        <Field label={t("hr.endDate")} required error={datesOk ? undefined : t("hr.endBeforeStart")}>
          <Input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} required dir="ltr" />
        </Field>
      </div>
      {datesOk && (
        <p className={days === 0 ? "text-sm text-serious" : "text-sm text-ink-2"}>
          {days === 0 ? t("hr.noWorkdays") : tp("hr.workdaysCount", days)}
        </p>
      )}
      <Field label={t("hr.reason")}>
        <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
      </Field>
      {error && <ErrorState message={error} />}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>{t("action.cancel")}</Button>
        <Button type="submit" loading={save.isPending} disabled={!typeId || !datesOk || days === 0}>
          {t("hr.submitRequest")}
        </Button>
      </div>
    </form>
  );
}

function DecisionForm({ request, to, onDone }: { request: LeaveRequest; to: LeaveStatus; onDone: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const decide = useMutation({
    mutationFn: async () => {
      const { error: e } = await supabase.rpc("leave_transition", { p_id: request.id, p_to: to, p_note: note.trim() || null });
      if (e) throw wrapDbError(e);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["leave_requests"] });
      void qc.invalidateQueries({ queryKey: ["leave_balances"] });
      toast.success(t(leaveStatus[to].labelKey));
      onDone();
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });
  return (
    <div className="space-y-4">
      <Field label={t("hr.decisionNote")}>
        <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
      </Field>
      {error && <ErrorState message={error} />}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>{t("action.cancel")}</Button>
        <Button variant={to === "approved" ? "primary" : "danger"} loading={decide.isPending} onClick={() => decide.mutate()}>
          {t(`hr.move.${to}` as "hr.move.approved")}
        </Button>
      </div>
    </div>
  );
}

export default function LeavePage() {
  const t = useT();
  const tp = useTp();
  const { language } = useI18n();
  const tenant = useTenant();
  const { isManager } = useAuth();
  const meQ = useMyEmployee();
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [employeeFilter, setEmployeeFilter] = useState("");
  const filterPicker = useEmployeePicker(employeeFilter, { enabled: isManager });
  const [status, setStatus] = useState<"all" | LeaveStatus>(isManager ? "pending" : "all");
  const [page, setPage] = useState(0);
  const [requesting, setRequesting] = useState(false);
  const [deciding, setDeciding] = useState<{ request: LeaveRequest; to: LeaveStatus } | null>(null);
  const ownId = meQ.data?.id ?? null;

  const { data, isLoading, error } = useQuery({
    queryKey: ["leave_requests", { page, status, employeeFilter, year }],
    queryFn: () =>
      listPage<LeaveRequest>("leave_requests", page, PAGE_SIZE, (q) => {
        let f = q.select(LEAVE_SELECT).gte("start_date", `${year}-01-01`).lte("start_date", `${year}-12-31`);
        if (status !== "all") f = f.eq("status", status);
        if (employeeFilter) f = f.eq("employee_id", employeeFilter);
        return f.order("start_date", { ascending: false });
      }),
    enabled: isManager || !meQ.isLoading,
  });

  if (!isManager && meQ.isLoading) return <LoadingState />;
  if (!isManager && !ownId) {
    return (
      <EmptyState
        icon={<CalendarOff className="h-10 w-10" />}
        title={t("hr.noEmployeeTitle")}
        description={t("hr.noEmployeeDesc")}
      />
    );
  }

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const thisYear = new Date().getFullYear();
  const balanceEmployee = isManager ? employeeFilter || null : ownId;

  const columns: Array<DataTableColumn<LeaveRequest>> = [
    ...(isManager
      ? [
          {
            id: "employee",
            header: t("hr.employee"),
            cell: (r: LeaveRequest) => (
              <>
                {r.employee ? (
                  <Link to={`/employees/${r.employee.id}`} className="font-medium text-brand-700 hover:underline">
                    <Bdi>{employeeName(r.employee, language)}</Bdi>
                  </Link>
                ) : (
                  t("common.dash")
                )}
                <div className="text-xs text-ink-3 sm:hidden">
                  <Bdi>{leaveTypeName(r.leave_type, language)}</Bdi> · {tp("hr.daysCount", Number(r.days))}
                </div>
              </>
            ),
            sortValue: (r: LeaveRequest) => (r.employee ? employeeName(r.employee, language) : null),
            exportValue: (r: LeaveRequest) => (r.employee ? employeeName(r.employee) : ""),
          },
        ]
      : []),
    {
      id: "type",
      header: t("hr.leaveType"),
      minBreakpoint: isManager ? "sm" : undefined,
      cell: (r) => <Bdi>{leaveTypeName(r.leave_type, language)}</Bdi>,
      sortValue: (r) => r.leave_type?.name ?? null,
      exportValue: (r) => r.leave_type?.name ?? "",
    },
    {
      id: "dates",
      header: t("hr.dates"),
      cell: (r) => (
        <span className="text-ink-2 tabular-nums">
          {formatDate(r.start_date, tenant.timezone)}
          {r.end_date !== r.start_date && <> – {formatDate(r.end_date, tenant.timezone)}</>}
          {!isManager && <span className="block text-xs text-ink-3 sm:hidden">{tp("hr.daysCount", Number(r.days))}</span>}
        </span>
      ),
      sortValue: (r) => r.start_date,
      exportValue: (r) => `${r.start_date} – ${r.end_date}`,
    },
    {
      id: "days",
      header: t("hr.days"),
      align: "end",
      minBreakpoint: "sm",
      cell: (r) => <span className="tabular-nums"><Ltr>{Number(r.days)}</Ltr></span>,
      sortValue: (r) => Number(r.days),
    },
    {
      id: "reason",
      header: t("hr.reason"),
      minBreakpoint: "lg",
      cell: (r) => <span className="line-clamp-2 text-ink-2" dir="auto">{r.reason ?? t("common.dash")}</span>,
      exportValue: (r) => r.reason ?? "",
    },
    {
      id: "status",
      header: t("common.status"),
      cell: (r) => <Badge tone={leaveStatus[r.status].tone}>{t(leaveStatus[r.status].labelKey)}</Badge>,
      sortValue: (r) => r.status,
      exportValue: (r) => r.status,
    },
    {
      id: "actions",
      header: t("common.actions"),
      align: "end",
      cell: (r) => {
        // A manager answers a pending request (approve / reject); withdrawing it is the employee's move.
        const moves = isManager
          ? leaveMoves(r.status).filter((m) => !(r.status === "pending" && m === "canceled"))
          : r.status === "pending"
            ? (["canceled"] as LeaveStatus[])
            : [];
        if (moves.length === 0) return null;
        return (
          <div className="flex justify-end gap-1">
            {moves.map((to) => (
              <Button
                key={to}
                variant={to === "approved" ? "secondary" : "ghost"}
                className="px-1.5 py-1"
                onClick={(e) => {
                  e.stopPropagation();
                  setDeciding({ request: r, to });
                }}
                title={t(`hr.move.${to}` as "hr.move.approved")}
              >
                {to === "approved" ? <Check className="h-4 w-4 text-good" /> : <X className="h-4 w-4" />}
                <span className="hidden xl:inline">{t(`hr.move.${to}` as "hr.move.approved")}</span>
              </Button>
            ))}
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      <Card className="p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-ink">{t("hr.balancesTitle", { year })}</h2>
        </div>
        <Balances employeeId={balanceEmployee} year={year} />
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        {isManager && (
          <div className="w-full sm:w-72">
            <Combobox
              {...filterPicker}
              value={employeeFilter}
              onChange={(v) => {
                setEmployeeFilter(v);
                setPage(0);
              }}
              placeholder={t("hr.allEmployees")}
            />
          </div>
        )}
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as typeof status);
            setPage(0);
          }}
          className="max-w-44"
        >
          <option value="all">{t("hr.allStatuses")}</option>
          {(Object.keys(leaveStatus) as LeaveStatus[]).map((s) => (
            <option key={s} value={s}>{t(leaveStatus[s].labelKey)}</option>
          ))}
        </Select>
        <Select
          value={String(year)}
          onChange={(e) => {
            setYear(Number(e.target.value));
            setPage(0);
          }}
          className="max-w-28"
          dir="ltr"
        >
          {[thisYear + 1, thisYear, thisYear - 1, thisYear - 2].map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </Select>
        <div className="ms-auto">
          <Button onClick={() => setRequesting(true)}>
            <Plus className="h-4 w-4" /> {t("hr.requestLeave")}
          </Button>
        </div>
      </div>

      {isLoading && <LoadingState />}
      {error && <ErrorState message={(error as Error).message} />}
      {!isLoading && !error && (
        <DataTable<LeaveRequest>
          tableId="hr-leave"
          exportName="leave-requests"
          rows={rows}
          rowKey={(r) => r.id}
          columns={columns}
          toolbar={total > 0 ? <span className="text-sm text-ink-3 tabular-nums">{tp("hr.requestCount", total)}</span> : undefined}
          empty={
            <EmptyState
              icon={<CalendarOff className="h-10 w-10" />}
              title={status === "pending" ? t("hr.noPending") : t("hr.noRequests")}
            />
          }
          footer={<Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />}
        />
      )}

      <Modal title={t("hr.requestLeave")} open={requesting} onClose={() => setRequesting(false)}>
        <RequestForm ownEmployeeId={ownId} onDone={() => setRequesting(false)} />
      </Modal>
      <Modal
        title={deciding ? t(`hr.move.${deciding.to}` as "hr.move.approved") : ""}
        open={!!deciding}
        onClose={() => setDeciding(null)}
      >
        {deciding && <DecisionForm request={deciding.request} to={deciding.to} onDone={() => setDeciding(null)} />}
      </Modal>
    </div>
  );
}
