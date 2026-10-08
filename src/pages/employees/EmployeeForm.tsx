import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { insertRow, listRows, updateRow } from "../../lib/db";
import { useDriverPicker, useTechnicianPicker } from "../../lib/pickers";
import type { Profile } from "../../lib/types";
import type { Tables } from "../../lib/database.types";
import { useTenant } from "../../context/AuthContext";
import { useModules } from "../../context/ModulesContext";
import { useT } from "../../i18n";
import { Button, ErrorState, Field, Input, Select, Textarea } from "../../components/ui";
import { Combobox } from "../../components/Combobox";
import { useToast } from "../../components/Toast";
import { useEmployeePicker } from "./pickers";
import { employeeStatus, employmentTypes, genders } from "./labels";
import type { Department, Employee, EmployeeStatus, EmploymentType, Gender } from "./types";

type Branch = Pick<Tables<"branches">, "id" | "name" | "name_ar" | "active">;

const TEXT_FIELDS = [
  "first_name", "last_name", "name_ar", "job_title", "nationality", "national_id",
  "passport_number", "residence_permit_number", "email", "phone", "address",
  "emergency_contact_name", "emergency_contact_phone", "bank_name", "iban",
  "social_insurance_number", "notes",
] as const;
const DATE_FIELDS = [
  "hire_date", "termination_date", "birth_date", "passport_expiry",
  "residence_permit_expiry", "work_permit_expiry",
] as const;
const MONEY_FIELDS = [
  "basic_salary", "housing_allowance", "transport_allowance", "other_allowance", "hourly_rate",
] as const;
const LINK_FIELDS = ["department_id", "branch_id", "manager_id", "user_id", "driver_id", "sl_technician_id"] as const;

type FormState = Record<
  (typeof TEXT_FIELDS)[number] | (typeof DATE_FIELDS)[number] | (typeof MONEY_FIELDS)[number] | (typeof LINK_FIELDS)[number],
  string
> & { employment_type: EmploymentType; status: EmployeeStatus; gender: Gender | "" };

function initialState(e?: Employee): FormState {
  const s = {} as FormState;
  for (const k of [...TEXT_FIELDS, ...DATE_FIELDS, ...LINK_FIELDS]) s[k] = (e?.[k] as string | null) ?? "";
  for (const k of MONEY_FIELDS) s[k] = e?.[k] != null ? String(e[k]) : "";
  s.employment_type = e?.employment_type ?? "full_time";
  s.status = e?.status ?? "active";
  s.gender = e?.gender ?? "";
  return s;
}

function Section({ title, children, hint }: { title: string; children: ReactNode; hint?: string }) {
  return (
    <fieldset className="space-y-3">
      <legend className="text-[11px] font-semibold uppercase tracking-wider text-ink-3 rtl:tracking-normal">
        {title}
      </legend>
      {hint && <p className="text-xs text-ink-3">{hint}</p>}
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

export function EmployeeForm({
  employee,
  onDone,
  onCancel,
}: {
  employee?: Employee;
  onDone: (saved: Employee) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const tenant = useTenant();
  const qc = useQueryClient();
  const toast = useToast();
  const { isEnabled } = useModules();
  const branchesOn = isEnabled("multi_company");
  const driversOn = isEnabled("drivers");
  const techniciansOn = isEnabled("speed_limiters");
  const [form, setForm] = useState<FormState>(() => initialState(employee));
  const [error, setError] = useState("");

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // Small reference lists: a tenant has a handful of departments and branches.
  const departmentsQ = useQuery({
    queryKey: ["departments", "all"],
    queryFn: () => listRows<Department>("departments", (q) => q.order("name")),
  });
  const branchesQ = useQuery({
    queryKey: ["branches", "options"],
    queryFn: () =>
      listRows<Branch>("branches", (q) => q.select("id, name, name_ar, active").order("name")),
    enabled: branchesOn,
  });
  const profilesQ = useQuery({
    queryKey: ["profiles"],
    queryFn: () => listRows<Profile>("profiles", (q) => q.order("full_name")),
  });

  const managerPicker = useEmployeePicker(form.manager_id, { activeOnly: true, excludeId: employee?.id });
  const driverPicker = useDriverPicker(form.driver_id);
  const technicianPicker = useTechnicianPicker(form.sl_technician_id, { activeOnly: false });

  const userOptions = useMemo(
    () =>
      (profilesQ.data ?? []).map((p) => ({ value: p.id, label: p.full_name || p.email, meta: p.email })),
    [profilesQ.data],
  );

  const mutation = useMutation({
    mutationFn: () => {
      const values: Record<string, unknown> = {
        employment_type: form.employment_type,
        status: form.status,
        gender: form.gender || null,
      };
      for (const k of TEXT_FIELDS) values[k] = form[k].trim() || null;
      for (const k of DATE_FIELDS) values[k] = form[k] || null;
      for (const k of MONEY_FIELDS) values[k] = form[k] === "" ? null : Number(form[k]);
      for (const k of LINK_FIELDS) values[k] = form[k] || null;
      values.first_name = form.first_name.trim();
      values.nationality = form.nationality.trim().toUpperCase() || null;
      values.iban = form.iban.replace(/\s+/g, "").toUpperCase() || null;
      // Branches are module-gated: never clear a branch the form could not show.
      if (!branchesOn) delete values.branch_id;
      if (!driversOn) delete values.driver_id;
      if (!techniciansOn) delete values.sl_technician_id;
      return employee
        ? updateRow<Employee>("employees", employee.id, values)
        : insertRow<Employee>("employees", values);
    },
    onSuccess: (saved) => {
      void qc.invalidateQueries({ queryKey: ["employees"] });
      void qc.invalidateQueries({ queryKey: ["picker", "employees"] });
      toast.success(employee ? t("toast.saved") : t("toast.created"));
      onDone(saved);
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("employees.saveFailed")),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    mutation.mutate();
  }

  const money = (label: string) => t("employees.moneyUnit", { label, currency: tenant.currency });

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {error && <ErrorState message={error} />}

      <Section title={t("employees.section.personal")}>
        <Field label={t("employees.firstName")} required>
          <Input value={form.first_name} onChange={(e) => set("first_name", e.target.value)} required maxLength={100} />
        </Field>
        <Field label={t("employees.lastName")}>
          <Input value={form.last_name} onChange={(e) => set("last_name", e.target.value)} />
        </Field>
        <Field label={t("employees.nameAr")}>
          <Input dir="rtl" lang="ar" value={form.name_ar} onChange={(e) => set("name_ar", e.target.value)} />
        </Field>
        <Field label={t("employees.genderLabel")}>
          <Select value={form.gender} onChange={(e) => set("gender", e.target.value as Gender | "")}>
            <option value="">{t("common.dash")}</option>
            {Object.entries(genders).map(([v, k]) => (
              <option key={v} value={v}>{t(k)}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("employees.birthDate")}>
          <Input type="date" value={form.birth_date} onChange={(e) => set("birth_date", e.target.value)} />
        </Field>
        <Field label={t("employees.nationality")} hint={t("employees.nationalityHint")}>
          <Input
            dir="ltr" maxLength={2}
            value={form.nationality}
            onChange={(e) => set("nationality", e.target.value.toUpperCase())}
          />
        </Field>
        <Field label={t("employees.nationalId")}>
          <Input dir="ltr" value={form.national_id} onChange={(e) => set("national_id", e.target.value)} />
        </Field>
      </Section>

      <Section title={t("employees.section.contact")}>
        <Field label={t("field.email")}>
          <Input type="email" dir="ltr" value={form.email} onChange={(e) => set("email", e.target.value)} />
        </Field>
        <Field label={t("field.phone")}>
          <Input dir="ltr" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
        </Field>
        <Field label={t("employees.address")}>
          <Input value={form.address} onChange={(e) => set("address", e.target.value)} />
        </Field>
        <Field label={t("employees.emergencyName")}>
          <Input value={form.emergency_contact_name} onChange={(e) => set("emergency_contact_name", e.target.value)} />
        </Field>
        <Field label={t("employees.emergencyPhone")}>
          <Input dir="ltr" value={form.emergency_contact_phone} onChange={(e) => set("emergency_contact_phone", e.target.value)} />
        </Field>
      </Section>

      <Section title={t("employees.section.employment")}>
        <Field label={t("employees.jobTitle")}>
          <Input value={form.job_title} onChange={(e) => set("job_title", e.target.value)} />
        </Field>
        <Field label={t("employees.department")}>
          <Select value={form.department_id} onChange={(e) => set("department_id", e.target.value)}>
            <option value="">{t("common.none")}</option>
            {(departmentsQ.data ?? []).map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </Select>
        </Field>
        {branchesOn && (
          <Field label={t("employees.branch")}>
            <Select value={form.branch_id} onChange={(e) => set("branch_id", e.target.value)}>
              <option value="">{t("common.none")}</option>
              {(branchesQ.data ?? [])
                .filter((b) => b.active || b.id === form.branch_id)
                .map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
            </Select>
          </Field>
        )}
        <Field label={t("employees.manager")}>
          <Combobox {...managerPicker} value={form.manager_id} onChange={(v) => set("manager_id", v)} />
        </Field>
        <Field label={t("employees.employmentTypeLabel")}>
          <Select
            value={form.employment_type}
            onChange={(e) => set("employment_type", e.target.value as EmploymentType)}
          >
            {Object.entries(employmentTypes).map(([v, k]) => (
              <option key={v} value={v}>{t(k)}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("field.status")}>
          <Select value={form.status} onChange={(e) => set("status", e.target.value as EmployeeStatus)}>
            {Object.entries(employeeStatus).map(([v, m]) => (
              <option key={v} value={v}>{t(m.labelKey)}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("employees.hireDate")}>
          <Input type="date" value={form.hire_date} onChange={(e) => set("hire_date", e.target.value)} />
        </Field>
        <Field label={t("employees.terminationDate")}>
          <Input
            type="date"
            min={form.hire_date || undefined}
            value={form.termination_date}
            onChange={(e) => set("termination_date", e.target.value)}
          />
        </Field>
      </Section>

      <Section title={t("employees.section.documents")}>
        <Field label={t("employees.passportNumber")}>
          <Input dir="ltr" value={form.passport_number} onChange={(e) => set("passport_number", e.target.value)} />
        </Field>
        <Field label={t("employees.passportExpiry")}>
          <Input type="date" value={form.passport_expiry} onChange={(e) => set("passport_expiry", e.target.value)} />
        </Field>
        <Field label={t("employees.residencePermitNumber")}>
          <Input dir="ltr" value={form.residence_permit_number} onChange={(e) => set("residence_permit_number", e.target.value)} />
        </Field>
        <Field label={t("employees.residencePermitExpiry")}>
          <Input type="date" value={form.residence_permit_expiry} onChange={(e) => set("residence_permit_expiry", e.target.value)} />
        </Field>
        <Field label={t("employees.workPermitExpiry")}>
          <Input type="date" value={form.work_permit_expiry} onChange={(e) => set("work_permit_expiry", e.target.value)} />
        </Field>
      </Section>

      <Section title={t("employees.section.compensation")}>
        {MONEY_FIELDS.map((k) => {
          const labelKey = {
            basic_salary: "employees.basicSalary",
            housing_allowance: "employees.housingAllowance",
            transport_allowance: "employees.transportAllowance",
            other_allowance: "employees.otherAllowance",
            hourly_rate: "employees.hourlyRate",
          } as const;
          return (
            <Field key={k} label={money(t(labelKey[k]))}>
              <Input
                type="number" min={0} step={k === "hourly_rate" ? "0.0001" : "0.01"} dir="ltr"
                value={form[k]}
                onChange={(e) => set(k, e.target.value)}
              />
            </Field>
          );
        })}
      </Section>

      <Section title={t("employees.section.banking")}>
        <Field label={t("employees.bankName")}>
          <Input value={form.bank_name} onChange={(e) => set("bank_name", e.target.value)} />
        </Field>
        <Field label={t("employees.iban")}>
          <Input dir="ltr" value={form.iban} onChange={(e) => set("iban", e.target.value)} />
        </Field>
        <Field label={t("employees.socialInsurance")}>
          <Input dir="ltr" value={form.social_insurance_number} onChange={(e) => set("social_insurance_number", e.target.value)} />
        </Field>
      </Section>

      <Section title={t("employees.section.links")} hint={t("employees.linkHint")}>
        <Field label={t("employees.linkedUser")}>
          <Combobox
            options={userOptions}
            loading={profilesQ.isLoading}
            value={form.user_id}
            onChange={(v) => set("user_id", v)}
            placeholder={t("employees.noLink")}
          />
        </Field>
        {driversOn && (
          <Field label={t("employees.linkedDriver")}>
            <Combobox {...driverPicker} value={form.driver_id} onChange={(v) => set("driver_id", v)} placeholder={t("employees.noLink")} />
          </Field>
        )}
        {techniciansOn && (
          <Field label={t("employees.linkedTechnician")}>
            <Combobox
              {...technicianPicker}
              value={form.sl_technician_id}
              onChange={(v) => set("sl_technician_id", v)}
              placeholder={t("employees.noLink")}
            />
          </Field>
        )}
      </Section>

      <Field label={t("field.notes")}>
        <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} />
      </Field>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>{t("action.cancel")}</Button>
        <Button type="submit" loading={mutation.isPending}>
          {employee ? t("action.saveChanges") : t("action.create")}
        </Button>
      </div>
    </form>
  );
}
