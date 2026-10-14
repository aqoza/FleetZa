import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlarmClock, CheckCircle2, ClipboardList, Plus, Timer, UserPlus } from "lucide-react";
import { listRows, updateRow } from "../../lib/db";
import { formatDateTime } from "../../lib/format";
import {
  BOARD_STATUSES, compareJobs, isLate, minutesLate, nextStep, OPEN_STATUSES, slaStats, type JobStatus,
} from "../../../shared/dispatch";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useT, useTp } from "../../i18n";
import { Badge, Bdi, Button, ErrorState, LoadingState, Ltr, Modal, StatCard } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { AssignForm, JobForm } from "./forms";
import { dayInTz, driverName, priorityTone, useDuration } from "./labels";
import { JOB_SELECT, type DispatchJob } from "./types";

const DAY = 86_400_000;
const COLUMN_LIMIT = 30;

export function useOpenJobs() {
  return useQuery({
    queryKey: ["dispatch_jobs", "open"],
    refetchInterval: 30_000,
    queryFn: () =>
      listRows<DispatchJob>("dispatch_jobs", (q) =>
        q.select(JOB_SELECT).in("status", OPEN_STATUSES).order("window_end").limit(500),
      ),
  });
}

export function useRecentDone() {
  return useQuery({
    queryKey: ["dispatch_jobs", "recent-done"],
    queryFn: () =>
      listRows<DispatchJob>("dispatch_jobs", (q) =>
        q.select(JOB_SELECT).eq("status", "completed").gte("completed_at", new Date(Date.now() - 30 * DAY).toISOString())
          .order("completed_at", { ascending: false }).limit(2000),
      ),
  });
}

export function useStepMutation() {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (v: { id: string; status: JobStatus; extra?: Record<string, unknown> }) =>
      updateRow("dispatch_jobs", v.id, { status: v.status, ...v.extra }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["dispatch_jobs"] });
      toast.success(t("dispatch.moved"));
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("common.error")),
  });
}

function JobCard({ job, now, onAssign }: { job: DispatchJob; now: number; onAssign: (j: DispatchJob) => void }) {
  const t = useT();
  const tenant = useTenant();
  const { isManager } = useAuth();
  const dur = useDuration();
  const step = useStepMutation();
  const late = minutesLate(job, now);
  const next = nextStep(job.status);
  const left = Math.round((Date.parse(job.window_end) - now) / 60_000);
  return (
    <div className={`rounded-xl border bg-surface p-3 text-sm shadow-sm ${late != null ? "border-serious/40" : "border-line"}`}>
      <Link to={`/dispatch/jobs/${job.id}`} className="block">
        <div className="flex items-center justify-between gap-2">
          <Ltr className="text-xs font-semibold text-brand-700">{job.doc_number}</Ltr>
          {job.priority !== "normal" && <Badge tone={priorityTone[job.priority]}>{t(`dispatch.priority.${job.priority}`)}</Badge>}
        </div>
        <Bdi className="mt-1 block font-medium text-ink">{job.title}</Bdi>
        <div className="mt-1 text-xs text-ink-3">
          {t(`dispatch.type.${job.job_type}`)}
          {job.customer && <> · <Bdi>{job.customer.name}</Bdi></>}
        </div>
        <div className={`mt-1 flex items-center gap-1 text-xs ${late != null ? "font-medium text-serious" : "text-ink-2"}`}>
          <Timer className="h-3.5 w-3.5 shrink-0" />
          {late != null ? t("dispatch.lateBy", { time: dur(late) }) : left <= 24 * 60 ? t("dispatch.dueIn", { time: dur(left) }) : formatDateTime(job.window_end, tenant.timezone)}
        </div>
        {job.vehicle && (
          <div className="mt-1 truncate text-xs text-ink-2">
            <Bdi>{job.vehicle.name}</Bdi>
            {job.driver && <> · <Bdi>{driverName(job.driver)}</Bdi></>}
          </div>
        )}
      </Link>
      {isManager && (job.status === "new" || next) && (
        <div className="mt-2 flex gap-1.5">
          {job.status === "new" ? (
            <Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => onAssign(job)}>
              <UserPlus className="h-4 w-4" /> {t("dispatch.assign")}
            </Button>
          ) : (
            next && (
              <Button variant="secondary" className="px-2.5 py-1 text-xs" disabled={step.isPending} onClick={() => step.mutate({ id: job.id, status: next })}>
                {next === "completed" && <CheckCircle2 className="h-4 w-4" />} {t(`dispatch.step.${next}`)}
              </Button>
            )
          )}
        </div>
      )}
    </div>
  );
}

export default function BoardPage() {
  const t = useT();
  const tp = useTp();
  const tenant = useTenant();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const openQ = useOpenJobs();
  const doneQ = useRecentDone();
  const [assigning, setAssigning] = useState<DispatchJob | null>(null);
  const [adding, setAdding] = useState(false);
  const now = openQ.dataUpdatedAt || Date.now();

  const columns = useMemo(() => {
    const m = new Map<JobStatus, DispatchJob[]>(BOARD_STATUSES.map((s) => [s, []]));
    for (const j of openQ.data ?? []) m.get(j.status)?.push(j);
    for (const list of m.values()) list.sort(compareJobs);
    return m;
  }, [openQ.data]);

  const kpi = useMemo(() => {
    const open = openQ.data ?? [];
    const done = doneQ.data ?? [];
    const today = dayInTz(Date.now(), tenant.timezone);
    return {
      open: open.length,
      unassigned: open.filter((j) => j.status === "new").length,
      late: open.filter((j) => isLate(j, now)).length,
      doneToday: done.filter((j) => j.completed_at && dayInTz(j.completed_at, tenant.timezone) === today).length,
      sla: slaStats(done),
    };
  }, [openQ.data, doneQ.data, now, tenant.timezone]);

  if (openQ.isLoading) return <LoadingState />;
  if (openQ.error) return <ErrorState message={(openQ.error as Error).message} />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<ClipboardList className="h-5 w-5" />}
          label={t("dispatch.kpi.open")}
          value={kpi.open}
          sub={kpi.unassigned > 0 ? tp("dispatch.kpi.unassigned", kpi.unassigned) : undefined}
          subTone="serious"
        />
        <StatCard icon={<AlarmClock className="h-5 w-5" />} tone="red" label={t("dispatch.kpi.late")} value={kpi.late} sub={t("dispatch.kpi.lateSub")} />
        <StatCard icon={<CheckCircle2 className="h-5 w-5" />} tone="green" label={t("dispatch.kpi.doneToday")} value={kpi.doneToday} />
        <StatCard
          icon={<Timer className="h-5 w-5" />}
          tone="amber"
          label={t("dispatch.kpi.onTime")}
          value={kpi.sla.onTimePct == null ? "—" : <Ltr>{`${kpi.sla.onTimePct}%`}</Ltr>}
          sub={kpi.sla.completed ? tp("dispatch.kpi.onTimeSub", kpi.sla.completed) : t("dispatch.kpi.noData")}
        />
      </div>

      <div className="flex items-center gap-3">
        <span className="text-xs text-ink-3">{t("dispatch.refreshed")}</span>
        {isManager && (
          <Button className="ms-auto" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> {t("dispatch.new")}
          </Button>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {BOARD_STATUSES.map((s) => {
          const list = columns.get(s) ?? [];
          return (
            <section key={s} className="rounded-2xl border border-line bg-canvas p-2">
              <h2 className="mb-2 flex items-center justify-between px-1 text-sm font-semibold text-ink">
                {t(`dispatch.status.${s}`)}
                <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-ink-2"><Ltr>{list.length}</Ltr></span>
              </h2>
              <div className="space-y-2">
                {list.length === 0 && <p className="px-1 py-4 text-center text-xs text-ink-3">{t("dispatch.columnEmpty")}</p>}
                {list.slice(0, COLUMN_LIMIT).map((j) => (
                  <JobCard key={j.id} job={j} now={now} onAssign={setAssigning} />
                ))}
                {list.length > COLUMN_LIMIT && (
                  <Link to="/dispatch/jobs" className="block px-1 text-center text-xs text-brand-700 hover:underline">
                    {tp("dispatch.moreInColumn", list.length - COLUMN_LIMIT)}
                  </Link>
                )}
              </div>
            </section>
          );
        })}
      </div>

      <Modal title={t("dispatch.assignTitle", { number: assigning?.doc_number ?? "" })} open={!!assigning} onClose={() => setAssigning(null)}>
        {assigning && <AssignForm job={assigning} onDone={() => setAssigning(null)} onCancel={() => setAssigning(null)} />}
      </Modal>
      <Modal title={t("dispatch.newTitle")} open={adding} onClose={() => setAdding(false)} wide>
        {adding && (
          <JobForm
            onCancel={() => setAdding(false)}
            onDone={() => {
              setAdding(false);
              void qc.invalidateQueries({ queryKey: ["dispatch_jobs"] });
              toast.success(t("dispatch.created"));
            }}
          />
        )}
      </Modal>
    </div>
  );
}
