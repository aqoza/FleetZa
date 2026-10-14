import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ClipboardList, Plus, Search } from "lucide-react";
import { listPage, sanitizeSearch } from "../../lib/db";
import { formatDateTime } from "../../lib/format";
import { employeeName } from "../../lib/employees";
import {
  FIELD_STATUSES, OPEN_STATUSES, checklistProgress, isOverdue, parseChecklist, type FieldTaskStatus,
} from "../../lib/field";
import { useTenant } from "../../context/AuthContext";
import { useI18n, useT, useTp } from "../../i18n";
import { Badge, Bdi, Button, EmptyState, ErrorState, Input, LoadingState, Ltr, Modal, Pagination, Select } from "../../components/ui";
import { Combobox } from "../../components/Combobox";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { useEmployeePicker } from "../employees/pickers";
import { taskPriority, taskStatus } from "./labels";
import { TaskForm } from "./TaskForm";
import { TASK_LIST_SELECT, type FieldTask } from "./types";

const PAGE_SIZE = 25;

export default function TasksPage() {
  const t = useT();
  const tp = useTp();
  const { language } = useI18n();
  const tenant = useTenant();
  const navigate = useNavigate();
  const [status, setStatus] = useState<"open" | "all" | FieldTaskStatus>("open");
  const [employee, setEmployee] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [creating, setCreating] = useState(false);
  const picker = useEmployeePicker(employee);
  const term = sanitizeSearch(search);

  const { data, isLoading, error } = useQuery({
    queryKey: ["field_tasks", "board", { status, employee, term, page }],
    queryFn: () =>
      listPage<FieldTask>("field_tasks", page, PAGE_SIZE, (q) => {
        let f = q.select(TASK_LIST_SELECT);
        if (status === "open") f = f.in("status", OPEN_STATUSES);
        else if (status !== "all") f = f.eq("status", status);
        if (employee) f = f.eq("employee_id", employee);
        if (term) f = f.or(`title.ilike.%${term}%,doc_number.ilike.%${term}%`);
        return status === "open" || status === "assigned" || status === "accepted" || status === "in_progress"
          ? f.order("due_at", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false })
          : f.order("created_at", { ascending: false });
      }),
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const now = Date.now();

  const columns: Array<DataTableColumn<FieldTask>> = [
    {
      id: "task",
      header: t("field.col.task"),
      cell: (r) => (
        <>
          <Link to={`/field/tasks/${r.id}`} className="font-medium text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()}>
            <Bdi>{r.title}</Bdi>
          </Link>
          <div className="text-xs text-ink-3">
            <Ltr>{r.doc_number ?? ""}</Ltr>
            {r.employee && (
              <span className="sm:hidden"> · <Bdi>{employeeName(r.employee, language)}</Bdi></span>
            )}
          </div>
        </>
      ),
      sortValue: (r) => r.title,
      exportValue: (r) => `${r.doc_number ?? ""} ${r.title}`.trim(),
    },
    {
      id: "assignee",
      header: t("field.col.assignee"),
      minBreakpoint: "sm",
      cell: (r) => (r.employee ? <Bdi>{employeeName(r.employee, language)}</Bdi> : t("common.dash")),
      sortValue: (r) => (r.employee ? employeeName(r.employee, language) : null),
      exportValue: (r) => (r.employee ? employeeName(r.employee) : ""),
    },
    {
      id: "where",
      header: t("field.col.where"),
      minBreakpoint: "lg",
      cell: (r) => (
        <span className="text-ink-2">
          {r.customer ? <Bdi>{r.customer.name}</Bdi> : null}
          {r.customer && r.vehicle ? " · " : null}
          {r.vehicle ? <Bdi>{r.vehicle.license_plate ?? r.vehicle.name}</Bdi> : null}
          {!r.customer && !r.vehicle && (r.address ? <span dir="auto">{r.address}</span> : t("common.dash"))}
        </span>
      ),
      exportValue: (r) => [r.customer?.name, r.vehicle?.license_plate ?? r.vehicle?.name, r.address].filter(Boolean).join(" · "),
    },
    {
      id: "due",
      header: t("field.col.due"),
      minBreakpoint: "md",
      cell: (r) =>
        r.due_at ? (
          <span className={`tabular-nums ${isOverdue(r, now) ? "font-medium text-serious" : "text-ink-2"}`}>
            <Ltr>{formatDateTime(r.due_at, tenant.timezone)}</Ltr>
          </span>
        ) : (
          t("common.dash")
        ),
      sortValue: (r) => r.due_at,
      exportValue: (r) => r.due_at ?? "",
    },
    {
      id: "progress",
      header: t("field.col.progress"),
      minBreakpoint: "xl",
      align: "end",
      cell: (r) => {
        const p = checklistProgress(parseChecklist(r.checklist));
        return p.total > 0 ? <span className="tabular-nums text-ink-2"><Ltr>{`${p.done}/${p.total}`}</Ltr></span> : t("common.dash");
      },
    },
    {
      id: "priority",
      header: t("field.f.priority"),
      minBreakpoint: "md",
      cell: (r) => <Badge tone={taskPriority[r.priority].tone}>{t(taskPriority[r.priority].labelKey)}</Badge>,
      sortValue: (r) => ["low", "medium", "high", "urgent"].indexOf(r.priority),
      exportValue: (r) => r.priority,
    },
    {
      id: "status",
      header: t("common.status"),
      cell: (r) => (
        <span className="inline-flex flex-wrap gap-1">
          <Badge tone={taskStatus[r.status].tone}>{t(taskStatus[r.status].labelKey)}</Badge>
          {isOverdue(r, now) && <span className="md:hidden"><Badge tone="red">{t("field.overdue")}</Badge></span>}
        </span>
      ),
      sortValue: (r) => FIELD_STATUSES.indexOf(r.status),
      exportValue: (r) => r.status,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder={t("field.searchPlaceholder")}
            className="ps-9"
          />
        </div>
        <div className="w-full sm:w-60">
          <Combobox
            {...picker}
            value={employee}
            onChange={(v) => {
              setEmployee(v);
              setPage(0);
            }}
            placeholder={t("field.filter.allEmployees")}
          />
        </div>
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as typeof status);
            setPage(0);
          }}
          className="max-w-44"
        >
          <option value="open">{t("field.filter.open")}</option>
          <option value="all">{t("field.filter.all")}</option>
          {FIELD_STATUSES.map((s) => (
            <option key={s} value={s}>{t(taskStatus[s].labelKey)}</option>
          ))}
        </Select>
        <div className="ms-auto">
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> {t("field.newTask")}
          </Button>
        </div>
      </div>

      {isLoading && <LoadingState />}
      {error && <ErrorState message={(error as Error).message} />}
      {!isLoading && !error && (
        <DataTable<FieldTask>
          tableId="field-tasks"
          exportName="field-tasks"
          rows={rows}
          rowKey={(r) => r.id}
          columns={columns}
          onRowClick={(r) => navigate(`/field/tasks/${r.id}`)}
          toolbar={total > 0 ? <span className="text-sm text-ink-3 tabular-nums">{tp("field.taskCount", total)}</span> : undefined}
          empty={
            <EmptyState icon={<ClipboardList className="h-10 w-10" />} title={t("field.emptyTasksTitle")} description={t("field.emptyTasksDesc")} />
          }
          footer={<Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />}
        />
      )}

      <Modal title={t("field.newTask")} open={creating} onClose={() => setCreating(false)} wide>
        {creating && (
          <TaskForm
            onDone={(id) => {
              setCreating(false);
              if (id) navigate(`/field/tasks/${id}`);
            }}
          />
        )}
      </Modal>
    </div>
  );
}
