import { useState, type FormEvent } from "react";
import { bdiText } from "../../lib/bidi";
import { supabase } from "../../lib/supabase";
import { insertRow, updateRow, wrapDbError } from "../../lib/db";
import { useCustomerPicker, useEntityPicker, type Picker } from "../../lib/pickers";
import {
  ACTIVITY_TYPES, LEAD_SOURCES, OPEN_STAGES, stageProbability, type ActivityType, type LeadSource, type Stage,
} from "../../../shared/crm";
import { useAuth } from "../../context/AuthContext";
import { useT } from "../../i18n";
import { Button, Field, Input, Select, Textarea } from "../../components/ui";
import { Combobox } from "../../components/Combobox";
import { fromLocalInput, toLocalInput } from "./labels";
import type { Activity, Lead, Opportunity } from "./types";

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

export function useMemberPicker(selectedId: string): Picker {
  return useEntityPicker<{ id: string; full_name: string; email: string }>({
    table: "profiles",
    selectedId,
    searchColumns: ["full_name", "email"],
    orderBy: "full_name",
    toOption: (p) => ({ value: p.id, label: p.full_name || p.email, meta: p.full_name ? p.email : undefined }),
    scope: ["crm-members"],
  });
}

function OwnerField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useT();
  const members = useMemberPicker(value);
  return (
    <Field label={t("crm.f.owner")}>
      <Combobox {...members} value={value} onChange={onChange} placeholder={t("crm.f.selectOwner")} />
    </Field>
  );
}

export function LeadForm({ lead, onDone, onCancel }: { lead?: Lead; onDone: (id: string) => void; onCancel: () => void }) {
  const t = useT();
  const { profile } = useAuth();
  const l = lead;
  const [f, setF] = useState({
    name: l?.name ?? "",
    company_name: l?.company_name ?? "",
    email: l?.email ?? "",
    phone: l?.phone ?? "",
    source: (l?.source ?? "website") as LeadSource,
    owner_id: l ? (l.owner_id ?? "") : (profile?.id ?? ""),
    estimated_value: l?.estimated_value?.toString() ?? "",
    fleet_size: l?.fleet_size?.toString() ?? "",
    interest: l?.interest ?? "",
    notes: l?.notes ?? "",
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const { error, saving, run } = useSubmit(onDone);
  const converted = l?.status === "converted";

  function submit(e: FormEvent) {
    e.preventDefault();
    // A converted lead is locked except its owner and notes.
    const values = converted
      ? { owner_id: f.owner_id || null, notes: text(f.notes) }
      : {
          name: f.name.trim(),
          company_name: text(f.company_name),
          email: text(f.email),
          phone: text(f.phone),
          source: f.source,
          owner_id: f.owner_id || null,
          estimated_value: num(f.estimated_value),
          fleet_size: num(f.fleet_size),
          interest: text(f.interest),
          notes: text(f.notes),
        };
    void run(async () => (l
      ? (await updateRow<{ id: string }>("crm_leads", l.id, values)).id
      : (await insertRow<{ id: string }>("crm_leads", values)).id));
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      {converted && <p className="rounded-xl bg-canvas px-3 py-2 text-sm text-ink-2">{t("crm.lead.lockedHint")}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("crm.f.contactName")} required>
          <Input value={f.name} onChange={(e) => set("name", e.target.value)} required maxLength={200} dir="auto" disabled={converted} />
        </Field>
        <Field label={t("crm.f.company")}>
          <Input value={f.company_name} onChange={(e) => set("company_name", e.target.value)} maxLength={200} dir="auto" disabled={converted} />
        </Field>
        <Field label={t("crm.f.email")}>
          <Input type="email" value={f.email} onChange={(e) => set("email", e.target.value)} maxLength={200} dir="ltr" disabled={converted} />
        </Field>
        <Field label={t("crm.f.phone")}>
          <Input type="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} maxLength={50} dir="ltr" disabled={converted} />
        </Field>
        <Field label={t("crm.f.source")}>
          <Select value={f.source} onChange={(e) => set("source", e.target.value as LeadSource)} disabled={converted}>
            {LEAD_SOURCES.map((s) => <option key={s} value={s}>{t(`crm.source.${s}`)}</option>)}
          </Select>
        </Field>
        <OwnerField value={f.owner_id} onChange={(v) => set("owner_id", v)} />
        <Field label={t("crm.f.estimatedValue")}>
          <Input type="number" min={0} step="0.001" value={f.estimated_value} onChange={(e) => set("estimated_value", e.target.value)} disabled={converted} />
        </Field>
        <Field label={t("crm.f.fleetSize")}>
          <Input type="number" min={0} max={100000} value={f.fleet_size} onChange={(e) => set("fleet_size", e.target.value)} disabled={converted} />
        </Field>
      </div>
      <Field label={t("crm.f.interest")} hint={t("crm.f.interestHint")}>
        <Input value={f.interest} onChange={(e) => set("interest", e.target.value)} maxLength={500} dir="auto" disabled={converted} />
      </Field>
      <Field label={t("crm.f.notes")}>
        <Textarea value={f.notes} onChange={(e) => set("notes", e.target.value)} rows={3} maxLength={4000} />
      </Field>
      <FormError message={error} />
      <FormActions saving={saving} label={l ? t("action.save") : t("crm.lead.create")} onCancel={onCancel} />
    </form>
  );
}

export function OpportunityForm({
  opportunity, prefill, onDone, onCancel,
}: {
  opportunity?: Opportunity;
  prefill?: { customer_id?: string };
  onDone: (id: string) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const { profile } = useAuth();
  const o = opportunity;
  const [f, setF] = useState({
    title: o?.title ?? "",
    customer_id: o?.customer_id ?? prefill?.customer_id ?? "",
    stage: (o?.stage ?? "prospecting") as Stage,
    amount: o ? String(o.amount) : "",
    probability: String(o?.probability ?? stageProbability("prospecting")),
    expected_close_date: o?.expected_close_date ?? "",
    owner_id: o ? (o.owner_id ?? "") : (profile?.id ?? ""),
    notes: o?.notes ?? "",
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const customers = useCustomerPicker(f.customer_id);
  const { error, saving, run } = useSubmit(onDone);
  const closed = o?.stage === "won" || o?.stage === "lost";

  function submit(e: FormEvent) {
    e.preventDefault();
    const values: Record<string, unknown> = {
      title: f.title.trim(),
      customer_id: f.customer_id || null,
      amount: num(f.amount) ?? 0,
      expected_close_date: f.expected_close_date || null,
      owner_id: f.owner_id || null,
      notes: text(f.notes),
    };
    // Stage moves happen on the pipeline and the detail page; won/lost keep their probability.
    if (!o) values.stage = f.stage;
    if (!closed) values.probability = num(f.probability) ?? stageProbability(f.stage);
    void run(async () => (o
      ? (await updateRow<{ id: string }>("crm_opportunities", o.id, values)).id
      : (await insertRow<{ id: string }>("crm_opportunities", values)).id));
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <Field label={t("crm.f.title")} required>
        <Input value={f.title} onChange={(e) => set("title", e.target.value)} required maxLength={200} dir="auto"
          placeholder={t("crm.f.titlePlaceholder")} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("crm.f.customer")}>
          <Combobox {...customers} value={f.customer_id} onChange={(v) => set("customer_id", v)} placeholder={t("crm.f.selectCustomer")} />
        </Field>
        {!o && (
          <Field label={t("crm.f.stage")}>
            <Select value={f.stage} onChange={(e) => {
              const s = e.target.value as Stage;
              setF((x) => ({ ...x, stage: s, probability: String(stageProbability(s)) }));
            }}>
              {OPEN_STAGES.map((s) => <option key={s} value={s}>{t(`crm.stage.${s}`)}</option>)}
            </Select>
          </Field>
        )}
        <Field label={t("crm.f.amount")}>
          <Input type="number" min={0} step="0.001" value={f.amount} onChange={(e) => set("amount", e.target.value)} />
        </Field>
        {!closed && (
          <Field label={t("crm.f.probability")} hint={t("crm.f.probabilityHint")}>
            <Input type="number" min={0} max={100} value={f.probability} onChange={(e) => set("probability", e.target.value)} />
          </Field>
        )}
        <Field label={t("crm.f.closeDate")}>
          <Input type="date" value={f.expected_close_date} onChange={(e) => set("expected_close_date", e.target.value)} />
        </Field>
        <OwnerField value={f.owner_id} onChange={(v) => set("owner_id", v)} />
      </div>
      <Field label={t("crm.f.notes")}>
        <Textarea value={f.notes} onChange={(e) => set("notes", e.target.value)} rows={3} maxLength={4000} />
      </Field>
      <FormError message={error} />
      <FormActions saving={saving} label={o ? t("action.save") : t("crm.opp.create")} onCancel={onCancel} />
    </form>
  );
}

export function LostForm({ opportunity, onDone, onCancel }: { opportunity: Opportunity; onDone: () => void; onCancel: () => void }) {
  const t = useT();
  const [reason, setReason] = useState(opportunity.lost_reason ?? "");
  const { error, saving, run } = useSubmit(onDone);
  return (
    <form className="space-y-4" onSubmit={(e) => {
      e.preventDefault();
      void run(async () => { await updateRow("crm_opportunities", opportunity.id, { stage: "lost", lost_reason: reason.trim() }); });
    }}>
      <Field label={t("crm.f.lostReason")} required>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} required maxLength={1000}
          placeholder={t("crm.f.lostReasonPlaceholder")} />
      </Field>
      <FormError message={error} />
      <FormActions saving={saving} label={t("crm.opp.markLost")} onCancel={onCancel} disabled={!reason.trim()} />
    </form>
  );
}

export interface ConvertResult {
  customer_id: string;
  contact_id: string;
  opportunity_id: string | null;
}

export function ConvertForm({ lead, onDone, onCancel }: { lead: Lead; onDone: (r: ConvertResult) => void; onCancel: () => void }) {
  const t = useT();
  const [withOpp, setWithOpp] = useState(true);
  const { error, saving, run } = useSubmit(onDone);
  const customerName = lead.company_name?.trim() || lead.name;
  return (
    <form className="space-y-4" onSubmit={(e) => {
      e.preventDefault();
      void run(async () => {
        const { data, error: err } = await supabase.rpc("crm_convert_lead", { p_lead_id: lead.id, p_create_opportunity: withOpp });
        if (err) throw wrapDbError(err);
        return data as unknown as ConvertResult;
      });
    }}>
      <p className="text-sm text-ink-2">{t("crm.convert.intro", { customer: bdiText(customerName), contact: bdiText(lead.name) })}</p>
      <label className="flex items-start gap-2 text-sm text-ink">
        <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-line" checked={withOpp} onChange={(e) => setWithOpp(e.target.checked)} />
        <span>
          {t("crm.convert.withOpp")}
          <span className="block text-xs text-ink-3">{t("crm.convert.withOppHint")}</span>
        </span>
      </label>
      <FormError message={error} />
      <FormActions saving={saving} label={t("crm.convert.action")} onCancel={onCancel} />
    </form>
  );
}

export function ActivityForm({
  activity, links, onDone, onCancel,
}: {
  activity?: Activity;
  /** The record the activity is logged against, fixed by the page it is added from. */
  links?: { lead_id?: string | null; opportunity_id?: string | null; customer_id?: string | null };
  onDone: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const { profile } = useAuth();
  const a = activity;
  const [f, setF] = useState({
    activity_type: (a?.activity_type ?? "call") as ActivityType,
    subject: a?.subject ?? "",
    body: a?.body ?? "",
    due_at: toLocalInput(a?.due_at ?? null),
    owner_id: a ? (a.owner_id ?? "") : (profile?.id ?? ""),
    done: a ? !!a.done_at : false,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const { error, saving, run } = useSubmit(onDone);
  const logged = f.activity_type === "note";

  function submit(e: FormEvent) {
    e.preventDefault();
    const values: Record<string, unknown> = {
      activity_type: f.activity_type,
      subject: f.subject.trim(),
      body: text(f.body),
      due_at: logged ? null : fromLocalInput(f.due_at),
      owner_id: f.owner_id || null,
      done_at: logged || f.done ? (a?.done_at ?? new Date().toISOString()) : null,
    };
    void run(async () => {
      if (a) await updateRow("crm_activities", a.id, values);
      else await insertRow("crm_activities", { ...values, ...links });
    });
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("crm.f.activityType")}>
          <Select value={f.activity_type} onChange={(e) => set("activity_type", e.target.value as ActivityType)}>
            {ACTIVITY_TYPES.map((x) => <option key={x} value={x}>{t(`crm.activity.${x}`)}</option>)}
          </Select>
        </Field>
        {!logged && (
          <Field label={t("crm.f.dueAt")}>
            <Input type="datetime-local" value={f.due_at} onChange={(e) => set("due_at", e.target.value)} />
          </Field>
        )}
      </div>
      <Field label={t("crm.f.subject")} required>
        <Input value={f.subject} onChange={(e) => set("subject", e.target.value)} required maxLength={200} dir="auto" />
      </Field>
      <Field label={t("crm.f.body")}>
        <Textarea value={f.body} onChange={(e) => set("body", e.target.value)} rows={3} maxLength={4000} />
      </Field>
      <OwnerField value={f.owner_id} onChange={(v) => set("owner_id", v)} />
      {!logged && (
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" className="h-4 w-4 rounded border-line" checked={f.done} onChange={(e) => set("done", e.target.checked)} />
          {t("crm.f.alreadyDone")}
        </label>
      )}
      <FormError message={error} />
      <FormActions saving={saving} label={a ? t("action.save") : t("crm.act.create")} onCancel={onCancel} />
    </form>
  );
}
