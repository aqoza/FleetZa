import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Route } from "lucide-react";
import { listPage, sanitizeSearch } from "../../lib/db";
import { formatDateTime, formatDistance } from "../../lib/format";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useT } from "../../i18n";
import { Badge, Bdi, Button, EmptyState, ErrorState, Input, LoadingState, Ltr, Modal, Pagination, Select } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { TripForm } from "./TripForm";
import { driverName, statusTone, TRIP_STATUSES } from "./labels";
import { normalizeTrip, TRIP_SELECT, type Trip } from "./types";

const PAGE_SIZE = 25;

export default function TripsPage() {
  const t = useT();
  const tenant = useTenant();
  const navigate = useNavigate();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState("active");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [adding, setAdding] = useState(false);
  const term = sanitizeSearch(search);

  const listQ = useQuery({
    queryKey: ["trips", "list", { page, status, term }],
    queryFn: async () => {
      const res = await listPage<Trip>("trips", page, PAGE_SIZE, (q) => {
        let f = q.select(TRIP_SELECT);
        if (status === "active") f = f.in("status", ["planned", "dispatched", "in_progress"]);
        else if (status !== "all") f = f.eq("status", status);
        if (term) f = f.or(`doc_number.ilike.%${term}%,purpose.ilike.%${term}%`);
        // Unfinished trips read soonest first; history reads newest first.
        return f.order("planned_start", { ascending: status === "active" || status === "planned" || status === "dispatched" });
      });
      return { ...res, rows: res.rows.map(normalizeTrip) };
    },
  });

  const columns: Array<DataTableColumn<Trip>> = [
    {
      id: "number",
      header: t("trips.col.number"),
      cell: (r) => (
        <div className="min-w-0">
          <Ltr className="font-medium text-brand-700">{r.doc_number}</Ltr>
          <Bdi className="block max-w-72 truncate text-xs text-ink-3">{r.purpose}</Bdi>
        </div>
      ),
      sortValue: (r) => r.number ?? 0,
      exportValue: (r) => `${r.doc_number} ${r.purpose}`,
    },
    {
      id: "vehicle",
      header: t("trips.col.vehicle"),
      cell: (r) => (
        <div className="min-w-0">
          <Bdi className="text-ink">{r.vehicle?.name ?? "—"}</Bdi>
          {r.vehicle?.license_plate && <div dir="ltr" className="text-xs text-ink-3 rtl:text-end">{r.vehicle.license_plate}</div>}
        </div>
      ),
      sortValue: (r) => r.vehicle?.name ?? "",
      exportValue: (r) => r.vehicle?.name ?? "",
    },
    {
      id: "driver",
      header: t("trips.col.driver"),
      minBreakpoint: "md",
      cell: (r) => (r.driver ? <Bdi className="text-ink-2">{driverName(r.driver)}</Bdi> : <span className="text-ink-3">—</span>),
      sortValue: (r) => driverName(r.driver) ?? "",
      exportValue: (r) => driverName(r.driver) ?? "",
    },
    {
      id: "window",
      header: t("trips.col.window"),
      minBreakpoint: "sm",
      cell: (r) => (
        <div className="whitespace-nowrap text-ink-2">
          {formatDateTime(r.planned_start, tenant.timezone)}
          <div className="text-xs text-ink-3">{formatDateTime(r.planned_end, tenant.timezone)}</div>
        </div>
      ),
      sortValue: (r) => r.planned_start,
      exportValue: (r) => `${r.planned_start} ${r.planned_end}`,
    },
    {
      id: "distance",
      header: t("trips.col.distance"),
      align: "end",
      minBreakpoint: "lg",
      cell: (r) => (
        <span dir="ltr" className="whitespace-nowrap tabular-nums text-ink-2">
          {formatDistance(r.actual_distance_km ?? r.planned_distance_km, tenant.distance_unit)}
        </span>
      ),
      sortValue: (r) => r.actual_distance_km ?? r.planned_distance_km,
      exportValue: (r) => r.actual_distance_km ?? r.planned_distance_km ?? "",
    },
    {
      id: "status",
      header: t("trips.col.status"),
      cell: (r) => <Badge tone={statusTone[r.status]}>{t(`trips.status.${r.status}`)}</Badge>,
      sortValue: (r) => TRIP_STATUSES.indexOf(r.status),
      exportValue: (r) => r.status,
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
          placeholder={t("trips.search")}
          className="w-full sm:max-w-72"
        />
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(0);
          }}
          className="max-w-48"
        >
          <option value="active">{t("trips.active")}</option>
          <option value="all">{t("trips.allStatuses")}</option>
          {TRIP_STATUSES.map((s) => (
            <option key={s} value={s}>{t(`trips.status.${s}`)}</option>
          ))}
        </Select>
        {isManager && (
          <Button className="ms-auto" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> {t("trips.new")}
          </Button>
        )}
      </div>
      {listQ.isLoading && <LoadingState />}
      {listQ.error && <ErrorState message={(listQ.error as Error).message} />}
      {listQ.data && (
        <DataTable<Trip>
          tableId="trips"
          exportName="trips"
          rows={listQ.data.rows}
          rowKey={(r) => r.id}
          columns={columns}
          onRowClick={(r) => navigate(`/trips/${r.id}`)}
          empty={<EmptyState icon={<Route className="h-10 w-10" />} title={t("trips.empty")} description={t("trips.emptyHint")} />}
          footer={<Pagination page={page} pageSize={PAGE_SIZE} total={listQ.data.total} onPage={setPage} />}
        />
      )}

      <Modal title={t("trips.newTitle")} open={adding} onClose={() => setAdding(false)} wide>
        {adding && (
          <TripForm
            onCancel={() => setAdding(false)}
            onDone={(id) => {
              setAdding(false);
              void qc.invalidateQueries({ queryKey: ["trips"] });
              toast.success(t("trips.created"));
              navigate(`/trips/${id}`);
            }}
          />
        )}
      </Modal>
    </div>
  );
}
