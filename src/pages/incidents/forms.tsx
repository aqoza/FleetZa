import { useState, type FormEvent, type ReactNode } from "react";
import { supabase } from "../../lib/supabase";
import { insertRow, updateRow, wrapDbError, type TableName } from "../../lib/db";
import { useDriverPicker, useEntityPicker, useVehiclePicker } from "../../lib/pickers";
import {
  AT_FAULT, INCIDENT_TYPES, PARTY_TYPES, SEVERITIES, isSerious, type AtFault, type IncidentType, type PartyType, type Severity,
} from "../../../shared/incidents";
import { useTenant } from "../../context/AuthContext";
import { useT } from "../../i18n";
import { Button, Field, Input, Select, Textarea } from "../../components/ui";
import { Combobox } from "../../components/Combobox";
import { fromLocalInput, toLocalInput } from "./labels";
import type { Incident, Party } from "./types";

function useSubmit<T>(onDone: (v: T) => void) {
  const t = useT();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const run = async (fn: () => Promise<T>) => {
    setSaving(true);
    setError("");
    try {
      onDone(await fn());
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setSaving(false);
    }
  };
  return { error, saving, run };
}

function FormActions({ saving, label, onCancel, disabled }: { saving: boolean; label: string; onCancel: () => void; disabled?: boolean }) {
  const t = useT();
  return (
    <div className="flex justify-end gap-2">
      <Button type="button" variant="secondary" onClick={onCancel}>{t("action.cancel")}</Button>
      <Button type="submit" loading={saving} disabled={disabled}>{label}</Button>
    </div>
  );
}

function FormError({ message }: { message: string }) {
  return message ? <p className="rounded-xl bg-serious-soft px-3 py-2 text-sm text-serious">{message}</p> : null;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-3">
      <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">{title}</legend>
      {children}
    </fieldset>
  );
}

const num = (v: string) => (v.trim() === "" ? null : Number(v));
const text = (v: string) => (v.trim() === "" ? null : v.trim());

export function IncidentForm({ incident, onDone, onCancel }: { incident?: Incident; onDone: (id: string) => void; onCancel: () => void }) {
  const t = useT();
  const tenant = useTenant();
  const i = incident;
  const [f, setF] = useState({
    vehicle_id: i?.vehicle_id ?? "",
    driver_id: i?.driver_id ?? "",
    occurred_at: toLocalInput(i?.occurred_at ?? new Date().toISOString()),
    location: i?.location ?? "",
    incident_type: (i?.incident_type ?? "collision") as IncidentType,
    severity: (i?.severity ?? "minor") as Severity,
    description: i?.description ?? "",
    injuries: String(i?.injuries ?? 0),
    fatalities: String(i?.fatalities ?? 0),
    at_fault: (i?.at_fault ?? "unknown") as AtFault,
    vehicle_drivable: i?.vehicle_drivable ?? true,
    police_report_number: i?.police_report_number ?? "",
    police_station: i?.police_station ?? "",
    estimated_damage: i?.estimated_damage?.toString() ?? "",
    actual_cost: i?.actual_cost?.toString() ?? "",
    notes: i?.notes ?? "",
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const vehicles = useVehiclePicker(f.vehicle_id, { ownership: "company" });
  const drivers = useDriverPicker(f.driver_id);
  const { error, saving, run } = useSubmit(onDone);
  const future = !!f.occurred_at && new Date(f.occurred_at).getTime() > Date.now() + 5 * 60_000;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!f.vehicle_id || future) return;
    const values = {
      vehicle_id: f.vehicle_id,
      driver_id: f.driver_id || null,
      occurred_at: fromLocalInput(f.occurred_at),
      location: text(f.location),
      incident_type: f.incident_type,
      severity: f.severity,
      description: f.description.trim(),
      injuries: num(f.injuries) ?? 0,
      fatalities: num(f.fatalities) ?? 0,
      at_fault: f.at_fault,
      vehicle_drivable: f.vehicle_drivable,
      police_report_number: text(f.police_report_number),
      police_station: text(f.police_station),
      estimated_damage: num(f.estimated_damage),
      actual_cost: num(f.actual_cost),
      notes: text(f.notes),
    };
    void run(async () => (i
      ? (await updateRow<{ id: string }>("incidents", i.id, values)).id
      : (await insertRow<{ id: string }>("incidents", values)).id));
  }

  return (
    <form className="space-y-5" onSubmit={submit}>
      <Section title={t("incidents.f.what")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("incidents.f.vehicle")} required>
            <Combobox {...vehicles} value={f.vehicle_id} onChange={(v) => set("vehicle_id", v)} required clearable={false}
              placeholder={t("incidents.f.selectVehicle")} />
          </Field>
          <Field label={t("incidents.f.driver")}>
            <Combobox {...drivers} value={f.driver_id} onChange={(v) => set("driver_id", v)} placeholder={t("incidents.f.selectDriver")} />
          </Field>
          <Field label={t("incidents.f.occurred")} required error={future ? t("incidents.f.future") : undefined}>
            <Input type="datetime-local" value={f.occurred_at} onChange={(e) => set("occurred_at", e.target.value)} required />
          </Field>
          <Field label={t("incidents.f.location")}>
            <Input value={f.location} onChange={(e) => set("location", e.target.value)} maxLength={300} dir="auto" />
          </Field>
          <Field label={t("incidents.f.type")} required>
            <Select value={f.incident_type} onChange={(e) => set("incident_type", e.target.value as IncidentType)}>
              {INCIDENT_TYPES.map((x) => <option key={x} value={x}>{t(`incidents.type.${x}`)}</option>)}
            </Select>
          </Field>
          <Field label={t("incidents.f.severity")} required hint={isSerious(f.severity) ? t("incidents.f.seriousHint") : undefined}>
            <Select value={f.severity} onChange={(e) => set("severity", e.target.value as Severity)}>
              {SEVERITIES.map((x) => <option key={x} value={x}>{t(`incidents.severity.${x}`)}</option>)}
            </Select>
          </Field>
        </div>
        <Field label={t("incidents.f.description")} required>
          <Textarea value={f.description} onChange={(e) => set("description", e.target.value)} rows={3} required maxLength={4000} />
        </Field>
      </Section>
      <Section title={t("incidents.f.consequences")}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t("incidents.f.injuries")}>
            <Input type="number" min={0} max={1000} value={f.injuries} onChange={(e) => set("injuries", e.target.value)} />
          </Field>
          <Field label={t("incidents.f.fatalities")}>
            <Input type="number" min={0} max={1000} value={f.fatalities} onChange={(e) => set("fatalities", e.target.value)} />
          </Field>
          <Field label={t("incidents.f.atFault")}>
            <Select value={f.at_fault} onChange={(e) => set("at_fault", e.target.value as AtFault)}>
              {AT_FAULT.map((x) => <option key={x} value={x}>{t(`incidents.fault.${x}`)}</option>)}
            </Select>
          </Field>
          <Field label={t("incidents.f.estimated", { currency: i?.currency ?? tenant.currency })}>
            <Input type="number" min={0} step="0.001" value={f.estimated_damage} onChange={(e) => set("estimated_damage", e.target.value)} />
          </Field>
          <Field label={t("incidents.f.actual", { currency: i?.currency ?? tenant.currency })}>
            <Input type="number" min={0} step="0.001" value={f.actual_cost} onChange={(e) => set("actual_cost", e.target.value)} />
          </Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm text-ink">
            <input type="checkbox" checked={f.vehicle_drivable} onChange={(e) => set("vehicle_drivable", e.target.checked)}
              className="h-4 w-4 rounded border-line" />
            {t("incidents.f.drivable")}
          </label>
        </div>
      </Section>
      <Section title={t("incidents.f.police")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("incidents.f.policeReport")}>
            <Input value={f.police_report_number} onChange={(e) => set("police_report_number", e.target.value)} maxLength={100} dir="auto" />
          </Field>
          <Field label={t("incidents.f.policeStation")}>
            <Input value={f.police_station} onChange={(e) => set("police_station", e.target.value)} maxLength={200} dir="auto" />
          </Field>
        </div>
      </Section>
      <Field label={t("incidents.f.notes")}>
        <Textarea value={f.notes} onChange={(e) => set("notes", e.target.value)} rows={2} maxLength={4000} />
      </Field>
      <FormError message={error} />
      <FormActions saving={saving} label={i ? t("action.save") : t("incidents.report")} onCancel={onCancel} disabled={!f.vehicle_id || future} />
    </form>
  );
}

export function PartyForm({ incidentId, party, onDone, onCancel }: {
  incidentId: string;
  party?: Party;
  onDone: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const p = party;
  const [f, setF] = useState({
    party_type: (p?.party_type ?? "third_party_driver") as PartyType,
    name: p?.name ?? "",
    phone: p?.phone ?? "",
    vehicle_plate: p?.vehicle_plate ?? "",
    insurer: p?.insurer ?? "",
    insurance_policy_number: p?.insurance_policy_number ?? "",
    statement: p?.statement ?? "",
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const { error, saving, run } = useSubmit(onDone);
  const hasVehicle = f.party_type === "third_party_driver";

  function submit(e: FormEvent) {
    e.preventDefault();
    const values = {
      party_type: f.party_type,
      name: f.name.trim(),
      phone: text(f.phone),
      vehicle_plate: hasVehicle ? text(f.vehicle_plate) : null,
      insurer: hasVehicle ? text(f.insurer) : null,
      insurance_policy_number: hasVehicle ? text(f.insurance_policy_number) : null,
      statement: text(f.statement),
    };
    void run(async () => {
      if (p) await updateRow("incident_parties", p.id, values);
      else await insertRow("incident_parties", { incident_id: incidentId, ...values });
    });
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("incidents.p.type")} required>
          <Select value={f.party_type} onChange={(e) => set("party_type", e.target.value as PartyType)}>
            {PARTY_TYPES.map((x) => <option key={x} value={x}>{t(`incidents.party.${x}`)}</option>)}
          </Select>
        </Field>
        <Field label={t("incidents.p.name")} required>
          <Input value={f.name} onChange={(e) => set("name", e.target.value)} required maxLength={200} dir="auto" />
        </Field>
        <Field label={t("incidents.p.phone")}>
          <Input type="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} maxLength={50} dir="ltr" />
        </Field>
        {hasVehicle && (
          <>
            <Field label={t("incidents.p.plate")}>
              <Input value={f.vehicle_plate} onChange={(e) => set("vehicle_plate", e.target.value)} maxLength={50} dir="auto" />
            </Field>
            <Field label={t("incidents.p.insurer")}>
              <Input value={f.insurer} onChange={(e) => set("insurer", e.target.value)} maxLength={200} dir="auto" />
            </Field>
            <Field label={t("incidents.p.policy")}>
              <Input value={f.insurance_policy_number} onChange={(e) => set("insurance_policy_number", e.target.value)} maxLength={100} dir="auto" />
            </Field>
          </>
        )}
      </div>
      <Field label={t("incidents.p.statement")}>
        <Textarea value={f.statement} onChange={(e) => set("statement", e.target.value)} rows={3} maxLength={4000} />
      </Field>
      <FormError message={error} />
      <FormActions saving={saving} label={p ? t("action.save") : t("incidents.p.add")} onCancel={onCancel} />
    </form>
  );
}

export type IncidentStep = "resolved" | "closed";

export function StepForm({ incident, step, onDone, onCancel }: { incident: Incident; step: IncidentStep; onDone: () => void; onCancel: () => void }) {
  const t = useT();
  const [rootCause, setRootCause] = useState(incident.root_cause ?? "");
  const [actions, setActions] = useState(incident.corrective_actions ?? "");
  const [actual, setActual] = useState(incident.actual_cost?.toString() ?? "");
  const { error, saving, run } = useSubmit(onDone);
  const rootRequired = step === "closed" && isSerious(incident.severity);

  function submit(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      await updateRow("incidents", incident.id, {
        status: step, root_cause: text(rootCause), corrective_actions: text(actions), actual_cost: num(actual),
      });
    });
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <Field label={t("incidents.d.rootCause")} required={rootRequired} hint={rootRequired ? t("incidents.f.rootHint") : undefined}>
        <Textarea value={rootCause} onChange={(e) => setRootCause(e.target.value)} rows={3} required={rootRequired} maxLength={4000} />
      </Field>
      <Field label={t("incidents.d.corrective")}>
        <Textarea value={actions} onChange={(e) => setActions(e.target.value)} rows={3} maxLength={4000} />
      </Field>
      <Field label={t("incidents.f.actual", { currency: incident.currency })}>
        <Input type="number" min={0} step="0.001" value={actual} onChange={(e) => setActual(e.target.value)} />
      </Field>
      <FormError message={error} />
      <FormActions saving={saving} label={t(`incidents.step.${step}`)} onCancel={onCancel} disabled={rootRequired && !rootCause.trim()} />
    </form>
  );
}

// insurance_policies is typed by the Insurance module; this module only
// needs its id, number and insurer to pick one.
const POLICIES = "insurance_policies" as unknown as TableName;

export function ClaimForm({ incident, onDone, onCancel }: { incident: Incident; onDone: (claimId: string) => void; onCancel: () => void }) {
  const t = useT();
  const [policyId, setPolicyId] = useState("");
  const policies = useEntityPicker<{ id: string; policy_number: string; insurer_name: string | null }>({
    table: POLICIES,
    selectedId: policyId,
    searchColumns: ["policy_number", "insurer_name"],
    orderBy: "end_date",
    ascending: false,
    toOption: (p) => ({ value: p.id, label: p.policy_number, meta: p.insurer_name ?? undefined }),
    filter: (q) => q.is("canceled_at", null),
    scope: ["incident-claim-policies"],
  });
  const { error, saving, run } = useSubmit(onDone);
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!policyId) return;
        void run(async () => {
          const { data, error: err } = await supabase.rpc("incident_create_claim", { p_incident_id: incident.id, p_policy_id: policyId });
          if (err) throw wrapDbError(err);
          return data as string;
        });
      }}
    >
      <p className="text-sm text-ink-2">{t("incidents.claim.hint")}</p>
      <Field label={t("incidents.claim.policy")} required>
        <Combobox {...policies} value={policyId} onChange={setPolicyId} required clearable={false} placeholder={t("incidents.claim.selectPolicy")} />
      </Field>
      <FormError message={error} />
      <FormActions saving={saving} label={t("incidents.claim.create")} onCancel={onCancel} disabled={!policyId} />
    </form>
  );
}
