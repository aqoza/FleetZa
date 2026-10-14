import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { insertRow, updateRow, wrapDbError } from "../../lib/db";
import { formatDateTime } from "../../lib/format";
import { useCustomerPicker, useDriverPicker, useEntityPicker } from "../../lib/pickers";
import { JOB_PRIORITIES, JOB_TYPES, type JobPriority, type JobType } from "../../../shared/dispatch";
import type { Vehicle } from "../../lib/types";
import { useTenant } from "../../context/AuthContext";
import { useT } from "../../i18n";
import { Button, Field, Input, Select, Textarea } from "../../components/ui";
import { Combobox } from "../../components/Combobox";
import { useToast } from "../../components/Toast";
import { fromInput, toInput } from "./labels";
import type { BusyRow, DispatchJob } from "./types";

interface FormState {
  title: string;
  job_type: JobType;
  priority: JobPriority;
  customer_id: string;
  contact_name: string;
  contact_phone: string;
  window_start: string;
  window_end: string;
  pickup_address: string;
  dropoff_address: string;
  notes: string;
}

function defaults(): FormState {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  const end = new Date(start.getTime() + 3 * 3_600_000);
  return {
    title: "", job_type: "delivery", priority: "normal", customer_id: "", contact_name: "", contact_phone: "",
    window_start: toInput(start.toISOString()), window_end: toInput(end.toISOString()), pickup_address: "", dropoff_address: "", notes: "",
  };
}

export function JobForm({ job, onDone, onCancel }: { job?: DispatchJob; onDone: (id: string) => void; onCancel: () => void }) {
  const t = useT();
  const [form, setForm] = useState<FormState>(() =>
    job
      ? {
          title: job.title, job_type: job.job_type, priority: job.priority, customer_id: job.customer_id ?? "",
          contact_name: job.contact_name ?? "", contact_phone: job.contact_phone ?? "",
          window_start: toInput(job.window_start), window_end: toInput(job.window_end),
          pickup_address: job.pickup_address ?? "", dropoff_address: job.dropoff_address ?? "", notes: job.notes ?? "",
        }
      : defaults(),
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const customerPicker = useCustomerPicker(form.customer_id, { activeOnly: true });
  const startIso = fromInput(form.window_start);
  const endIso = fromInput(form.window_end);
  const badWindow = Boolean(startIso && endIso && endIso <= startIso);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (badWindow) return;
    setSaving(true);
    setError("");
    const row = {
      title: form.title.trim(),
      job_type: form.job_type,
      priority: form.priority,
      customer_id: form.customer_id || null,
      contact_name: form.contact_name.trim() || null,
      contact_phone: form.contact_phone.trim() || null,
      window_start: startIso!,
      window_end: endIso!,
      pickup_address: form.pickup_address.trim() || null,
      dropoff_address: form.dropoff_address.trim() || null,
      notes: form.notes.trim() || null,
    };
    try {
      if (job) {
        await updateRow("dispatch_jobs", job.id, row);
        onDone(job.id);
      } else {
        const created = await insertRow<{ id: string }>("dispatch_jobs", row);
        onDone(created.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="space-y-3" onSubmit={submit}>
      <Field label={t("dispatch.f.title")} required>
        <Input value={form.title} onChange={(e) => set("title", e.target.value)} required maxLength={200} placeholder={t("dispatch.f.titlePlaceholder")} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("dispatch.f.type")}>
          <Select value={form.job_type} onChange={(e) => set("job_type", e.target.value as JobType)}>
            {JOB_TYPES.map((v) => <option key={v} value={v}>{t(`dispatch.type.${v}`)}</option>)}
          </Select>
        </Field>
        <Field label={t("dispatch.f.priority")}>
          <Select value={form.priority} onChange={(e) => set("priority", e.target.value as JobPriority)}>
            {JOB_PRIORITIES.map((v) => <option key={v} value={v}>{t(`dispatch.priority.${v}`)}</option>)}
          </Select>
        </Field>
        <Field label={t("dispatch.f.windowStart")} required>
          <Input type="datetime-local" value={form.window_start} onChange={(e) => set("window_start", e.target.value)} required />
        </Field>
        <Field label={t("dispatch.f.windowEnd")} required error={badWindow ? t("dispatch.endBeforeStart") : undefined}>
          <Input type="datetime-local" value={form.window_end} onChange={(e) => set("window_end", e.target.value)} required />
        </Field>
        <Field label={t("dispatch.f.customer")}>
          <Combobox {...customerPicker} value={form.customer_id} onChange={(v) => set("customer_id", v)} placeholder={t("dispatch.f.noCustomer")} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("dispatch.f.contactName")}>
            <Input value={form.contact_name} onChange={(e) => set("contact_name", e.target.value)} maxLength={120} />
          </Field>
          <Field label={t("dispatch.f.contactPhone")}>
            <Input dir="ltr" type="tel" value={form.contact_phone} onChange={(e) => set("contact_phone", e.target.value)} maxLength={40} />
          </Field>
        </div>
      </div>
      <Field label={t("dispatch.f.pickup")}>
        <Input value={form.pickup_address} onChange={(e) => set("pickup_address", e.target.value)} maxLength={500} />
      </Field>
      <Field label={t("dispatch.f.dropoff")}>
        <Input value={form.dropoff_address} onChange={(e) => set("dropoff_address", e.target.value)} maxLength={500} />
      </Field>
      <Field label={t("dispatch.f.notes")}>
        <Textarea rows={2} maxLength={4000} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
      </Field>
      {error && <p className="text-sm text-serious">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>{t("action.cancel")}</Button>
        <Button type="submit" loading={saving} disabled={badWindow}>{job ? t("action.save") : t("dispatch.new")}</Button>
      </div>
    </form>
  );
}

/** Assign or reassign a job. Busy vehicles and drivers are marked in the lists; the server has the last word. */
export function AssignForm({ job, onDone, onCancel }: { job: DispatchJob; onDone: () => void; onCancel: () => void }) {
  const t = useT();
  const tenant = useTenant();
  const qc = useQueryClient();
  const toast = useToast();
  const [vehicleId, setVehicleId] = useState(job.vehicle_id ?? "");
  const [driverId, setDriverId] = useState(job.driver_id ?? "");
  const [error, setError] = useState("");

  const busyQ = useQuery({
    queryKey: ["dispatch_busy", job.id, job.window_start, job.window_end],
    queryFn: async () => {
      const { data, error: e } = await supabase.rpc("dispatch_busy", { p_start: job.window_start, p_end: job.window_end, p_exclude: job.id });
      if (e) throw wrapDbError(e);
      return (data ?? []) as BusyRow[];
    },
  });
  const busy = (kind: BusyRow["kind"], id: string) => busyQ.data?.find((b) => b.kind === kind && b.resource_id === id);
  const busyMeta = (kind: BusyRow["kind"], id: string) => {
    const b = busy(kind, id);
    return b ? t("dispatch.busyWith", { number: b.doc_number ?? "" }) : undefined;
  };

  const vehicles = useEntityPicker<Vehicle>({
    table: "vehicles",
    selectedId: vehicleId,
    searchColumns: ["name", "license_plate", "fleet_number"],
    orderBy: "name",
    toOption: (v) => ({ value: v.id, label: v.name, meta: busyMeta("vehicle", v.id) ?? v.license_plate ?? undefined }),
    filter: (q) => q.eq("status", "active"),
    scope: ["dispatch-vehicles", busyQ.dataUpdatedAt],
  });
  const driversBase = useDriverPicker(driverId, { activeOnly: true });
  const drivers = {
    ...driversBase,
    options: driversBase.options.map((o) => ({ ...o, meta: busyMeta("driver", o.value) ?? o.meta })),
  };

  const assign = useMutation({
    mutationFn: async () => {
      const { error: e } = await supabase.rpc("dispatch_assign", { p_job_id: job.id, p_vehicle_id: vehicleId, p_driver_id: driverId || null });
      if (e) throw wrapDbError(e);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["dispatch_jobs"] });
      toast.success(t("dispatch.assigned"));
      onDone();
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("common.error")),
  });

  const vehicleBusy = vehicleId ? busy("vehicle", vehicleId) : undefined;
  const driverBusy = driverId ? busy("driver", driverId) : undefined;

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        assign.mutate();
      }}
    >
      <p className="text-sm text-ink-2">
        {formatDateTime(job.window_start, tenant.timezone)} – {formatDateTime(job.window_end, tenant.timezone)}
      </p>
      <Field label={t("dispatch.assignVehicle")} required error={vehicleBusy ? t("dispatch.busyWith", { number: vehicleBusy.doc_number ?? "" }) : undefined}>
        <Combobox {...vehicles} value={vehicleId} onChange={setVehicleId} required clearable={false} placeholder={t("dispatch.selectVehicle")} />
      </Field>
      <Field label={t("dispatch.assignDriver")} error={driverBusy ? t("dispatch.busyWith", { number: driverBusy.doc_number ?? "" }) : undefined}>
        <Combobox {...drivers} value={driverId} onChange={setDriverId} placeholder={t("dispatch.noDriver")} />
      </Field>
      <p className="text-xs text-ink-3">{t("dispatch.assignHint")}</p>
      {error && <p className="text-sm text-serious">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>{t("action.cancel")}</Button>
        <Button type="submit" loading={assign.isPending} disabled={!vehicleId || Boolean(vehicleBusy) || Boolean(driverBusy)}>
          {job.status === "assigned" ? t("dispatch.reassign") : t("dispatch.assign")}
        </Button>
      </div>
    </form>
  );
}
