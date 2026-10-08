import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { insertRow, updateRow, wrapDbError } from "../../lib/db";
import { displayToKm, formatDateTime, kmToDisplay } from "../../lib/format";
import { useCustomerPicker, useDriverPicker, useVehiclePicker } from "../../lib/pickers";
import { useTenant } from "../../context/AuthContext";
import { useT, useTp } from "../../i18n";
import { Bdi, Button, Field, Input, Textarea } from "../../components/ui";
import { Combobox } from "../../components/Combobox";
import { fromInput, toInput } from "./labels";
import type { Trip, TripConflict } from "./types";

interface FormState {
  vehicle_id: string;
  driver_id: string;
  customer_id: string;
  purpose: string;
  planned_start: string;
  planned_end: string;
  distance: string;
  notes: string;
}

function defaults(): FormState {
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(8, 0, 0, 0);
  const end = new Date(start);
  end.setHours(12);
  return {
    vehicle_id: "", driver_id: "", customer_id: "", purpose: "",
    planned_start: toInput(start.toISOString()), planned_end: toInput(end.toISOString()), distance: "", notes: "",
  };
}

/** Overlapping trips for the chosen vehicle, driver and window (warnings only). */
export function useConflicts(vehicleId: string, driverId: string, startIso: string | null, endIso: string | null, excludeId?: string) {
  const enabled = Boolean(vehicleId && startIso && endIso && endIso > startIso);
  return useQuery({
    queryKey: ["trip_conflicts", vehicleId, driverId, startIso, endIso, excludeId ?? null],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("trip_conflicts", {
        p_vehicle_id: vehicleId,
        p_driver_id: driverId || null,
        p_start: startIso!,
        p_end: endIso!,
        p_exclude: excludeId ?? null,
      });
      if (error) throw wrapDbError(error);
      return (data ?? []) as TripConflict[];
    },
  });
}

export function ConflictList({ conflicts }: { conflicts: TripConflict[] }) {
  const t = useT();
  const tp = useTp();
  const tenant = useTenant();
  if (conflicts.length === 0) return null;
  return (
    <div className="rounded-xl border border-warn/30 bg-warn-soft p-3 text-sm text-warn">
      <div className="flex items-center gap-2 font-medium">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        {tp("trips.conflictsTitle", conflicts.length)}
      </div>
      <ul className="mt-1.5 space-y-1 ps-6">
        {conflicts.map((c) => (
          <li key={c.trip_id}>
            <Bdi className="font-medium">{c.doc_number}</Bdi> · <Bdi>{c.purpose}</Bdi> ·{" "}
            <span className="whitespace-nowrap">{formatDateTime(c.planned_start, tenant.timezone)}</span> ·{" "}
            {t(c.vehicle_clash && c.driver_clash ? "trips.clash.both" : c.vehicle_clash ? "trips.clash.vehicle" : "trips.clash.driver")} ·{" "}
            {t(`trips.status.${c.status}`)}
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-xs opacity-80">{t("trips.conflictsHint")}</p>
    </div>
  );
}

export function TripForm({ trip, onDone, onCancel }: { trip?: Trip; onDone: (id: string) => void; onCancel: () => void }) {
  const t = useT();
  const tenant = useTenant();
  const unit = tenant.distance_unit;
  const [form, setForm] = useState<FormState>(() =>
    trip
      ? {
          vehicle_id: trip.vehicle_id,
          driver_id: trip.driver_id ?? "",
          customer_id: trip.customer_id ?? "",
          purpose: trip.purpose,
          planned_start: toInput(trip.planned_start),
          planned_end: toInput(trip.planned_end),
          distance: trip.planned_distance_km == null ? "" : String(Math.round(kmToDisplay(trip.planned_distance_km, unit) * 10) / 10),
          notes: trip.notes ?? "",
        }
      : defaults(),
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const vehiclePicker = useVehiclePicker(form.vehicle_id);
  const driverPicker = useDriverPicker(form.driver_id, { activeOnly: true });
  const customerPicker = useCustomerPicker(form.customer_id, { activeOnly: true });
  const startIso = fromInput(form.planned_start);
  const endIso = fromInput(form.planned_end);
  const conflictsQ = useConflicts(form.vehicle_id, form.driver_id, startIso, endIso, trip?.id);
  const badWindow = Boolean(startIso && endIso && endIso <= startIso);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (badWindow) return;
    setError("");
    setSaving(true);
    const row = {
      vehicle_id: form.vehicle_id,
      driver_id: form.driver_id || null,
      customer_id: form.customer_id || null,
      purpose: form.purpose.trim(),
      planned_start: startIso!,
      planned_end: endIso!,
      planned_distance_km: form.distance.trim() === "" ? null : Math.round(displayToKm(Number(form.distance), unit) * 10) / 10,
      notes: form.notes.trim() || null,
    };
    try {
      if (trip) {
        await updateRow("trips", trip.id, row);
        onDone(trip.id);
      } else {
        const created = await insertRow<{ id: string }>("trips", row);
        onDone(created.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setSaving(false);
    }
  }

  const locked = trip && trip.status === "in_progress";

  return (
    <form className="space-y-3" onSubmit={submit}>
      <Field label={t("trips.f.purpose")} required>
        <Input value={form.purpose} onChange={(e) => set("purpose", e.target.value)} required maxLength={200} placeholder={t("trips.f.purposePlaceholder")} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("trips.f.vehicle")} required>
          <Combobox
            {...vehiclePicker}
            value={form.vehicle_id}
            onChange={(v) => set("vehicle_id", v)}
            required
            clearable={false}
            disabled={locked}
            placeholder={t("trips.f.selectVehicle")}
          />
        </Field>
        <Field label={t("trips.f.driver")}>
          <Combobox {...driverPicker} value={form.driver_id} onChange={(v) => set("driver_id", v)} placeholder={t("trips.f.noDriver")} />
        </Field>
        <Field label={t("trips.f.start")} required>
          <Input type="datetime-local" value={form.planned_start} onChange={(e) => set("planned_start", e.target.value)} required />
        </Field>
        <Field label={t("trips.f.end")} required error={badWindow ? t("trips.endBeforeStart") : undefined}>
          <Input type="datetime-local" value={form.planned_end} onChange={(e) => set("planned_end", e.target.value)} required />
        </Field>
        <Field label={`${t("trips.f.distance")} (${unit})`} hint={t("trips.f.distanceHint")}>
          <Input type="number" min={0} step="0.1" value={form.distance} onChange={(e) => set("distance", e.target.value)} />
        </Field>
        <Field label={t("trips.f.customer")}>
          <Combobox {...customerPicker} value={form.customer_id} onChange={(v) => set("customer_id", v)} placeholder={t("trips.f.noCustomer")} />
        </Field>
      </div>
      <Field label={t("trips.f.notes")}>
        <Textarea rows={2} maxLength={4000} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
      </Field>
      <ConflictList conflicts={conflictsQ.data ?? []} />
      {error && <p className="text-sm text-serious">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>{t("action.cancel")}</Button>
        <Button type="submit" loading={saving} disabled={badWindow || !form.vehicle_id}>
          {trip ? t("action.save") : t("trips.new")}
        </Button>
      </div>
    </form>
  );
}
