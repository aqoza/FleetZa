import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addMonths, format } from "date-fns";
import { Gauge, Pencil, Plus, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { deleteRow, insertRow, listRows, updateRow } from "../../lib/db";
import { daysUntil, formatDate } from "../../lib/format";
import type {
  SpeedLimiterCertificate,
  SpeedLimiterInstallation,
  SpeedLimiterStatus,
  Vehicle,
} from "../../lib/types";
import { useAuth } from "../../context/AuthContext";
import { useModules } from "../../context/ModulesContext";
import {
  Badge, Button, Card, EmptyState, ErrorState, Field, Input, LoadingState, Modal, PageHeader, Select, Table, Textarea,
} from "../../components/ui";
import type { BadgeTone } from "../../components/ui";
import { useT, type MessageKey, type Translate } from "../../i18n";

// --- Installations ---

type InstallationRow = SpeedLimiterInstallation & { vehicles: { name: string } };

const installationStatus: Record<SpeedLimiterStatus, { labelKey: MessageKey; tone: BadgeTone }> = {
  active: { labelKey: "speedLimiters.status.active", tone: "green" },
  maintenance: { labelKey: "speedLimiters.status.maintenance", tone: "yellow" },
  removed: { labelKey: "speedLimiters.status.removed", tone: "slate" },
};

function KpiCard({ label, value }: { label: string; value: number }) {
  return (
    <Card className="p-5">
      <div className="text-sm font-medium text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">{value}</div>
    </Card>
  );
}

function InstallationForm({
  installation,
  vehicles,
  onDone,
}: {
  installation?: SpeedLimiterInstallation;
  vehicles: Vehicle[];
  onDone: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();

  const [form, setForm] = useState({
    vehicle_id: installation?.vehicle_id ?? "",
    device_serial: installation?.device_serial ?? "",
    brand: installation?.brand ?? "",
    model: installation?.model ?? "",
    set_speed_kmh: installation?.set_speed_kmh != null ? String(installation.set_speed_kmh) : "",
    installed_at: installation?.installed_at.slice(0, 10) ?? format(new Date(), "yyyy-MM-dd"),
    technician: installation?.technician ?? "",
    status: (installation?.status ?? "active") as string,
    notes: installation?.notes ?? "",
  });
  const [error, setError] = useState("");

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const mutation = useMutation({
    mutationFn: () => {
      const values = {
        vehicle_id: form.vehicle_id,
        device_serial: form.device_serial.trim(),
        brand: form.brand.trim() || null,
        model: form.model.trim() || null,
        set_speed_kmh: form.set_speed_kmh === "" ? null : Number(form.set_speed_kmh),
        installed_at: form.installed_at,
        technician: form.technician.trim() || null,
        status: form.status,
        notes: form.notes.trim() || null,
      };
      return installation
        ? updateRow<SpeedLimiterInstallation>("speed_limiter_installations", installation.id, values)
        : insertRow<SpeedLimiterInstallation>("speed_limiter_installations", values);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["speed_limiter_installations"] });
      onDone();
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("speedLimiters.saveFailed")),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    mutation.mutate();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && <ErrorState message={error} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("field.vehicle")} required>
          <Select value={form.vehicle_id} onChange={(e) => set("vehicle_id", e.target.value)} required>
            <option value="">{t("speedLimiters.selectVehicle")}</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("speedLimiters.deviceSerial")} required>
          <Input
            value={form.device_serial}
            onChange={(e) => set("device_serial", e.target.value)}
            required
          />
        </Field>
        <Field label={t("speedLimiters.brand")}>
          <Input value={form.brand} onChange={(e) => set("brand", e.target.value)} />
        </Field>
        <Field label={t("speedLimiters.model")}>
          <Input value={form.model} onChange={(e) => set("model", e.target.value)} />
        </Field>
        <Field label={t("speedLimiters.setSpeedKmh")}>
          <Input
            type="number"
            min={30}
            max={160}
            value={form.set_speed_kmh}
            onChange={(e) => set("set_speed_kmh", e.target.value)}
          />
        </Field>
        <Field label={t("speedLimiters.installedAt")} required>
          <Input
            type="date"
            value={form.installed_at}
            onChange={(e) => set("installed_at", e.target.value)}
            required
          />
        </Field>
        <Field label={t("speedLimiters.technician")}>
          <Input value={form.technician} onChange={(e) => set("technician", e.target.value)} />
        </Field>
        <Field label={t("common.status")}>
          <Select value={form.status} onChange={(e) => set("status", e.target.value)}>
            {(Object.keys(installationStatus) as SpeedLimiterStatus[]).map((s) => (
              <option key={s} value={s}>{t(installationStatus[s].labelKey)}</option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label={t("field.notes")}>
        <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>{t("action.cancel")}</Button>
        <Button type="submit" loading={mutation.isPending}>
          {installation ? t("action.saveChanges") : t("speedLimiters.newInstallation")}
        </Button>
      </div>
    </form>
  );
}

function InstallationsTab({
  adding,
  setAdding,
}: {
  adding: boolean;
  setAdding: (open: boolean) => void;
}) {
  const t = useT();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<InstallationRow | null>(null);
  const [deleting, setDeleting] = useState<InstallationRow | null>(null);
  const [actionError, setActionError] = useState("");

  const { data: installations, isLoading, error } = useQuery({
    queryKey: ["speed_limiter_installations"],
    queryFn: () =>
      listRows<InstallationRow>("speed_limiter_installations", (q) =>
        q.select("*, vehicles(name)").order("installed_at", { ascending: false }),
      ),
  });

  const { data: vehicles } = useQuery({
    queryKey: ["vehicles"],
    queryFn: () => listRows<Vehicle>("vehicles", (q) => q.order("name")),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteRow("speed_limiter_installations", id),
    onSuccess: () => {
      setActionError("");
      void qc.invalidateQueries({ queryKey: ["speed_limiter_installations"] });
      setDeleting(null);
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : t("speedLimiters.deleteFailed"));
      setDeleting(null);
    },
  });

  const kpis = useMemo(() => {
    const active = (installations ?? []).filter((i) => i.status === "active");
    return {
      activeCount: active.length,
      vehiclesCovered: new Set(active.map((i) => i.vehicle_id)).size,
    };
  }, [installations]);

  return (
    <>
      {isLoading && <LoadingState />}
      {error && <ErrorState message={(error as Error).message} />}
      {actionError && <div className="mb-4"><ErrorState message={actionError} /></div>}

      {!isLoading && !error && (installations ?? []).length > 0 && (
        <div className="mb-4 grid gap-4 sm:grid-cols-2">
          <KpiCard label={t("speedLimiters.kpiActiveInstallations")} value={kpis.activeCount} />
          <KpiCard label={t("speedLimiters.kpiVehiclesCovered")} value={kpis.vehiclesCovered} />
        </div>
      )}

      {!isLoading && !error && (installations ?? []).length === 0 && (
        <EmptyState
          icon={<Gauge className="h-10 w-10" />}
          title={t("speedLimiters.noInstallationsYet")}
          description={t("speedLimiters.installationsEmptyDesc")}
          action={
            isManager ? (
              <Button onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4" /> {t("speedLimiters.newInstallation")}
              </Button>
            ) : undefined
          }
        />
      )}

      {!isLoading && !error && (installations ?? []).length > 0 && (
        <Table
          headers={[
            t("speedLimiters.device"),
            t("field.vehicle"),
            t("speedLimiters.setSpeed"),
            t("speedLimiters.installed"),
            t("common.status"),
            "",
          ]}
        >
          {(installations ?? []).map((i) => {
            const device = [i.brand, i.model].filter(Boolean).join(" · ");
            return (
              <tr key={i.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-800">{i.device_serial}</div>
                  {device && <div className="text-xs text-slate-500">{device}</div>}
                </td>
                <td className="px-4 py-3 text-slate-600">{i.vehicles.name}</td>
                <td className="px-4 py-3 text-slate-600">
                  {i.set_speed_kmh != null
                    ? t("speedLimiters.kmhValue", { value: i.set_speed_kmh })
                    : "—"}
                </td>
                <td className="px-4 py-3 text-slate-600">{formatDate(i.installed_at)}</td>
                <td className="px-4 py-3">
                  <Badge tone={installationStatus[i.status].tone}>
                    {t(installationStatus[i.status].labelKey)}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-end">
                  {isManager && (
                    <div className="flex justify-end gap-1">
                      <button
                        className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                        onClick={() => setEditing(i)}
                        aria-label={t("speedLimiters.editInstallation")}
                        title={t("action.edit")}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        onClick={() => setDeleting(i)}
                        aria-label={t("speedLimiters.deleteInstallation")}
                        title={t("action.delete")}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </Table>
      )}

      <Modal title={t("speedLimiters.newInstallation")} open={adding} onClose={() => setAdding(false)} wide>
        <InstallationForm vehicles={vehicles ?? []} onDone={() => setAdding(false)} />
      </Modal>

      <Modal title={t("speedLimiters.editInstallation")} open={!!editing} onClose={() => setEditing(null)} wide>
        {editing && (
          <InstallationForm
            installation={editing}
            vehicles={vehicles ?? []}
            onDone={() => setEditing(null)}
          />
        )}
      </Modal>

      <Modal
        title={t("speedLimiters.deleteInstallation")}
        open={!!deleting}
        onClose={() => setDeleting(null)}
      >
        {deleting && (
          <>
            <p className="text-sm text-slate-600">
              {t("speedLimiters.deleteInstallationConfirm", {
                serial: deleting.device_serial,
                vehicle: deleting.vehicles.name,
              })}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeleting(null)}>{t("action.cancel")}</Button>
              <Button
                variant="danger"
                onClick={() => remove.mutate(deleting.id)}
                loading={remove.isPending}
              >
                {t("speedLimiters.deleteInstallation")}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}

// --- Certificates ---

type CertificateRow = SpeedLimiterCertificate & { vehicles: { name: string } };

function expiryCell(c: CertificateRow, t: Translate) {
  const days = daysUntil(c.expires_at);
  if (days < 0) {
    return (
      <div className="flex items-center gap-2">
        <Badge tone="red">{t("speedLimiters.expired")}</Badge>
        <span className="text-xs text-slate-500">{formatDate(c.expires_at)}</span>
      </div>
    );
  }
  if (days <= 60) {
    return (
      <div className="flex items-center gap-2">
        <Badge tone="yellow">{t("speedLimiters.expiresInDays", { count: days })}</Badge>
        <span className="text-xs text-slate-500">{formatDate(c.expires_at)}</span>
      </div>
    );
  }
  return <span className="text-slate-600">{formatDate(c.expires_at)}</span>;
}

function CertificateForm({
  certificate,
  renewFrom,
  vehicles,
  installations,
  onDone,
}: {
  certificate?: SpeedLimiterCertificate;
  renewFrom?: SpeedLimiterCertificate;
  vehicles: Vehicle[];
  installations: SpeedLimiterInstallation[];
  onDone: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();

  const [form, setForm] = useState(() => {
    if (certificate) {
      return {
        vehicle_id: certificate.vehicle_id,
        installation_id: certificate.installation_id ?? "",
        certificate_number: certificate.certificate_number,
        issuing_authority: certificate.issuing_authority ?? "",
        issued_at: certificate.issued_at.slice(0, 10),
        expires_at: certificate.expires_at.slice(0, 10),
        notes: certificate.notes ?? "",
      };
    }
    const today = format(new Date(), "yyyy-MM-dd");
    if (renewFrom) {
      return {
        vehicle_id: renewFrom.vehicle_id,
        installation_id: renewFrom.installation_id ?? "",
        certificate_number: "",
        issuing_authority: renewFrom.issuing_authority ?? "",
        issued_at: today,
        expires_at: format(
          addMonths(new Date(`${renewFrom.expires_at.slice(0, 10)}T00:00:00`), 12),
          "yyyy-MM-dd",
        ),
        notes: "",
      };
    }
    return {
      vehicle_id: "",
      installation_id: "",
      certificate_number: "",
      issuing_authority: "",
      issued_at: today,
      expires_at: format(addMonths(new Date(), 12), "yyyy-MM-dd"),
      notes: "",
    };
  });
  const [error, setError] = useState("");

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const vehicleInstallations = installations.filter((i) => i.vehicle_id === form.vehicle_id);

  const mutation = useMutation({
    mutationFn: () => {
      const values = {
        vehicle_id: form.vehicle_id,
        installation_id: form.installation_id || null,
        certificate_number: form.certificate_number.trim(),
        issuing_authority: form.issuing_authority.trim() || null,
        issued_at: form.issued_at,
        expires_at: form.expires_at,
        notes: form.notes.trim() || null,
      };
      return certificate
        ? updateRow<SpeedLimiterCertificate>("speed_limiter_certificates", certificate.id, values)
        : insertRow<SpeedLimiterCertificate>("speed_limiter_certificates", {
            ...values,
            renewed_from: renewFrom?.id ?? null,
          });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["speed_limiter_certificates"] });
      onDone();
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("speedLimiters.saveFailed")),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    mutation.mutate();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && <ErrorState message={error} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("field.vehicle")} required>
          <Select
            value={form.vehicle_id}
            onChange={(e) => {
              const vehicleId = e.target.value;
              setForm((f) => ({ ...f, vehicle_id: vehicleId, installation_id: "" }));
            }}
            required
          >
            <option value="">{t("speedLimiters.selectVehicle")}</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("speedLimiters.installation")} hint={t("speedLimiters.installationHint")}>
          <Select
            value={form.installation_id}
            onChange={(e) => set("installation_id", e.target.value)}
          >
            <option value="">{t("speedLimiters.noLinkedInstallation")}</option>
            {vehicleInstallations.map((i) => (
              <option key={i.id} value={i.id}>{i.device_serial}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("speedLimiters.certificateNumber")} required>
          <Input
            value={form.certificate_number}
            onChange={(e) => set("certificate_number", e.target.value)}
            required
          />
        </Field>
        <Field label={t("speedLimiters.issuingAuthority")}>
          <Input
            value={form.issuing_authority}
            onChange={(e) => set("issuing_authority", e.target.value)}
          />
        </Field>
        <Field label={t("speedLimiters.issuedAt")} required>
          <Input
            type="date"
            value={form.issued_at}
            onChange={(e) => set("issued_at", e.target.value)}
            required
          />
        </Field>
        <Field label={t("speedLimiters.expiresAt")} required>
          <Input
            type="date"
            value={form.expires_at}
            onChange={(e) => set("expires_at", e.target.value)}
            required
          />
        </Field>
      </div>
      <Field label={t("field.notes")}>
        <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>{t("action.cancel")}</Button>
        <Button type="submit" loading={mutation.isPending}>
          {certificate
            ? t("action.saveChanges")
            : renewFrom
              ? t("speedLimiters.renewCertificate")
              : t("speedLimiters.newCertificate")}
        </Button>
      </div>
    </form>
  );
}

function CertificatesTab({
  adding,
  setAdding,
}: {
  adding: boolean;
  setAdding: (open: boolean) => void;
}) {
  const t = useT();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const [renewing, setRenewing] = useState<CertificateRow | null>(null);
  const [editing, setEditing] = useState<CertificateRow | null>(null);
  const [deleting, setDeleting] = useState<CertificateRow | null>(null);
  const [actionError, setActionError] = useState("");

  const { data: certificates, isLoading, error } = useQuery({
    queryKey: ["speed_limiter_certificates"],
    queryFn: () =>
      listRows<CertificateRow>("speed_limiter_certificates", (q) =>
        q.select("*, vehicles(name)").order("expires_at"),
      ),
  });

  const { data: vehicles } = useQuery({
    queryKey: ["vehicles"],
    queryFn: () => listRows<Vehicle>("vehicles", (q) => q.order("name")),
  });

  const { data: installations } = useQuery({
    queryKey: ["speed_limiter_installations"],
    queryFn: () =>
      listRows<InstallationRow>("speed_limiter_installations", (q) =>
        q.select("*, vehicles(name)").order("installed_at", { ascending: false }),
      ),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteRow("speed_limiter_certificates", id),
    onSuccess: () => {
      setActionError("");
      void qc.invalidateQueries({ queryKey: ["speed_limiter_certificates"] });
      setDeleting(null);
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : t("speedLimiters.deleteFailed"));
      setDeleting(null);
    },
  });

  return (
    <>
      {isLoading && <LoadingState />}
      {error && <ErrorState message={(error as Error).message} />}
      {actionError && <div className="mb-4"><ErrorState message={actionError} /></div>}

      {!isLoading && !error && (certificates ?? []).length === 0 && (
        <EmptyState
          icon={<ShieldCheck className="h-10 w-10" />}
          title={t("speedLimiters.noCertificatesYet")}
          description={t("speedLimiters.certificatesEmptyDesc")}
          action={
            isManager ? (
              <Button onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4" /> {t("speedLimiters.newCertificate")}
              </Button>
            ) : undefined
          }
        />
      )}

      {!isLoading && !error && (certificates ?? []).length > 0 && (
        <Table
          headers={[
            t("speedLimiters.certificateNumber"),
            t("field.vehicle"),
            t("speedLimiters.issued"),
            t("speedLimiters.expires"),
            "",
          ]}
        >
          {(certificates ?? []).map((c) => (
            <tr key={c.id} className="hover:bg-slate-50">
              <td className="px-4 py-3">
                <div className="font-medium text-slate-800">{c.certificate_number}</div>
                {c.issuing_authority && (
                  <div className="text-xs text-slate-500">{c.issuing_authority}</div>
                )}
              </td>
              <td className="px-4 py-3 text-slate-600">{c.vehicles.name}</td>
              <td className="px-4 py-3 text-slate-600">{formatDate(c.issued_at)}</td>
              <td className="px-4 py-3">{expiryCell(c, t)}</td>
              <td className="px-4 py-3 text-end">
                {isManager && (
                  <div className="flex justify-end gap-1">
                    <button
                      className="rounded p-1.5 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600"
                      onClick={() => setRenewing(c)}
                      aria-label={t("speedLimiters.renewCertificate")}
                      title={t("speedLimiters.renew")}
                    >
                      <RefreshCw className="h-4 w-4" />
                    </button>
                    <button
                      className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                      onClick={() => setEditing(c)}
                      aria-label={t("speedLimiters.editCertificate")}
                      title={t("action.edit")}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      onClick={() => setDeleting(c)}
                      aria-label={t("speedLimiters.deleteCertificate")}
                      title={t("action.delete")}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}

      <Modal title={t("speedLimiters.newCertificate")} open={adding} onClose={() => setAdding(false)} wide>
        <CertificateForm
          vehicles={vehicles ?? []}
          installations={installations ?? []}
          onDone={() => setAdding(false)}
        />
      </Modal>

      <Modal
        title={t("speedLimiters.renewCertificate")}
        open={!!renewing}
        onClose={() => setRenewing(null)}
        wide
      >
        {renewing && (
          <CertificateForm
            renewFrom={renewing}
            vehicles={vehicles ?? []}
            installations={installations ?? []}
            onDone={() => setRenewing(null)}
          />
        )}
      </Modal>

      <Modal title={t("speedLimiters.editCertificate")} open={!!editing} onClose={() => setEditing(null)} wide>
        {editing && (
          <CertificateForm
            certificate={editing}
            vehicles={vehicles ?? []}
            installations={installations ?? []}
            onDone={() => setEditing(null)}
          />
        )}
      </Modal>

      <Modal
        title={t("speedLimiters.deleteCertificate")}
        open={!!deleting}
        onClose={() => setDeleting(null)}
      >
        {deleting && (
          <>
            <p className="text-sm text-slate-600">
              {t("speedLimiters.deleteCertificateConfirm", {
                number: deleting.certificate_number,
                vehicle: deleting.vehicles.name,
              })}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeleting(null)}>{t("action.cancel")}</Button>
              <Button
                variant="danger"
                onClick={() => remove.mutate(deleting.id)}
                loading={remove.isPending}
              >
                {t("speedLimiters.deleteCertificate")}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}

// --- Page ---

type Tab = "installations" | "certificates";

export default function SpeedLimitersPage() {
  const t = useT();
  const { isManager } = useAuth();
  const { isEnabled } = useModules();
  const certificatesEnabled = isEnabled("sl_certificates");
  const [tab, setTab] = useState<Tab>("installations");
  const [addingInstallation, setAddingInstallation] = useState(false);
  const [addingCertificate, setAddingCertificate] = useState(false);

  const activeTab: Tab = certificatesEnabled ? tab : "installations";

  return (
    <>
      <PageHeader
        title={t("speedLimiters.title")}
        description={t("speedLimiters.subtitle")}
        actions={
          isManager &&
          (activeTab === "installations" ? (
            <Button onClick={() => setAddingInstallation(true)}>
              <Plus className="h-4 w-4" /> {t("speedLimiters.newInstallation")}
            </Button>
          ) : (
            <Button onClick={() => setAddingCertificate(true)}>
              <Plus className="h-4 w-4" /> {t("speedLimiters.newCertificate")}
            </Button>
          ))
        }
      />

      {certificatesEnabled && (
        <div className="mb-4 flex gap-2">
          {(
            [
              ["installations", t("speedLimiters.tabInstallations")],
              ["certificates", t("speedLimiters.tabCertificates")],
            ] as [Tab, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              className={
                activeTab === value
                  ? "rounded-full bg-brand-600 px-4 py-1.5 text-sm font-medium text-white shadow-sm"
                  : "rounded-full border border-slate-300 bg-white px-4 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
              }
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {activeTab === "installations" ? (
        <InstallationsTab adding={addingInstallation} setAdding={setAddingInstallation} />
      ) : (
        <CertificatesTab adding={addingCertificate} setAdding={setAddingCertificate} />
      )}
    </>
  );
}
