import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building, Pencil, Plus, Trash2 } from "lucide-react";
import { countRows, deleteRow, insertRow, listRows, updateRow } from "../../lib/db";
import { bdiText } from "../../lib/bidi";
import { employeeName } from "../../lib/employees";
import { useAuth } from "../../context/AuthContext";
import { useI18n, useT } from "../../i18n";
import {
  Bdi, Button, EmptyState, ErrorState, Field, Input, LoadingState, Ltr, Modal, Select,
} from "../../components/ui";
import { Combobox } from "../../components/Combobox";
import { useToast } from "../../components/Toast";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { useEmployeePicker } from "./pickers";
import type { Department, Employee } from "./types";

type DepartmentRow = Department & {
  manager: Pick<Employee, "id" | "first_name" | "last_name" | "name_ar"> | null;
};

/** employees↔departments has two FKs, so the manager embed names its own. */
const DEPARTMENT_SELECT =
  "*, manager:employees!departments_manager_employee_id_fkey(id, first_name, last_name, name_ar)";

function DepartmentForm({
  department,
  departments,
  onDone,
}: {
  department?: Department;
  departments: Department[];
  onDone: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({
    name: department?.name ?? "",
    name_ar: department?.name_ar ?? "",
    code: department?.code ?? "",
    parent_id: department?.parent_id ?? "",
    manager_employee_id: department?.manager_employee_id ?? "",
  });
  const [error, setError] = useState("");
  const managerPicker = useEmployeePicker(form.manager_employee_id, { activeOnly: true });

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // A department cannot sit under itself or under one of its own descendants.
  const blocked = useMemo(() => {
    const out = new Set<string>();
    if (!department) return out;
    out.add(department.id);
    let grew = true;
    while (grew) {
      grew = false;
      for (const d of departments) {
        if (d.parent_id && out.has(d.parent_id) && !out.has(d.id)) {
          out.add(d.id);
          grew = true;
        }
      }
    }
    return out;
  }, [department, departments]);

  const mutation = useMutation({
    mutationFn: () => {
      const values = {
        name: form.name.trim(),
        name_ar: form.name_ar.trim() || null,
        code: form.code.trim() || null,
        parent_id: form.parent_id || null,
        manager_employee_id: form.manager_employee_id || null,
      };
      return department
        ? updateRow<Department>("departments", department.id, values)
        : insertRow<Department>("departments", values);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["departments"] });
      toast.success(department ? t("toast.saved") : t("toast.created"));
      onDone();
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("employees.departmentSaveFailed")),
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
        <Field label={t("employees.departmentName")} required>
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} required maxLength={200} />
        </Field>
        <Field label={t("employees.nameAr")}>
          <Input dir="rtl" lang="ar" value={form.name_ar} onChange={(e) => set("name_ar", e.target.value)} />
        </Field>
        <Field label={t("employees.departmentCode")}>
          <Input dir="ltr" value={form.code} onChange={(e) => set("code", e.target.value)} />
        </Field>
        <Field label={t("employees.parentDepartment")}>
          <Select value={form.parent_id} onChange={(e) => set("parent_id", e.target.value)}>
            <option value="">{t("employees.topLevel")}</option>
            {departments
              .filter((d) => !blocked.has(d.id))
              .map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
          </Select>
        </Field>
        <Field label={t("employees.departmentManager")}>
          <Combobox
            {...managerPicker}
            value={form.manager_employee_id}
            onChange={(v) => set("manager_employee_id", v)}
          />
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>{t("action.cancel")}</Button>
        <Button type="submit" loading={mutation.isPending}>
          {department ? t("action.saveChanges") : t("action.create")}
        </Button>
      </div>
    </form>
  );
}

export default function DepartmentsPage() {
  const t = useT();
  const { language } = useI18n();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [deleting, setDeleting] = useState<Department | null>(null);
  const [actionError, setActionError] = useState("");

  // A tenant has tens of departments, not thousands: one bounded list.
  const { data, isLoading, error } = useQuery({
    queryKey: ["departments", "with-manager"],
    queryFn: () =>
      listRows<DepartmentRow>("departments", (q) => q.select(DEPARTMENT_SELECT).order("name").limit(500)),
  });
  const departments = useMemo(() => data ?? [], [data]);

  // Exact head-only counts, one per department (tens of them), so a big
  // directory can never be truncated by the response row cap.
  const departmentIds = departments.map((d) => d.id);
  const headcountQ = useQuery({
    queryKey: ["employees", "department-headcount", departmentIds],
    queryFn: async () => {
      const counts = await Promise.all(
        departmentIds.map((id) =>
          countRows("employees", (q) => q.eq("department_id", id).neq("status", "terminated")),
        ),
      );
      return new Map(departmentIds.map((id, i) => [id, counts[i]]));
    },
    enabled: isManager && departmentIds.length > 0,
  });
  const headcount = headcountQ.data ?? new Map<string, number>();

  const byId = useMemo(() => new Map(departments.map((d) => [d.id, d])), [departments]);
  const label = (d: Pick<Department, "name" | "name_ar">) => (language === "ar" && d.name_ar ? d.name_ar : d.name);

  const remove = useMutation({
    mutationFn: (id: string) => deleteRow("departments", id),
    onSuccess: () => {
      setActionError("");
      void qc.invalidateQueries({ queryKey: ["departments"] });
      void qc.invalidateQueries({ queryKey: ["employees"] });
      setDeleting(null);
      toast.success(t("toast.deleted"));
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : t("employees.departmentSaveFailed"));
      setDeleting(null);
    },
  });

  const columns: Array<DataTableColumn<DepartmentRow>> = [
    {
      id: "name",
      header: t("employees.departmentName"),
      cell: (d) => (
        <>
          <div className="font-medium text-ink"><Bdi>{label(d)}</Bdi></div>
          {d.code && <div className="text-xs text-ink-3"><Ltr>{d.code}</Ltr></div>}
        </>
      ),
      sortValue: (d) => label(d),
      exportValue: (d) => d.name,
    },
    {
      id: "parent",
      header: t("employees.parentDepartment"),
      minBreakpoint: "md",
      cell: (d) => {
        const p = d.parent_id ? byId.get(d.parent_id) : undefined;
        return <span className="text-ink-2">{p ? <Bdi>{label(p)}</Bdi> : t("employees.topLevel")}</span>;
      },
      sortValue: (d) => (d.parent_id ? byId.get(d.parent_id)?.name ?? null : null),
      exportValue: (d) => (d.parent_id ? byId.get(d.parent_id)?.name ?? "" : ""),
    },
    {
      id: "manager",
      header: t("employees.departmentManager"),
      minBreakpoint: "md",
      cell: (d) => <span className="text-ink-2">{d.manager ? <Bdi>{employeeName(d.manager, language)}</Bdi> : "—"}</span>,
      sortValue: (d) => (d.manager ? employeeName(d.manager) : null),
      exportValue: (d) => (d.manager ? employeeName(d.manager) : ""),
    },
    {
      id: "headcount",
      header: t("employees.headcount"),
      align: "end",
      cell: (d) => <span className="text-ink-2 tabular-nums">{headcount.get(d.id) ?? 0}</span>,
      sortValue: (d) => headcount.get(d.id) ?? 0,
      exportValue: (d) => headcount.get(d.id) ?? 0,
    },
    ...(isManager
      ? [
          {
            id: "actions",
            header: "",
            align: "end",
            cell: (d) => (
              <div className="flex justify-end gap-1">
                <button
                  className="rounded p-1.5 text-ink-3 hover:bg-canvas hover:text-ink-2"
                  onClick={() => setEditing(d)}
                  aria-label={t("employees.editDepartment")}
                  title={t("action.edit")}
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  className="rounded p-1.5 text-ink-3 hover:bg-serious-soft hover:text-serious"
                  onClick={() => setDeleting(d)}
                  aria-label={t("employees.deleteDepartment")}
                  title={t("action.delete")}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ),
          } satisfies DataTableColumn<DepartmentRow>,
        ]
      : []),
  ];

  return (
    <>
      {isManager && (
        <div className="mb-4 flex justify-end">
          <Button onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> {t("employees.newDepartment")}
          </Button>
        </div>
      )}
      {isLoading && <LoadingState />}
      {error && <ErrorState message={(error as Error).message} />}
      {actionError && (
        <div className="mb-4">
          <ErrorState message={actionError} />
        </div>
      )}
      {!isLoading && !error && (
        <DataTable<DepartmentRow>
          tableId="departments"
          exportName="departments"
          rows={departments}
          rowKey={(d) => d.id}
          columns={columns}
          empty={
            <EmptyState
              icon={<Building className="h-10 w-10" />}
              title={t("employees.noDepartments")}
              description={t("employees.noDepartmentsDesc")}
              action={
                isManager ? (
                  <Button onClick={() => setAdding(true)}>
                    <Plus className="h-4 w-4" /> {t("employees.newDepartment")}
                  </Button>
                ) : undefined
              }
            />
          }
        />
      )}

      <Modal title={t("employees.newDepartment")} open={adding} onClose={() => setAdding(false)} wide>
        <DepartmentForm departments={departments} onDone={() => setAdding(false)} />
      </Modal>
      <Modal title={t("employees.editDepartment")} open={!!editing} onClose={() => setEditing(null)} wide>
        {editing && <DepartmentForm department={editing} departments={departments} onDone={() => setEditing(null)} />}
      </Modal>
      <Modal title={t("employees.deleteDepartment")} open={!!deleting} onClose={() => setDeleting(null)}>
        {deleting && (
          <>
            <p className="text-sm text-ink-2">
              {t("employees.deleteDepartmentConfirm", { name: bdiText(deleting.name) })}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeleting(null)}>{t("action.cancel")}</Button>
              <Button variant="danger" onClick={() => remove.mutate(deleting.id)} loading={remove.isPending}>
                {t("employees.deleteDepartment")}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
