import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Crosshair, Plus, X } from "lucide-react";
import { insertRow, updateRow } from "../../lib/db";
import {
  CHECKLIST_LABEL_MAX, CHECKLIST_MAX, FIELD_PRIORITIES, cleanChecklist, fromLocalInput, parseChecklist, parseCoord,
  toLocalInput, type ChecklistItem, type FieldPriority,
} from "../../lib/field";
import { useCustomerPicker, useVehiclePicker } from "../../lib/pickers";
import { useT } from "../../i18n";
import { Button, ErrorState, Field, Input, Select, Textarea } from "../../components/ui";
import { Combobox } from "../../components/Combobox";
import { useToast } from "../../components/Toast";
import { useEmployeePicker } from "../employees/pickers";
import { getPosition } from "./geo";
import { taskPriority } from "./labels";
import type { FieldTask } from "./types";

/** Create or edit a task (managers). Status and on-site fields are not here. */
export function TaskForm({ task, onDone }: { task?: FieldTask; onDone: (id?: string) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [employeeId, setEmployeeId] = useState(task?.employee_id ?? "");
  const [customerId, setCustomerId] = useState(task?.customer_id ?? "");
  const [vehicleId, setVehicleId] = useState(task?.vehicle_id ?? "");
  const [address, setAddress] = useState(task?.address ?? "");
  const [lat, setLat] = useState(task?.lat != null ? String(task.lat) : "");
  const [lng, setLng] = useState(task?.lng != null ? String(task.lng) : "");
  const [scheduled, setScheduled] = useState(toLocalInput(task?.scheduled_start));
  const [due, setDue] = useState(toLocalInput(task?.due_at));
  const [priority, setPriority] = useState<FieldPriority>(task?.priority ?? "medium");
  const [steps, setSteps] = useState<ChecklistItem[]>(() => parseChecklist(task?.checklist));
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState("");

  const employeePicker = useEmployeePicker(employeeId, { activeOnly: true });
  const customerPicker = useCustomerPicker(customerId, { activeOnly: true });
  const vehiclePicker = useVehiclePicker(vehicleId, { customerId: customerId || null, includeUnassigned: true });

  const latN = parseCoord(lat, 90);
  const lngN = parseCoord(lng, 180);
  const coordsOk = (latN === null) === (lngN === null) && !Number.isNaN(latN) && !Number.isNaN(lngN);
  const datesOk = !scheduled || !due || due >= scheduled;

  const save = useMutation({
    mutationFn: async () => {
      const values = {
        title: title.trim(),
        description: description.trim() || null,
        employee_id: employeeId,
        customer_id: customerId || null,
        vehicle_id: vehicleId || null,
        address: address.trim() || null,
        lat: latN,
        lng: lngN,
        scheduled_start: fromLocalInput(scheduled),
        due_at: fromLocalInput(due),
        priority,
        checklist: cleanChecklist(steps),
      };
      if (task) return updateRow<FieldTask>("field_tasks", task.id, values);
      return insertRow<FieldTask>("field_tasks", values);
    },
    onSuccess: (row) => {
      void qc.invalidateQueries({ queryKey: ["field_tasks"] });
      toast.success(t(task ? "field.saved" : "field.created"));
      onDone(row?.id);
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !employeeId || !coordsOk || !datesOk) return;
    setError("");
    save.mutate();
  };

  const useMyLocation = async () => {
    setLocating(true);
    const pos = await getPosition();
    setLocating(false);
    if (pos.ok) {
      setLat(pos.lat.toFixed(6));
      setLng(pos.lng.toFixed(6));
    } else {
      toast.show(t(pos.reasonKey), "info");
    }
  };

  const setStep = (i: number, label: string) =>
    setSteps((s) => s.map((x, j) => (j === i ? { ...x, label } : x)));
  const moveStep = (i: number, d: -1 | 1) =>
    setSteps((s) => {
      const out = [...s];
      [out[i], out[i + d]] = [out[i + d], out[i]];
      return out;
    });

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label={t("field.f.title")} required>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required autoFocus />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("field.f.assignee")} required>
          <Combobox {...employeePicker} value={employeeId} onChange={setEmployeeId} required />
        </Field>
        <Field label={t("field.f.priority")}>
          <Select value={priority} onChange={(e) => setPriority(e.target.value as FieldPriority)}>
            {FIELD_PRIORITIES.map((p) => (
              <option key={p} value={p}>{t(taskPriority[p].labelKey)}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("field.f.customer")}>
          <Combobox
            {...customerPicker}
            value={customerId}
            onChange={(v) => {
              setCustomerId(v);
              setVehicleId("");
            }}
          />
        </Field>
        <Field label={t("field.f.vehicle")}>
          <Combobox {...vehiclePicker} value={vehicleId} onChange={setVehicleId} />
        </Field>
        <Field label={t("field.f.scheduled")}>
          <Input type="datetime-local" value={scheduled} onChange={(e) => setScheduled(e.target.value)} dir="ltr" />
        </Field>
        <Field label={t("field.f.due")} error={datesOk ? undefined : t("field.f.dueBeforeStart")}>
          <Input type="datetime-local" value={due} min={scheduled || undefined} onChange={(e) => setDue(e.target.value)} dir="ltr" />
        </Field>
      </div>
      <Field label={t("field.f.address")}>
        <Input value={address} onChange={(e) => setAddress(e.target.value)} maxLength={500} />
      </Field>
      <div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("field.f.lat")}>
            <Input inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} dir="ltr" />
          </Field>
          <Field label={t("field.f.lng")}>
            <Input inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} dir="ltr" />
          </Field>
        </div>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <span className={coordsOk ? "text-xs text-ink-3" : "text-xs text-serious"}>
            {coordsOk ? t("field.f.coordsHint") : t("field.f.coordsInvalid")}
          </span>
          <Button type="button" variant="ghost" className="px-2 py-1 text-xs" onClick={useMyLocation} loading={locating}>
            <Crosshair className="h-3.5 w-3.5" /> {t("field.f.useMyLocation")}
          </Button>
        </div>
      </div>
      <Field label={t("field.f.description")}>
        <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} />
      </Field>

      <fieldset>
        <legend className="mb-1 block text-sm font-medium text-ink-2">{t("field.f.checklist")}</legend>
        <ol className="space-y-2">
          {steps.map((s, i) => (
            <li key={i} className="flex items-center gap-1.5">
              <span className="w-5 shrink-0 text-end text-xs text-ink-3 tabular-nums">{i + 1}</span>
              <Input
                value={s.label}
                onChange={(e) => setStep(i, e.target.value)}
                placeholder={t("field.f.stepPlaceholder", { n: i + 1 })}
                maxLength={CHECKLIST_LABEL_MAX}
                aria-label={t("field.f.stepPlaceholder", { n: i + 1 })}
              />
              <Button type="button" variant="ghost" className="px-1.5 py-1" disabled={i === 0} onClick={() => moveStep(i, -1)}
                aria-label={t("field.f.moveUp")} title={t("field.f.moveUp")}>
                <ArrowUp className="h-4 w-4" />
              </Button>
              <Button type="button" variant="ghost" className="px-1.5 py-1" disabled={i === steps.length - 1} onClick={() => moveStep(i, 1)}
                aria-label={t("field.f.moveDown")} title={t("field.f.moveDown")}>
                <ArrowDown className="h-4 w-4" />
              </Button>
              <Button type="button" variant="ghost" className="px-1.5 py-1" onClick={() => setSteps((x) => x.filter((_, j) => j !== i))}
                aria-label={t("field.f.removeStep")} title={t("field.f.removeStep")}>
                <X className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ol>
        <Button
          type="button"
          variant="secondary"
          className="mt-2"
          disabled={steps.length >= CHECKLIST_MAX}
          onClick={() => setSteps((s) => [...s, { label: "", done: false }])}
        >
          <Plus className="h-4 w-4" /> {t("field.f.addStep")}
        </Button>
      </fieldset>

      {error && <ErrorState message={error} />}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => onDone()}>{t("action.cancel")}</Button>
        <Button type="submit" loading={save.isPending} disabled={!title.trim() || !employeeId || !coordsOk || !datesOk}>
          {t("action.save")}
        </Button>
      </div>
    </form>
  );
}
