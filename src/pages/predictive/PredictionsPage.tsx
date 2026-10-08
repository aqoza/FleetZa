import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ClipboardList } from "lucide-react";
import { listPage } from "../../lib/db";
import { formatDate, formatDateTime } from "../../lib/format";
import { useTenant } from "../../context/AuthContext";
import { useT } from "../../i18n";
import { Badge, Bdi, EmptyState, ErrorState, LoadingState, Pagination, Select } from "../../components/ui";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { bandTone, statusTone } from "./labels";
import { PREDICTION_SELECT, type Prediction, type PredictionStatus } from "./types";

const PAGE_SIZE = 25;
const STATUSES: PredictionStatus[] = ["open", "actioned", "dismissed"];

/** Saved snapshots: what was flagged, and whether it became a work order or was dismissed. */
export default function PredictionsPage() {
  const t = useT();
  const tenant = useTenant();
  const [status, setStatus] = useState("open");
  const [band, setBand] = useState("all");
  const [page, setPage] = useState(0);

  const listQ = useQuery({
    queryKey: ["maintenance_predictions", { page, status, band }],
    queryFn: () =>
      listPage<Prediction>("maintenance_predictions", page, PAGE_SIZE, (q) => {
        let f = q.select(PREDICTION_SELECT);
        if (status !== "all") f = f.eq("status", status);
        if (band !== "all") f = f.eq("band", band);
        return f.order("computed_at", { ascending: false }).order("risk_score", { ascending: false });
      }),
  });

  const columns: Array<DataTableColumn<Prediction>> = [
    {
      id: "vehicle",
      header: t("predictive.col.vehicle"),
      cell: (p) => (
        <div className="min-w-0">
          <Link to={`/predictive/vehicles/${p.vehicle_id}`} className="font-medium text-brand-700 hover:underline">
            <Bdi>{p.vehicle?.name ?? "…"}</Bdi>
          </Link>
          {p.vehicle?.license_plate && <div dir="ltr" className="text-xs text-ink-3 rtl:text-end">{p.vehicle.license_plate}</div>}
        </div>
      ),
      sortValue: (p) => p.vehicle?.name ?? "",
      exportValue: (p) => p.vehicle?.name ?? p.vehicle_id,
    },
    {
      id: "score",
      header: t("predictive.col.score"),
      align: "end",
      cell: (p) => <span className="font-semibold tabular-nums text-ink">{p.risk_score}</span>,
      sortValue: (p) => p.risk_score,
    },
    {
      id: "band",
      header: t("predictive.col.band"),
      cell: (p) => <Badge tone={bandTone[p.band]}>{t(`predictive.band.${p.band}`)}</Badge>,
      sortValue: (p) => p.risk_score,
      exportValue: (p) => p.band,
    },
    {
      id: "factors",
      header: t("predictive.col.factors"),
      minBreakpoint: "lg",
      cell: (p) =>
        p.factors.length === 0 ? (
          <span className="text-ink-3">—</span>
        ) : (
          <span className="text-ink-2">
            {p.factors.slice(0, 2).map((f) => t(`predictive.f.${f.code}`)).join(t("common.listSeparator"))}
            {p.factors.length > 2 && <span className="text-ink-3"> {t("predictive.moreFactors", { count: p.factors.length - 2 })}</span>}
          </span>
        ),
      exportValue: (p) => p.factors.map((f) => f.code).join(" "),
    },
    {
      id: "predicted",
      header: t("predictive.s.predicted"),
      minBreakpoint: "md",
      cell: (p) => <span className="whitespace-nowrap text-ink-2">{p.predicted_service_date ? formatDate(p.predicted_service_date) : "—"}</span>,
      sortValue: (p) => p.predicted_service_date ?? "",
      exportValue: (p) => p.predicted_service_date ?? "",
    },
    {
      id: "computed",
      header: t("predictive.col.computed"),
      minBreakpoint: "sm",
      cell: (p) => <span className="whitespace-nowrap text-ink-2">{formatDateTime(p.computed_at, tenant.timezone)}</span>,
      sortValue: (p) => p.computed_at,
      exportValue: (p) => p.computed_at,
    },
    {
      id: "status",
      header: t("predictive.col.status"),
      cell: (p) => (
        <div className="min-w-0">
          <Badge tone={statusTone[p.status]}>{t(`predictive.status.${p.status}`)}</Badge>
          {p.note && <Bdi className="mt-0.5 block max-w-56 truncate text-xs text-ink-3">{p.note}</Bdi>}
        </div>
      ),
      sortValue: (p) => STATUSES.indexOf(p.status),
      exportValue: (p) => p.status,
    },
    {
      id: "workOrder",
      header: t("predictive.col.workOrder"),
      minBreakpoint: "sm",
      cell: (p) =>
        p.work_order_id && p.work_order ? (
          <Link to={`/maintenance/work-orders/${p.work_order_id}`} className="whitespace-nowrap text-brand-700 hover:underline">
            {t("maintenance.workOrderNumber", { number: p.work_order.number })}
          </Link>
        ) : (
          <span className="text-ink-3">—</span>
        ),
      exportValue: (p) => p.work_order?.number ?? "",
    },
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(0);
          }}
          className="max-w-48"
        >
          <option value="all">{t("predictive.allStatuses")}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{t(`predictive.status.${s}`)}</option>
          ))}
        </Select>
        <Select
          value={band}
          onChange={(e) => {
            setBand(e.target.value);
            setPage(0);
          }}
          className="max-w-48"
        >
          <option value="all">{t("predictive.allBands")}</option>
          {(["high", "medium", "low"] as const).map((b) => (
            <option key={b} value={b}>{t(`predictive.band.${b}`)}</option>
          ))}
        </Select>
      </div>
      {listQ.isLoading && <LoadingState />}
      {listQ.error && <ErrorState message={(listQ.error as Error).message} />}
      {listQ.data && (
        <DataTable<Prediction>
          tableId="predictive-predictions"
          exportName="maintenance-predictions"
          rows={listQ.data.rows}
          rowKey={(p) => p.id}
          columns={columns}
          empty={
            <EmptyState
              icon={<ClipboardList className="h-10 w-10" />}
              title={t("predictive.predictionsEmpty")}
              description={t("predictive.predictionsEmptyHint")}
            />
          }
          footer={<Pagination page={page} pageSize={PAGE_SIZE} total={listQ.data.total} onPage={setPage} />}
        />
      )}
    </div>
  );
}
