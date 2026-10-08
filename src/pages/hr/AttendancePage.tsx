import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, UsersRound } from "lucide-react";
import { listPage, listRows, wrapDbError } from "../../lib/db";
import { supabase } from "../../lib/supabase";
import { employeeName } from "../../lib/employees";
import { clockHours } from "../../lib/hr";
import { useI18n, useT, useTp } from "../../i18n";
import {
  Badge, Bdi, Button, Card, EmptyState, ErrorState, Input, LoadingState, Ltr, Pagination, Select,
} from "../../components/ui";
import { useToast } from "../../components/Toast";
import { todayIso } from "../employees/shared";
import { useWeekend } from "./hooks";
import { attendanceStatus } from "./labels";
import type { AttendanceRecord, AttendanceStatus, EmployeeRef } from "./types";

const PAGE_SIZE = 25;

interface Draft {
  status: AttendanceStatus | "";
  check_in: string;
  check_out: string;
  note: string;
}

const EMPTY: Draft = { status: "", check_in: "", check_out: "", note: "" };

function fromRecord(r: AttendanceRecord | undefined): Draft {
  if (!r) return EMPTY;
  return {
    status: r.status,
    check_in: r.check_in?.slice(0, 5) ?? "",
    check_out: r.check_out?.slice(0, 5) ?? "",
    note: r.note ?? "",
  };
}

function same(a: Draft, b: Draft): boolean {
  return a.status === b.status && a.check_in === b.check_in && a.check_out === b.check_out && a.note === b.note;
}

export default function AttendancePage() {
  const t = useT();
  const tp = useTp();
  const { language } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const weekend = useWeekend();
  const [date, setDate] = useState(todayIso());
  const [page, setPage] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [saveError, setSaveError] = useState("");

  const employeesQ = useQuery({
    queryKey: ["employees", "attendance", page],
    queryFn: () =>
      listPage<EmployeeRef>("employees", page, PAGE_SIZE, (q) =>
        q
          .select("id, first_name, last_name, name_ar, doc_number")
          .in("status", ["active", "on_leave"])
          .order("first_name")
          .order("last_name"),
      ),
  });
  const ids = useMemo(() => (employeesQ.data?.rows ?? []).map((e) => e.id), [employeesQ.data]);

  const recordsQ = useQuery({
    queryKey: ["attendance_records", date, ids],
    queryFn: () =>
      listRows<AttendanceRecord>("attendance_records", (q) => q.eq("work_date", date).in("employee_id", ids)),
    enabled: ids.length > 0,
  });
  const leaveQ = useQuery({
    queryKey: ["leave_requests", "on", date, ids],
    queryFn: () =>
      listRows<{ employee_id: string }>("leave_requests", (q) =>
        q.select("employee_id").eq("status", "approved").lte("start_date", date).gte("end_date", date).in("employee_id", ids),
      ),
    enabled: ids.length > 0,
  });

  const saved = useMemo(() => {
    const m: Record<string, Draft> = {};
    for (const r of recordsQ.data ?? []) m[r.employee_id] = fromRecord(r);
    return m;
  }, [recordsQ.data]);
  const onLeave = useMemo(() => new Set((leaveQ.data ?? []).map((r) => r.employee_id)), [leaveQ.data]);

  // A new day or page starts from what is stored.
  useEffect(() => setDrafts({}), [date, page]);

  const current = (id: string): Draft => drafts[id] ?? saved[id] ?? EMPTY;
  const dirty = ids.filter((id) => drafts[id] && !same(drafts[id], saved[id] ?? EMPTY));
  const set = (id: string, patch: Partial<Draft>) => setDrafts((d) => ({ ...d, [id]: { ...current(id), ...patch } }));

  const markAllPresent = () => {
    setDrafts((d) => {
      const next = { ...d };
      for (const id of ids) {
        const c = d[id] ?? saved[id] ?? EMPTY;
        if (!c.status) next[id] = { ...c, status: onLeave.has(id) ? "on_leave" : "present" };
      }
      return next;
    });
  };

  const save = useMutation({
    mutationFn: async () => {
      const rows = dirty.map((id) => {
        const d = current(id);
        return {
          employee_id: id,
          status: d.status || null,
          check_in: d.check_in || null,
          check_out: d.check_out || null,
          note: d.note.trim() || null,
        };
      });
      const { error } = await supabase.rpc("attendance_set", { p_date: date, p_rows: rows });
      if (error) throw wrapDbError(error);
      return rows.length;
    },
    onSuccess: (n) => {
      setSaveError("");
      setDrafts({});
      void qc.invalidateQueries({ queryKey: ["attendance_records"] });
      toast.success(tp("hr.attendanceSaved", n));
    },
    onError: (e) => setSaveError(e instanceof Error ? e.message : String(e)),
  });

  const isWeekend = weekend.includes(new Date(`${date}T00:00:00Z`).getUTCDay());
  const rows = employeesQ.data?.rows ?? [];
  const total = employeesQ.data?.total ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="max-w-44" dir="ltr" />
        {isWeekend && <Badge tone="slate">{t("hr.weekendDay")}</Badge>}
        <div className="ms-auto flex flex-wrap gap-2">
          <Button variant="secondary" onClick={markAllPresent} disabled={rows.length === 0}>
            <CalendarCheck className="h-4 w-4" /> {t("hr.markAllPresent")}
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={dirty.length === 0}>
            {dirty.length > 0 ? tp("hr.saveRows", dirty.length) : t("action.save")}
          </Button>
        </div>
      </div>
      {saveError && <ErrorState message={saveError} />}

      {employeesQ.isLoading && <LoadingState />}
      {employeesQ.error && <ErrorState message={(employeesQ.error as Error).message} />}
      {!employeesQ.isLoading && rows.length === 0 && (
        <EmptyState icon={<UsersRound className="h-10 w-10" />} title={t("hr.noActiveEmployees")} />
      )}
      {rows.length > 0 && (
        <Card className="divide-y divide-line">
          {rows.map((e) => {
            const d = current(e.id);
            const hours = d.check_in && d.check_out ? clockHours(d.check_in, d.check_out) : null;
            const changed = dirty.includes(e.id);
            return (
              <div key={e.id} className="grid gap-2 p-3 lg:grid-cols-[minmax(0,1.4fr)_9rem_8.5rem_8.5rem_4rem_minmax(0,1fr)] lg:items-center">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-ink">
                    <Bdi>{employeeName(e, language)}</Bdi>
                    {changed && <span className="ms-1 text-brand-600" aria-hidden>•</span>}
                  </div>
                  <div className="flex flex-wrap gap-1 text-xs text-ink-3">
                    {e.doc_number && <Ltr>{e.doc_number}</Ltr>}
                    {onLeave.has(e.id) && <Badge tone="purple">{t("hr.onApprovedLeave")}</Badge>}
                  </div>
                </div>
                <Select
                  value={d.status}
                  onChange={(ev) => set(e.id, { status: ev.target.value as Draft["status"] })}
                  aria-label={t("common.status")}
                >
                  <option value="">{t("hr.notRecorded")}</option>
                  {(Object.keys(attendanceStatus) as AttendanceStatus[]).map((s) => (
                    <option key={s} value={s}>{t(attendanceStatus[s].labelKey)}</option>
                  ))}
                </Select>
                <div className="grid grid-cols-[1fr_1fr_auto] gap-2 lg:contents">
                  <Input
                    type="time"
                    value={d.check_in}
                    onChange={(ev) => set(e.id, { check_in: ev.target.value })}
                    aria-label={t("hr.checkIn")}
                    title={t("hr.checkIn")}
                    dir="ltr"
                  />
                  <Input
                    type="time"
                    value={d.check_out}
                    onChange={(ev) => set(e.id, { check_out: ev.target.value })}
                    aria-label={t("hr.checkOut")}
                    title={t("hr.checkOut")}
                    dir="ltr"
                  />
                  <span className="self-center text-end text-sm text-ink-2 tabular-nums">
                    {hours != null ? <Ltr>{t("hr.hoursShort", { hours })}</Ltr> : t("common.dash")}
                  </span>
                </div>
                <Input
                  value={d.note}
                  onChange={(ev) => set(e.id, { note: ev.target.value })}
                  placeholder={t("hr.notePlaceholder")}
                  maxLength={500}
                />
              </div>
            );
          })}
        </Card>
      )}
      {total > PAGE_SIZE && (
        <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
      )}
      {dirty.length > 0 && total > PAGE_SIZE && <p className="text-xs text-ink-3">{t("hr.saveBeforePaging")}</p>}
    </div>
  );
}
