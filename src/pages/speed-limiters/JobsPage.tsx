import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Pencil, Plus, Wrench } from "lucide-react";
import { insertRow, listPage, listRows, updateRow } from "../../lib/db";
import { formatDate } from "../../lib/format";
import type {
  SlChecklistItem,
  Customer,
  SlDevice,
  SlJob,
  SlJobStatus,
  SlJobType,
  SlTechnician,
  Vehicle,
} from "../../lib/types";
import { useAuth } from "../../context/AuthContext";
import { useT, type MessageKey } from "../../i18n";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  Modal,
  PageHeader,
  Pagination,
  Select,
  Textarea,
  type BadgeTone,
} from "../../components/ui";
import { DataTable, type DataTableColumn } from "../../components/DataTable";

type JobRow = SlJob & {
  vehicles: Pick<Vehicle, "name"> | null;
  customers: { name: string } | null;
  sl_technicians: { name: string } | null;
};

const PAGE_SIZE = 25;

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

// Labels are stored data (kept English in the DB); the UI translates matching
// checklist ids via slJobs.checklist.* keys.
const DEFAULT_CHECKLIST: SlChecklistItem[] = [
  { id: "mounting", label: "Mounting & wiring secure", done: false },
  { id: "calibration", label: "Set speed calibrated", done: false },
  { id: "seal", label: "Tamper seal applied", done: false },
  { id: "function_test", label: "Function/road test passed", done: false },
  { id: "cabin_sticker", label: "Cabin sticker applied", done: false },
  { id: "docs", label: "Photos & documents captured", done: false },
];

function NewJobForm({
  customers,
  vehicles,
  devices,
  technicians,
  loadError,
  vehiclesLoading,
  onDone,
}: {
  customers: Customer[];
  vehicles: Vehicle[];
  devices: SlDevice[];
  technicians: SlTechnician[];
  loadError: Error | null;
  vehiclesLoading: boolean;
  onDone: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    job_type: "installation" as SlJobType,
    customer_id: "",
    vehicle_id: "",
    device_id: "",
    technician_id: "",
    scheduled_date: "",
    set_speed_kmh: "100",
    location: "",
    notes: "",
  });
  const [error, setError] = useState("");

  const isInstallLike = form.job_type === "installation" || form.job_type === "replacement";
  const vehicleOptions = form.customer_id
    ? vehicles.filter((v) => v.customer_id === form.customer_id || v.customer_id === null)
    : vehicles;
  const deviceOptions = isInstallLike ? devices.filter((d) => d.status === "in_stock") : devices;
  const activeTechnicians = technicians.filter((tech) => tech.active);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function onTypeChange(value: string) {
    const type = value as SlJobType;
    const installLike = type === "installation" || type === "replacement";
    setForm((f) => ({
      ...f,
      job_type: type,
      set_speed_kmh:
        type === "installation" && f.set_speed_kmh === "" ? "100" : f.set_speed_kmh,
      device_id:
        installLike &&
        f.device_id &&
        !devices.some((d) => d.id === f.device_id && d.status === "in_stock")
          ? ""
          : f.device_id,
    }));
  }

  function onCustomerChange(value: string) {
    setForm((f) => {
      const keepVehicle =
        !value ||
        vehicles.some(
          (v) => v.id === f.vehicle_id && (v.customer_id === value || v.customer_id === null),
        );
      return { ...f, customer_id: value, vehicle_id: keepVehicle ? f.vehicle_id : "" };
    });
  }

  const mutation = useMutation({
    // Never send number/tenant_id — the DB assigns both.
    mutationFn: () =>
      insertRow<SlJob>("sl_jobs", {
        job_type: form.job_type,
        customer_id: form.customer_id || null,
        vehicle_id: form.vehicle_id,
        device_id: form.device_id || null,
        technician_id: form.technician_id || null,
        status: "scheduled",
        scheduled_date: form.scheduled_date || null,
        set_speed_kmh: form.set_speed_kmh === "" ? null : Number(form.set_speed_kmh),
        location: form.location.trim() || null,
        notes: form.notes.trim() || null,
        checklist: DEFAULT_CHECKLIST.map((item) => ({ ...item })),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["sl_jobs"] });
      onDone();
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("slJobs.saveFailed")),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    mutation.mutate();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {loadError && <ErrorState message={loadError.message} />}
      {error && <ErrorState message={error} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("slJobs.jobType")} required>
          <Select value={form.job_type} onChange={(e) => onTypeChange(e.target.value)} required>
            {Object.entries(jobTypeKeys).map(([value, labelKey]) => (
              <option key={value} value={value}>{t(labelKey)}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("slJobs.customer")}>
          <Select value={form.customer_id} onChange={(e) => onCustomerChange(e.target.value)}>
            <option value="">{t("slJobs.noCustomer")}</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </Field>
        <Field
          label={t("field.vehicle")}
          required
          hint={form.customer_id ? t("slJobs.vehicleFilterHint") : undefined}
        >
          <Select value={form.vehicle_id} onChange={(e) => set("vehicle_id", e.target.value)} required>
            <option value="">{t("slJobs.selectVehicle")}</option>
            {vehicleOptions.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </Select>
        </Field>
        <Field
          label={t("slJobs.device")}
          hint={isInstallLike ? t("slJobs.deviceInStockHint") : undefined}
        >
          <Select value={form.device_id} onChange={(e) => set("device_id", e.target.value)}>
            <option value="">{t("slJobs.noDevice")}</option>
            {deviceOptions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.serial}{d.model ? ` · ${d.model}` : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("slJobs.technician")}>
          <Select value={form.technician_id} onChange={(e) => set("technician_id", e.target.value)}>
            <option value="">{t("slJobs.unassigned")}</option>
            {activeTechnicians.map((tech) => (
              <option key={tech.id} value={tech.id}>{tech.name}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("slJobs.scheduledDate")}>
          <Input
            type="date"
            value={form.scheduled_date}
            onChange={(e) => set("scheduled_date", e.target.value)}
          />
        </Field>
        <Field label={t("slJobs.setSpeedKmh")}>
          <Input
            type="number"
            min={0}
            step="1"
            value={form.set_speed_kmh}
            onChange={(e) => set("set_speed_kmh", e.target.value)}
          />
        </Field>
        <Field label={t("slJobs.location")}>
          <Input value={form.location} onChange={(e) => set("location", e.target.value)} />
        </Field>
      </div>
      <Field label={t("field.notes")}>
        <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>{t("action.cancel")}</Button>
        <Button type="submit" loading={mutation.isPending} disabled={vehiclesLoading}>
          {t("slJobs.createJob")}
        </Button>
      </div>
    </form>
  );
}

function TechniciansManager({
  technicians,
  isLoading,
  loadError,
}: {
  technicians: SlTechnician[];
  isLoading: boolean;
  loadError: Error | null;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<SlTechnician | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", email: "", active: true });
  const [error, setError] = useState("");

  function openAdd() {
    setEditing(null);
    setForm({ name: "", phone: "", email: "", active: true });
    setFormOpen(true);
  }

  function openEdit(tech: SlTechnician) {
    setEditing(tech);
    setForm({
      name: tech.name,
      phone: tech.phone ?? "",
      email: tech.email ?? "",
      active: tech.active,
    });
    setFormOpen(true);
  }

  const save = useMutation({
    mutationFn: () => {
      const values = {
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        active: form.active,
      };
      return editing
        ? updateRow<SlTechnician>("sl_technicians", editing.id, values)
        : insertRow<SlTechnician>("sl_technicians", values);
    },
    onSuccess: () => {
      setError("");
      void qc.invalidateQueries({ queryKey: ["sl_technicians"] });
      setFormOpen(false);
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("slJobs.saveFailed")),
  });

  const toggleActive = useMutation({
    mutationFn: (tech: SlTechnician) =>
      updateRow<SlTechnician>("sl_technicians", tech.id, { active: !tech.active }),
    onSuccess: () => {
      setError("");
      void qc.invalidateQueries({ queryKey: ["sl_technicians"] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("slJobs.saveFailed")),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    save.mutate();
  }

  if (formOpen) {
    return (
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <ErrorState message={error} />}
        <Field label={t("field.name")} required>
          <Input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            required
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("field.phone")}>
            <Input
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            />
          </Field>
          <Field label={t("field.email")}>
            <Input
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300"
            checked={form.active}
            onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
          />
          {t("slJobs.active")}
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setFormOpen(false)}>
            {t("action.cancel")}
          </Button>
          <Button type="submit" loading={save.isPending}>
            {editing ? t("action.saveChanges") : t("slJobs.addTechnician")}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="space-y-4">
      {error && <ErrorState message={error} />}
      {isLoading ? (
        <LoadingState />
      ) : loadError ? (
        <ErrorState message={loadError.message} />
      ) : technicians.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-500">{t("slJobs.noTechniciansYet")}</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {technicians.map((tech) => (
            <li key={tech.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-slate-800">{tech.name}</span>
                  <Badge tone={tech.active ? "green" : "slate"}>
                    {tech.active ? t("slJobs.active") : t("slJobs.inactive")}
                  </Badge>
                </div>
                {(tech.phone || tech.email) && (
                  <div className="truncate text-xs text-slate-500">
                    {[tech.phone, tech.email].filter(Boolean).join(" · ")}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  onClick={() => openEdit(tech)}
                  aria-label={t("slJobs.editTechnician")}
                  title={t("action.edit")}
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <Button
                  variant="ghost"
                  className="px-2 py-1 text-xs"
                  disabled={toggleActive.isPending}
                  onClick={() => toggleActive.mutate(tech)}
                >
                  {tech.active ? t("slJobs.deactivate") : t("slJobs.reactivate")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="flex justify-end">
        <Button onClick={openAdd}>
          <Plus className="h-4 w-4" /> {t("slJobs.addTechnician")}
        </Button>
      </div>
    </div>
  );
}

export default function JobsPage() {
  const t = useT();
  const navigate = useNavigate();
  const { isManager } = useAuth();
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [technicianFilter, setTechnicianFilter] = useState("all");
  const [customerFilter, setCustomerFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [creating, setCreating] = useState(false);
  const [managingTechnicians, setManagingTechnicians] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["sl_jobs", "list", page, typeFilter, statusFilter, technicianFilter, customerFilter],
    queryFn: () =>
      listPage<JobRow>("sl_jobs", page, PAGE_SIZE, (q) => {
        let query = q
          .select("*, vehicles(name), customers(name), sl_technicians(name)")
          .order("created_at", { ascending: false });
        if (typeFilter !== "all") query = query.eq("job_type", typeFilter);
        if (statusFilter !== "all") query = query.eq("status", statusFilter);
        if (technicianFilter !== "all") query = query.eq("technician_id", technicianFilter);
        if (customerFilter !== "all") query = query.eq("customer_id", customerFilter);
        return query;
      }),
  });
  const jobs = data?.rows ?? [];
  const total = data?.total ?? 0;

  const {
    data: technicians,
    isLoading: techniciansLoading,
    error: techniciansError,
  } = useQuery({
    queryKey: ["sl_technicians"],
    queryFn: () => listRows<SlTechnician>("sl_technicians", (q) => q.order("name")),
  });

  const { data: customers, error: customersError } = useQuery({
    queryKey: ["customers"],
    queryFn: () => listRows<Customer>("customers", (q) => q.order("name")),
  });

  const {
    data: vehicles,
    isLoading: vehiclesLoading,
    error: vehiclesError,
  } = useQuery({
    queryKey: ["vehicles"],
    queryFn: () => listRows<Vehicle>("vehicles", (q) => q.order("name")),
  });

  const { data: devices, error: devicesError } = useQuery({
    queryKey: ["sl_devices", "picker"],
    queryFn: () => listRows<SlDevice>("sl_devices", (q) => q.order("serial")),
  });

  const hasFilters =
    typeFilter !== "all" ||
    statusFilter !== "all" ||
    technicianFilter !== "all" ||
    customerFilter !== "all";

  function setFilter(setter: (value: string) => void, value: string) {
    setter(value);
    setPage(0);
  }

  const columns: Array<DataTableColumn<JobRow>> = [
    {
      id: "number",
      header: t("slJobs.number"),
      cell: (j) => (
        <Link
          to={`/speed-limiters/jobs/${j.id}`}
          className="font-medium text-brand-700 hover:underline"
        >
          #{j.number}
        </Link>
      ),
      sortValue: (j) => j.number,
      exportValue: (j) => j.number,
    },
    {
      id: "customer",
      header: t("slJobs.customer"),
      cell: (j) => <span className="text-slate-600">{j.customers?.name ?? "—"}</span>,
      sortValue: (j) => j.customers?.name ?? null,
      minBreakpoint: "md",
    },
    {
      id: "vehicle",
      header: t("field.vehicle"),
      cell: (j) => <span className="text-slate-600">{j.vehicles?.name ?? "—"}</span>,
      sortValue: (j) => j.vehicles?.name ?? null,
    },
    {
      id: "type",
      header: t("slJobs.type"),
      cell: (j) => <span className="text-slate-600">{t(jobTypeKeys[j.job_type])}</span>,
      sortValue: (j) => t(jobTypeKeys[j.job_type]),
      minBreakpoint: "md",
    },
    {
      id: "technician",
      header: t("slJobs.technician"),
      cell: (j) => <span className="text-slate-600">{j.sl_technicians?.name ?? "—"}</span>,
      sortValue: (j) => j.sl_technicians?.name ?? null,
      minBreakpoint: "lg",
      defaultHidden: true,
    },
    {
      id: "scheduled",
      header: t("slJobs.scheduled"),
      cell: (j) => <span className="text-slate-600">{formatDate(j.scheduled_date)}</span>,
      sortValue: (j) => j.scheduled_date,
      minBreakpoint: "lg",
    },
    {
      id: "status",
      header: t("common.status"),
      cell: (j) => (
        <Badge tone={jobStatusMeta[j.status].tone}>{t(jobStatusMeta[j.status].labelKey)}</Badge>
      ),
      sortValue: (j) => t(jobStatusMeta[j.status].labelKey),
    },
  ];

  return (
    <>
      <PageHeader
        title={t("slJobs.title")}
        description={t("slJobs.description")}
        actions={
          isManager && (
            <>
              <Button variant="secondary" onClick={() => setManagingTechnicians(true)}>
                <Wrench className="h-4 w-4" /> {t("slJobs.technicians")}
              </Button>
              <Button onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" /> {t("slJobs.newJob")}
              </Button>
            </>
          )
        }
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <Select
          value={typeFilter}
          onChange={(e) => setFilter(setTypeFilter, e.target.value)}
          className="max-w-44"
        >
          <option value="all">{t("slJobs.allTypes")}</option>
          {Object.entries(jobTypeKeys).map(([value, labelKey]) => (
            <option key={value} value={value}>{t(labelKey)}</option>
          ))}
        </Select>
        <Select
          value={statusFilter}
          onChange={(e) => setFilter(setStatusFilter, e.target.value)}
          className="max-w-44"
        >
          <option value="all">{t("slJobs.allStatuses")}</option>
          {Object.entries(jobStatusMeta).map(([value, meta]) => (
            <option key={value} value={value}>{t(meta.labelKey)}</option>
          ))}
        </Select>
        <Select
          value={technicianFilter}
          onChange={(e) => setFilter(setTechnicianFilter, e.target.value)}
          className="max-w-44"
        >
          <option value="all">{t("slJobs.allTechnicians")}</option>
          {technicians?.map((tech) => (
            <option key={tech.id} value={tech.id}>{tech.name}</option>
          ))}
        </Select>
        <Select
          value={customerFilter}
          onChange={(e) => setFilter(setCustomerFilter, e.target.value)}
          className="max-w-44"
        >
          <option value="all">{t("slJobs.allCustomers")}</option>
          {customers?.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </Select>
      </div>

      {isLoading && <LoadingState />}
      {error && <ErrorState message={(error as Error).message} />}

      {!isLoading && !error && (
        <DataTable<JobRow>
          tableId="sl_jobs"
          exportName="sl_jobs"
          columns={columns}
          rows={jobs}
          rowKey={(j) => j.id}
          onRowClick={(j) => navigate(`/speed-limiters/jobs/${j.id}`)}
          empty={
            <EmptyState
              icon={<ClipboardList className="h-10 w-10" />}
              title={
                hasFilters || total > 0 ? t("slJobs.emptyFilteredTitle") : t("slJobs.emptyTitle")
              }
              description={
                hasFilters || total > 0 ? t("slJobs.emptyFilteredDesc") : t("slJobs.emptyDesc")
              }
              action={
                isManager && !hasFilters && total === 0 ? (
                  <Button onClick={() => setCreating(true)}>
                    <Plus className="h-4 w-4" /> {t("slJobs.newJob")}
                  </Button>
                ) : undefined
              }
            />
          }
          footer={<Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />}
        />
      )}

      <Modal title={t("slJobs.newJob")} open={creating} onClose={() => setCreating(false)} wide>
        <NewJobForm
          customers={customers ?? []}
          vehicles={vehicles ?? []}
          devices={devices ?? []}
          technicians={technicians ?? []}
          loadError={customersError ?? vehiclesError ?? devicesError ?? techniciansError ?? null}
          vehiclesLoading={vehiclesLoading}
          onDone={() => setCreating(false)}
        />
      </Modal>

      <Modal
        title={t("slJobs.technicians")}
        open={managingTechnicians}
        onClose={() => setManagingTechnicians(false)}
        wide
      >
        <TechniciansManager
          technicians={technicians ?? []}
          isLoading={techniciansLoading}
          loadError={techniciansError ?? null}
        />
      </Modal>
    </>
  );
}
