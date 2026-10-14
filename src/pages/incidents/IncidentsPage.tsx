import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, ShieldAlert, X } from "lucide-react";
import { listPage, listRows, sanitizeSearch } from "../../lib/db";
import { formatDateTime, formatMoney } from "../../lib/format";
import {
  INCIDENT_STATUSES, INCIDENT_TYPES, OPEN_STATUSES, SEVERITIES, incidentCost, type IncidentStatus, type IncidentType, type Severity,
} from "../../../shared/incidents";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useT } from "../../i18n";
import { Badge, Bdi, Button, EmptyState, ErrorState, Input, LoadingState, Ltr, Modal, Pagination, Select } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { IncidentForm } from "./forms";
import { driverName, severityTone, statusTone } from "./labels";
import { INCIDENT_SELECT, type Incident } from "./types";

const PAGE_SIZE = 25;
type Filter = "open" | "all" | IncidentStatus;

export default function IncidentsPage() {
  const t = useT();
  const tenant = useTenant();
  const navigate = useNavigate();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const driverId = params.get("driver") ?? "";
  const [filter, setFilter] = useState<Filter>(driverId ? "all" : "open");
  const [type, setType] = useState<"" | IncidentType>("");
  const [severity, setSeverity] = useState<"" | Severity>("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [creating, setCreating] = useState(false);
  const term = sanitizeSearch(search);

  const countsQ = useQuery({
    queryKey: ["incidents", "counts", driverId],
    queryFn: () =>
      listRows<{ status: IncidentStatus }>("incidents", (q) => {
        const f = q.select("status");
        return (driverId ? f.eq("driver_id", driverId) : f).limit(10000);
      }),
  });
  const counts = useMemo(() => {
    const m = new Map<IncidentStatus, number>();
    for (const r of countsQ.data ?? []) m.set(r.status, (m.get(r.status) ?? 0) + 1);
    return m;
  }, [countsQ.data]);
  const openCount = OPEN_STATUSES.reduce((n, s) => n + (counts.get(s) ?? 0), 0);

  const driverQ = useQuery({
    queryKey: ["drivers", "name", driverId],
    enabled: !!driverId,
    queryFn: async () =>
      (await listRows<{ first_name: string; last_name: string }>("drivers", (q) => q.select("first_name, last_name").eq("id", driverId).limit(1)))[0] ?? null,
  });

  const listQ = useQuery({
    queryKey: ["incidents", "list", { page, filter, term, type, severity, driverId }],
    queryFn: () =>
      listPage<Incident>("incidents", page, PAGE_SIZE, (q) => {
        let f = q.select(INCIDENT_SELECT);
        if (filter === "open") f = f.in("status", OPEN_STATUSES);
        else if (filter !== "all") f = f.eq("status", filter);
        if (type) f = f.eq("incident_type", type);
        if (severity) f = f.eq("severity", severity);
        if (driverId) f = f.eq("driver_id", driverId);
        if (term) f = f.or(`doc_number.ilike.%${term}%,description.ilike.%${term}%,location.ilike.%${term}%,police_report_number.ilike.%${term}%`);
        return f.order("occurred_at", { ascending: false });
      }),
  });

  const pick = (f: Filter) => { setFilter(f); setPage(0); };
  const chip = (f: Filter, label: string, n: number) => (
    <button
      key={f}
      type="button"
      onClick={() => pick(f)}
      aria-pressed={filter === f}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${
        filter === f ? "border-brand-600 bg-brand-600 text-white" : "border-line bg-surface text-ink-2 hover:bg-canvas"
      }`}
    >
      {label}
      <Ltr className={`text-xs ${filter === f ? "text-white/80" : "text-ink-3"}`}>{String(n)}</Ltr>
    </button>
  );

  const columns: Array<DataTableColumn<Incident>> = [
    {
      id: "number",
      header: t("incidents.col.number"),
      cell: (i) => <Ltr className="whitespace-nowrap font-medium text-brand-700">{i.doc_number}</Ltr>,
      sortValue: (i) => i.number ?? 0,
      exportValue: (i) => i.doc_number ?? "",
    },
    {
      id: "what",
      header: t("incidents.col.what"),
      cell: (i) => (
        <div className="min-w-0 max-w-80">
          <div className="truncate text-ink">{t(`incidents.type.${i.incident_type}`)} · <Bdi>{i.vehicle?.name}</Bdi></div>
          <div className="truncate text-xs text-ink-3"><Bdi>{i.description}</Bdi></div>
        </div>
      ),
      exportValue: (i) => `${i.incident_type} · ${i.vehicle?.name ?? ""} · ${i.description}`,
    },
    {
      id: "driver",
      header: t("incidents.col.driver"),
      minBreakpoint: "lg",
      cell: (i) => (i.driver ? <Bdi className="text-ink-2">{driverName(i.driver)}</Bdi> : <span className="text-ink-3">—</span>),
      exportValue: (i) => driverName(i.driver),
    },
    {
      id: "occurred",
      header: t("incidents.col.occurred"),
      minBreakpoint: "md",
      cell: (i) => <span className="whitespace-nowrap text-ink-2">{formatDateTime(i.occurred_at, tenant.timezone)}</span>,
      sortValue: (i) => i.occurred_at,
      exportValue: (i) => i.occurred_at,
    },
    {
      id: "severity",
      header: t("incidents.col.severity"),
      minBreakpoint: "sm",
      cell: (i) => <span className="whitespace-nowrap"><Badge tone={severityTone[i.severity]}>{t(`incidents.severity.${i.severity}`)}</Badge></span>,
      sortValue: (i) => SEVERITIES.indexOf(i.severity),
      exportValue: (i) => i.severity,
    },
    {
      id: "cost",
      header: t("incidents.col.cost"),
      minBreakpoint: "lg",
      align: "end",
      cell: (i) => (i.actual_cost == null && i.estimated_damage == null
        ? <span className="text-ink-3">—</span>
        : <span className="whitespace-nowrap text-ink-2">{formatMoney(incidentCost(i), i.currency)}</span>),
      sortValue: (i) => incidentCost(i),
      exportValue: (i) => incidentCost(i),
    },
    {
      id: "status",
      header: t("incidents.col.status"),
      cell: (i) => <span className="whitespace-nowrap"><Badge tone={statusTone[i.status]}>{t(`incidents.status.${i.status}`)}</Badge></span>,
      sortValue: (i) => INCIDENT_STATUSES.indexOf(i.status),
      exportValue: (i) => i.status,
    },
  ];

  return (
    <div>
      {driverId && (
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-line bg-canvas px-3 py-1 text-sm text-ink">
          {t("incidents.forDriver", { name: driverName(driverQ.data ?? null) || "…" })}
          <button type="button" aria-label={t("incidents.clearDriver")} className="text-ink-3 hover:text-ink"
            onClick={() => { params.delete("driver"); setParams(params, { replace: true }); setPage(0); }}>
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      <div className="mb-3 flex flex-wrap gap-2">
        {chip("open", t("incidents.filter.open"), openCount)}
        {INCIDENT_STATUSES.map((s) => chip(s, t(`incidents.status.${s}`), counts.get(s) ?? 0))}
        {chip("all", t("incidents.filter.all"), countsQ.data?.length ?? 0)}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} placeholder={t("incidents.search")} className="w-full sm:max-w-72" />
        <div className="w-[calc(50%-0.375rem)] sm:w-44"><Select value={type} onChange={(e) => { setType(e.target.value as "" | IncidentType); setPage(0); }} aria-label={t("incidents.f.type")}>
          <option value="">{t("incidents.filter.anyType")}</option>
          {INCIDENT_TYPES.map((x) => <option key={x} value={x}>{t(`incidents.type.${x}`)}</option>)}
        </Select></div>
        <div className="w-[calc(50%-0.375rem)] sm:w-44"><Select value={severity} onChange={(e) => { setSeverity(e.target.value as "" | Severity); setPage(0); }} aria-label={t("incidents.f.severity")}>
          <option value="">{t("incidents.filter.anySeverity")}</option>
          {SEVERITIES.map((x) => <option key={x} value={x}>{t(`incidents.severity.${x}`)}</option>)}
        </Select></div>
        {isManager && (
          <Button className="ms-auto" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> {t("incidents.report")}
          </Button>
        )}
      </div>
      {listQ.isLoading && <LoadingState />}
      {listQ.error && <ErrorState message={(listQ.error as Error).message} />}
      {listQ.data && (
        <DataTable<Incident>
          tableId="incidents"
          exportName="incidents"
          rows={listQ.data.rows}
          rowKey={(i) => i.id}
          columns={columns}
          onRowClick={(i) => navigate(`/incidents/i/${i.id}`)}
          empty={<EmptyState icon={<ShieldAlert className="h-10 w-10" />} title={t("incidents.empty")} description={t("incidents.emptyHint")} />}
          footer={<Pagination page={page} pageSize={PAGE_SIZE} total={listQ.data.total} onPage={setPage} />}
        />
      )}
      <Modal title={t("incidents.newTitle")} open={creating} onClose={() => setCreating(false)} wide>
        {creating && (
          <IncidentForm
            onCancel={() => setCreating(false)}
            onDone={(id) => {
              setCreating(false);
              void qc.invalidateQueries({ queryKey: ["incidents"] });
              toast.success(t("incidents.saved"));
              navigate(`/incidents/i/${id}`);
            }}
          />
        )}
      </Modal>
    </div>
  );
}
