import { useState, type FormEvent, type ReactNode } from "react";
import { supabase } from "../../lib/supabase";
import { insertRow, updateRow, wrapDbError } from "../../lib/db";
import { ltrText } from "../../lib/bidi";
import { formatDate } from "../../lib/format";
import { useCustomerPicker, useVehiclePicker } from "../../lib/pickers";
import { CONTRACT_TYPES, FREQUENCIES, addDays, addMonths, daysBetween, type ContractType, type Frequency } from "../../../shared/contracts";
import { useT } from "../../i18n";
import { Button, Field, Input, Select, Textarea } from "../../components/ui";
import { Combobox } from "../../components/Combobox";
import type { Contract, CoveredVehicle } from "./types";

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

function todayLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function ContractForm({ contract, onDone, onCancel }: { contract?: Contract; onDone: (id: string) => void; onCancel: () => void }) {
  const t = useT();
  const c = contract;
  const start = todayLocal();
  const [f, setF] = useState({
    customer_id: c?.customer_id ?? "",
    contract_type: (c?.contract_type ?? "service") as ContractType,
    title: c?.title ?? "",
    start_date: c?.start_date ?? start,
    end_date: c ? (c.end_date ?? "") : addDays(addMonths(start, 12), -1),
    billing_frequency: (c?.billing_frequency ?? "monthly") as Frequency,
    recurring_amount: c ? String(c.recurring_amount) : "",
    tax_rate: c?.tax_rate?.toString() ?? "",
    auto_renew: c?.auto_renew ?? false,
    notice_days: String(c?.notice_days ?? 30),
    next_billing_date: c?.next_billing_date ?? "",
    signed_at: c?.signed_at ?? "",
    signed_by_name: c?.signed_by_name ?? "",
    terms: c?.terms ?? "",
    notes: c?.notes ?? "",
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const customers = useCustomerPicker(f.customer_id);
  const { error, saving, run } = useSubmit(onDone);
  const badDates = !!f.end_date && f.end_date < f.start_date;
  const active = c?.status === "active";

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!f.customer_id || badDates) return;
    const values = {
      customer_id: f.customer_id,
      contract_type: f.contract_type,
      title: f.title.trim(),
      start_date: f.start_date,
      end_date: f.end_date || null,
      billing_frequency: f.billing_frequency,
      recurring_amount: num(f.recurring_amount) ?? 0,
      tax_rate: num(f.tax_rate),
      auto_renew: f.auto_renew,
      notice_days: num(f.notice_days) ?? 30,
      next_billing_date: f.next_billing_date || null,
      signed_at: f.signed_at || null,
      signed_by_name: text(f.signed_by_name),
      terms: text(f.terms),
      notes: text(f.notes),
    };
    void run(async () => (c
      ? (await updateRow<{ id: string }>("contracts", c.id, values)).id
      : (await insertRow<{ id: string }>("contracts", values)).id));
  }

  return (
    <form className="space-y-5" onSubmit={submit}>
      <Section title={t("contracts.f.what")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("contracts.f.customer")} required>
            <Combobox {...customers} value={f.customer_id} onChange={(v) => set("customer_id", v)} required clearable={false}
              placeholder={t("contracts.f.selectCustomer")} />
          </Field>
          <Field label={t("contracts.f.type")}>
            <Select value={f.contract_type} onChange={(e) => set("contract_type", e.target.value as ContractType)}>
              {CONTRACT_TYPES.map((x) => <option key={x} value={x}>{t(`contracts.type.${x}`)}</option>)}
            </Select>
          </Field>
        </div>
        <Field label={t("contracts.f.title")} required>
          <Input value={f.title} onChange={(e) => set("title", e.target.value)} required maxLength={200} dir="auto"
            placeholder={t("contracts.f.titlePlaceholder")} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t("contracts.f.start")} required>
            <Input type="date" value={f.start_date} onChange={(e) => set("start_date", e.target.value)} required />
          </Field>
          <Field label={t("contracts.f.end")} hint={t("contracts.f.endHint")} error={badDates ? t("contracts.f.badDates") : undefined}>
            <Input type="date" value={f.end_date} onChange={(e) => set("end_date", e.target.value)} />
          </Field>
          <Field label={t("contracts.f.notice")} hint={t("contracts.f.noticeHint")}>
            <Input type="number" min={0} max={365} value={f.notice_days} onChange={(e) => set("notice_days", e.target.value)} />
          </Field>
        </div>
        <label className="flex items-start gap-2 text-sm text-ink">
          <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-line" checked={f.auto_renew} onChange={(e) => set("auto_renew", e.target.checked)} />
          <span>
            {t("contracts.f.autoRenew")}
            <span className="block text-xs text-ink-3">{t("contracts.f.autoRenewHint")}</span>
          </span>
        </label>
      </Section>
      <Section title={t("contracts.f.billing")}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t("contracts.f.frequency")}>
            <Select value={f.billing_frequency} onChange={(e) => set("billing_frequency", e.target.value as Frequency)}>
              {FREQUENCIES.map((x) => <option key={x} value={x}>{t(`contracts.freq.${x}`)}</option>)}
            </Select>
          </Field>
          <Field label={f.billing_frequency === "one_time" ? t("contracts.f.amountOnce") : t("contracts.f.amount")}>
            <Input type="number" min={0} step="0.001" value={f.recurring_amount} onChange={(e) => set("recurring_amount", e.target.value)} />
          </Field>
          <Field label={t("contracts.f.tax")} hint={t("contracts.f.taxHint")}>
            <Input type="number" min={0} max={100} step="0.01" value={f.tax_rate} onChange={(e) => set("tax_rate", e.target.value)} />
          </Field>
        </div>
        {active && (
          <Field label={t("contracts.f.nextBilling")} hint={t("contracts.f.nextBillingHint")}>
            <Input type="date" value={f.next_billing_date} onChange={(e) => set("next_billing_date", e.target.value)} className="sm:max-w-56" />
          </Field>
        )}
      </Section>
      <Section title={t("contracts.f.signature")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("contracts.f.signedAt")}>
            <Input type="date" value={f.signed_at} onChange={(e) => set("signed_at", e.target.value)} />
          </Field>
          <Field label={t("contracts.f.signedBy")}>
            <Input value={f.signed_by_name} onChange={(e) => set("signed_by_name", e.target.value)} maxLength={200} dir="auto" />
          </Field>
        </div>
        <Field label={t("contracts.f.terms")}>
          <Textarea value={f.terms} onChange={(e) => set("terms", e.target.value)} rows={4} maxLength={10000} />
        </Field>
        <Field label={t("contracts.f.notes")}>
          <Textarea value={f.notes} onChange={(e) => set("notes", e.target.value)} rows={2} maxLength={4000} />
        </Field>
      </Section>
      <FormError message={error} />
      <FormActions saving={saving} label={c ? t("action.save") : t("contracts.create")} onCancel={onCancel} disabled={!f.customer_id || badDates} />
    </form>
  );
}

export function NotesForm({ contract, onDone, onCancel }: { contract: Contract; onDone: () => void; onCancel: () => void }) {
  const t = useT();
  const [notes, setNotes] = useState(contract.notes ?? "");
  const { error, saving, run } = useSubmit(onDone);
  return (
    <form className="space-y-4" onSubmit={(e) => {
      e.preventDefault();
      void run(async () => { await updateRow("contracts", contract.id, { notes: text(notes) }); });
    }}>
      <p className="text-sm text-ink-3">{t("contracts.lockedHint")}</p>
      <Field label={t("contracts.f.notes")}>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} maxLength={4000} />
      </Field>
      <FormError message={error} />
      <FormActions saving={saving} label={t("action.save")} onCancel={onCancel} />
    </form>
  );
}

export function TerminateForm({ contract, onDone, onCancel }: { contract: Contract; onDone: () => void; onCancel: () => void }) {
  const t = useT();
  const [reason, setReason] = useState("");
  const { error, saving, run } = useSubmit(onDone);
  return (
    <form className="space-y-4" onSubmit={(e) => {
      e.preventDefault();
      void run(async () => { await updateRow("contracts", contract.id, { status: "terminated", termination_reason: reason.trim() }); });
    }}>
      <p className="text-sm text-ink-2">{t("contracts.terminate.intro")}</p>
      <Field label={t("contracts.f.terminationReason")} required>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} required maxLength={1000} />
      </Field>
      <FormError message={error} />
      <FormActions saving={saving} label={t("contracts.terminate.action")} onCancel={onCancel} disabled={!reason.trim()} />
    </form>
  );
}

export function RenewForm({ contract, onDone, onCancel }: { contract: Contract; onDone: (id: string) => void; onCancel: () => void }) {
  const t = useT();
  const start = contract.end_date ? addDays(contract.end_date, 1) : "";
  const defaultEnd = contract.end_date ? addDays(start, daysBetween(contract.start_date, contract.end_date)) : "";
  const [end, setEnd] = useState(defaultEnd);
  const [amount, setAmount] = useState(String(contract.recurring_amount));
  const { error, saving, run } = useSubmit(onDone);
  const bad = !!end && end < start;
  return (
    <form className="space-y-4" onSubmit={(e) => {
      e.preventDefault();
      if (bad) return;
      void run(async () => {
        const { data, error: err } = await supabase.rpc("contract_renew", {
          p_contract_id: contract.id,
          p_end_date: end || undefined,
          p_recurring_amount: num(amount) ?? undefined,
        });
        if (err) throw wrapDbError(err);
        return data as string;
      });
    }}>
      <p className="text-sm text-ink-2">{t("contracts.renew.intro", { date: ltrText(formatDate(start)) })}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("contracts.f.end")} required error={bad ? t("contracts.f.badDates") : undefined}>
          <Input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} required />
        </Field>
        <Field label={contract.billing_frequency === "one_time" ? t("contracts.f.amountOnce") : t("contracts.f.amount")}>
          <Input type="number" min={0} step="0.001" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
      </div>
      <FormError message={error} />
      <FormActions saving={saving} label={t("contracts.renew.action")} onCancel={onCancel} disabled={!end || bad} />
    </form>
  );
}

export function VehicleForm({
  contractId, customerId, covered, onDone, onCancel,
}: {
  contractId: string;
  customerId: string;
  covered?: CoveredVehicle;
  onDone: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [vehicleId, setVehicleId] = useState(covered?.vehicle_id ?? "");
  const [rate, setRate] = useState(covered?.rate_override?.toString() ?? "");
  // Customer-owned vehicles first, but a lease of the tenant's own trucks is just as common.
  const vehicles = useVehiclePicker(vehicleId, { customerId, includeUnassigned: true, enabled: !covered });
  const { error, saving, run } = useSubmit(onDone);
  return (
    <form className="space-y-4" onSubmit={(e) => {
      e.preventDefault();
      void run(async () => {
        if (covered) await updateRow("contract_vehicles", covered.id, { rate_override: num(rate) });
        else await insertRow("contract_vehicles", { contract_id: contractId, vehicle_id: vehicleId, rate_override: num(rate) });
      });
    }}>
      {covered ? (
        <p className="text-sm font-medium text-ink">{covered.vehicle?.name}</p>
      ) : (
        <Field label={t("contracts.v.vehicle")} required>
          <Combobox {...vehicles} value={vehicleId} onChange={setVehicleId} required clearable={false} placeholder={t("contracts.v.selectVehicle")} />
        </Field>
      )}
      <Field label={t("contracts.v.rate")} hint={t("contracts.v.rateHint")}>
        <Input type="number" min={0} step="0.001" value={rate} onChange={(e) => setRate(e.target.value)} />
      </Field>
      <FormError message={error} />
      <FormActions saving={saving} label={covered ? t("action.save") : t("contracts.v.add")} onCancel={onCancel} disabled={!vehicleId} />
    </form>
  );
}
