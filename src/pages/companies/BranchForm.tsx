import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { insertRow, updateRow } from "../../lib/db";
import { useEntityPicker } from "../../lib/pickers";
import type { Tables } from "../../lib/database.types";
import { useModules } from "../../context/ModulesContext";
import { useT } from "../../i18n";
import { Button, ErrorState, Field, Input, Select, Textarea } from "../../components/ui";
import { Combobox } from "../../components/Combobox";
import { useToast } from "../../components/Toast";
import { useCompanies } from "./hooks";
import type { Branch } from "./types";

export function BranchForm({ branch, onDone }: { branch?: Branch; onDone: (saved?: Branch) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const { isEnabled } = useModules();
  const employeesOn = isEnabled("employees");
  const companiesQ = useCompanies();
  const companies = companiesQ.data ?? [];
  const defaultCompany = companies.find((c) => c.is_default)?.id ?? "";
  const [form, setForm] = useState({
    name: branch?.name ?? "",
    name_ar: branch?.name_ar ?? "",
    code: branch?.code ?? "",
    // null = "use the default company once the list loads" for a new branch.
    company_id: branch ? branch.company_id ?? "" : (null as string | null),
    manager_employee_id: branch?.manager_employee_id ?? "",
    phone: branch?.phone ?? "",
    address: branch?.address ?? "",
    city: branch?.city ?? "",
    country: branch?.country ?? "",
    active: branch?.active ?? true,
  });
  const [error, setError] = useState("");
  const companyId = form.company_id ?? defaultCompany;
  const managerPicker = useEntityPicker<Tables<"employees">>({
    table: "employees",
    selectedId: form.manager_employee_id,
    searchColumns: ["first_name", "last_name", "doc_number"],
    orderBy: "first_name",
    toOption: (e) => ({ value: e.id, label: `${e.first_name} ${e.last_name ?? ""}`.trim(), meta: e.job_title ?? undefined }),
    filter: (q) => q.neq("status", "terminated"),
    scope: ["employees", "branch-manager"],
    enabled: employeesOn,
  });

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }
  const text = (v: string) => v.trim() || null;

  const mutation = useMutation({
    mutationFn: () => {
      const values: Record<string, unknown> = {
        name: form.name.trim(),
        name_ar: text(form.name_ar),
        code: text(form.code),
        company_id: companyId || null,
        phone: text(form.phone),
        address: text(form.address),
        city: text(form.city),
        country: text(form.country),
        active: form.active,
      };
      // Never clear a manager the form could not show.
      if (employeesOn) values.manager_employee_id = form.manager_employee_id || null;
      return branch
        ? updateRow<Branch>("branches", branch.id, values)
        : insertRow<Branch>("branches", values);
    },
    onSuccess: (saved) => {
      void qc.invalidateQueries({ queryKey: ["branches"] });
      void qc.invalidateQueries({ queryKey: ["picker", "branches"] });
      toast.success(branch ? t("toast.saved") : t("toast.created"));
      onDone(saved);
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("companies.branchSaveFailed")),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    mutation.mutate();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && <ErrorState message={error} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("companies.branchName")} required>
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} required maxLength={200} />
        </Field>
        <Field label={t("companies.nameAr")}>
          <Input dir="rtl" lang="ar" value={form.name_ar} onChange={(e) => set("name_ar", e.target.value)} />
        </Field>
        <Field label={t("companies.code")}>
          <Input dir="ltr" value={form.code} onChange={(e) => set("code", e.target.value)} />
        </Field>
        <Field label={t("companies.company")}>
          <Select value={companyId} onChange={(e) => set("company_id", e.target.value)}>
            <option value="">{t("companies.noCompany")}</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.legal_name}</option>
            ))}
          </Select>
        </Field>
        {employeesOn && (
          <Field label={t("companies.manager")}>
            <Combobox
              {...managerPicker}
              value={form.manager_employee_id}
              onChange={(v) => set("manager_employee_id", v)}
            />
          </Field>
        )}
        <Field label={t("field.phone")}>
          <Input type="tel" dir="ltr" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
        </Field>
        <Field label={t("companies.city")}>
          <Input value={form.city} onChange={(e) => set("city", e.target.value)} />
        </Field>
        <Field label={t("companies.country")}>
          <Input value={form.country} onChange={(e) => set("country", e.target.value)} />
        </Field>
      </div>
      <Field label={t("companies.address")}>
        <Textarea value={form.address} onChange={(e) => set("address", e.target.value)} />
      </Field>
      <label className="flex items-center gap-2 text-sm font-medium text-ink-2">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-line"
          checked={form.active}
          onChange={(e) => set("active", e.target.checked)}
        />
        {t("companies.active")}
      </label>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => onDone()}>{t("action.cancel")}</Button>
        <Button type="submit" loading={mutation.isPending}>
          {branch ? t("action.saveChanges") : t("action.create")}
        </Button>
      </div>
    </form>
  );
}
