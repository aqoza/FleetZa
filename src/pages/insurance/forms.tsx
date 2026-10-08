import { useState, type FormEvent } from "react";
import { insertRow, updateRow } from "../../lib/db";
import { useEntityPicker, useSupplierPicker, useVehiclePicker } from "../../lib/pickers";
import { POLICY_TYPES, PREMIUM_FREQUENCIES, type PolicyType, type PremiumFrequency } from "../../../shared/insurance";
import { useTenant } from "../../context/AuthContext";
import { useT } from "../../i18n";
import { Button, Field, Input, Select, Textarea } from "../../components/ui";
import { Combobox } from "../../components/Combobox";
import { addDays, todayInTz } from "./labels";
import type { Claim, Policy } from "./types";

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

const num = (v: string) => (v.trim() === "" ? null : Number(v));
const text = (v: string) => (v.trim() === "" ? null : v.trim());

export function usePolicyPicker(selectedId: string, opts: { liveOnly?: boolean } = {}) {
  const { liveOnly = false } = opts;
  return useEntityPicker<Pick<Policy, "id" | "policy_number" | "insurer_name" | "end_date">>({
    table: "insurance_policies",
    selectedId,
    searchColumns: ["policy_number", "insurer_name", "broker"],
    orderBy: "end_date",
    ascending: false,
    toOption: (p) => ({ value: p.id, label: p.policy_number, meta: p.insurer_name ?? undefined }),
    filter: (q) => (liveOnly ? q.is("canceled_at", null) : q),
    scope: ["insurance-policies", liveOnly],
  });
}

export function PolicyForm({ policy, onDone, onCancel }: { policy?: Policy; onDone: (id: string) => void; onCancel: () => void }) {
  const t = useT();
  const tenant = useTenant();
  const p = policy;
  const today = todayInTz(tenant.timezone);
  const [f, setF] = useState({
    policy_number: p?.policy_number ?? "",
    insurer_supplier_id: p?.insurer_supplier_id ?? "",
    insurer_name: p?.insurer_name ?? "",
    policy_type: (p?.policy_type ?? "comprehensive") as PolicyType,
    coverage_amount: p?.coverage_amount?.toString() ?? "",
    premium: p ? String(p.premium) : "",
    premium_frequency: (p?.premium_frequency ?? "annual") as PremiumFrequency,
    deductible: p?.deductible?.toString() ?? "",
    start_date: p?.start_date ?? today,
    end_date: p?.end_date ?? addDays(addDays(today, 365), -1),
    auto_renew: p?.auto_renew ?? false,
    broker: p?.broker ?? "",
    notes: p?.notes ?? "",
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const insurers = useSupplierPicker(f.insurer_supplier_id, { activeOnly: true, supplierType: "insurance" });
  const { error, saving, run } = useSubmit(onDone);
  const badTerm = !!f.start_date && !!f.end_date && f.end_date < f.start_date;
  const noInsurer = !f.insurer_supplier_id && !f.insurer_name.trim();

  function submit(e: FormEvent) {
    e.preventDefault();
    if (badTerm || noInsurer) return;
    const values = {
      policy_number: f.policy_number.trim(),
      insurer_supplier_id: f.insurer_supplier_id || null,
      insurer_name: text(f.insurer_name),
      policy_type: f.policy_type,
      coverage_amount: num(f.coverage_amount),
      premium: num(f.premium) ?? 0,
      premium_frequency: f.premium_frequency,
      deductible: num(f.deductible),
      start_date: f.start_date,
      end_date: f.end_date,
      auto_renew: f.auto_renew,
      broker: text(f.broker),
      notes: text(f.notes),
    };
    void run(async () => (p ? (await updateRow<{ id: string }>("insurance_policies", p.id, values)).id : (await insertRow<{ id: string }>("insurance_policies", values)).id));
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("insurance.f.number")} required>
          <Input value={f.policy_number} onChange={(e) => set("policy_number", e.target.value)} required maxLength={100} dir="auto" />
        </Field>
        <Field label={t("insurance.f.type")} required>
          <Select value={f.policy_type} onChange={(e) => set("policy_type", e.target.value as PolicyType)}>
            {POLICY_TYPES.map((x) => <option key={x} value={x}>{t(`insurance.type.${x}`)}</option>)}
          </Select>
        </Field>
        <Field label={t("insurance.f.insurer")} hint={t("insurance.f.insurerHint")}>
          <Combobox {...insurers} value={f.insurer_supplier_id} onChange={(v) => set("insurer_supplier_id", v)}
            placeholder={t("insurance.f.selectInsurer")} />
        </Field>
        <Field label={t("insurance.f.insurerName")}>
          <Input value={f.insurer_name} onChange={(e) => set("insurer_name", e.target.value)} maxLength={200} dir="auto"
            disabled={!!f.insurer_supplier_id} />
        </Field>
        <Field label={t("insurance.f.start")} required>
          <Input type="date" value={f.start_date} onChange={(e) => set("start_date", e.target.value)} required />
        </Field>
        <Field label={t("insurance.f.end")} required error={badTerm ? t("insurance.f.endAfter") : undefined}>
          <Input type="date" value={f.end_date} onChange={(e) => set("end_date", e.target.value)} required />
        </Field>
        <Field label={t("insurance.f.premium", { currency: p?.currency ?? tenant.currency })} required>
          <Input type="number" min={0} step="0.001" value={f.premium} onChange={(e) => set("premium", e.target.value)} required />
        </Field>
        <Field label={t("insurance.f.frequency")}>
          <Select value={f.premium_frequency} onChange={(e) => set("premium_frequency", e.target.value as PremiumFrequency)}>
            {PREMIUM_FREQUENCIES.map((x) => <option key={x} value={x}>{t(`insurance.freq.${x}`)}</option>)}
          </Select>
        </Field>
        <Field label={t("insurance.f.coverage")}>
          <Input type="number" min={0} step="0.001" value={f.coverage_amount} onChange={(e) => set("coverage_amount", e.target.value)} />
        </Field>
        <Field label={t("insurance.f.deductible")}>
          <Input type="number" min={0} step="0.001" value={f.deductible} onChange={(e) => set("deductible", e.target.value)} />
        </Field>
        <Field label={t("insurance.f.broker")}>
          <Input value={f.broker} onChange={(e) => set("broker", e.target.value)} maxLength={200} dir="auto" />
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm text-ink">
          <input type="checkbox" checked={f.auto_renew} onChange={(e) => set("auto_renew", e.target.checked)} className="h-4 w-4 rounded border-line" />
          {t("insurance.f.autoRenew")}
        </label>
      </div>
      <Field label={t("insurance.f.notes")}>
        <Textarea value={f.notes} onChange={(e) => set("notes", e.target.value)} rows={2} maxLength={4000} />
      </Field>
      {noInsurer && <p className="text-xs text-ink-3">{t("insurance.f.needInsurer")}</p>}
      <FormError message={error} />
      <FormActions saving={saving} label={p ? t("action.save") : t("insurance.create")} onCancel={onCancel} disabled={badTerm || noInsurer} />
    </form>
  );
}

export function CancelPolicyForm({ policy, onDone, onCancel }: { policy: Policy; onDone: () => void; onCancel: () => void }) {
  const t = useT();
  const tenant = useTenant();
  const today = todayInTz(tenant.timezone);
  const [date, setDate] = useState(today < policy.end_date ? today : policy.end_date);
  const [reason, setReason] = useState("");
  const { error, saving, run } = useSubmit(onDone);
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => { await updateRow("insurance_policies", policy.id, { canceled_at: date, cancel_reason: text(reason) }); });
      }}
    >
      <p className="text-sm text-ink-2">{t("insurance.cancelHint")}</p>
      <Field label={t("insurance.f.canceledOn")} required>
        <Input type="date" value={date} min={policy.start_date} max={today} onChange={(e) => setDate(e.target.value)} required />
      </Field>
      <Field label={t("insurance.f.cancelReason")}>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} dir="auto" />
      </Field>
      <FormError message={error} />
      <FormActions saving={saving} label={t("insurance.cancelPolicy")} onCancel={onCancel} />
    </form>
  );
}

export function CoverForm({ policy, onDone, onCancel }: { policy: Policy; onDone: () => void; onCancel: () => void }) {
  const t = useT();
  const tenant = useTenant();
  const today = todayInTz(tenant.timezone);
  const [vehicleId, setVehicleId] = useState("");
  const [addedOn, setAddedOn] = useState(today < policy.start_date ? policy.start_date : today);
  const vehicles = useVehiclePicker(vehicleId, { ownership: "company" });
  const { error, saving, run } = useSubmit(onDone);
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!vehicleId) return;
        void run(async () => { await insertRow("insurance_policy_vehicles", { policy_id: policy.id, vehicle_id: vehicleId, added_on: addedOn }); });
      }}
    >
      <Field label={t("insurance.cover.vehicle")} required>
        <Combobox {...vehicles} value={vehicleId} onChange={setVehicleId} required clearable={false} placeholder={t("insurance.cover.selectVehicle")} />
      </Field>
      <Field label={t("insurance.cover.addedOn")} required>
        <Input type="date" value={addedOn} onChange={(e) => setAddedOn(e.target.value)} required />
      </Field>
      <FormError message={error} />
      <FormActions saving={saving} label={t("insurance.cover.add")} onCancel={onCancel} disabled={!vehicleId} />
    </form>
  );
}

export function ClaimForm({ claim, policyId, onDone, onCancel }: {
  claim?: Claim;
  policyId?: string;
  onDone: (id: string) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const tenant = useTenant();
  const c = claim;
  const today = todayInTz(tenant.timezone);
  const [f, setF] = useState({
    policy_id: c?.policy_id ?? policyId ?? "",
    vehicle_id: c?.vehicle_id ?? "",
    loss_date: c?.loss_date ?? today,
    claim_date: c?.claim_date ?? today,
    description: c?.description ?? "",
    amount_claimed: c ? String(c.amount_claimed) : "",
    deductible_applied: c?.deductible_applied?.toString() ?? "",
    insurer_reference: c?.insurer_reference ?? "",
    adjuster_name: c?.adjuster_name ?? "",
    adjuster_phone: c?.adjuster_phone ?? "",
    notes: c?.notes ?? "",
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const policies = usePolicyPicker(f.policy_id, { liveOnly: !c });
  const vehicles = useVehiclePicker(f.vehicle_id, { ownership: "company" });
  const { error, saving, run } = useSubmit(onDone);
  const badDates = !!f.loss_date && !!f.claim_date && f.claim_date < f.loss_date;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!f.policy_id || badDates) return;
    const values = {
      policy_id: f.policy_id,
      vehicle_id: f.vehicle_id || null,
      loss_date: f.loss_date,
      claim_date: f.claim_date,
      description: f.description.trim(),
      amount_claimed: num(f.amount_claimed) ?? 0,
      deductible_applied: num(f.deductible_applied),
      insurer_reference: text(f.insurer_reference),
      adjuster_name: text(f.adjuster_name),
      adjuster_phone: text(f.adjuster_phone),
      notes: text(f.notes),
    };
    void run(async () => (c ? (await updateRow<{ id: string }>("insurance_claims", c.id, values)).id : (await insertRow<{ id: string }>("insurance_claims", values)).id));
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("insurance.c.policy")} required>
          <Combobox {...policies} value={f.policy_id} onChange={(v) => set("policy_id", v)} required clearable={false}
            placeholder={t("insurance.c.selectPolicy")} />
        </Field>
        <Field label={t("insurance.c.vehicle")}>
          <Combobox {...vehicles} value={f.vehicle_id} onChange={(v) => set("vehicle_id", v)} placeholder={t("insurance.c.selectVehicle")} />
        </Field>
        <Field label={t("insurance.c.lossDate")} required>
          <Input type="date" value={f.loss_date} max={today} onChange={(e) => set("loss_date", e.target.value)} required />
        </Field>
        <Field label={t("insurance.c.claimDate")} required error={badDates ? t("insurance.c.claimAfterLoss") : undefined}>
          <Input type="date" value={f.claim_date} onChange={(e) => set("claim_date", e.target.value)} required />
        </Field>
      </div>
      <Field label={t("insurance.c.description")} required>
        <Textarea value={f.description} onChange={(e) => set("description", e.target.value)} rows={3} required maxLength={4000} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("insurance.c.amountClaimed", { currency: c?.currency ?? tenant.currency })} required>
          <Input type="number" min={0} step="0.001" value={f.amount_claimed} onChange={(e) => set("amount_claimed", e.target.value)} required />
        </Field>
        <Field label={t("insurance.c.deductible")}>
          <Input type="number" min={0} step="0.001" value={f.deductible_applied} onChange={(e) => set("deductible_applied", e.target.value)} />
        </Field>
        <Field label={t("insurance.c.insurerRef")}>
          <Input value={f.insurer_reference} onChange={(e) => set("insurer_reference", e.target.value)} maxLength={100} dir="auto" />
        </Field>
        <Field label={t("insurance.c.adjuster")}>
          <Input value={f.adjuster_name} onChange={(e) => set("adjuster_name", e.target.value)} maxLength={200} dir="auto" />
        </Field>
        <Field label={t("insurance.c.adjusterPhone")}>
          <Input type="tel" value={f.adjuster_phone} onChange={(e) => set("adjuster_phone", e.target.value)} maxLength={50} dir="ltr" />
        </Field>
      </div>
      <Field label={t("insurance.c.notes")}>
        <Textarea value={f.notes} onChange={(e) => set("notes", e.target.value)} rows={2} maxLength={4000} />
      </Field>
      <FormError message={error} />
      <FormActions saving={saving} label={c ? t("action.save") : t("insurance.c.create")} onCancel={onCancel} disabled={!f.policy_id || badDates} />
    </form>
  );
}

export type ClaimStep = "approved" | "rejected" | "settled";

export function ClaimStepForm({ claim, step, onDone, onCancel }: { claim: Claim; step: ClaimStep; onDone: () => void; onCancel: () => void }) {
  const t = useT();
  const tenant = useTenant();
  const today = todayInTz(tenant.timezone);
  const [approved, setApproved] = useState(claim.amount_approved?.toString() ?? String(claim.amount_claimed));
  const [deductible, setDeductible] = useState(claim.deductible_applied?.toString() ?? "");
  const [paid, setPaid] = useState(claim.amount_paid?.toString() ?? claim.amount_approved?.toString() ?? "");
  const [settledAt, setSettledAt] = useState(today);
  const [reason, setReason] = useState("");
  const { error, saving, run } = useSubmit(onDone);

  function submit(e: FormEvent) {
    e.preventDefault();
    const values =
      step === "approved"
        ? { status: step, amount_approved: num(approved), deductible_applied: num(deductible) }
        : step === "rejected"
          ? { status: step, rejection_reason: text(reason) }
          : { status: step, amount_paid: num(paid), settled_at: settledAt };
    void run(async () => { await updateRow("insurance_claims", claim.id, values); });
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      {step === "approved" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("insurance.c.amountApproved", { currency: claim.currency })} required>
            <Input type="number" min={0} step="0.001" value={approved} onChange={(e) => setApproved(e.target.value)} required />
          </Field>
          <Field label={t("insurance.c.deductible")}>
            <Input type="number" min={0} step="0.001" value={deductible} onChange={(e) => setDeductible(e.target.value)} />
          </Field>
        </div>
      )}
      {step === "rejected" && (
        <Field label={t("insurance.c.rejectionReason")}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={1000} />
        </Field>
      )}
      {step === "settled" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("insurance.c.amountPaid", { currency: claim.currency })} required>
            <Input type="number" min={0} step="0.001" value={paid} onChange={(e) => setPaid(e.target.value)} required />
          </Field>
          <Field label={t("insurance.c.settledOn")} required>
            <Input type="date" value={settledAt} max={today} onChange={(e) => setSettledAt(e.target.value)} required />
          </Field>
        </div>
      )}
      <FormError message={error} />
      <FormActions saving={saving} label={t(`insurance.c.step.${step}`)} onCancel={onCancel} />
    </form>
  );
}
