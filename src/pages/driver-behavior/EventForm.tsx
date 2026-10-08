import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { insertRow, updateRow } from "../../lib/db";
import { useDriverPicker, useVehiclePicker } from "../../lib/pickers";
import { DRIVING_EVENT_TYPES, SEVERITIES, type DrivingEventType, type Severity } from "../../../shared/driverScore";
import { useT } from "../../i18n";
import { Button, ErrorState, Field, Input, Modal, Select, Textarea } from "../../components/ui";
import { Combobox } from "../../components/Combobox";
import { useToast } from "../../components/Toast";
import { localNow } from "./labels";
import type { DrivingEvent } from "./types";

/** Log an event by hand (new) or correct driver / severity / notes (existing). */
export function EventForm({ open, event, onClose }: { open: boolean; event: DrivingEvent | null; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const editing = !!event;
  const [form, setForm] = useState(() => ({
    vehicle: event?.vehicle_id ?? "",
    driver: event?.driver_id ?? "",
    at: localNow(),
    type: (event?.event_type ?? "harsh_braking") as DrivingEventType,
    severity: (event?.severity ?? "medium") as Severity,
    speed: "",
    limit: "",
    duration: "",
    notes: event?.notes ?? "",
  }));
  const [error, setError] = useState("");
  const vehiclePicker = useVehiclePicker(form.vehicle);
  const driverPicker = useDriverPicker(form.driver);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const num = (v: string) => (v === "" ? null : Number(v));

  const m = useMutation({
    mutationFn: () =>
      editing
        ? updateRow("driving_events", event!.id, {
            driver_id: form.driver || null,
            severity: form.severity,
            notes: form.notes.trim() || null,
          })
        : insertRow("driving_events", {
            vehicle_id: form.vehicle,
            driver_id: form.driver || null,
            occurred_at: new Date(form.at).toISOString(),
            event_type: form.type,
            severity: form.severity,
            speed_kmh: num(form.speed),
            speed_limit_kmh: num(form.limit),
            duration_s: num(form.duration),
            notes: form.notes.trim() || null,
            source: "manual",
          }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["driving_events"] });
      void qc.invalidateQueries({ queryKey: ["driver_scores"] });
      toast.success(t("driverBehavior.eventSaved"));
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("common.error")),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError("");
    m.mutate();
  };

  return (
    <Modal title={t(editing ? "driverBehavior.editEvent" : "driverBehavior.addEvent")} open={open} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {error && <ErrorState message={error} />}
        {editing && <p className="text-xs text-ink-3">{t("driverBehavior.factsLocked")}</p>}
        {!editing && (
          <>
            <Field label={t("driverBehavior.f.vehicle")} required>
              <Combobox {...vehiclePicker} value={form.vehicle} onChange={(v) => set("vehicle", v)} />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={t("driverBehavior.f.type")} required>
                <Select value={form.type} onChange={(e) => set("type", e.target.value as DrivingEventType)}>
                  {DRIVING_EVENT_TYPES.map((ty) => (
                    <option key={ty} value={ty}>{t(`driverBehavior.type.${ty}`)}</option>
                  ))}
                </Select>
              </Field>
              <Field label={t("driverBehavior.f.occurredAt")} required>
                <Input type="datetime-local" dir="ltr" value={form.at} onChange={(e) => set("at", e.target.value)} required />
              </Field>
            </div>
          </>
        )}
        <Field label={t("driverBehavior.f.driver")} hint={editing ? undefined : t("driverBehavior.f.driverHint")}>
          <Combobox {...driverPicker} value={form.driver} onChange={(v) => set("driver", v)} />
        </Field>
        <Field label={t("driverBehavior.f.severity")} required>
          <Select value={form.severity} onChange={(e) => set("severity", e.target.value as Severity)}>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>{t(`driverBehavior.severity.${s}`)}</option>
            ))}
          </Select>
        </Field>
        {!editing && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label={t("driverBehavior.f.speed")}>
              <Input type="number" dir="ltr" step="0.1" min={0} max={400} value={form.speed} onChange={(e) => set("speed", e.target.value)} />
            </Field>
            <Field label={t("driverBehavior.f.speedLimit")}>
              <Input type="number" dir="ltr" step="0.1" min={0} max={400} value={form.limit} onChange={(e) => set("limit", e.target.value)} />
            </Field>
            <Field label={t("driverBehavior.f.duration")}>
              <Input type="number" dir="ltr" step="1" min={0} max={86400} value={form.duration} onChange={(e) => set("duration", e.target.value)} />
            </Field>
          </div>
        )}
        <Field label={t("driverBehavior.f.notes")}>
          <Textarea rows={3} maxLength={2000} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>{t("action.cancel")}</Button>
          <Button type="submit" loading={m.isPending} disabled={!editing && !form.vehicle}>{t("action.save")}</Button>
        </div>
      </form>
    </Modal>
  );
}
