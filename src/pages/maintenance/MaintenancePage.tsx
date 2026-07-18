import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addMonths, format } from "date-fns";
import { BellRing, CheckCircle2, Pencil, Plus, Trash2, Wrench } from "lucide-react";
import { getCountry, taxBreakdown } from "../../../shared/countries";
import { deleteRow, insertRow, listPage, listRows, updateRow } from "../../lib/db";
import {
  daysUntil, displayToKm, formatDate, formatDistance, formatMoney, kmToDisplay,
} from "../../lib/format";
import { priority, workOrderStatus } from "../../lib/labels";
import type { ServiceReminder, Vehicle, WorkOrder } from "../../lib/types";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useModules } from "../../context/ModulesContext";
import {
  Badge, Button, EmptyState, ErrorState, Field, Input, LoadingState, Modal, PageHeader, Pagination, Select, Table, Textarea,
} from "../../components/ui";
import type { BadgeTone } from "../../components/ui";
import { useT, type MessageKey } from "../../i18n";

const PAGE_SIZE = 25;

// --- Service reminders ---

type ReminderRow = ServiceReminder & { vehicles: { name: string; odometer: number } };

type ReminderStatusKey = "overdue" | "due_soon" | "ok" | "inactive";

const reminderStatus: Record<ReminderStatusKey, { labelKey: MessageKey; tone: BadgeTone }> = {
  overdue: { labelKey: "maintenance.reminderStatus.overdue", tone: "red" },
  due_soon: { labelKey: "maintenance.reminderStatus.dueSoon", tone: "yellow" },
  ok: { labelKey: "maintenance.reminderStatus.ok", tone: "green" },
  inactive: { labelKey: "maintenance.reminderStatus.inactive", tone: "slate" },
};

function reminderState(r: ReminderRow): ReminderStatusKey {
  if (!r.active) return "inactive";
  const dueInDays = r.due_date ? daysUntil(r.due_date) : null;
  const kmLeft = r.due_km != null ? r.due_km - r.vehicles.odometer : null;
  if ((dueInDays !== null && dueInDays < 0) || (kmLeft !== null && kmLeft <= 0)) return "overdue";
  if ((dueInDays !== null && dueInDays <= 14) || (kmLeft !== null && kmLeft <= 500)) return "due_soon";
  return "ok";
}

function ReminderForm({ reminder, onDone }: { reminder?: ServiceReminder; onDone: () => void }) {
  const t = useT();
  const tenant = useTenant();
  const qc = useQueryClient();
  const unit = tenant.distance_unit;

  const { data: vehicles } = useQuery({
    queryKey: ["vehicles"],
    queryFn: () => listRows<Vehicle>("vehicles", (q) => q.order("name")),
  });

  const [form, setForm] = useState({
    vehicle_id: reminder?.vehicle_id ?? "",
    task: reminder?.task ?? "",
    notes: reminder?.notes ?? "",
    interval_months: reminder?.interval_months != null ? String(reminder.interval_months) : "",
    interval_distance:
      reminder?.interval_km != null
        ? String(Math.round(kmToDisplay(reminder.interval_km, unit)))
        : "",
    due_date: reminder?.due_date ?? "",
    due_distance:
      reminder?.due_km != null ? String(Math.round(kmToDisplay(reminder.due_km, unit))) : "",
  });
  const [error, setError] = useState("");

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const mutation = useMutation({
    mutationFn: () => {
      const values = {
        vehicle_id: form.vehicle_id,
        task: form.task.trim(),
        notes: form.notes.trim() || null,
        interval_months: form.interval_months ? Number(form.interval_months) : null,
        interval_km: form.interval_distance
          ? Math.round(displayToKm(Number(form.interval_distance), unit))
          : null,
        due_date: form.due_date || null,
        due_km: form.due_distance
          ? Math.round(displayToKm(Number(form.due_distance), unit))
          : null,
      };
      return reminder
        ? updateRow<ServiceReminder>("service_reminders", reminder.id, values)
        : insertRow<ServiceReminder>("service_reminders", values);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["service_reminders"] });
      onDone();
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("maintenance.saveFailed")),
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
            <option value="">{t("maintenance.selectVehicle")}</option>
            {vehicles?.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("maintenance.task")} required>
          <Input
            value={form.task}
            onChange={(e) => set("task", e.target.value)}
            placeholder={t("maintenance.taskPlaceholder")}
            required
          />
        </Field>
        <Field label={t("maintenance.intervalMonths")} hint={t("maintenance.intervalMonthsHint")}>
          <Input
            type="number"
            min={1}
            value={form.interval_months}
            onChange={(e) => set("interval_months", e.target.value)}
          />
        </Field>
        <Field
          label={t("maintenance.intervalDistance", { unit })}
          hint={t("maintenance.intervalDistanceHint", { unit })}
        >
          <Input
            type="number"
            min={1}
            value={form.interval_distance}
            onChange={(e) => set("interval_distance", e.target.value)}
          />
        </Field>
        <Field label={t("field.dueDate")}>
          <Input type="date" value={form.due_date} onChange={(e) => set("due_date", e.target.value)} />
        </Field>
        <Field label={t("maintenance.dueOdometer", { unit })}>
          <Input
            type="number"
            min={0}
            value={form.due_distance}
            onChange={(e) => set("due_distance", e.target.value)}
          />
        </Field>
      </div>
      <Field label={t("field.notes")}>
        <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>{t("action.cancel")}</Button>
        <Button type="submit" loading={mutation.isPending}>
          {reminder ? t("action.saveChanges") : t("maintenance.addReminder")}
        </Button>
      </div>
    </form>
  );
}

function RemindersTab({
  adding,
  setAdding,
}: {
  adding: boolean;
  setAdding: (open: boolean) => void;
}) {
  const t = useT();
  const tenant = useTenant();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const [filter, setFilter] = useState("all");
  const [editing, setEditing] = useState<ReminderRow | null>(null);
  const [deleting, setDeleting] = useState<ReminderRow | null>(null);
  const [actionError, setActionError] = useState("");

  const { data: reminders, isLoading, error } = useQuery({
    queryKey: ["service_reminders"],
    queryFn: () =>
      listRows<ReminderRow>("service_reminders", (q) =>
        q.select("*, vehicles(name, odometer)").order("created_at"),
      ),
  });

  const markDone = useMutation({
    mutationFn: (r: ReminderRow) => {
      const today = format(new Date(), "yyyy-MM-dd");
      const odometer = r.vehicles.odometer;
      const values: Record<string, unknown> = {
        last_completed_at: today,
        last_completed_km: odometer,
      };
      if (r.interval_months || r.interval_km) {
        values.due_date = r.interval_months
          ? format(addMonths(new Date(), r.interval_months), "yyyy-MM-dd")
          : null;
        values.due_km = r.interval_km ? odometer + r.interval_km : null;
      } else {
        values.active = false;
      }
      return updateRow<ServiceReminder>("service_reminders", r.id, values);
    },
    onSuccess: () => {
      setActionError("");
      void qc.invalidateQueries({ queryKey: ["service_reminders"] });
    },
    onError: (err) => setActionError(err instanceof Error ? err.message : t("maintenance.updateFailed")),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteRow("service_reminders", id),
    onSuccess: () => {
      setActionError("");
      void qc.invalidateQueries({ queryKey: ["service_reminders"] });
      setDeleting(null);
    },
    onError: (err) => setActionError(err instanceof Error ? err.message : t("maintenance.deleteFailed")),
  });

  const filtered = useMemo(
    () => (reminders ?? []).filter((r) => filter === "all" || reminderState(r) === filter),
    [reminders, filter],
  );

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-3">
        <Select value={filter} onChange={(e) => setFilter(e.target.value)} className="max-w-44">
          <option value="all">{t("maintenance.allReminders")}</option>
          <option value="overdue">{t("maintenance.reminderStatus.overdue")}</option>
          <option value="due_soon">{t("maintenance.reminderStatus.dueSoon")}</option>
        </Select>
      </div>

      {isLoading && <LoadingState />}
      {error && <ErrorState message={(error as Error).message} />}
      {actionError && <div className="mb-4"><ErrorState message={actionError} /></div>}

      {!isLoading && !error && filtered.length === 0 && (
        <EmptyState
          icon={<BellRing className="h-10 w-10" />}
          title={reminders?.length ? t("maintenance.noRemindersMatch") : t("maintenance.noRemindersYet")}
          description={
            reminders?.length
              ? t("maintenance.tryDifferentFilter")
              : t("maintenance.remindersEmptyDesc")
          }
          action={
            isManager && !reminders?.length ? (
              <Button onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4" /> {t("maintenance.addReminder")}
              </Button>
            ) : undefined
          }
        />
      )}

      {!isLoading && !error && filtered.length > 0 && (
        <Table
          headers={[
            t("maintenance.task"),
            t("field.vehicle"),
            t("maintenance.due"),
            t("maintenance.lastDone"),
            t("common.status"),
            "",
          ]}
        >
          {filtered.map((r) => {
            const state = reminderState(r);
            return (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-800">{r.task}</div>
                  {r.notes && <div className="text-xs text-slate-500">{r.notes}</div>}
                </td>
                <td className="px-4 py-3 text-slate-600">{r.vehicles.name}</td>
                <td className="px-4 py-3 text-slate-600">
                  {r.due_date || r.due_km != null ? (
                    <>
                      {r.due_date && <div>{formatDate(r.due_date)}</div>}
                      {r.due_km != null && (
                        <div className={r.due_date ? "text-xs text-slate-500" : undefined}>
                          {formatDistance(r.due_km, tenant.distance_unit)}
                        </div>
                      )}
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {r.last_completed_at ? (
                    <>
                      <div>{formatDate(r.last_completed_at)}</div>
                      {r.last_completed_km != null && (
                        <div className="text-xs text-slate-500">
                          {formatDistance(r.last_completed_km, tenant.distance_unit)}
                        </div>
                      )}
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-4 py-3">
                  <Badge tone={reminderStatus[state].tone}>{t(reminderStatus[state].labelKey)}</Badge>
                </td>
                <td className="px-4 py-3 text-end">
                  {isManager && (
                    <div className="flex justify-end gap-1">
                      {r.active && (
                        <button
                          className="rounded p-1.5 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600"
                          onClick={() => markDone.mutate(r)}
                          disabled={markDone.isPending}
                          title={t("maintenance.markDone")}
                          aria-label={t("maintenance.markDoneAria", { task: r.task })}
                        >
                          <CheckCircle2 className="h-4 w-4" />
                        </button>
                      )}
                      <button
                        className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                        onClick={() => setEditing(r)}
                        aria-label={t("maintenance.editAria", { name: r.task })}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        onClick={() => setDeleting(r)}
                        aria-label={t("maintenance.deleteAria", { name: r.task })}
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

      <Modal title={t("maintenance.addReminder")} open={adding} onClose={() => setAdding(false)} wide>
        <ReminderForm onDone={() => setAdding(false)} />
      </Modal>

      <Modal title={t("maintenance.editReminder")} open={!!editing} onClose={() => setEditing(null)} wide>
        {editing && <ReminderForm reminder={editing} onDone={() => setEditing(null)} />}
      </Modal>

      <Modal title={t("maintenance.deleteReminder")} open={!!deleting} onClose={() => setDeleting(null)}>
        {deleting && (
          <>
            <p className="text-sm text-slate-600">
              {t("maintenance.deleteReminderConfirm", {
                task: deleting.task,
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
                {t("maintenance.deleteReminder")}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}

// --- Work orders ---

type WorkOrderRow = WorkOrder & {
  vehicles: { name: string };
  work_order_lines: { quantity: number; unit_cost: number }[];
};

function WorkOrderForm({ onDone }: { onDone: () => void }) {
  const t = useT();
  const tenant = useTenant();
  const qc = useQueryClient();
  const unit = tenant.distance_unit;

  const { data: vehicles } = useQuery({
    queryKey: ["vehicles"],
    queryFn: () => listRows<Vehicle>("vehicles", (q) => q.order("name")),
  });

  const [form, setForm] = useState({
    vehicle_id: "",
    title: "",
    description: "",
    priority: "normal",
    vendor: "",
    scheduled_date: "",
    odometer: "",
  });
  const [error, setError] = useState("");

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const mutation = useMutation({
    mutationFn: () =>
      insertRow<WorkOrder>("work_orders", {
        vehicle_id: form.vehicle_id,
        title: form.title.trim(),
        description: form.description.trim() || null,
        status: "open",
        priority: form.priority,
        vendor: form.vendor.trim() || null,
        scheduled_date: form.scheduled_date || null,
        odometer: form.odometer ? Math.round(displayToKm(Number(form.odometer), unit)) : null,
        tax_rate: getCountry(tenant.country).tax.rate,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["work_orders"] });
      void qc.invalidateQueries({ queryKey: ["vehicles"] });
      void qc.invalidateQueries({ queryKey: ["service_reminders"] });
      onDone();
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("maintenance.saveFailed")),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    mutation.mutate();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && <ErrorState message={error} />}
      <Field label={t("maintenance.woTitle")} required>
        <Input
          value={form.title}
          onChange={(e) => set("title", e.target.value)}
          placeholder={t("maintenance.woTitlePlaceholder")}
          required
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("field.vehicle")} required>
          <Select value={form.vehicle_id} onChange={(e) => set("vehicle_id", e.target.value)} required>
            <option value="">{t("maintenance.selectVehicle")}</option>
            {vehicles?.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("field.priority")}>
          <Select value={form.priority} onChange={(e) => set("priority", e.target.value)}>
            {Object.entries(priority).map(([v, p]) => (
              <option key={v} value={v}>{t(p.labelKey)}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("field.vendor")}>
          <Input value={form.vendor} onChange={(e) => set("vendor", e.target.value)} />
        </Field>
        <Field label={t("maintenance.scheduledDate")}>
          <Input
            type="date"
            value={form.scheduled_date}
            onChange={(e) => set("scheduled_date", e.target.value)}
          />
        </Field>
        <Field label={t("maintenance.odometerUnit", { unit })}>
          <Input
            type="number"
            min={0}
            value={form.odometer}
            onChange={(e) => set("odometer", e.target.value)}
          />
        </Field>
      </div>
      <Field label={t("maintenance.description")}>
        <Textarea value={form.description} onChange={(e) => set("description", e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>{t("action.cancel")}</Button>
        <Button type="submit" loading={mutation.isPending}>{t("maintenance.createWorkOrder")}</Button>
      </div>
    </form>
  );
}

function WorkOrdersTab({
  adding,
  setAdding,
}: {
  adding: boolean;
  setAdding: (open: boolean) => void;
}) {
  const t = useT();
  const tenant = useTenant();
  const { isManager } = useAuth();
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(0);
  const taxLabel = getCountry(tenant.country).tax.label;
  const currencyDecimals = getCountry(tenant.country).currencyDecimals;

  const { data: workOrdersPage, isLoading, error } = useQuery({
    queryKey: ["work_orders", page, status],
    queryFn: () =>
      listPage<WorkOrderRow>("work_orders", page, PAGE_SIZE, (q) => {
        // Re-select keeps listPage's count=exact Prefer; only the columns change.
        let query = q
          .select("*, vehicles(name), work_order_lines(quantity, unit_cost)")
          .order("created_at", { ascending: false });
        if (status !== "all") query = query.eq("status", status);
        return query;
      }),
  });
  const workOrders = workOrdersPage?.rows ?? [];

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-3">
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(0);
          }}
          className="max-w-44"
        >
          <option value="all">{t("maintenance.allStatuses")}</option>
          {Object.entries(workOrderStatus).map(([v, s]) => (
            <option key={v} value={v}>{t(s.labelKey)}</option>
          ))}
        </Select>
      </div>

      {isLoading && <LoadingState />}
      {error && <ErrorState message={(error as Error).message} />}

      {!isLoading && !error && workOrders.length === 0 && (
        <EmptyState
          icon={<Wrench className="h-10 w-10" />}
          title={status !== "all" ? t("maintenance.noWorkOrdersMatch") : t("maintenance.noWorkOrdersYet")}
          description={
            status !== "all"
              ? t("maintenance.tryDifferentStatusFilter")
              : t("maintenance.workOrdersEmptyDesc")
          }
          action={
            isManager && status === "all" ? (
              <Button onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4" /> {t("maintenance.newWorkOrder")}
              </Button>
            ) : undefined
          }
        />
      )}

      {!isLoading && !error && workOrders.length > 0 && (
        <>
          <Table
            headers={[
              "#",
              t("maintenance.woTitle"),
              t("field.priority"),
              t("common.status"),
              t("maintenance.scheduled"),
              t("maintenance.total"),
            ]}
          >
            {workOrders.map((w) => {
              const subtotal = w.work_order_lines.reduce(
                (sum, l) => sum + l.quantity * l.unit_cost,
                0,
              );
              const total = taxBreakdown(subtotal, w.tax_rate, currencyDecimals).total;
              return (
                <tr key={w.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-500">{w.number}</td>
                  <td className="px-4 py-3">
                    <Link
                      to={`/maintenance/work-orders/${w.id}`}
                      className="font-medium text-brand-700 hover:underline"
                    >
                      {w.title}
                    </Link>
                    <div className="text-xs text-slate-500">{w.vehicles.name}</div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={priority[w.priority].tone}>{t(priority[w.priority].labelKey)}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={workOrderStatus[w.status].tone}>
                      {t(workOrderStatus[w.status].labelKey)}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{formatDate(w.scheduled_date)}</td>
                  <td className="px-4 py-3 font-medium text-slate-800">
                    {formatMoney(total, tenant.currency)}
                    {w.tax_rate > 0 && (
                      <div className="text-xs font-normal text-slate-500">
                        {t("maintenance.inclTax", { label: taxLabel, rate: w.tax_rate })}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </Table>
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={workOrdersPage?.total ?? 0}
            onPage={setPage}
          />
        </>
      )}

      <Modal title={t("maintenance.newWorkOrder")} open={adding} onClose={() => setAdding(false)} wide>
        <WorkOrderForm onDone={() => setAdding(false)} />
      </Modal>
    </>
  );
}

// --- Page ---

type Tab = "reminders" | "work_orders";

export default function MaintenancePage() {
  const t = useT();
  const { isManager } = useAuth();
  const { isEnabled } = useModules();
  // Service reminders belong to the "preventive" module — without it the page
  // only offers work orders.
  const preventiveEnabled = isEnabled("preventive");
  const [tab, setTab] = useState<Tab>(preventiveEnabled ? "reminders" : "work_orders");
  const activeTab: Tab = preventiveEnabled ? tab : "work_orders";
  const [addingReminder, setAddingReminder] = useState(false);
  const [addingWorkOrder, setAddingWorkOrder] = useState(false);

  return (
    <>
      <PageHeader
        title={t("maintenance.title")}
        description={t("maintenance.subtitle")}
        actions={
          isManager &&
          (activeTab === "reminders" ? (
            <Button onClick={() => setAddingReminder(true)}>
              <Plus className="h-4 w-4" /> {t("maintenance.addReminder")}
            </Button>
          ) : (
            <Button onClick={() => setAddingWorkOrder(true)}>
              <Plus className="h-4 w-4" /> {t("maintenance.newWorkOrder")}
            </Button>
          ))
        }
      />

      <div className="mb-4 flex gap-2">
        {(
          [
            ["reminders", t("maintenance.tabReminders")],
            ["work_orders", t("maintenance.tabWorkOrders")],
          ] as [Tab, string][]
        )
          .filter(([value]) => value !== "reminders" || preventiveEnabled)
          .map(([value, label]) => (
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

      {activeTab === "reminders" ? (
        <RemindersTab adding={addingReminder} setAdding={setAddingReminder} />
      ) : (
        <WorkOrdersTab adding={addingWorkOrder} setAdding={setAddingWorkOrder} />
      )}
    </>
  );
}
