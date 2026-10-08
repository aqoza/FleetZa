import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2, UserRound } from "lucide-react";
import { deleteRow, listPage, listRows, sanitizeSearch } from "../../lib/db";
import { bdiText } from "../../lib/bidi";
import { formatDate } from "../../lib/format";
import { employeeName, nextDocument } from "../../lib/employees";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useI18n, useT, useTp } from "../../i18n";
import {
  Badge, Bdi, Button, EmptyState, ErrorState, Input, LoadingState, Ltr, Modal, Pagination, Select,
} from "../../components/ui";
import { useToast } from "../../components/Toast";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { EmployeeForm } from "./EmployeeForm";
import { DocumentBadge, todayIso } from "./shared";
import { documentKinds, employeeStatus } from "./labels";
import { EMPLOYEE_SELECT, type Department, type Employee, type EmployeeRow } from "./types";

const PAGE_SIZE = 25;

/** "current" = everyone not terminated: the list people want by default. */
type StatusFilter = "current" | "all" | Employee["status"];

export default function EmployeesPage() {
  const t = useT();
  const tp = useTp();
  const { language } = useI18n();
  const tenant = useTenant();
  const navigate = useNavigate();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("current");
  const [page, setPage] = useState(0);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [deleting, setDeleting] = useState<Employee | null>(null);
  const [actionError, setActionError] = useState("");
  const today = todayIso();

  // % , ( ) are .or() logic-tree syntax, not search text.
  const term = sanitizeSearch(search);

  const { data, isLoading, error } = useQuery({
    queryKey: ["employees", "list", { page, term, department: departmentFilter, status: statusFilter }],
    queryFn: () =>
      listPage<EmployeeRow>("employees", page, PAGE_SIZE, (q) => {
        let f = q.select(EMPLOYEE_SELECT);
        if (departmentFilter === "none") f = f.is("department_id", null);
        else if (departmentFilter !== "all") f = f.eq("department_id", departmentFilter);
        if (statusFilter === "current") f = f.neq("status", "terminated");
        else if (statusFilter !== "all") f = f.eq("status", statusFilter);
        if (term) {
          f = f.or(
            `first_name.ilike.%${term}%,last_name.ilike.%${term}%,name_ar.ilike.%${term}%,` +
              `doc_number.ilike.%${term}%,national_id.ilike.%${term}%,phone.ilike.%${term}%,` +
              `job_title.ilike.%${term}%`,
          );
        }
        return f.order("first_name").order("last_name");
      }),
  });
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;

  const departmentsQ = useQuery({
    queryKey: ["departments", "all"],
    queryFn: () => listRows<Department>("departments", (q) => q.order("name")),
    enabled: isManager,
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteRow("employees", id),
    onSuccess: () => {
      setActionError("");
      void qc.invalidateQueries({ queryKey: ["employees"] });
      setDeleting(null);
      toast.success(t("toast.deleted"));
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : t("employees.deleteFailed"));
      setDeleting(null);
    },
  });

  const filtersOn = term !== "" || departmentFilter !== "all" || statusFilter !== "current";

  const columns: Array<DataTableColumn<EmployeeRow>> = [
    {
      id: "employee",
      header: t("employees.employee"),
      cell: (e) => (
        <>
          <Link to={`/employees/${e.id}`} className="font-medium text-brand-700 hover:underline">
            <Bdi>{employeeName(e, language)}</Bdi>
          </Link>
          <div className="text-xs text-ink-3">
            {e.doc_number && <Ltr>{e.doc_number}</Ltr>}
            {e.doc_number && e.job_title && " · "}
            {e.job_title && <Bdi>{e.job_title}</Bdi>}
          </div>
        </>
      ),
      sortValue: (e) => employeeName(e, language),
      exportValue: (e) => employeeName(e),
    },
    {
      id: "number",
      header: t("employees.number"),
      defaultHidden: true,
      cell: (e) => <span className="text-ink-2 tabular-nums"><Ltr>{e.doc_number ?? "—"}</Ltr></span>,
      sortValue: (e) => e.number,
      exportValue: (e) => e.doc_number ?? "",
      dir: "ltr",
    },
    {
      id: "department",
      header: t("employees.department"),
      minBreakpoint: "md",
      cell: (e) => (
        <span className="text-ink-2">
          {e.department ? (
            <Bdi>{language === "ar" && e.department.name_ar ? e.department.name_ar : e.department.name}</Bdi>
          ) : (
            "—"
          )}
        </span>
      ),
      sortValue: (e) => e.department?.name ?? null,
      exportValue: (e) => e.department?.name ?? "",
    },
    {
      id: "phone",
      header: t("field.phone"),
      minBreakpoint: "lg",
      cell: (e) => <span className="text-ink-2"><Ltr>{e.phone ?? "—"}</Ltr></span>,
      sortValue: (e) => e.phone,
      exportValue: (e) => e.phone ?? "",
      dir: "ltr",
    },
    {
      id: "hireDate",
      header: t("employees.hireDate"),
      minBreakpoint: "xl",
      defaultHidden: true,
      cell: (e) => <span className="text-ink-2 tabular-nums">{formatDate(e.hire_date, tenant.timezone)}</span>,
      sortValue: (e) => e.hire_date,
      exportValue: (e) => e.hire_date ?? "",
    },
    {
      id: "nextDocument",
      header: t("employees.nextDocument"),
      minBreakpoint: "lg",
      cell: (e) => {
        const doc = nextDocument(e, today);
        return doc ? <DocumentBadge doc={doc} withKind /> : <span className="text-ink-3">—</span>;
      },
      sortValue: (e) => nextDocument(e, today)?.days ?? null,
      exportValue: (e) => {
        const doc = nextDocument(e, today);
        return doc ? `${t(documentKinds[doc.kind])} ${doc.expiry}` : "";
      },
    },
    {
      id: "status",
      header: t("common.status"),
      cell: (e) => {
        const st = employeeStatus[e.status];
        return <Badge tone={st.tone}>{t(st.labelKey)}</Badge>;
      },
      sortValue: (e) => t(employeeStatus[e.status].labelKey),
      exportValue: (e) => t(employeeStatus[e.status].labelKey),
    },
    ...(isManager
      ? [
          {
            id: "actions",
            header: "",
            align: "end",
            cell: (e) => (
              <div className="flex justify-end gap-1">
                <button
                  className="rounded p-1.5 text-ink-3 hover:bg-canvas hover:text-ink-2"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    setEditing(e);
                  }}
                  aria-label={t("employees.editEmployee")}
                  title={t("action.edit")}
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  className="rounded p-1.5 text-ink-3 hover:bg-serious-soft hover:text-serious"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    setDeleting(e);
                  }}
                  aria-label={t("employees.deleteEmployee")}
                  title={t("action.delete")}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ),
          } satisfies DataTableColumn<EmployeeRow>,
        ]
      : []),
  ];

  return (
    <>
      {!isManager && (
        <p className="mb-4 rounded-xl border border-line bg-surface px-4 py-3 text-sm text-ink-2">
          {t("employees.ownRecordOnly")}
        </p>
      )}

      {isManager && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder={t("employees.searchPlaceholder")}
            className="max-w-80"
          />
          <Select
            value={departmentFilter}
            onChange={(e) => {
              setDepartmentFilter(e.target.value);
              setPage(0);
            }}
            className="max-w-48"
          >
            <option value="all">{t("employees.allDepartments")}</option>
            {(departmentsQ.data ?? []).map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
            <option value="none">{t("common.none")}</option>
          </Select>
          <Select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as StatusFilter);
              setPage(0);
            }}
            className="max-w-44"
          >
            <option value="current">{t("employees.currentStaff")}</option>
            <option value="all">{t("employees.allStatuses")}</option>
            {Object.entries(employeeStatus).map(([v, m]) => (
              <option key={v} value={v}>{t(m.labelKey)}</option>
            ))}
          </Select>
          <div className="ms-auto">
            <Button onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" /> {t("employees.newEmployee")}
            </Button>
          </div>
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
        <DataTable<EmployeeRow>
          tableId="employees"
          exportName="employees"
          rows={rows}
          rowKey={(e) => e.id}
          onRowClick={(e) => navigate(`/employees/${e.id}`)}
          columns={columns}
          toolbar={
            isManager && total > 0 ? (
              <span className="text-sm text-ink-3 tabular-nums">{tp("employees.countEmployees", total)}</span>
            ) : undefined
          }
          empty={
            <EmptyState
              icon={<UserRound className="h-10 w-10" />}
              title={
                !isManager
                  ? t("employees.noOwnRecord")
                  : filtersOn
                    ? t("employees.emptyFilteredTitle")
                    : t("employees.emptyTitle")
              }
              description={
                !isManager
                  ? undefined
                  : filtersOn
                    ? t("employees.emptyFilteredDesc")
                    : t("employees.emptyDesc")
              }
              action={
                isManager && !filtersOn ? (
                  <Button onClick={() => setAdding(true)}>
                    <Plus className="h-4 w-4" /> {t("employees.newEmployee")}
                  </Button>
                ) : undefined
              }
            />
          }
          footer={<Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />}
        />
      )}

      <Modal title={t("employees.newEmployee")} open={adding} onClose={() => setAdding(false)} wide>
        <EmployeeForm
          onDone={(saved) => {
            setAdding(false);
            navigate(`/employees/${saved.id}`);
          }}
          onCancel={() => setAdding(false)}
        />
      </Modal>

      <Modal title={t("employees.editEmployee")} open={!!editing} onClose={() => setEditing(null)} wide>
        {editing && (
          <EmployeeForm employee={editing} onDone={() => setEditing(null)} onCancel={() => setEditing(null)} />
        )}
      </Modal>

      <Modal title={t("employees.deleteEmployee")} open={!!deleting} onClose={() => setDeleting(null)}>
        {deleting && (
          <>
            <p className="text-sm text-ink-2">
              {t("employees.deleteConfirm", { name: bdiText(employeeName(deleting)) })}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeleting(null)}>
                {t("action.cancel")}
              </Button>
              <Button variant="danger" onClick={() => remove.mutate(deleting.id)} loading={remove.isPending}>
                {t("employees.deleteEmployee")}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
