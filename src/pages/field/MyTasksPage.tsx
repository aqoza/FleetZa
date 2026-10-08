import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, ClipboardList, LogIn, LogOut, MapPin, UserX } from "lucide-react";
import { listPage, listRows } from "../../lib/db";
import { formatDateTime } from "../../lib/format";
import { OPEN_STATUSES, checklistProgress, isOverdue, isToday, parseChecklist } from "../../lib/field";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useT, useTp } from "../../i18n";
import { Badge, Bdi, Button, Card, EmptyState, ErrorState, LoadingState, Ltr, Pagination } from "../../components/ui";
import { useCheckin, useMyEmployee } from "./hooks";
import { taskPriority, taskStatus } from "./labels";
import { TASK_LIST_SELECT, type FieldCheckin, type FieldTask } from "./types";

const PAGE_SIZE = 20;

function CheckinCard({ employeeId }: { employeeId: string }) {
  const t = useT();
  const tenant = useTenant();
  const checkin = useCheckin();
  const lastQ = useQuery({
    queryKey: ["field_checkins", "last", employeeId],
    queryFn: async () =>
      (
        await listRows<Pick<FieldCheckin, "id" | "kind" | "at">>("field_checkins", (q) =>
          q.select("id, kind, at").eq("employee_id", employeeId).order("at", { ascending: false }).limit(1),
        )
      )[0] ?? null,
  });
  const last = lastQ.data && isToday(lastQ.data.at) ? lastQ.data : null;
  const checkedIn = last?.kind === "check_in";
  const time = last ? formatDateTime(last.at, tenant.timezone) : "";

  return (
    <Card className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
      <div>
        <div className="text-sm font-semibold text-ink">{t("field.checkin.title")}</div>
        <div className="text-sm text-ink-2">
          {lastQ.isLoading
            ? "…"
            : !last
              ? t("field.checkin.none")
              : t(checkedIn ? "field.checkin.in" : "field.checkin.out", { time })}
        </div>
      </div>
      <Button
        variant={checkedIn ? "secondary" : "primary"}
        loading={checkin.isPending}
        onClick={() => checkin.mutate({ kind: checkedIn ? "check_out" : "check_in" })}
        className="min-w-36"
      >
        {checkedIn ? <LogOut className="h-4 w-4 rtl:-scale-x-100" /> : <LogIn className="h-4 w-4 rtl:-scale-x-100" />}
        {checkin.isPending ? t("field.checkin.locating") : t(checkedIn ? "field.checkin.checkOut" : "field.checkin.checkIn")}
      </Button>
    </Card>
  );
}

function TaskCard({ task }: { task: FieldTask }) {
  const t = useT();
  const tenant = useTenant();
  const st = taskStatus[task.status];
  const pr = taskPriority[task.priority];
  const progress = checklistProgress(parseChecklist(task.checklist));
  const overdue = isOverdue(task, Date.now());
  return (
    <Link to={`/field/tasks/${task.id}`} className="block rounded-xl border border-line bg-surface p-4 transition-colors hover:bg-canvas">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-medium text-ink"><Bdi>{task.title}</Bdi></div>
          <div className="text-xs text-ink-3"><Ltr>{task.doc_number ?? ""}</Ltr></div>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          {task.priority !== "medium" && <Badge tone={pr.tone}>{t(pr.labelKey)}</Badge>}
          <Badge tone={st.tone}>{t(st.labelKey)}</Badge>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
        {task.due_at && (
          <span className={`inline-flex items-center gap-1 ${overdue ? "text-serious" : ""}`}>
            <CalendarClock className="h-3.5 w-3.5" />
            {overdue ? t("field.overdue") + " · " : ""}
            {t("field.dueAt", { date: formatDateTime(task.due_at, tenant.timezone) })}
          </span>
        )}
        {(task.address || task.customer) && (
          <span className="inline-flex min-w-0 items-center gap-1">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate" dir="auto">{task.address ?? task.customer?.name}</span>
          </span>
        )}
        {progress.total > 0 && (
          <span className="inline-flex items-center gap-1 tabular-nums">
            <ClipboardList className="h-3.5 w-3.5" />
            {t("field.progress", { done: progress.done, total: progress.total })}
          </span>
        )}
      </div>
    </Link>
  );
}

export default function MyTasksPage() {
  const t = useT();
  const tp = useTp();
  const { isManager } = useAuth();
  const meQ = useMyEmployee();
  const [view, setView] = useState<"open" | "done">("open");
  const [page, setPage] = useState(0);
  const meId = meQ.data?.id ?? null;

  const { data, isLoading, error } = useQuery({
    queryKey: ["field_tasks", "mine", meId, view, page],
    queryFn: () =>
      listPage<FieldTask>("field_tasks", page, PAGE_SIZE, (q) => {
        const f = q.select(TASK_LIST_SELECT).eq("employee_id", meId!);
        return view === "open"
          ? f.in("status", OPEN_STATUSES).order("due_at", { ascending: true, nullsFirst: false }).order("created_at")
          : f.in("status", ["completed", "canceled"]).order("updated_at", { ascending: false });
      }),
    enabled: !!meId,
  });

  if (meQ.isLoading) return <LoadingState />;
  if (meQ.error) return <ErrorState message={(meQ.error as Error).message} />;
  if (!meId) {
    if (isManager) return <Navigate to="/field/tasks" replace />;
    return <EmptyState icon={<UserX className="h-10 w-10" />} title={t("field.noEmployeeTitle")} description={t("field.noEmployeeDesc")} />;
  }

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="space-y-4">
      <CheckinCard employeeId={meId} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-lg border border-line bg-surface p-0.5" role="tablist">
          {(["open", "done"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => {
                setView(v);
                setPage(0);
              }}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${view === v ? "bg-brand-600 text-white" : "text-ink-2 hover:text-ink"}`}
            >
              {t(v === "open" ? "field.filter.open" : "field.filter.done")}
            </button>
          ))}
        </div>
        {total > 0 && <span className="text-sm text-ink-3 tabular-nums">{tp("field.taskCount", total)}</span>}
      </div>
      {isLoading && <LoadingState />}
      {error && <ErrorState message={(error as Error).message} />}
      {!isLoading && !error && rows.length === 0 && (
        <EmptyState icon={<ClipboardList className="h-10 w-10" />} title={t("field.emptyMineTitle")} description={t("field.emptyMineDesc")} />
      )}
      <div className="grid gap-3 lg:grid-cols-2">
        {rows.map((r) => (
          <TaskCard key={r.id} task={r} />
        ))}
      </div>
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
    </div>
  );
}
