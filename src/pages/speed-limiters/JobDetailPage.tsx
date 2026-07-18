import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addMonths, format } from "date-fns";
import { Archive, ArrowLeft, Award, Ban, Check, Play, ShieldCheck } from "lucide-react";
import { insertRow, listRows, updateRow } from "../../lib/db";
import { formatDate, formatDateTime } from "../../lib/format";
import { supabase } from "../../lib/supabase";
import type {
  SlChecklistItem,
  SlDevice,
  SlJob,
  SlJobStatus,
  SlJobType,
  SlSettings,
  SpeedLimiterCertificate,
} from "../../lib/types";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useModules } from "../../context/ModulesContext";
import { useT, type MessageKey } from "../../i18n";
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Field,
  Input,
  LoadingState,
  Modal,
  PageHeader,
  Textarea,
  type BadgeTone,
} from "../../components/ui";

type JobDetail = SlJob & {
  vehicles: { name: string } | null;
  sl_customers: { name: string } | null;
  sl_technicians: { name: string } | null;
  sl_devices: Pick<SlDevice, "serial" | "manufacturer" | "model"> | null;
};

// Shared enum labels — defined once in the speedLimiters namespace.
const jobTypeKeys: Record<SlJobType, MessageKey> = {
  installation: "speedLimiters.jobType.installation",
  inspection: "speedLimiters.jobType.inspection",
  maintenance: "speedLimiters.jobType.maintenance",
  removal: "speedLimiters.jobType.removal",
  replacement: "speedLimiters.jobType.replacement",
  emergency: "speedLimiters.jobType.emergency",
};

const jobStatusMeta: Record<SlJobStatus, { labelKey: MessageKey; tone: BadgeTone }> = {
  scheduled: { labelKey: "speedLimiters.jobStatus.scheduled", tone: "blue" },
  in_progress: { labelKey: "speedLimiters.jobStatus.in_progress", tone: "yellow" },
  completed: { labelKey: "speedLimiters.jobStatus.completed", tone: "green" },
  qc_approved: { labelKey: "speedLimiters.jobStatus.qc_approved", tone: "purple" },
  closed: { labelKey: "speedLimiters.jobStatus.closed", tone: "slate" },
  canceled: { labelKey: "speedLimiters.jobStatus.canceled", tone: "slate" },
};

// Checklist labels are stored data (English in the DB); known ids render
// translated, unknown ids fall back to the stored label.
const CHECKLIST_LABEL_KEYS: Record<string, MessageKey> = {
  mounting: "slJobs.checklist.mounting",
  calibration: "slJobs.checklist.calibration",
  seal: "slJobs.checklist.seal",
  function_test: "slJobs.checklist.function_test",
  cabin_sticker: "slJobs.checklist.cabin_sticker",
  docs: "slJobs.checklist.docs",
};

const CERT_JOB_TYPES: SlJobType[] = ["installation", "replacement", "inspection"];

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="text-end font-medium text-slate-800">{value}</span>
    </div>
  );
}

function CompleteJobForm({ job, onDone }: { job: JobDetail; onDone: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const checklist: SlChecklistItem[] = job.checklist ?? [];
  const undone = checklist.filter((c) => !c.done).length;
  const [duration, setDuration] = useState(() =>
    job.started_at
      ? String(Math.max(1, Math.round((Date.now() - new Date(job.started_at).getTime()) / 60_000)))
      : "",
  );
  const [setSpeed, setSetSpeed] = useState(
    job.set_speed_kmh != null ? String(job.set_speed_kmh) : "",
  );
  const [customerSigned, setCustomerSigned] = useState(job.customer_signed);
  const [technicianSigned, setTechnicianSigned] = useState(job.technician_signed);
  const [overrideNote, setOverrideNote] = useState("");
  const [error, setError] = useState("");

  const mutation = useMutation({
    // The RPC atomically completes the job, retires prior active installations,
    // frees their devices, inserts the new installation, and updates the
    // job's device (removal jobs return the device to stock).
    mutationFn: async () => {
      const speed = setSpeed === "" ? null : Number(setSpeed);
      const { error } = await supabase.rpc("complete_sl_job", {
        p_job_id: job.id,
        p_duration_minutes: duration === "" ? null : Number(duration),
        p_set_speed_kmh: speed,
        p_customer_signed: customerSigned,
        p_technician_signed: technicianSigned,
      });
      if (error) {
        throw new Error(
          error.message === "JOB_NOT_IN_PROGRESS" ||
          error.message.includes("JOB_NOT_IN_PROGRESS")
            ? t("slJobs.notInProgress")
            : error.message,
        );
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["sl_jobs"] });
      void qc.invalidateQueries({ queryKey: ["speed_limiter_installations"] });
      void qc.invalidateQueries({ queryKey: ["sl_devices"] });
      onDone();
    },
    onError: (err) => {
      // The job may have changed under us — refresh everything.
      void qc.invalidateQueries({ queryKey: ["sl_jobs"] });
      void qc.invalidateQueries({ queryKey: ["speed_limiter_installations"] });
      void qc.invalidateQueries({ queryKey: ["sl_devices"] });
      setError(err instanceof Error ? err.message : t("slJobs.completeFailed"));
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (undone > 0 && !overrideNote.trim()) {
      setError(t("slJobs.checklistIncomplete", { count: undone }));
      return;
    }
    setError("");
    mutation.mutate();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && <ErrorState message={error} />}
      {undone > 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
          {t("slJobs.checklistIncomplete", { count: undone })}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("slJobs.durationMinutes")}>
          <Input
            type="number"
            min={0}
            step="1"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
        </Field>
        <Field label={t("slJobs.setSpeedKmh")}>
          <Input
            type="number"
            min={0}
            step="1"
            value={setSpeed}
            onChange={(e) => setSetSpeed(e.target.value)}
          />
        </Field>
      </div>
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300"
            checked={customerSigned}
            onChange={(e) => setCustomerSigned(e.target.checked)}
          />
          {t("slJobs.customerSigned")}
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300"
            checked={technicianSigned}
            onChange={(e) => setTechnicianSigned(e.target.checked)}
          />
          {t("slJobs.technicianSigned")}
        </label>
      </div>
      {undone > 0 && (
        <Field label={t("slJobs.overrideNote")} required hint={t("slJobs.overrideNoteHint")}>
          <Textarea
            value={overrideNote}
            onChange={(e) => setOverrideNote(e.target.value)}
            required
          />
        </Field>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>{t("action.cancel")}</Button>
        <Button type="submit" loading={mutation.isPending}>
          <Check className="h-4 w-4" /> {t("slJobs.completeJob")}
        </Button>
      </div>
    </form>
  );
}

function IssueCertificateForm({
  job,
  validityMonths,
  onDone,
}: {
  job: JobDetail;
  validityMonths: number;
  onDone: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [authority, setAuthority] = useState("");
  const [expiresAt, setExpiresAt] = useState(() =>
    format(addMonths(new Date(), validityMonths), "yyyy-MM-dd"),
  );
  const [notes, setNotes] = useState("");
  const [issued, setIssued] = useState<string | null>(null);
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      // Atomic numbering: the RPC is called exactly once per issued certificate.
      const { data: num, error: rpcError } = await supabase.rpc("next_certificate_number");
      if (rpcError) throw new Error(rpcError.message);
      await insertRow<SpeedLimiterCertificate>("speed_limiter_certificates", {
        certificate_number: num as string,
        vehicle_id: job.vehicle_id,
        customer_id: job.customer_id,
        job_id: job.id,
        device_id: job.device_id,
        installation_id: null,
        set_speed_kmh: job.set_speed_kmh,
        issuing_authority: authority.trim() || null,
        issued_at: format(new Date(), "yyyy-MM-dd"),
        expires_at: expiresAt,
        notes: notes.trim() || null,
      });
      return num as string;
    },
    onSuccess: (num) => {
      setError("");
      setIssued(num);
      void qc.invalidateQueries({ queryKey: ["speed_limiter_certificates"] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("slJobs.issueFailed")),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    mutation.mutate();
  }

  if (issued) {
    return (
      <div className="space-y-4">
        <p className="text-sm font-medium text-emerald-700">
          {t("slJobs.certIssued", { number: issued })}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onDone}>{t("action.close")}</Button>
          <Button onClick={() => navigate("/speed-limiters/certificates")}>
            {t("slJobs.goToCertificates")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && <ErrorState message={error} />}
      <Field label={t("slJobs.issuingAuthority")}>
        <Input value={authority} onChange={(e) => setAuthority(e.target.value)} />
      </Field>
      <Field label={t("slJobs.expiresAt")} required>
        <Input
          type="date"
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
          required
        />
      </Field>
      <Field label={t("field.notes")}>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>{t("action.cancel")}</Button>
        <Button type="submit" loading={mutation.isPending}>
          <Award className="h-4 w-4" /> {t("slJobs.issueCertificate")}
        </Button>
      </div>
    </form>
  );
}

export default function JobDetailPage() {
  const t = useT();
  const { jobId = "" } = useParams();
  const tenant = useTenant();
  const { isManager, session } = useAuth();
  const { isEnabled } = useModules();
  const qc = useQueryClient();
  const certificatesEnabled = isEnabled("sl_certificates");
  const [completing, setCompleting] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [actionError, setActionError] = useState("");

  const { data: job, isLoading, error } = useQuery({
    queryKey: ["sl_jobs", jobId],
    queryFn: async () => {
      const rows = await listRows<JobDetail>("sl_jobs", (q) =>
        q
          .select(
            "*, vehicles(name), sl_customers(name), sl_technicians(name), sl_devices(serial, manufacturer, model)",
          )
          .eq("id", jobId)
          .limit(1),
      );
      return rows[0] ?? null;
    },
  });

  const { data: settings } = useQuery({
    queryKey: ["sl_settings"],
    queryFn: async () => {
      const rows = await listRows<SlSettings>("sl_settings");
      return rows[0] ?? null;
    },
    enabled: certificatesEnabled,
  });

  const setStatus = useMutation({
    mutationFn: (values: Record<string, unknown>) => updateRow<SlJob>("sl_jobs", jobId, values),
    onSuccess: () => {
      setActionError("");
      void qc.invalidateQueries({ queryKey: ["sl_jobs"] });
    },
    onError: (err) =>
      setActionError(err instanceof Error ? err.message : t("slJobs.statusUpdateFailed")),
  });

  const saveChecklist = useMutation({
    mutationFn: (next: SlChecklistItem[]) =>
      updateRow<SlJob>("sl_jobs", jobId, { checklist: next }),
    onSuccess: () => {
      setActionError("");
      void qc.invalidateQueries({ queryKey: ["sl_jobs"] });
    },
    onError: (err) => setActionError(err instanceof Error ? err.message : t("slJobs.saveFailed")),
  });

  const saveSigned = useMutation({
    mutationFn: ({
      field,
      value,
    }: {
      field: "customer_signed" | "technician_signed";
      value: boolean;
    }) => updateRow<SlJob>("sl_jobs", jobId, { [field]: value }),
    onSuccess: () => {
      setActionError("");
      void qc.invalidateQueries({ queryKey: ["sl_jobs"] });
    },
    onError: (err) => setActionError(err instanceof Error ? err.message : t("slJobs.saveFailed")),
  });

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={(error as Error).message} />;
  if (!job) return <ErrorState message={t("slJobs.jobNotFound")} />;

  const checklist: SlChecklistItem[] = job.checklist ?? [];
  const doneCount = checklist.filter((c) => c.done).length;
  const statusMeta = jobStatusMeta[job.status];
  const canEditChecklist = isManager && job.status === "in_progress";
  const showChecklist =
    checklist.length > 0 && job.status !== "scheduled" && job.status !== "canceled";
  const showSignatureRows =
    job.status === "completed" || job.status === "qc_approved" || job.status === "closed";
  const canIssue =
    isManager &&
    certificatesEnabled &&
    (job.status === "completed" || job.status === "qc_approved") &&
    CERT_JOB_TYPES.includes(job.job_type);

  const checklistLabel = (item: SlChecklistItem) => {
    const key = CHECKLIST_LABEL_KEYS[item.id];
    return key ? t(key) : item.label;
  };

  return (
    <>
      <Link
        to="/speed-limiters/jobs"
        className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
      >
        <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" /> {t("slJobs.backToJobs")}
      </Link>
      <PageHeader
        title={t("slJobs.jobNumber", { number: job.number })}
        description={job.vehicles?.name}
        actions={
          <>
            <Badge tone="slate">{t(jobTypeKeys[job.job_type])}</Badge>
            <Badge tone={statusMeta.tone}>{t(statusMeta.labelKey)}</Badge>
          </>
        }
      />

      {actionError && (
        <div className="mb-4">
          <ErrorState message={actionError} />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5">
          <h3 className="mb-2 text-sm font-semibold text-slate-900">{t("slJobs.details")}</h3>
          <InfoRow
            label={t("slJobs.customer")}
            value={
              job.sl_customers && job.customer_id ? (
                <Link
                  to={`/speed-limiters/customers/${job.customer_id}`}
                  className="text-brand-700 hover:underline"
                >
                  {job.sl_customers.name}
                </Link>
              ) : (
                "—"
              )
            }
          />
          <InfoRow
            label={t("field.vehicle")}
            value={
              job.vehicles ? (
                <Link to={`/vehicles/${job.vehicle_id}`} className="text-brand-700 hover:underline">
                  {job.vehicles.name}
                </Link>
              ) : (
                "—"
              )
            }
          />
          <InfoRow label={t("slJobs.device")} value={job.sl_devices?.serial ?? "—"} />
          <InfoRow label={t("slJobs.technician")} value={job.sl_technicians?.name ?? "—"} />
          <InfoRow label={t("slJobs.scheduled")} value={formatDate(job.scheduled_date)} />
          <InfoRow label={t("slJobs.location")} value={job.location ?? "—"} />
          <InfoRow
            label={t("slJobs.setSpeed")}
            value={
              job.set_speed_kmh != null
                ? t("speedLimiters.kmhValue", { value: job.set_speed_kmh })
                : "—"
            }
          />
          {job.notes && (
            <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">{job.notes}</p>
          )}
        </Card>

        <Card className="p-5 lg:col-span-2">
          <h3 className="mb-3 text-sm font-semibold text-slate-900">{t("slJobs.workflow")}</h3>

          {isManager && (
            <div className="flex flex-wrap items-center gap-2">
              {job.status === "scheduled" && (
                <>
                  <Button
                    onClick={() =>
                      setStatus.mutate({
                        status: "in_progress",
                        started_at: new Date().toISOString(),
                      })
                    }
                    loading={setStatus.isPending}
                  >
                    <Play className="h-4 w-4" /> {t("slJobs.startJob")}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={setStatus.isPending}
                    onClick={() => setStatus.mutate({ status: "canceled" })}
                  >
                    <Ban className="h-4 w-4" /> {t("slJobs.cancelJob")}
                  </Button>
                </>
              )}
              {job.status === "in_progress" && (
                <Button onClick={() => setCompleting(true)}>
                  <Check className="h-4 w-4" /> {t("slJobs.completeJob")}
                </Button>
              )}
              {job.status === "completed" && (
                <Button
                  onClick={() =>
                    setStatus.mutate({
                      status: "qc_approved",
                      qc_at: new Date().toISOString(),
                      qc_by: session?.user.id ?? null,
                    })
                  }
                  loading={setStatus.isPending}
                >
                  <ShieldCheck className="h-4 w-4" /> {t("slJobs.qcApprove")}
                </Button>
              )}
              {job.status === "qc_approved" && (
                <Button
                  onClick={() => setStatus.mutate({ status: "closed" })}
                  loading={setStatus.isPending}
                >
                  <Archive className="h-4 w-4" /> {t("slJobs.closeJob")}
                </Button>
              )}
              {canIssue && (
                <Button variant="secondary" onClick={() => setIssuing(true)}>
                  <Award className="h-4 w-4" /> {t("slJobs.issueCertificate")}
                </Button>
              )}
            </div>
          )}

          {showChecklist && (
            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-sm font-medium text-slate-700">{t("slJobs.checklist")}</h4>
                <span className="text-xs text-slate-500">
                  {t("slJobs.checklistProgress", { done: doneCount, total: checklist.length })}
                </span>
              </div>
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {checklist.map((item) => (
                  <li key={item.id} className="flex items-center gap-3 px-3 py-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300"
                      checked={item.done}
                      disabled={!canEditChecklist || saveChecklist.isPending}
                      onChange={() =>
                        saveChecklist.mutate(
                          checklist.map((c) =>
                            c.id === item.id ? { ...c, done: !c.done } : c,
                          ),
                        )
                      }
                    />
                    <span
                      className={
                        item.done
                          ? "text-sm text-slate-500 line-through"
                          : "text-sm text-slate-700"
                      }
                    >
                      {checklistLabel(item)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {job.status === "in_progress" && (
            <div className="mt-4 space-y-2">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300"
                  checked={job.customer_signed}
                  disabled={!isManager || saveSigned.isPending}
                  onChange={(e) =>
                    saveSigned.mutate({ field: "customer_signed", value: e.target.checked })
                  }
                />
                {t("slJobs.customerSigned")}
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300"
                  checked={job.technician_signed}
                  disabled={!isManager || saveSigned.isPending}
                  onChange={(e) =>
                    saveSigned.mutate({ field: "technician_signed", value: e.target.checked })
                  }
                />
                {t("slJobs.technicianSigned")}
              </label>
            </div>
          )}

          <div className="mt-4 border-t border-slate-100 pt-3">
            <InfoRow
              label={t("slJobs.startedAt")}
              value={formatDateTime(job.started_at, tenant.timezone)}
            />
            <InfoRow
              label={t("slJobs.completedAt")}
              value={formatDateTime(job.completed_at, tenant.timezone)}
            />
            <InfoRow
              label={t("slJobs.duration")}
              value={
                job.duration_minutes != null
                  ? t("slJobs.durationValue", { minutes: job.duration_minutes })
                  : "—"
              }
            />
            <InfoRow
              label={t("slJobs.qcApprovedInfo")}
              value={formatDateTime(job.qc_at, tenant.timezone)}
            />
            {showSignatureRows && (
              <>
                <InfoRow
                  label={t("slJobs.customerSignature")}
                  value={job.customer_signed ? t("slJobs.signed") : t("slJobs.notSigned")}
                />
                <InfoRow
                  label={t("slJobs.technicianSignature")}
                  value={job.technician_signed ? t("slJobs.signed") : t("slJobs.notSigned")}
                />
              </>
            )}
          </div>
        </Card>
      </div>

      <Modal
        title={t("slJobs.completeJob")}
        open={completing}
        onClose={() => setCompleting(false)}
        wide
      >
        <CompleteJobForm job={job} onDone={() => setCompleting(false)} />
      </Modal>

      <Modal title={t("slJobs.issueCertificate")} open={issuing} onClose={() => setIssuing(false)}>
        <IssueCertificateForm
          job={job}
          validityMonths={settings?.cert_validity_months ?? 12}
          onDone={() => setIssuing(false)}
        />
      </Modal>
    </>
  );
}
