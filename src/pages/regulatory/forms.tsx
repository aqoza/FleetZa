import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { formatDate } from "../../lib/format";
import { getRow, insertRow, updateRow, wrapDbError } from "../../lib/db";
import { useDriverPicker, useEntityPicker, useVehiclePicker, type Picker } from "../../lib/pickers";
import {
  CATEGORIES, SUBJECT_TYPES, TEMPLATE_COUNTRIES, nextDueDate, type Category, type SubjectType,
} from "../../../shared/regulatory";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useModules } from "../../context/ModulesContext";
import { useI18n, useT } from "../../i18n";
import { Button, Field, Input, Select, Textarea } from "../../components/ui";
import { Combobox } from "../../components/Combobox";
import { useEmployeePicker } from "../employees/pickers";
import { uploadDocument } from "../documents/storage";
import { addDays, reqTitle, todayIn } from "./labels";
import type { Obligation, Requirement } from "./types";

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

const text = (v: string) => (v.trim() === "" ? null : v.trim());

export function RequirementForm({ requirement, onDone, onCancel }: {
  requirement?: Requirement;
  onDone: (id: string) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const r = requirement;
  const [f, setF] = useState({
    code: r?.code ?? "",
    title: r?.title ?? "",
    title_ar: r?.title_ar ?? "",
    authority: r?.authority ?? "",
    country: r?.country ?? "",
    category: (r?.category ?? "license") as Category,
    applies_to: (r?.applies_to ?? "vehicle") as SubjectType,
    recurring: r ? r.frequency_months != null : true,
    frequency_months: r?.frequency_months?.toString() ?? "12",
    lead_days: r?.lead_days?.toString() ?? "30",
    reference_url: r?.reference_url ?? "",
    description: r?.description ?? "",
    verified: r?.verified ?? true,
    active: r?.active ?? true,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const { error, saving, run } = useSubmit(onDone);

  function submit(e: FormEvent) {
    e.preventDefault();
    const values = {
      code: f.code.trim(),
      title: f.title.trim(),
      title_ar: text(f.title_ar),
      authority: text(f.authority),
      country: text(f.country.toUpperCase()),
      category: f.category,
      applies_to: f.applies_to,
      frequency_months: f.recurring ? Number(f.frequency_months) : null,
      lead_days: Number(f.lead_days || 0),
      reference_url: text(f.reference_url),
      description: text(f.description),
      verified: f.verified,
      active: f.active,
    };
    void run(async () => (r
      ? (await updateRow<{ id: string }>("compliance_requirements", r.id, values)).id
      : (await insertRow<{ id: string }>("compliance_requirements", values)).id));
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("regulatory.f.code")} required>
          <Input value={f.code} onChange={(e) => set("code", e.target.value)} required maxLength={40} dir="ltr" />
        </Field>
        <div className="sm:col-span-2">
          <Field label={t("regulatory.f.title")} required>
            <Input value={f.title} onChange={(e) => set("title", e.target.value)} required maxLength={200} dir="auto" />
          </Field>
        </div>
      </div>
      <Field label={t("regulatory.f.titleAr")}>
        <Input value={f.title_ar} onChange={(e) => set("title_ar", e.target.value)} maxLength={200} dir="rtl" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("regulatory.f.category")} required>
          <Select value={f.category} onChange={(e) => set("category", e.target.value as Category)}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{t(`regulatory.cat.${c}`)}</option>)}
          </Select>
        </Field>
        <Field label={t("regulatory.f.appliesTo")} required hint={r ? t("regulatory.f.appliesToHint") : undefined}>
          <Select value={f.applies_to} onChange={(e) => set("applies_to", e.target.value as SubjectType)}>
            {SUBJECT_TYPES.map((s) => <option key={s} value={s}>{t(`regulatory.subject.${s}`)}</option>)}
          </Select>
        </Field>
        <Field label={t("regulatory.f.country")} hint={t("regulatory.f.countryHint")}>
          <Input value={f.country} onChange={(e) => set("country", e.target.value.toUpperCase().slice(0, 2))} maxLength={2} dir="ltr"
            pattern="[A-Za-z]{2}" />
        </Field>
      </div>
      <Field label={t("regulatory.f.authority")}>
        <Input value={f.authority} onChange={(e) => set("authority", e.target.value)} maxLength={200} dir="auto" />
      </Field>
      <label className="flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" checked={f.recurring} onChange={(e) => set("recurring", e.target.checked)} className="h-4 w-4 rounded border-line" />
        {t("regulatory.f.recurring")}
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("regulatory.f.frequency")}>
          <Input type="number" min={1} max={120} value={f.recurring ? f.frequency_months : ""} disabled={!f.recurring}
            onChange={(e) => set("frequency_months", e.target.value)} required={f.recurring} />
        </Field>
        <Field label={t("regulatory.f.lead")} hint={t("regulatory.f.leadHint")}>
          <Input type="number" min={0} max={365} value={f.lead_days} onChange={(e) => set("lead_days", e.target.value)} required />
        </Field>
      </div>
      <Field label={t("regulatory.f.reference")}>
        <Input type="url" value={f.reference_url} onChange={(e) => set("reference_url", e.target.value)} maxLength={500} dir="ltr"
          placeholder="https://" />
      </Field>
      <Field label={t("regulatory.f.description")}>
        <Textarea value={f.description} onChange={(e) => set("description", e.target.value)} rows={3} maxLength={4000} />
      </Field>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={f.verified} onChange={(e) => set("verified", e.target.checked)} className="h-4 w-4 rounded border-line" />
          {t("regulatory.f.verified")}
        </label>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={f.active} onChange={(e) => set("active", e.target.checked)} className="h-4 w-4 rounded border-line" />
          {t("regulatory.f.active")}
        </label>
      </div>
      <FormError message={error} />
      <FormActions saving={saving} label={r ? t("action.save") : t("regulatory.r.add")} onCancel={onCancel} />
    </form>
  );
}

export function SeedForm({ onDone, onCancel }: { onDone: (added: number) => void; onCancel: () => void }) {
  const t = useT();
  const tenant = useTenant();
  const initial = (TEMPLATE_COUNTRIES as readonly string[]).includes(tenant.country) ? tenant.country : "XX";
  const [country, setCountry] = useState(initial);
  const { error, saving, run } = useSubmit(onDone);
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          const { data, error: err } = await supabase.rpc("regulatory_seed_templates", { p_country: country });
          if (err) throw wrapDbError(err);
          return (data as number) ?? 0;
        });
      }}
    >
      <p className="text-sm text-ink-2">{t("regulatory.seed.hint")}</p>
      <Field label={t("regulatory.seed.country")}>
        <Select value={country} onChange={(e) => setCountry(e.target.value)}>
          {TEMPLATE_COUNTRIES.map((c) => <option key={c} value={c}>{t(`regulatory.country.${c}`)}</option>)}
          <option value="XX">{t("regulatory.country.XX")}</option>
        </Select>
      </Field>
      <p className="rounded-xl bg-warn-soft px-3 py-2 text-xs text-warn">{t("regulatory.seed.verify")}</p>
      <FormError message={error} />
      <FormActions saving={saving} label={t("regulatory.seed.add")} onCancel={onCancel} />
    </form>
  );
}

export function GenerateForm({ requirement, onDone, onCancel }: { requirement: Requirement; onDone: (n: number) => void; onCancel: () => void }) {
  const t = useT();
  const tenant = useTenant();
  const [due, setDue] = useState(addDays(todayIn(tenant.timezone), Math.max(requirement.lead_days, 30)));
  const { error, saving, run } = useSubmit(onDone);
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          const { data, error: err } = await supabase.rpc("regulatory_generate_obligations", { p_requirement_id: requirement.id, p_due_date: due });
          if (err) throw wrapDbError(err);
          return (data as number) ?? 0;
        });
      }}
    >
      <p className="text-sm text-ink-2">{t(`regulatory.gen.hint.${requirement.applies_to}`)}</p>
      <Field label={t("regulatory.gen.due")} required hint={t("regulatory.gen.dueHint")}>
        <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} required />
      </Field>
      <FormError message={error} />
      <FormActions saving={saving} label={t("regulatory.gen.create")} onCancel={onCancel} disabled={!due} />
    </form>
  );
}

function useMemberPicker(selectedId: string): Picker {
  return useEntityPicker<{ id: string; full_name: string; email: string }>({
    table: "profiles",
    selectedId,
    searchColumns: ["full_name", "email"],
    orderBy: "full_name",
    toOption: (p) => ({ value: p.id, label: p.full_name || p.email, meta: p.full_name ? p.email : undefined }),
    scope: ["regulatory-members"],
  });
}

function SubjectPicker({ type, value, onChange }: { type: SubjectType; value: string; onChange: (v: string) => void }) {
  const t = useT();
  const vehicles = useVehiclePicker(type === "vehicle" ? value : "", { ownership: "company" });
  const drivers = useDriverPicker(type === "driver" ? value : "");
  const employees = useEmployeePicker(type === "employee" ? value : "", { activeOnly: true, enabled: type === "employee" });
  const picker = type === "vehicle" ? vehicles : type === "driver" ? drivers : employees;
  return (
    <Field label={t(`regulatory.subject.${type}`)} required>
      <Combobox {...picker} value={value} onChange={onChange} required clearable={false} placeholder={t(`regulatory.o.select.${type}`)} />
    </Field>
  );
}

export function ObligationForm({ obligation, requirementId, subject, onDone, onCancel }: {
  obligation?: Obligation;
  requirementId?: string;
  subject?: { type: SubjectType; id: string };
  onDone: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const { language } = useI18n();
  const tenant = useTenant();
  const o = obligation;
  const [reqId, setReqId] = useState(o?.requirement_id ?? requirementId ?? "");
  const [subjectId, setSubjectId] = useState(o?.subject_id ?? subject?.id ?? "");
  const [due, setDue] = useState(o?.due_date ?? addDays(todayIn(tenant.timezone), 30));
  const [responsible, setResponsible] = useState(o?.responsible_user ?? "");
  const [notes, setNotes] = useState(o?.notes ?? "");
  const requirements = useEntityPicker<Pick<Requirement, "id" | "code" | "title" | "title_ar" | "applies_to">>({
    table: "compliance_requirements",
    selectedId: reqId,
    searchColumns: ["code", "title", "title_ar"],
    orderBy: "code",
    toOption: (r) => ({ value: r.id, label: reqTitle(r, language), meta: `${r.code} · ${t(`regulatory.subject.${r.applies_to}`)}` }),
    filter: (q) => (subject ? q.eq("active", true).eq("applies_to", subject.type) : q.eq("active", true)),
    scope: ["regulatory-reqs", subject?.type],
    enabled: !o,
  });
  const members = useMemberPicker(responsible);
  const { error, saving, run } = useSubmit(onDone);

  // The picked requirement's scope decides which subject to ask for.
  const scopeQ = useQuery({
    queryKey: ["compliance_requirements", "scope", reqId],
    enabled: !o && !!reqId,
    queryFn: async () => (await getRow<{ applies_to: SubjectType }>("compliance_requirements", reqId))?.applies_to ?? "",
  });
  const pickRequirement = (id: string) => { setReqId(id); if (!subject) setSubjectId(""); };
  const type: SubjectType | "" = o?.subject_type ?? (reqId ? (scopeQ.data ?? "") : "");
  const needsSubject = type !== "" && type !== "company";

  function submit(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      const common = { due_date: due, responsible_user: responsible || null, notes: text(notes) };
      if (o) await updateRow("compliance_obligations", o.id, common);
      else {
        await insertRow("compliance_obligations", {
          requirement_id: reqId, subject_type: type, subject_id: needsSubject ? subjectId : null, ...common,
        });
      }
    });
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      {!o && (
        <Field label={t("regulatory.o.requirement")} required>
          <Combobox {...requirements} value={reqId} onChange={pickRequirement} required clearable={false} placeholder={t("regulatory.o.selectRequirement")} />
        </Field>
      )}
      {!o && needsSubject && !subject && <SubjectPicker type={type} value={subjectId} onChange={setSubjectId} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("regulatory.o.due")} required>
          <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} required />
        </Field>
        <Field label={t("regulatory.o.responsible")}>
          <Combobox {...members} value={responsible} onChange={setResponsible} placeholder={t("regulatory.o.selectResponsible")} />
        </Field>
      </div>
      <Field label={t("regulatory.o.notes")}>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={4000} />
      </Field>
      <FormError message={error} />
      <FormActions saving={saving} label={o ? t("action.save") : t("regulatory.o.add")} onCancel={onCancel}
        disabled={!o && (!reqId || !type || (needsSubject && !subjectId))} />
    </form>
  );
}

export function CompleteForm({ obligation, onDone, onCancel }: { obligation: Obligation; onDone: (nextId: string | null) => void; onCancel: () => void }) {
  const t = useT();
  const tenant = useTenant();
  const { profile } = useAuth();
  const { isEnabled } = useModules();
  const today = todayIn(tenant.timezone);
  const [completed, setCompleted] = useState(today);
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState("");
  const { error, saving, run } = useSubmit(onDone);
  const months = obligation.requirement?.frequency_months ?? null;
  const next = months && obligation.requirement?.active && completed ? nextDueDate(obligation.due_date, completed, months) : null;
  const docsOn = isEnabled("documents");

  function submit(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      let evidence: string | null = null;
      if (file && profile) {
        const linked = obligation.subject_type !== "company" && obligation.subject_id
          ? { entity_type: obligation.subject_type, entity_id: obligation.subject_id } : {};
        const doc = await uploadDocument(profile.tenant_id, file, {
          name: file.name, category: "certificate", description: obligation.requirement?.title ?? null, ...linked,
        });
        evidence = doc.id;
      }
      const { data, error: err } = await supabase.rpc("obligation_complete", {
        p_obligation_id: obligation.id, p_completed_on: completed, p_evidence_document_id: evidence ?? undefined, p_notes: text(notes) ?? undefined,
      });
      if (err) throw wrapDbError(err);
      return (data as string | null) ?? null;
    });
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <Field label={t("regulatory.c.completedOn")} required>
        <Input type="date" value={completed} max={today} onChange={(e) => setCompleted(e.target.value)} required />
      </Field>
      {docsOn && (
        <Field label={t("regulatory.c.evidence")} hint={t("regulatory.c.evidenceHint")}>
          <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-ink-2 file:me-3 file:rounded-lg file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-sm file:text-ink-2" />
        </Field>
      )}
      <Field label={t("regulatory.o.notes")}>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={4000} />
      </Field>
      {next && <p className="rounded-xl bg-canvas px-3 py-2 text-sm text-ink-2">{t("regulatory.c.next", { date: formatDate(next) })}</p>}
      <FormError message={error} />
      <FormActions saving={saving} label={t("regulatory.c.complete")} onCancel={onCancel} disabled={!completed} />
    </form>
  );
}

export type StatusStep = "non_compliant" | "waived";

export function StatusForm({ obligation, step, onDone, onCancel }: { obligation: Obligation; step: StatusStep; onDone: () => void; onCancel: () => void }) {
  const t = useT();
  const [notes, setNotes] = useState(obligation.notes ?? "");
  const { error, saving, run } = useSubmit(onDone);
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => { await updateRow("compliance_obligations", obligation.id, { status: step, notes: text(notes) }); });
      }}
    >
      <Field label={t(`regulatory.s.reason.${step}`)} required>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} required maxLength={4000} />
      </Field>
      <FormError message={error} />
      <FormActions saving={saving} label={t(`regulatory.s.do.${step}`)} onCancel={onCancel} disabled={!notes.trim()} />
    </form>
  );
}
