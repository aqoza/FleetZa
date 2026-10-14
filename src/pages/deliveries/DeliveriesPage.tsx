import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PackageOpen, Plus, Upload } from "lucide-react";
import { listPage, sanitizeSearch } from "../../lib/db";
import { formatDateTime, formatMoney } from "../../lib/format";
import { DELIVERY_STATUSES, OPEN_DELIVERY_STATUSES } from "../../../shared/deliveries";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useT, useTp } from "../../i18n";
import { Badge, Bdi, Button, EmptyState, ErrorState, Input, LoadingState, Ltr, Modal, Pagination, Select } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { DeliveryForm, ImportForm } from "./forms";
import { deliveryTone } from "./labels";
import { DELIVERY_SELECT, type Delivery } from "./types";

const PAGE_SIZE = 25;

export default function DeliveriesPage() {
  const t = useT();
  const tp = useTp();
  const tenant = useTenant();
  const navigate = useNavigate();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState("open");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [modal, setModal] = useState<"new" | "import" | null>(null);
  const term = sanitizeSearch(search);

  const listQ = useQuery({
    queryKey: ["deliveries", "list", { page, status, term }],
    queryFn: () =>
      listPage<Delivery>("deliveries", page, PAGE_SIZE, (q) => {
        let f = q.select(DELIVERY_SELECT);
        if (status === "open") f = f.in("status", OPEN_DELIVERY_STATUSES);
        else if (status !== "all") f = f.eq("status", status);
        if (term) {
          f = f.or(`doc_number.ilike.%${term}%,recipient_name.ilike.%${term}%,recipient_phone.ilike.%${term}%,` +
                   `city.ilike.%${term}%,reference.ilike.%${term}%`);
        }
        return f.order("updated_at", { ascending: false });
      }),
  });

  const columns: Array<DataTableColumn<Delivery>> = [
    {
      id: "number",
      header: t("deliveries.col.number"),
      cell: (d) => (
        <div className="min-w-0">
          <Ltr className="font-medium text-brand-700">{d.doc_number}</Ltr>
          {d.reference && <Bdi className="block text-xs text-ink-3">{d.reference}</Bdi>}
        </div>
      ),
      sortValue: (d) => d.number ?? 0,
      exportValue: (d) => d.doc_number ?? "",
    },
    {
      id: "recipient",
      header: t("deliveries.col.recipient"),
      cell: (d) => (
        <div className="min-w-0">
          <Bdi className="text-ink">{d.recipient_name}</Bdi>
          <Bdi className="block max-w-72 truncate text-xs text-ink-3">{d.address}</Bdi>
        </div>
      ),
      exportValue: (d) => `${d.recipient_name}, ${d.address}`,
    },
    {
      id: "city",
      header: t("deliveries.col.city"),
      minBreakpoint: "md",
      cell: (d) => (d.city ? <Bdi className="text-ink-2">{d.city}</Bdi> : <span className="text-ink-3">—</span>),
      exportValue: (d) => d.city ?? "",
    },
    {
      id: "route",
      header: t("deliveries.col.route"),
      minBreakpoint: "lg",
      cell: (d) => (d.route ? <Ltr className="text-ink-2">{d.route.doc_number}</Ltr> : <span className="text-ink-3">—</span>),
      exportValue: (d) => d.route?.doc_number ?? "",
    },
    {
      id: "parcels",
      header: t("deliveries.col.parcels"),
      minBreakpoint: "lg",
      align: "end",
      cell: (d) => <span className="text-ink-2">{tp("deliveries.parcelsCount", d.parcels)}</span>,
      sortValue: (d) => d.parcels,
      exportValue: (d) => d.parcels,
    },
    {
      id: "cod",
      header: t("deliveries.col.cod"),
      minBreakpoint: "sm",
      align: "end",
      cell: (d) => (d.cod_amount > 0 ? <span className="whitespace-nowrap text-ink">{formatMoney(d.cod_amount, tenant.currency)}</span> : <span className="text-ink-3">—</span>),
      sortValue: (d) => d.cod_amount,
      exportValue: (d) => d.cod_amount,
    },
    {
      id: "status",
      header: t("deliveries.col.status"),
      cell: (d) => <Badge tone={deliveryTone[d.status]}>{t(`deliveries.status.${d.status}`)}</Badge>,
      sortValue: (d) => DELIVERY_STATUSES.indexOf(d.status),
      exportValue: (d) => d.status,
    },
    {
      id: "updated",
      header: t("deliveries.col.updated"),
      minBreakpoint: "xl",
      cell: (d) => <span className="whitespace-nowrap text-ink-2">{formatDateTime(d.updated_at, tenant.timezone)}</span>,
      sortValue: (d) => d.updated_at,
      exportValue: (d) => d.updated_at,
    },
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} placeholder={t("deliveries.search")} className="w-full sm:max-w-80" />
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }} className="max-w-48">
          <option value="open">{t("deliveries.open")}</option>
          <option value="all">{t("deliveries.allStatuses")}</option>
          {DELIVERY_STATUSES.map((s) => <option key={s} value={s}>{t(`deliveries.status.${s}`)}</option>)}
        </Select>
        {isManager && (
          <div className="ms-auto flex gap-2">
            <Button variant="secondary" onClick={() => setModal("import")}>
              <Upload className="h-4 w-4" /> {t("deliveries.import")}
            </Button>
            <Button onClick={() => setModal("new")}>
              <Plus className="h-4 w-4" /> {t("deliveries.new")}
            </Button>
          </div>
        )}
      </div>
      {listQ.isLoading && <LoadingState />}
      {listQ.error && <ErrorState message={(listQ.error as Error).message} />}
      {listQ.data && (
        <DataTable<Delivery>
          tableId="deliveries"
          exportName="deliveries"
          rows={listQ.data.rows}
          rowKey={(d) => d.id}
          columns={columns}
          onRowClick={(d) => navigate(`/deliveries/d/${d.id}`)}
          empty={<EmptyState icon={<PackageOpen className="h-10 w-10" />} title={t("deliveries.empty")} description={t("deliveries.emptyHint")} />}
          footer={<Pagination page={page} pageSize={PAGE_SIZE} total={listQ.data.total} onPage={setPage} />}
        />
      )}
      <Modal title={t("deliveries.newTitle")} open={modal === "new"} onClose={() => setModal(null)} wide>
        {modal === "new" && (
          <DeliveryForm
            onCancel={() => setModal(null)}
            onDone={(id) => {
              setModal(null);
              void qc.invalidateQueries({ queryKey: ["deliveries"] });
              toast.success(t("deliveries.created"));
              navigate(`/deliveries/d/${id}`);
            }}
          />
        )}
      </Modal>
      <Modal title={t("deliveries.importTitle")} open={modal === "import"} onClose={() => setModal(null)} wide>
        {modal === "import" && (
          <ImportForm
            onCancel={() => setModal(null)}
            onDone={(n) => {
              setModal(null);
              setStatus("pending");
              setPage(0);
              void qc.invalidateQueries({ queryKey: ["deliveries"] });
              toast.success(tp("deliveries.imported", n));
            }}
          />
        )}
      </Modal>
    </div>
  );
}
