import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Plus } from "lucide-react";
import { listPage, sanitizeSearch } from "../../lib/db";
import { formatDateTime } from "../../lib/format";
import { JOB_PRIORITIES, JOB_TYPES, minutesLate, OPEN_STATUSES } from "../../../shared/dispatch";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useT } from "../../i18n";
import { Badge, Bdi, Button, EmptyState, ErrorState, Input, LoadingState, Ltr, Modal, Pagination, Select } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { JobForm } from "./forms";
import { driverName, JOB_STATUSES, priorityTone, statusTone, useDuration } from "./labels";
import { JOB_SELECT, type DispatchJob } from "./types";

const PAGE_SIZE = 25;

export default function JobsPage() {
  const t = useT();
  const tenant = useTenant();
  const navigate = useNavigate();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const dur = useDuration();
  const [status, setStatus] = useState("open");
  const [priority, setPriority] = useState("all");
  const [type, setType] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [adding, setAdding] = useState(false);
  const term = sanitizeSearch(search);
  const now = Date.now();

  const listQ = useQuery({
    queryKey: ["dispatch_jobs", "list", { page, status, priority, type, term }],
    queryFn: () =>
      listPage<DispatchJob>("dispatch_jobs", page, PAGE_SIZE, (q) => {
        let f = q.select(JOB_SELECT);
        if (status === "open") f = f.in("status", OPEN_STATUSES);
        else if (status !== "all") f = f.eq("status", status);
        if (priority !== "all") f = f.eq("priority", priority);
        if (type !== "all") f = f.eq("job_type", type);
        if (term) f = f.or(`doc_number.ilike.%${term}%,title.ilike.%${term}%,contact_name.ilike.%${term}%,contact_phone.ilike.%${term}%`);
        return status === "open" ? f.order("window_end") : f.order("window_start", { ascending: false });
      }),
  });

  const columns: Array<DataTableColumn<DispatchJob>> = [
    {
      id: "number",
      header: t("dispatch.col.number"),
      cell: (j) => (
        <div className="min-w-0">
          <Ltr className="font-medium text-brand-700">{j.doc_number}</Ltr>
          <Bdi className="block max-w-72 truncate text-xs text-ink-3">{j.title}</Bdi>
        </div>
      ),
      sortValue: (j) => j.number ?? 0,
      exportValue: (j) => `${j.doc_number} ${j.title}`,
    },
    {
      id: "type",
      header: t("dispatch.col.type"),
      minBreakpoint: "md",
      cell: (j) => <span className="text-ink-2">{t(`dispatch.type.${j.job_type}`)}</span>,
      exportValue: (j) => j.job_type,
    },
    {
      id: "priority",
      header: t("dispatch.col.priority"),
      cell: (j) => <Badge tone={priorityTone[j.priority]}>{t(`dispatch.priority.${j.priority}`)}</Badge>,
      sortValue: (j) => JOB_PRIORITIES.indexOf(j.priority),
      exportValue: (j) => j.priority,
    },
    {
      id: "customer",
      header: t("dispatch.col.customer"),
      minBreakpoint: "lg",
      cell: (j) => (j.customer ? <Bdi className="text-ink-2">{j.customer.name}</Bdi> : <span className="text-ink-3">—</span>),
      exportValue: (j) => j.customer?.name ?? "",
    },
    {
      id: "window",
      header: t("dispatch.col.window"),
      minBreakpoint: "sm",
      cell: (j) => {
        const late = minutesLate(j, now);
        return (
          <div className="whitespace-nowrap text-ink-2">
            {formatDateTime(j.window_start, tenant.timezone)}
            <div className={late != null ? "text-xs font-medium text-serious" : "text-xs text-ink-3"}>
              {late != null
                ? j.status === "completed" ? t("dispatch.completedLate", { time: dur(late) }) : t("dispatch.lateBy", { time: dur(late) })
                : formatDateTime(j.window_end, tenant.timezone)}
            </div>
          </div>
        );
      },
      sortValue: (j) => j.window_start,
      exportValue: (j) => `${j.window_start} ${j.window_end}`,
    },
    {
      id: "assignee",
      header: t("dispatch.col.assignee"),
      minBreakpoint: "md",
      cell: (j) =>
        j.vehicle ? (
          <div className="min-w-0">
            <Bdi className="text-ink">{j.vehicle.name}</Bdi>
            {j.driver && <Bdi className="block text-xs text-ink-3">{driverName(j.driver)}</Bdi>}
          </div>
        ) : (
          <span className="text-ink-3">—</span>
        ),
      exportValue: (j) => `${j.vehicle?.name ?? ""} ${driverName(j.driver) ?? ""}`.trim(),
    },
    {
      id: "status",
      header: t("dispatch.col.status"),
      cell: (j) => <Badge tone={statusTone[j.status]}>{t(`dispatch.status.${j.status}`)}</Badge>,
      sortValue: (j) => JOB_STATUSES.indexOf(j.status),
      exportValue: (j) => j.status,
    },
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          placeholder={t("dispatch.search")}
          className="w-full sm:max-w-72"
        />
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }} className="max-w-44">
          <option value="open">{t("dispatch.open")}</option>
          <option value="all">{t("dispatch.allStatuses")}</option>
          {JOB_STATUSES.map((s) => <option key={s} value={s}>{t(`dispatch.status.${s}`)}</option>)}
        </Select>
        <Select value={priority} onChange={(e) => { setPriority(e.target.value); setPage(0); }} className="max-w-44">
          <option value="all">{t("dispatch.allPriorities")}</option>
          {JOB_PRIORITIES.map((p) => <option key={p} value={p}>{t(`dispatch.priority.${p}`)}</option>)}
        </Select>
        <Select value={type} onChange={(e) => { setType(e.target.value); setPage(0); }} className="max-w-44">
          <option value="all">{t("dispatch.allTypes")}</option>
          {JOB_TYPES.map((v) => <option key={v} value={v}>{t(`dispatch.type.${v}`)}</option>)}
        </Select>
        {isManager && (
          <Button className="ms-auto" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> {t("dispatch.new")}
          </Button>
        )}
      </div>
      {listQ.isLoading && <LoadingState />}
      {listQ.error && <ErrorState message={(listQ.error as Error).message} />}
      {listQ.data && (
        <DataTable<DispatchJob>
          tableId="dispatch-jobs"
          exportName="dispatch-jobs"
          rows={listQ.data.rows}
          rowKey={(j) => j.id}
          columns={columns}
          onRowClick={(j) => navigate(`/dispatch/jobs/${j.id}`)}
          empty={<EmptyState icon={<ClipboardList className="h-10 w-10" />} title={t("dispatch.empty")} description={t("dispatch.emptyHint")} />}
          footer={<Pagination page={page} pageSize={PAGE_SIZE} total={listQ.data.total} onPage={setPage} />}
        />
      )}
      <Modal title={t("dispatch.newTitle")} open={adding} onClose={() => setAdding(false)} wide>
        {adding && (
          <JobForm
            onCancel={() => setAdding(false)}
            onDone={(id) => {
              setAdding(false);
              void qc.invalidateQueries({ queryKey: ["dispatch_jobs"] });
              toast.success(t("dispatch.created"));
              navigate(`/dispatch/jobs/${id}`);
            }}
          />
        )}
      </Modal>
    </div>
  );
}
