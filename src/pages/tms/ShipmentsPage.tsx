import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, PackageSearch, Plus } from "lucide-react";
import { listPage, sanitizeSearch } from "../../lib/db";
import { formatDateTime, formatMoney } from "../../lib/format";
import { ACTIVE_SHIPMENT_STATUSES, SHIPMENT_STATUSES } from "../../../shared/tms";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useT } from "../../i18n";
import { Badge, Bdi, Button, EmptyState, ErrorState, Input, LoadingState, Ltr, Modal, Pagination, Select } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { ShipmentForm } from "./forms";
import { carrierLabel, shipmentTone } from "./labels";
import { SHIPMENT_SELECT, type Shipment } from "./types";

const PAGE_SIZE = 25;

export function Lane({ s }: { s: Pick<Shipment, "origin_city" | "destination_city"> }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <Bdi className="truncate">{s.origin_city}</Bdi>
      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-ink-3 rtl:-scale-x-100" />
      <Bdi className="truncate">{s.destination_city}</Bdi>
    </span>
  );
}

export default function ShipmentsPage() {
  const t = useT();
  const tenant = useTenant();
  const navigate = useNavigate();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState("active");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [creating, setCreating] = useState(false);
  const term = sanitizeSearch(search);

  const listQ = useQuery({
    queryKey: ["shipments", "list", { page, status, term }],
    queryFn: () =>
      listPage<Shipment>("shipments", page, PAGE_SIZE, (q) => {
        let f = q.select(SHIPMENT_SELECT);
        if (status === "active") f = f.in("status", ACTIVE_SHIPMENT_STATUSES);
        else if (status !== "all") f = f.eq("status", status);
        if (term) {
          f = f.or(`doc_number.ilike.%${term}%,customer_ref.ilike.%${term}%,bol_number.ilike.%${term}%,` +
                   `origin_city.ilike.%${term}%,destination_city.ilike.%${term}%`);
        }
        return f.order("updated_at", { ascending: false });
      }),
  });

  const columns: Array<DataTableColumn<Shipment>> = [
    {
      id: "number",
      header: t("tms.col.number"),
      cell: (s) => (
        <div className="min-w-0">
          <Ltr className="whitespace-nowrap font-medium text-brand-700">{s.doc_number}</Ltr>
          {s.customer_ref && <div className="text-xs text-ink-3"><Bdi>{s.customer_ref}</Bdi></div>}
        </div>
      ),
      sortValue: (s) => s.number ?? 0,
      exportValue: (s) => s.doc_number ?? "",
    },
    {
      id: "customer",
      header: t("tms.col.customer"),
      cell: (s) => <Bdi className="text-ink">{s.customer?.name}</Bdi>,
      exportValue: (s) => s.customer?.name ?? "",
    },
    {
      id: "lane",
      header: t("tms.col.lane"),
      cell: (s) => <span className="text-ink-2"><Lane s={s} /></span>,
      exportValue: (s) => `${s.origin_city} - ${s.destination_city}`,
    },
    {
      id: "mode",
      header: t("tms.col.mode"),
      minBreakpoint: "xl",
      cell: (s) => <span className="text-ink-2">{t(`tms.mode.${s.mode}`)}</span>,
      exportValue: (s) => s.mode,
    },
    {
      id: "carrier",
      header: t("tms.col.carrier"),
      minBreakpoint: "lg",
      cell: (s) => {
        const c = carrierLabel(s);
        return c ? <Bdi className="text-ink-2">{c}</Bdi> : <span className="text-ink-3">—</span>;
      },
      exportValue: (s) => carrierLabel(s) ?? "",
    },
    {
      id: "pickup",
      header: t("tms.col.pickup"),
      minBreakpoint: "xl",
      cell: (s) => s.pickup_window_start
        ? <span className="whitespace-nowrap text-ink-2">{formatDateTime(s.pickup_window_start, tenant.timezone)}</span>
        : <span className="text-ink-3">—</span>,
      sortValue: (s) => s.pickup_window_start ?? "",
      exportValue: (s) => s.pickup_window_start ?? "",
    },
    {
      id: "charge",
      header: t("tms.col.charge"),
      minBreakpoint: "sm",
      align: "end",
      cell: (s) => <span className="whitespace-nowrap text-ink">{formatMoney(s.total_charge, s.currency)}</span>,
      sortValue: (s) => s.total_charge,
      exportValue: (s) => s.total_charge,
    },
    {
      id: "margin",
      header: t("tms.col.margin"),
      minBreakpoint: "md",
      align: "end",
      cell: (s) => s.margin == null
        ? <span className="text-ink-3">—</span>
        : <Ltr className={`whitespace-nowrap ${s.margin < 0 ? "text-serious" : "text-ink-2"}`}>{formatMoney(s.margin, s.currency)}</Ltr>,
      sortValue: (s) => s.margin ?? 0,
      exportValue: (s) => s.margin ?? "",
    },
    {
      id: "status",
      header: t("tms.col.status"),
      cell: (s) => <Badge tone={shipmentTone[s.status]}>{t(`tms.status.${s.status}`)}</Badge>,
      sortValue: (s) => SHIPMENT_STATUSES.indexOf(s.status),
      exportValue: (s) => s.status,
    },
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} placeholder={t("tms.search")} className="w-full sm:max-w-80" />
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }} className="max-w-48">
          <option value="active">{t("tms.active")}</option>
          <option value="all">{t("tms.allStatuses")}</option>
          {SHIPMENT_STATUSES.map((s) => <option key={s} value={s}>{t(`tms.status.${s}`)}</option>)}
        </Select>
        {isManager && (
          <Button className="ms-auto" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> {t("tms.new")}
          </Button>
        )}
      </div>
      {listQ.isLoading && <LoadingState />}
      {listQ.error && <ErrorState message={(listQ.error as Error).message} />}
      {listQ.data && (
        <DataTable<Shipment>
          tableId="shipments"
          exportName="shipments"
          rows={listQ.data.rows}
          rowKey={(s) => s.id}
          columns={columns}
          onRowClick={(s) => navigate(`/tms/s/${s.id}`)}
          empty={<EmptyState icon={<PackageSearch className="h-10 w-10" />} title={t("tms.empty")} description={t("tms.emptyHint")} />}
          footer={<Pagination page={page} pageSize={PAGE_SIZE} total={listQ.data.total} onPage={setPage} />}
        />
      )}
      <Modal title={t("tms.newTitle")} open={creating} onClose={() => setCreating(false)} wide>
        {creating && (
          <ShipmentForm
            onCancel={() => setCreating(false)}
            onDone={(id) => {
              setCreating(false);
              void qc.invalidateQueries({ queryKey: ["shipments"] });
              toast.success(t("tms.created"));
              navigate(`/tms/s/${id}`);
            }}
          />
        )}
      </Modal>
    </div>
  );
}
