import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Ban, CalendarClock, Car, CheckCircle2, ClipboardList, MapPin, Pencil, Play, Trash2, User, UserCheck,
} from "lucide-react";
import { deleteRow, listRows, wrapDbError } from "../../lib/db";
import { supabase } from "../../lib/supabase";
import type { Json } from "../../lib/database.types";
import { formatDateTime } from "../../lib/format";
import { employeeName } from "../../lib/employees";
import {
  canTick, checklistProgress, fieldMoves, isOverdue, isTerminal, mapsUrl, parseChecklist, type ChecklistItem,
  type FieldTaskStatus,
} from "../../lib/field";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useI18n, useT, useTp } from "../../i18n";
import {
  Badge, Bdi, Button, Card, EmptyState, ErrorState, Field, LoadingState, Ltr, Modal, PageHeader, Textarea,
} from "../../components/ui";
import { useToast } from "../../components/Toast";
import { useCheckin, useMyEmployee } from "./hooks";
import { moveDone, moveLabel, taskPriority, taskStatus } from "./labels";
import { SignatureImage, SignaturePad } from "./SignaturePad";
import { TaskForm } from "./TaskForm";
import { CHECKIN_SELECT, TASK_SELECT, type FieldCheckin, type FieldTask } from "./types";

type Move = Exclude<FieldTaskStatus, "assigned">;

const MOVE_ICON: Record<Move, typeof Play> = {
  accepted: UserCheck,
  in_progress: Play,
  completed: CheckCircle2,
  canceled: Ban,
};

function CompleteForm({ task, steps, onDone }: { task: FieldTask; steps: ChecklistItem[]; onDone: () => void }) {
  const t = useT();
  const tp = useTp();
  const qc = useQueryClient();
  const toast = useToast();
  const [notes, setNotes] = useState(task.completion_notes ?? "");
  const [signature, setSignature] = useState<string | null>(null);
  const [error, setError] = useState("");
  const open = steps.filter((s) => !s.done).length;
  const complete = useMutation({
    mutationFn: async () => {
      const { error: e } = await supabase.rpc("field_task_transition", {
        p_task: task.id,
        p_to: "completed",
        p_payload: { completion_notes: notes, ...(signature ? { signature_data: signature } : {}) },
      });
      if (e) throw wrapDbError(e);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["field_tasks"] });
      toast.success(t("field.done.completed"));
      onDone();
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });
  return (
    <div className="space-y-4">
      {open > 0 && <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">{tp("field.openSteps", open)}</p>}
      <Field label={t("field.notes")}>
        <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} />
      </Field>
      <div>
        <span className="mb-1 block text-sm font-medium text-ink-2">{t("field.signature")}</span>
        <SignaturePad onChange={setSignature} />
      </div>
      {error && <ErrorState message={error} />}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>{t("action.cancel")}</Button>
        <Button loading={complete.isPending} onClick={() => complete.mutate()}>
          <CheckCircle2 className="h-4 w-4" /> {t("field.move.completed")}
        </Button>
      </div>
    </div>
  );
}

function Info({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 text-ink-3">{icon}</span>
      <div className="min-w-0">
        <div className="text-xs text-ink-3">{label}</div>
        <div className="text-sm text-ink">{children}</div>
      </div>
    </div>
  );
}

export default function TaskDetailPage() {
  const { taskId = "" } = useParams();
  const t = useT();
  const { language } = useI18n();
  const tenant = useTenant();
  const { isManager } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const meQ = useMyEmployee();
  const checkin = useCheckin();
  const [editing, setEditing] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [confirm, setConfirm] = useState<"cancel" | "delete" | null>(null);
  const [actionError, setActionError] = useState("");

  const taskQ = useQuery({
    queryKey: ["field_tasks", "one", taskId],
    queryFn: async () => {
      const rows = await listRows<FieldTask>("field_tasks", (q) => q.select(TASK_SELECT).eq("id", taskId).limit(1));
      return rows[0] ?? null;
    },
  });
  const checkinsQ = useQuery({
    queryKey: ["field_checkins", "task", taskId],
    queryFn: () =>
      listRows<FieldCheckin>("field_checkins", (q) =>
        q.select(CHECKIN_SELECT).eq("task_id", taskId).order("at", { ascending: false }).limit(50),
      ),
  });

  const move = useMutation({
    mutationFn: async (args: { to: FieldTaskStatus | null; checklist?: ChecklistItem[] }) => {
      const { error } = await supabase.rpc("field_task_transition", {
        p_task: taskId,
        p_to: args.to,
        p_payload: args.checklist ? { checklist: args.checklist as unknown as Json } : {},
      });
      if (error) throw wrapDbError(error);
    },
    onSuccess: (_d, args) => {
      setActionError("");
      setConfirm(null);
      void qc.invalidateQueries({ queryKey: ["field_tasks"] });
      if (args.to && args.to !== "assigned") toast.success(t(moveDone[args.to]));
    },
    onError: (e) => {
      setConfirm(null);
      setActionError(e instanceof Error ? e.message : String(e));
    },
  });

  const remove = useMutation({
    mutationFn: () => deleteRow("field_tasks", taskId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["field_tasks"] });
      toast.success(t("toast.deleted"));
      navigate("/field/tasks");
    },
    onError: (e) => {
      setConfirm(null);
      setActionError(e instanceof Error ? e.message : String(e));
    },
  });

  const backTo = isManager ? "/field/tasks" : "/field";
  const back = (
    <Link to={backTo} className="mb-3 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink">
      <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" /> {t(isManager ? "field.backAll" : "field.backMine")}
    </Link>
  );

  if (taskQ.isLoading) return <LoadingState />;
  if (taskQ.error) return <ErrorState message={(taskQ.error as Error).message} />;
  const task = taskQ.data;
  if (!task) {
    return (
      <>
        {back}
        <EmptyState icon={<ClipboardList className="h-10 w-10" />} title={t("field.notFound")} />
      </>
    );
  }

  const isAssignee = !!meQ.data && meQ.data.id === task.employee_id;
  const moves = fieldMoves(task.status, { isManager, isAssignee }) as Move[];
  const steps = parseChecklist(task.checklist);
  const progress = checklistProgress(steps);
  const tickable = canTick(task.status) && (isManager || isAssignee);
  const overdue = isOverdue(task, Date.now());
  const map = mapsUrl(task.lat, task.lng);
  const st = taskStatus[task.status];
  const pr = taskPriority[task.priority];
  const when = (iso: string | null) => (iso ? <Ltr>{formatDateTime(iso, tenant.timezone)}</Ltr> : t("common.dash"));

  const toggle = (i: number) => {
    const next = steps.map((s, j) => (j === i ? { ...s, done: !s.done } : s));
    move.mutate({ to: null, checklist: next });
  };

  const timeline: Array<[string, string | null]> = [
    [t("field.t.created"), task.created_at],
    [t("field.t.accepted"), task.accepted_at],
    [t("field.t.started"), task.started_at],
    [t("field.t.completed"), task.completed_at],
    [t("field.t.canceled"), task.canceled_at],
  ];

  return (
    <>
      {back}
      <PageHeader
        title={task.title}
        description={task.doc_number ?? t("field.task")}
        badge={
          <span className="flex flex-wrap gap-1.5">
            <Badge tone={st.tone}>{t(st.labelKey)}</Badge>
            <Badge tone={pr.tone}>{t(pr.labelKey)}</Badge>
            {overdue && <Badge tone="red">{t("field.overdue")}</Badge>}
          </span>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {moves.filter((m) => m !== "canceled").map((m) => {
              const Icon = MOVE_ICON[m];
              return (
                <Button
                  key={m}
                  loading={move.isPending && move.variables?.to === m}
                  onClick={() => (m === "completed" ? setCompleting(true) : move.mutate({ to: m }))}
                >
                  <Icon className="h-4 w-4" /> {t(moveLabel[m])}
                </Button>
              );
            })}
            {isAssignee && !isTerminal(task.status) && (
              <Button variant="secondary" loading={checkin.isPending} onClick={() => checkin.mutate({ kind: "check_in", taskId: task.id })}>
                <MapPin className="h-4 w-4" /> {t("field.checkin.hereTask")}
              </Button>
            )}
            {isManager && !isTerminal(task.status) && (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                <Pencil className="h-4 w-4" /> {t("action.edit")}
              </Button>
            )}
            {moves.includes("canceled") && (
              <Button variant="ghost" onClick={() => setConfirm("cancel")}>
                <Ban className="h-4 w-4" /> {t("field.move.canceled")}
              </Button>
            )}
            {isManager && (task.status === "assigned" || task.status === "canceled") && (
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

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card className="p-4 sm:p-5">
            <h2 className="mb-3 text-base font-semibold text-ink">{t("field.details")}</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Info icon={<User className="h-4 w-4" />} label={t("field.col.assignee")}>
                {task.employee ? <Bdi>{employeeName(task.employee, language)}</Bdi> : t("common.dash")}
              </Info>
              <Info icon={<CalendarClock className="h-4 w-4" />} label={t("field.col.due")}>
                <span className={overdue ? "text-serious" : undefined}>{when(task.due_at)}</span>
                {task.scheduled_start && (
                  <div className="text-xs text-ink-3">{t("field.scheduledAt", { date: formatDateTime(task.scheduled_start, tenant.timezone) })}</div>
                )}
              </Info>
              {(task.customer || task.vehicle) && (
                <Info icon={<Car className="h-4 w-4" />} label={t("field.col.where")}>
                  {task.customer && (
                    <Link to={`/customers/${task.customer.id}`} className="text-brand-700 hover:underline">
                      <Bdi>{task.customer.name}</Bdi>
                    </Link>
                  )}
                  {task.customer && task.vehicle && " · "}
                  {task.vehicle && (
                    <Link to={`/vehicles/${task.vehicle.id}`} className="text-brand-700 hover:underline">
                      <Bdi>{task.vehicle.license_plate ? `${task.vehicle.name} (${task.vehicle.license_plate})` : task.vehicle.name}</Bdi>
                    </Link>
                  )}
                </Info>
              )}
              {(task.address || map) && (
                <Info icon={<MapPin className="h-4 w-4" />} label={t("field.f.address")}>
                  {task.address && <div dir="auto">{task.address}</div>}
                  {map && (
                    <a href={map} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">
                      {t("field.openMap")}
                    </a>
                  )}
                </Info>
              )}
            </div>
            {task.description && (
              <p className="mt-4 whitespace-pre-line border-t border-line pt-4 text-sm text-ink-2" dir="auto">{task.description}</p>
            )}
          </Card>

          <Card className="p-4 sm:p-5">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-base font-semibold text-ink">{t("field.f.checklist")}</h2>
              {progress.total > 0 && (
                <span className="text-sm text-ink-3 tabular-nums">{t("field.progress", { done: progress.done, total: progress.total })}</span>
              )}
            </div>
            {steps.length === 0 ? (
              <p className="text-sm text-ink-3">{t("field.checklistEmpty")}</p>
            ) : (
              <ul className="space-y-1">
                {steps.map((s, i) => (
                  <li key={i}>
                    <label className={`flex items-start gap-3 rounded-lg px-2 py-2 ${tickable ? "cursor-pointer hover:bg-canvas" : ""}`}>
                      <input
                        type="checkbox"
                        className="mt-0.5 h-5 w-5 shrink-0 accent-brand-600"
                        checked={s.done}
                        disabled={!tickable || move.isPending}
                        onChange={() => toggle(i)}
                      />
                      <span className={`text-sm ${s.done ? "text-ink-3 line-through" : "text-ink"}`} dir="auto">{s.label}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {steps.length > 0 && !tickable && task.status === "assigned" && isAssignee && (
              <p className="mt-2 text-xs text-ink-3">{t("field.tickHint")}</p>
            )}
          </Card>

          {task.status === "completed" && (
            <Card className="p-4 sm:p-5">
              <h2 className="mb-3 text-base font-semibold text-ink">{t("field.completion")}</h2>
              {task.completion_notes && (
                <p className="mb-3 whitespace-pre-line text-sm text-ink-2" dir="auto">{task.completion_notes}</p>
              )}
              <div className="text-xs text-ink-3">{t("field.signature")}</div>
              <div className="mt-1">
                {task.signature_data ? (
                  <SignatureImage src={task.signature_data} alt={t("field.signature")} />
                ) : (
                  <span className="text-sm text-ink-3">{t("field.noSignature")}</span>
                )}
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card className="p-4 sm:p-5">
            <h2 className="mb-3 text-base font-semibold text-ink">{t("field.timeline")}</h2>
            <ol className="space-y-2">
              {timeline
                .filter(([, at]) => !!at)
                .map(([label, at]) => (
                  <li key={label} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="text-ink-2">{label}</span>
                    <span className="text-ink-3 tabular-nums">{when(at)}</span>
                  </li>
                ))}
            </ol>
          </Card>
          <Card className="p-4 sm:p-5">
            <h2 className="mb-3 text-base font-semibold text-ink">{t("field.taskCheckins")}</h2>
            {checkinsQ.isLoading && <LoadingState />}
            {!checkinsQ.isLoading && (checkinsQ.data ?? []).length === 0 && (
              <p className="text-sm text-ink-3">{t("field.noTaskCheckins")}</p>
            )}
            <ul className="space-y-3">
              {(checkinsQ.data ?? []).map((c) => {
                const link = mapsUrl(c.lat, c.lng);
                return (
                  <li key={c.id} className="text-sm">
                    <div className="flex items-center gap-2">
                      <Badge tone={c.kind === "check_in" ? "green" : "slate"}>{t(`field.kind.${c.kind}`)}</Badge>
                      {c.employee && isManager && <span className="truncate text-ink-2"><Bdi>{employeeName(c.employee, language)}</Bdi></span>}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-3">
                      <span className="tabular-nums">{when(c.at)}</span>
                      {link && (
                        <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-700 hover:underline">
                          <MapPin className="h-3.5 w-3.5" /> {t("field.openMap")}
                        </a>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      </div>

      <Modal title={t("field.editTask")} open={editing} onClose={() => setEditing(false)} wide>
        {editing && <TaskForm task={task} onDone={() => setEditing(false)} />}
      </Modal>
      <Modal title={t("field.completeTitle")} open={completing} onClose={() => setCompleting(false)}>
        {completing && <CompleteForm task={task} steps={steps} onDone={() => setCompleting(false)} />}
      </Modal>
      <Modal title={t("action.confirm")} open={!!confirm} onClose={() => setConfirm(null)}>
        {confirm && (
          <div className="space-y-4">
            <p className="text-sm text-ink-2">{t(confirm === "cancel" ? "field.confirmCancel" : "field.confirmDelete")}</p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirm(null)}>{t("action.cancel")}</Button>
              <Button
                variant="danger"
                loading={move.isPending || remove.isPending}
                onClick={() => (confirm === "cancel" ? move.mutate({ to: "canceled" }) : remove.mutate())}
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
