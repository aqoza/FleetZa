import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cpu, History, Pencil, Plus, Trash2 } from "lucide-react";
import { deleteRow, insertRow, listRows, updateRow } from "../../lib/db";
import { daysUntil, formatDate } from "../../lib/format";
import type { SlDevice, SlDeviceStatus, SlJob, Vehicle } from "../../lib/types";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useT, type MessageKey, type Translate } from "../../i18n";
import type { BadgeTone } from "../../components/ui";
import {
  Badge, Button, Card, EmptyState, ErrorState, Field, Input, LoadingState, Modal, PageHeader,
  Select, Table, Textarea,
} from "../../components/ui";

type DeviceRow = SlDevice & { vehicles: Pick<Vehicle, "name"> | null };
type JobRow = SlJob & { vehicles: Pick<Vehicle, "name"> | null };

// Shared enum labels are defined once in the speedLimiters namespace; these
// maps only attach badge tones for this page.
const deviceStatus: Record<SlDeviceStatus, { labelKey: MessageKey; tone: BadgeTone }> = {
  in_stock: { labelKey: "speedLimiters.deviceStatus.in_stock", tone: "blue" },
  installed: { labelKey: "speedLimiters.deviceStatus.installed", tone: "green" },
  faulty: { labelKey: "speedLimiters.deviceStatus.faulty", tone: "red" },
  retired: { labelKey: "speedLimiters.deviceStatus.retired", tone: "slate" },
};

const jobType: Record<SlJob["job_type"], MessageKey> = {
  installation: "speedLimiters.jobType.installation",
  inspection: "speedLimiters.jobType.inspection",
  maintenance: "speedLimiters.jobType.maintenance",
  removal: "speedLimiters.jobType.removal",
  replacement: "speedLimiters.jobType.replacement",
  emergency: "speedLimiters.jobType.emergency",
};

const jobStatus: Record<SlJob["status"], { labelKey: MessageKey; tone: BadgeTone }> = {
  scheduled: { labelKey: "speedLimiters.jobStatus.scheduled", tone: "blue" },
  in_progress: { labelKey: "speedLimiters.jobStatus.in_progress", tone: "yellow" },
  completed: { labelKey: "speedLimiters.jobStatus.completed", tone: "green" },
  qc_approved: { labelKey: "speedLimiters.jobStatus.qc_approved", tone: "purple" },
  closed: { labelKey: "speedLimiters.jobStatus.closed", tone: "slate" },
  canceled: { labelKey: "speedLimiters.jobStatus.canceled", tone: "slate" },
};

const STATUS_FILTERS: Array<SlDeviceStatus> = ["in_stock", "installed", "faulty", "retired"];

function warrantyCell(d: SlDevice, t: Translate) {
  if (!d.warranty_until) return <span className="text-slate-400">—</span>;
  const days = daysUntil(d.warranty_until);
  if (days < 0) {
    return (
      <div className="flex items-center gap-2">
        <Badge tone="slate">{t("slDevices.outOfWarranty")}</Badge>
        <span className="text-xs text-slate-500">{formatDate(d.warranty_until)}</span>
      </div>
    );
  }
  if (days <= 60) {
    return (
      <div className="flex items-center gap-2">
        <Badge tone="yellow">{t("slDevices.warrantyDaysLeft", { count: days })}</Badge>
        <span className="text-xs text-slate-500">{formatDate(d.warranty_until)}</span>
      </div>
    );
  }
  return <span className="text-slate-600">{formatDate(d.warranty_until)}</span>;
}

function KpiCard({ label, value }: { label: string; value: number }) {
  return (
    <Card className="p-4">
      <div className="text-sm font-medium text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">{value}</div>
    </Card>
  );
}

function DeviceForm({ device, onDone }: { device?: SlDevice; onDone: () => void }) {
  const t = useT();
  const tenant = useTenant();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    serial: device?.serial ?? "",
    manufacturer: device?.manufacturer ?? "",
    model: device?.model ?? "",
    firmware_version: device?.firmware_version ?? "",
    imei: device?.imei ?? "",
    purchase_date: device?.purchase_date ?? "",
    purchase_price: device?.purchase_price != null ? String(device.purchase_price) : "",
    supplier: device?.supplier ?? "",
    warranty_until: device?.warranty_until ?? "",
    status: device?.status ?? "in_stock",
    notes: device?.notes ?? "",
  });
  const [error, setError] = useState("");

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const mutation = useMutation({
    mutationFn: () => {
      const values = {
        serial: form.serial.trim(),
        manufacturer: form.manufacturer.trim() || null,
        model: form.model.trim() || null,
        firmware_version: form.firmware_version.trim() || null,
        imei: form.imei.trim() || null,
        purchase_date: form.purchase_date || null,
        purchase_price: form.purchase_price === "" ? null : Number(form.purchase_price),
        supplier: form.supplier.trim() || null,
        warranty_until: form.warranty_until || null,
        status: form.status,
        notes: form.notes.trim() || null,
      };
      return device
        ? updateRow<SlDevice>("sl_devices", device.id, values)
        : insertRow<SlDevice>("sl_devices", values);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["sl_devices"] });
      onDone();
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : "";
      setError(
        /duplicate|unique/i.test(msg)
          ? t("slDevices.duplicateSerial")
          : msg || t("slDevices.saveFailed"),
      );
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    mutation.mutate();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && <ErrorState message={error} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("slDevices.serialNumber")} required>
          <Input value={form.serial} onChange={(e) => set("serial", e.target.value)} required />
        </Field>
        <Field label={t("common.status")}>
          <Select value={form.status} onChange={(e) => set("status", e.target.value)}>
            {Object.entries(deviceStatus).map(([v, s]) => (
              <option key={v} value={v}>{t(s.labelKey)}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("slDevices.manufacturer")}>
          <Input value={form.manufacturer} onChange={(e) => set("manufacturer", e.target.value)} />
        </Field>
        <Field label={t("slDevices.model")}>
          <Input value={form.model} onChange={(e) => set("model", e.target.value)} />
        </Field>
        <Field label={t("slDevices.firmwareVersion")}>
          <Input
            value={form.firmware_version}
            onChange={(e) => set("firmware_version", e.target.value)}
          />
        </Field>
        <Field label={t("slDevices.imei")}>
          <Input value={form.imei} onChange={(e) => set("imei", e.target.value)} />
        </Field>
        <Field label={t("slDevices.purchaseDate")}>
          <Input
            type="date"
            value={form.purchase_date}
            onChange={(e) => set("purchase_date", e.target.value)}
          />
        </Field>
        <Field label={t("slDevices.purchasePrice", { currency: tenant.currency })}>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={form.purchase_price}
            onChange={(e) => set("purchase_price", e.target.value)}
          />
        </Field>
        <Field label={t("slDevices.supplier")}>
          <Input value={form.supplier} onChange={(e) => set("supplier", e.target.value)} />
        </Field>
        <Field label={t("slDevices.warrantyUntil")}>
          <Input
            type="date"
            value={form.warranty_until}
            onChange={(e) => set("warranty_until", e.target.value)}
          />
        </Field>
      </div>
      <Field label={t("field.notes")}>
        <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>{t("action.cancel")}</Button>
        <Button type="submit" loading={mutation.isPending}>
          {device ? t("action.saveChanges") : t("slDevices.addDevice")}
        </Button>
      </div>
    </form>
  );
}

function DeviceHistory({ device }: { device: SlDevice }) {
  const t = useT();
  const { data: jobs, isLoading, error } = useQuery({
    queryKey: ["sl_jobs", "device", device.id],
    queryFn: () =>
      listRows<JobRow>("sl_jobs", (q) =>
        q
          .select("*, vehicles(name)")
          .eq("device_id", device.id)
          .order("created_at", { ascending: false }),
      ),
  });

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={(error as Error).message} />;
  if (!jobs?.length) {
    return (
      <EmptyState
        icon={<History className="h-10 w-10" />}
        title={t("slDevices.historyEmptyTitle")}
        description={t("slDevices.historyEmptyDesc")}
      />
    );
  }

  return (
    <ol className="ms-2 border-s-2 border-slate-200">
      {jobs.map((j) => (
        <li key={j.id} className="relative ms-4 pb-5 last:pb-1">
          <span className="absolute -start-[23px] top-1 h-3 w-3 rounded-full border-2 border-white bg-brand-500" />
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium text-slate-800">
              {t("slDevices.jobNumber", { number: j.number })}
            </span>
            <span className="text-slate-600">{t(jobType[j.job_type])}</span>
            <Badge tone={jobStatus[j.status].tone}>{t(jobStatus[j.status].labelKey)}</Badge>
          </div>
          <div className="mt-0.5 text-xs text-slate-500">
            {j.vehicles?.name ?? "—"}
            {" · "}
            {formatDate(j.created_at)}
          </div>
        </li>
      ))}
    </ol>
  );
}

export default function DevicesPage() {
  const t = useT();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<SlDeviceStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<DeviceRow | null>(null);
  const [historyFor, setHistoryFor] = useState<DeviceRow | null>(null);
  const [deleting, setDeleting] = useState<DeviceRow | null>(null);
  const [actionError, setActionError] = useState("");

  const { data: devices, isLoading, error } = useQuery({
    queryKey: ["sl_devices"],
    queryFn: () =>
      listRows<DeviceRow>("sl_devices", (q) => q.select("*, vehicles(name)").order("serial")),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteRow("sl_devices", id),
    onSuccess: () => {
      setActionError("");
      void qc.invalidateQueries({ queryKey: ["sl_devices"] });
      setDeleting(null);
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : t("slDevices.deleteFailed"));
      setDeleting(null);
    },
  });

  const kpis = useMemo(() => {
    const counts: Record<SlDeviceStatus, number> = {
      in_stock: 0, installed: 0, faulty: 0, retired: 0,
    };
    for (const d of devices ?? []) counts[d.status] += 1;
    return counts;
  }, [devices]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (devices ?? []).filter((d) => {
      if (statusFilter !== "all" && d.status !== statusFilter) return false;
      if (!needle) return true;
      return [d.serial, d.manufacturer, d.model, d.imei].some((f) =>
        f?.toLowerCase().includes(needle),
      );
    });
  }, [devices, statusFilter, search]);

  function chip(value: SlDeviceStatus | "all", label: string) {
    const selected = statusFilter === value;
    return (
      <button
        key={value}
        type="button"
        onClick={() => setStatusFilter(value)}
        aria-pressed={selected}
        className={
          selected
            ? "rounded-full border border-brand-600 bg-brand-600 px-3 py-1 text-xs font-medium text-white"
            : "rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
        }
      >
        {label}
      </button>
    );
  }

  return (
    <>
      <PageHeader
        title={t("slDevices.title")}
        description={t("slDevices.description")}
        actions={
          isManager && (
            <Button onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" /> {t("slDevices.addDevice")}
            </Button>
          )
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label={t(deviceStatus.in_stock.labelKey)} value={kpis.in_stock} />
        <KpiCard label={t(deviceStatus.installed.labelKey)} value={kpis.installed} />
        <KpiCard label={t(deviceStatus.faulty.labelKey)} value={kpis.faulty} />
        <KpiCard label={t(deviceStatus.retired.labelKey)} value={kpis.retired} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {chip("all", t("common.all"))}
          {STATUS_FILTERS.map((s) => chip(s, t(deviceStatus[s].labelKey)))}
        </div>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("slDevices.searchPlaceholder")}
          className="max-w-72"
          aria-label={t("action.search")}
        />
      </div>

      {isLoading && <LoadingState />}
      {error && <ErrorState message={(error as Error).message} />}
      {actionError && (
        <div className="mb-4">
          <ErrorState message={actionError} />
        </div>
      )}

      {!isLoading && !error && filtered.length === 0 && (
        <EmptyState
          icon={<Cpu className="h-10 w-10" />}
          title={devices?.length ? t("slDevices.emptyFilteredTitle") : t("slDevices.emptyTitle")}
          description={
            devices?.length ? t("slDevices.emptyFilteredDesc") : t("slDevices.emptyDesc")
          }
          action={
            isManager && !devices?.length ? (
              <Button onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4" /> {t("slDevices.addDevice")}
              </Button>
            ) : undefined
          }
        />
      )}

      {!isLoading && !error && filtered.length > 0 && (
        <Table
          headers={[
            t("slDevices.serial"),
            t("slDevices.firmware"),
            t("slDevices.imei"),
            t("field.vehicle"),
            t("slDevices.warranty"),
            t("common.status"),
            "",
          ]}
        >
          {filtered.map((d) => {
            const sub = [d.manufacturer, d.model].filter(Boolean).join(" · ");
            return (
              <tr key={d.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-800">{d.serial}</div>
                  {sub && <div className="text-xs text-slate-500">{sub}</div>}
                </td>
                <td className="px-4 py-3 text-slate-600">{d.firmware_version ?? "—"}</td>
                <td className="px-4 py-3 text-slate-600">{d.imei ?? "—"}</td>
                <td className="px-4 py-3">
                  {d.current_vehicle_id && d.vehicles ? (
                    <Link
                      to={`/vehicles/${d.current_vehicle_id}`}
                      className="font-medium text-brand-700 hover:underline"
                    >
                      {d.vehicles.name}
                    </Link>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className="px-4 py-3">{warrantyCell(d, t)}</td>
                <td className="px-4 py-3">
                  <Badge tone={deviceStatus[d.status].tone}>
                    {t(deviceStatus[d.status].labelKey)}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-end">
                  {isManager && (
                    <div className="flex justify-end gap-1">
                      <button
                        className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                        onClick={() => setEditing(d)}
                        aria-label={t("slDevices.editDevice")}
                        title={t("action.edit")}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                        onClick={() => setHistoryFor(d)}
                        aria-label={t("slDevices.history")}
                        title={t("slDevices.history")}
                      >
                        <History className="h-4 w-4" />
                      </button>
                      <button
                        className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        onClick={() => setDeleting(d)}
                        aria-label={t("slDevices.deleteDevice")}
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

      <Modal title={t("slDevices.addDevice")} open={adding} onClose={() => setAdding(false)} wide>
        <DeviceForm onDone={() => setAdding(false)} />
      </Modal>

      <Modal
        title={t("slDevices.editDevice")}
        open={!!editing}
        onClose={() => setEditing(null)}
        wide
      >
        {editing && <DeviceForm device={editing} onDone={() => setEditing(null)} />}
      </Modal>

      <Modal
        title={historyFor ? t("slDevices.historyTitle", { serial: historyFor.serial }) : ""}
        open={!!historyFor}
        onClose={() => setHistoryFor(null)}
        wide
      >
        {historyFor && <DeviceHistory device={historyFor} />}
      </Modal>

      <Modal title={t("slDevices.deleteDevice")} open={!!deleting} onClose={() => setDeleting(null)}>
        {deleting && (
          <>
            <p className="text-sm text-slate-600">
              {t("slDevices.deleteConfirm", { serial: deleting.serial })}
            </p>
            {deleting.status === "installed" && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                {t("slDevices.deleteInstalledWarning")}
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeleting(null)}>
                {t("action.cancel")}
              </Button>
              <Button
                variant="danger"
                onClick={() => remove.mutate(deleting.id)}
                loading={remove.isPending}
              >
                {t("slDevices.deleteDevice")}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
