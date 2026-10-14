import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Route as RouteIcon } from "lucide-react";
import { listPage } from "../../lib/db";
import { formatDate } from "../../lib/format";
import { ROUTE_STATUSES } from "../../../shared/deliveries";
import { useAuth } from "../../context/AuthContext";
import { useT } from "../../i18n";
import { Badge, Bdi, Button, EmptyState, ErrorState, Input, LoadingState, Ltr, Modal, Pagination, Select } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { RouteForm } from "./forms";
import { driverName, routeTone } from "./labels";
import { ROUTE_SELECT, type DeliveryRoute } from "./types";

const PAGE_SIZE = 25;

export function stopCounts(r: Pick<DeliveryRoute, "deliveries">) {
  const total = r.deliveries.length;
  const done = r.deliveries.filter((d) => d.status !== "assigned" && d.status !== "out_for_delivery").length;
  return { total, done };
}

export default function RoutesPage() {
  const t = useT();
  const navigate = useNavigate();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState("all");
  const [date, setDate] = useState("");
  const [page, setPage] = useState(0);
  const [adding, setAdding] = useState(false);

  const listQ = useQuery({
    queryKey: ["delivery_routes", "list", { page, status, date }],
    queryFn: () =>
      listPage<DeliveryRoute>("delivery_routes", page, PAGE_SIZE, (q) => {
        let f = q.select(ROUTE_SELECT);
        if (status !== "all") f = f.eq("status", status);
        if (date) f = f.eq("route_date", date);
        return f.order("route_date", { ascending: false }).order("number", { ascending: false });
      }),
  });

  const columns: Array<DataTableColumn<DeliveryRoute>> = [
    {
      id: "number",
      header: t("deliveries.col.route"),
      cell: (r) => <Ltr className="font-medium text-brand-700">{r.doc_number}</Ltr>,
      sortValue: (r) => r.number ?? 0,
      exportValue: (r) => r.doc_number ?? "",
    },
    {
      id: "date",
      header: t("deliveries.col.date"),
      cell: (r) => <span className="whitespace-nowrap text-ink-2">{formatDate(`${r.route_date}T12:00:00Z`, "UTC")}</span>,
      sortValue: (r) => r.route_date,
      exportValue: (r) => r.route_date,
    },
    {
      id: "vehicle",
      header: t("deliveries.col.vehicle"),
      minBreakpoint: "sm",
      cell: (r) => (
        <div className="min-w-0">
          <Bdi className="text-ink">{r.vehicle?.name ?? "—"}</Bdi>
          {r.driver && <Bdi className="block text-xs text-ink-3">{driverName(r.driver)}</Bdi>}
        </div>
      ),
      exportValue: (r) => `${r.vehicle?.name ?? ""} ${driverName(r.driver) ?? ""}`.trim(),
    },
    {
      id: "stops",
      header: t("deliveries.col.stops"),
      align: "end",
      cell: (r) => {
        const c = stopCounts(r);
        return <span className="whitespace-nowrap text-ink-2">{t("deliveries.stopsDone", { done: c.done, total: c.total })}</span>;
      },
      sortValue: (r) => r.deliveries.length,
      exportValue: (r) => r.deliveries.length,
    },
    {
      id: "status",
      header: t("deliveries.col.status"),
      cell: (r) => <Badge tone={routeTone[r.status]}>{t(`deliveries.route.${r.status}`)}</Badge>,
      sortValue: (r) => ROUTE_STATUSES.indexOf(r.status),
      exportValue: (r) => r.status,
    },
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Input type="date" value={date} onChange={(e) => { setDate(e.target.value); setPage(0); }} className="max-w-44" />
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }} className="max-w-48">
          <option value="all">{t("deliveries.routes.allStatuses")}</option>
          {ROUTE_STATUSES.map((s) => <option key={s} value={s}>{t(`deliveries.route.${s}`)}</option>)}
        </Select>
        {isManager && (
          <Button className="ms-auto" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> {t("deliveries.routes.new")}
          </Button>
        )}
      </div>
      {listQ.isLoading && <LoadingState />}
      {listQ.error && <ErrorState message={(listQ.error as Error).message} />}
      {listQ.data && (
        <DataTable<DeliveryRoute>
          tableId="delivery-routes"
          exportName="delivery-routes"
          rows={listQ.data.rows}
          rowKey={(r) => r.id}
          columns={columns}
          onRowClick={(r) => navigate(`/deliveries/routes/${r.id}`)}
          empty={<EmptyState icon={<RouteIcon className="h-10 w-10" />} title={t("deliveries.routes.empty")} description={t("deliveries.routes.emptyHint")} />}
          footer={<Pagination page={page} pageSize={PAGE_SIZE} total={listQ.data.total} onPage={setPage} />}
        />
      )}
      <Modal title={t("deliveries.routes.newTitle")} open={adding} onClose={() => setAdding(false)} wide>
        {adding && (
          <RouteForm
            onCancel={() => setAdding(false)}
            onDone={(id) => {
              setAdding(false);
              void qc.invalidateQueries({ queryKey: ["delivery_routes"] });
              toast.success(t("deliveries.routes.created"));
              navigate(`/deliveries/routes/${id}`);
            }}
          />
        )}
      </Modal>
    </div>
  );
}
