import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Pencil, Trash2, Undo2, UserPlus, XCircle } from "lucide-react";
import { deleteRow, listRows, updateRow } from "../../lib/db";
import { formatDateTime } from "../../lib/format";
import { minutesLate, nextStep, OPEN_STATUSES } from "../../../shared/dispatch";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useT } from "../../i18n";
import { Badge, Bdi, Button, Card, ErrorState, Field, LoadingState, Ltr, Modal, Textarea } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { AssignForm, JobForm } from "./forms";
import { driverName, priorityTone, statusTone, useDuration } from "./labels";
import { JOB_SELECT, type DispatchJob } from "./types";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-2 last:border-b-0">
      <dt className="shrink-0 text-sm text-ink-3">{label}</dt>
      <dd className="min-w-0 text-end text-sm text-ink">{children}</dd>
    </div>
  );
}

export default function JobDetailPage() {
  const { id = "" } = useParams();
  const t = useT();
  const tenant = useTenant();
  const navigate = useNavigate();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const dur = useDuration();
  const [modal, setModal] = useState<"edit" | "assign" | "complete" | "cancel" | "delete" | null>(null);
  const [text, setText] = useState("");
  const [actionError, setActionError] = useState("");

  const jobQ = useQuery({
    queryKey: ["dispatch_jobs", "detail", id],
    queryFn: async () => (await listRows<DispatchJob>("dispatch_jobs", (q) => q.select(JOB_SELECT).eq("id", id).limit(1)))[0] ?? null,
  });
  const update = useMutation({
    mutationFn: (v: { values: Record<string, unknown>; done: string }) => updateRow("dispatch_jobs", id, v.values),
    onSuccess: (_d, v) => {
      setActionError("");
      setModal(null);
      void qc.invalidateQueries({ queryKey: ["dispatch_jobs"] });
      toast.success(v.done);
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : t("common.error"));
      setModal(null);
    },
  });
  const remove = useMutation({
    mutationFn: () => deleteRow("dispatch_jobs", id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["dispatch_jobs"] });
      toast.success(t("dispatch.deleted"));
      navigate("/dispatch/jobs");
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : t("common.error"));
      setModal(null);
    },
  });

  if (jobQ.isLoading) return <LoadingState />;
  if (jobQ.error) return <ErrorState message={(jobQ.error as Error).message} />;
  const job = jobQ.data;
  if (!job) return <ErrorState message={t("dispatch.notFound")} />;

  const open = OPEN_STATUSES.includes(job.status);
  const next = nextStep(job.status);
  const late = minutesLate(job, Date.now());
  const steps: Array<{ key: "created" | "assigned" | "en_route" | "on_site" | "completed" | "canceled"; at: string | null }> = [
    { key: "created", at: job.created_at },
    { key: "assigned", at: job.assigned_at },
    { key: "en_route", at: job.en_route_at },
    { key: "on_site", at: job.on_site_at },
    { key: job.status === "canceled" ? "canceled" : "completed", at: job.status === "canceled" ? job.canceled_at : job.completed_at },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Link to="/dispatch/jobs" className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline">
          <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" /> {t("dispatch.back")}
        </Link>
        <Ltr className="text-lg font-semibold text-ink">{job.doc_number}</Ltr>
        <Badge tone={statusTone[job.status]}>{t(`dispatch.status.${job.status}`)}</Badge>
        <Badge tone={priorityTone[job.priority]}>{t(`dispatch.priority.${job.priority}`)}</Badge>
        <Bdi className="min-w-0 truncate text-ink-2">{job.title}</Bdi>
        {isManager && (
          <div className="ms-auto flex flex-wrap gap-2">
            {open && (
              <Button variant="secondary" onClick={() => setModal("edit")}>
                <Pencil className="h-4 w-4" /> {t("action.edit")}
              </Button>
            )}
            {job.status === "new" && (
              <Button variant="ghost" onClick={() => setModal("delete")}>
                <Trash2 className="h-4 w-4" /> {t("action.delete")}
              </Button>
            )}
            {open && (
              <Button variant="secondary" onClick={() => { setText(""); setModal("cancel"); }}>
                <XCircle className="h-4 w-4" /> {t("dispatch.cancel")}
              </Button>
            )}
            {job.status === "assigned" && (
              <Button variant="secondary" loading={update.isPending}
                onClick={() => update.mutate({ values: { status: "new" }, done: t("dispatch.unassigned") })}>
                <Undo2 className="h-4 w-4 rtl:-scale-x-100" /> {t("dispatch.unassign")}
              </Button>
            )}
            {(job.status === "new" || job.status === "assigned") && (
              <Button variant={job.status === "new" ? "primary" : "secondary"} onClick={() => setModal("assign")}>
                <UserPlus className="h-4 w-4" /> {job.status === "new" ? t("dispatch.assign") : t("dispatch.reassign")}
              </Button>
            )}
            {next && next !== "completed" && (
              <Button loading={update.isPending} onClick={() => update.mutate({ values: { status: next }, done: t("dispatch.moved") })}>
                {t(`dispatch.step.${next}`)}
              </Button>
            )}
            {next === "completed" && (
              <Button onClick={() => { setText(""); setModal("complete"); }}>
                <CheckCircle2 className="h-4 w-4" /> {t("dispatch.step.completed")}
              </Button>
            )}
          </div>
        )}
      </div>

      {actionError && <ErrorState message={actionError} />}

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="p-4 lg:col-span-3">
          <dl>
            <Row label={t("dispatch.col.type")}>{t(`dispatch.type.${job.job_type}`)}</Row>
            <Row label={t("dispatch.s.window")}>
              <span className="whitespace-nowrap">{formatDateTime(job.window_start, tenant.timezone)}</span>
              <div className="text-xs text-ink-3">{formatDateTime(job.window_end, tenant.timezone)}</div>
              {late != null && (
                <div className="text-xs font-medium text-serious">
                  {job.status === "completed" ? t("dispatch.completedLate", { time: dur(late) }) : t("dispatch.lateBy", { time: dur(late) })}
                </div>
              )}
              {late == null && job.status === "completed" && <div className="text-xs text-good">{t("dispatch.onTime")}</div>}
            </Row>
            {job.customer && (
              <Row label={t("dispatch.col.customer")}>
                <Link to={`/customers/${job.customer_id}`} className="text-brand-700 hover:underline"><Bdi>{job.customer.name}</Bdi></Link>
              </Row>
            )}
            {(job.contact_name || job.contact_phone) && (
              <Row label={t("dispatch.s.contact")}>
                {job.contact_name && <Bdi>{job.contact_name}</Bdi>}
                {job.contact_phone && (
                  <a href={`tel:${job.contact_phone}`} dir="ltr" className="block text-brand-700 hover:underline">{job.contact_phone}</a>
                )}
              </Row>
            )}
            {job.pickup_address && <Row label={t("dispatch.s.pickup")}><Bdi>{job.pickup_address}</Bdi></Row>}
            {job.dropoff_address && <Row label={t("dispatch.s.dropoff")}><Bdi>{job.dropoff_address}</Bdi></Row>}
            <Row label={t("dispatch.s.vehicle")}>
              {job.vehicle ? (
                <Link to={`/vehicles/${job.vehicle_id}`} className="text-brand-700 hover:underline"><Bdi>{job.vehicle.name}</Bdi></Link>
              ) : (
                <span className="text-ink-3">{t("dispatch.unassignedRow")}</span>
              )}
            </Row>
            <Row label={t("dispatch.s.driver")}>{job.driver ? <Bdi>{driverName(job.driver)}</Bdi> : "—"}</Row>
            {job.cancel_reason && <Row label={t("dispatch.s.cancelReason")}><Bdi>{job.cancel_reason}</Bdi></Row>}
          </dl>
          {job.notes && (
            <div className="mt-3 text-sm">
              <div className="text-ink-3">{t("dispatch.s.notes")}</div>
              <Bdi className="block whitespace-pre-line text-ink-2">{job.notes}</Bdi>
            </div>
          )}
          {job.completion_notes && (
            <div className="mt-3 text-sm">
              <div className="text-ink-3">{t("dispatch.s.completionNotes")}</div>
              <Bdi className="block whitespace-pre-line text-ink-2">{job.completion_notes}</Bdi>
            </div>
          )}
        </Card>
        <Card className="p-4 lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold text-ink">{t("dispatch.timeline")}</h2>
          <ol className="space-y-3">
            {steps.map((s) => (
              <li key={s.key} className="flex items-start gap-3">
                <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${s.at ? (s.key === "canceled" ? "bg-serious" : "bg-good") : "bg-line"}`} />
                <div className="min-w-0">
                  <div className={s.at ? "text-sm font-medium text-ink" : "text-sm text-ink-3"}>{t(`dispatch.t.${s.key}`)}</div>
                  {s.at && <div className="text-xs text-ink-3">{formatDateTime(s.at, tenant.timezone)}</div>}
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      <Modal title={t("dispatch.editTitle")} open={modal === "edit"} onClose={() => setModal(null)} wide>
        {modal === "edit" && (
          <JobForm
            job={job}
            onCancel={() => setModal(null)}
            onDone={() => {
              setModal(null);
              void qc.invalidateQueries({ queryKey: ["dispatch_jobs"] });
              toast.success(t("dispatch.saved"));
            }}
          />
        )}
      </Modal>
      <Modal title={t("dispatch.assignTitle", { number: job.doc_number ?? "" })} open={modal === "assign"} onClose={() => setModal(null)}>
        {modal === "assign" && <AssignForm job={job} onDone={() => setModal(null)} onCancel={() => setModal(null)} />}
      </Modal>
      <Modal title={t("dispatch.completeTitle")} open={modal === "complete"} onClose={() => setModal(null)}>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            update.mutate({ values: { status: "completed", completion_notes: text.trim() || null }, done: t("dispatch.moved") });
          }}
        >
          <Field label={t("dispatch.completionNotes")}>
            <Textarea rows={3} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setModal(null)}>{t("action.cancel")}</Button>
            <Button type="submit" loading={update.isPending}>{t("dispatch.step.completed")}</Button>
          </div>
        </form>
      </Modal>
      <Modal title={t("dispatch.cancelTitle")} open={modal === "cancel"} onClose={() => setModal(null)}>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            update.mutate({ values: { status: "canceled", cancel_reason: text.trim() || null }, done: t("dispatch.canceled") });
          }}
        >
          <Field label={t("dispatch.cancelReason")}>
            <Textarea rows={3} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setModal(null)}>{t("action.cancel")}</Button>
            <Button type="submit" variant="danger" loading={update.isPending}>{t("dispatch.cancel")}</Button>
          </div>
        </form>
      </Modal>
      <Modal title={t("action.delete")} open={modal === "delete"} onClose={() => setModal(null)}>
        <p className="text-sm text-ink-2">{t("dispatch.deleteConfirm", { number: job.doc_number ?? "" })}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setModal(null)}>{t("action.cancel")}</Button>
          <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>{t("action.delete")}</Button>
        </div>
      </Modal>
    </div>
  );
}
