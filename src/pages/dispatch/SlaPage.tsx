import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { AlarmClock, CheckCircle2, Timer } from "lucide-react";
import { formatDateTime } from "../../lib/format";
import { isLate, minutesLate, slaStats } from "../../../shared/dispatch";
import { useTenant } from "../../context/AuthContext";
import { useT, useTp } from "../../i18n";
import { Badge, Bdi, Card, ErrorState, LoadingState, Ltr, StatCard } from "../../components/ui";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { useOpenJobs, useRecentDone } from "./BoardPage";
import { driverName, priorityTone, statusTone, useDuration } from "./labels";
import type { DispatchJob } from "./types";

type LateJob = DispatchJob & { late: number };

export default function SlaPage() {
  const t = useT();
  const tp = useTp();
  const tenant = useTenant();
  const navigate = useNavigate();
  const dur = useDuration();
  const openQ = useOpenJobs();
  const doneQ = useRecentDone();
  const now = openQ.dataUpdatedAt || Date.now();

  const lateOpen = useMemo<LateJob[]>(
    () => (openQ.data ?? []).filter((j) => isLate(j, now)).map((j) => ({ ...j, late: minutesLate(j, now) ?? 0 })).sort((a, b) => b.late - a.late),
    [openQ.data, now],
  );
  const lateDone = useMemo<LateJob[]>(
    () =>
      (doneQ.data ?? [])
        .map((j) => ({ ...j, late: minutesLate(j, now) ?? -1 }))
        .filter((j) => j.late >= 0)
        .sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? "")),
    [doneQ.data, now],
  );
  const stats = useMemo(() => slaStats(doneQ.data ?? []), [doneQ.data]);

  const columns = (done: boolean): Array<DataTableColumn<LateJob>> => [
    {
      id: "number",
      header: t("dispatch.col.number"),
      cell: (j) => (
        <div className="min-w-0">
          <Ltr className="font-medium text-brand-700">{j.doc_number}</Ltr>
          <Bdi className="block max-w-72 truncate text-xs text-ink-3">{j.title}</Bdi>
        </div>
      ),
      exportValue: (j) => `${j.doc_number} ${j.title}`,
    },
    {
      id: "priority",
      header: t("dispatch.col.priority"),
      minBreakpoint: "sm",
      cell: (j) => <Badge tone={priorityTone[j.priority]}>{t(`dispatch.priority.${j.priority}`)}</Badge>,
      exportValue: (j) => j.priority,
    },
    {
      id: "window",
      header: t("dispatch.col.window"),
      minBreakpoint: "md",
      cell: (j) => <span className="whitespace-nowrap text-ink-2">{formatDateTime(j.window_end, tenant.timezone)}</span>,
      sortValue: (j) => j.window_end,
      exportValue: (j) => j.window_end,
    },
    {
      id: "assignee",
      header: t("dispatch.col.assignee"),
      minBreakpoint: "lg",
      cell: (j) =>
        j.vehicle ? (
          <div className="min-w-0">
            <Bdi className="text-ink">{j.vehicle.name}</Bdi>
            {j.driver && <Bdi className="block text-xs text-ink-3">{driverName(j.driver)}</Bdi>}
          </div>
        ) : (
          <span className="text-ink-3">—</span>
        ),
      exportValue: (j) => j.vehicle?.name ?? "",
    },
    ...(done
      ? []
      : [
          {
            id: "status",
            header: t("dispatch.col.status"),
            cell: (j: LateJob) => <Badge tone={statusTone[j.status]}>{t(`dispatch.status.${j.status}`)}</Badge>,
            exportValue: (j: LateJob) => j.status,
          },
        ]),
    {
      id: "late",
      header: t("dispatch.col.late"),
      cell: (j) => <span className="whitespace-nowrap font-medium text-serious">{dur(j.late)}</span>,
      sortValue: (j) => j.late,
      exportValue: (j) => j.late,
    },
  ];

  if (openQ.isLoading || doneQ.isLoading) return <LoadingState />;
  const err = openQ.error ?? doneQ.error;
  if (err) return <ErrorState message={(err as Error).message} />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard icon={<AlarmClock className="h-5 w-5" />} tone="red" label={t("dispatch.kpi.late")} value={lateOpen.length} sub={t("dispatch.kpi.lateSub")} />
        <StatCard
          icon={<CheckCircle2 className="h-5 w-5" />}
          tone="green"
          label={t("dispatch.kpi.onTime")}
          value={stats.onTimePct == null ? "—" : <Ltr>{`${stats.onTimePct}%`}</Ltr>}
          sub={stats.completed ? tp("dispatch.kpi.onTimeSub", stats.completed) : t("dispatch.kpi.noData")}
        />
        <StatCard
          icon={<Timer className="h-5 w-5" />}
          tone="amber"
          label={t("dispatch.avgLate")}
          value={stats.avgLateMinutes == null ? "—" : dur(stats.avgLateMinutes)}
        />
      </div>
      <Card className="p-4">
        <h2 className="mb-3 text-base font-semibold text-ink">{t("dispatch.slaTitle")}</h2>
        <DataTable<LateJob>
          tableId="dispatch-sla-open"
          exportName="dispatch-late-open"
          rows={lateOpen}
          rowKey={(j) => j.id}
          columns={columns(false)}
          onRowClick={(j) => navigate(`/dispatch/jobs/${j.id}`)}
          empty={<p className="py-6 text-center text-sm text-ink-3">{t("dispatch.slaEmpty")}</p>}
        />
      </Card>
      <Card className="p-4">
        <h2 className="mb-3 text-base font-semibold text-ink">{t("dispatch.slaRecent")}</h2>
        <DataTable<LateJob>
          tableId="dispatch-sla-done"
          exportName="dispatch-late-completed"
          rows={lateDone}
          rowKey={(j) => j.id}
          columns={columns(true)}
          onRowClick={(j) => navigate(`/dispatch/jobs/${j.id}`)}
          empty={<p className="py-6 text-center text-sm text-ink-3">{t("dispatch.slaRecentEmpty")}</p>}
        />
      </Card>
    </div>
  );
}
