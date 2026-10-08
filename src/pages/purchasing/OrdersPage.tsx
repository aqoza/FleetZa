import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search, ShoppingCart } from "lucide-react";
import { listPage, sanitizeSearch } from "../../lib/db";
import { formatDate, formatMoney } from "../../lib/format";
import { PO_STATUSES, type PoStatus } from "../../lib/purchasing";
import { useSupplierPicker } from "../../lib/pickers";
import { useAuth } from "../../context/AuthContext";
import { useI18n, useT, useTp } from "../../i18n";
import { Badge, Bdi, Button, EmptyState, ErrorState, Input, LoadingState, Ltr, Modal, Pagination, Select } from "../../components/ui";
import { Combobox } from "../../components/Combobox";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { todayIso } from "../employees/shared";
import { poStatus, supplierName } from "./labels";
import { OrderForm } from "./OrderForm";
import { PO_SELECT, type PurchaseOrder } from "./types";

const PAGE_SIZE = 25;
const OPEN: PoStatus[] = ["draft", "sent", "confirmed", "partially_received"];

export default function OrdersPage() {
  const t = useT();
  const tp = useTp();
  const { language } = useI18n();
  const { isManager } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState<"open" | "all" | PoStatus>("open");
  const [supplier, setSupplier] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [creating, setCreating] = useState(false);
  const picker = useSupplierPicker(supplier);
  const term = sanitizeSearch(search);
  const today = todayIso();

  const { data, isLoading, error } = useQuery({
    queryKey: ["purchase_orders", "list", { status, supplier, term, page }],
    queryFn: () =>
      listPage<PurchaseOrder>("purchase_orders", page, PAGE_SIZE, (q) => {
        let f = q.select(PO_SELECT);
        if (status === "open") f = f.in("status", OPEN);
        else if (status !== "all") f = f.eq("status", status);
        if (supplier) f = f.eq("supplier_id", supplier);
        if (term) f = f.or(`doc_number.ilike.%${term}%,supplier_reference.ilike.%${term}%`);
        return f.order("order_date", { ascending: false }).order("number", { ascending: false });
      }),
  });
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const late = (o: PurchaseOrder) =>
    !!o.expected_date && o.expected_date < today && ["sent", "confirmed", "partially_received"].includes(o.status);

  const columns: Array<DataTableColumn<PurchaseOrder>> = [
    {
      id: "number",
      header: t("purchasing.col.number"),
      cell: (o) => (
        <>
          <Link to={`/purchasing/orders/${o.id}`} className="whitespace-nowrap font-medium text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()}>
            <Ltr>{o.doc_number ?? ""}</Ltr>
          </Link>
          <div className="text-xs text-ink-3 sm:hidden"><Bdi>{supplierName(o.supplier, language)}</Bdi></div>
        </>
      ),
      sortValue: (o) => o.number,
      exportValue: (o) => o.doc_number ?? "",
    },
    {
      id: "supplier",
      header: t("purchasing.col.supplier"),
      minBreakpoint: "sm",
      cell: (o) => <Bdi>{supplierName(o.supplier, language)}</Bdi>,
      sortValue: (o) => o.supplier?.name ?? null,
      exportValue: (o) => o.supplier?.name ?? "",
    },
    {
      id: "date",
      header: t("purchasing.col.date"),
      minBreakpoint: "md",
      cell: (o) => <span className="whitespace-nowrap text-ink-2 tabular-nums"><Ltr>{formatDate(o.order_date)}</Ltr></span>,
      sortValue: (o) => o.order_date,
      exportValue: (o) => o.order_date,
    },
    {
      id: "expected",
      header: t("purchasing.col.expected"),
      minBreakpoint: "lg",
      cell: (o) =>
        o.expected_date ? (
          <span className={`whitespace-nowrap tabular-nums ${late(o) ? "font-medium text-serious" : "text-ink-2"}`}>
            <Ltr>{formatDate(o.expected_date)}</Ltr>
          </span>
        ) : (
          t("common.dash")
        ),
      sortValue: (o) => o.expected_date,
      exportValue: (o) => o.expected_date ?? "",
    },
    {
      id: "total",
      header: t("purchasing.col.total"),
      align: "end",
      cell: (o) => <span className="whitespace-nowrap font-medium tabular-nums"><Ltr>{formatMoney(Number(o.total), o.currency)}</Ltr></span>,
      sortValue: (o) => Number(o.total),
      exportValue: (o) => String(o.total),
    },
    {
      id: "status",
      header: t("common.status"),
      cell: (o) => (
        <span className="inline-flex flex-wrap gap-1 whitespace-nowrap">
          <Badge tone={poStatus[o.status].tone}>{t(poStatus[o.status].labelKey)}</Badge>
          {late(o) && <Badge tone="red">{t("purchasing.late")}</Badge>}
        </span>
      ),
      sortValue: (o) => PO_STATUSES.indexOf(o.status),
      exportValue: (o) => o.status,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
          <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder={t("purchasing.searchOrders")} className="ps-9" />
        </div>
        <div className="w-full sm:w-60">
          <Combobox {...picker} value={supplier} onChange={(v) => { setSupplier(v); setPage(0); }} placeholder={t("purchasing.allSuppliers")} />
        </div>
        <Select value={status} onChange={(e) => { setStatus(e.target.value as typeof status); setPage(0); }} className="max-w-48">
          <option value="open">{t("purchasing.openOnly")}</option>
          <option value="all">{t("purchasing.allStatuses")}</option>
          {PO_STATUSES.map((s) => <option key={s} value={s}>{t(poStatus[s].labelKey)}</option>)}
        </Select>
        {isManager && (
          <div className="ms-auto">
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> {t("purchasing.newOrder")}
            </Button>
          </div>
        )}
      </div>
      {isLoading && <LoadingState />}
      {error && <ErrorState message={(error as Error).message} />}
      {!isLoading && !error && (
        <DataTable<PurchaseOrder>
          tableId="purchase-orders"
          exportName="purchase-orders"
          rows={rows}
          rowKey={(o) => o.id}
          columns={columns}
          onRowClick={(o) => navigate(`/purchasing/orders/${o.id}`)}
          toolbar={total > 0 ? <span className="text-sm text-ink-3 tabular-nums">{tp("purchasing.orderCount", total)}</span> : undefined}
          empty={<EmptyState icon={<ShoppingCart className="h-10 w-10" />} title={t("purchasing.emptyOrdersTitle")} description={t("purchasing.emptyOrdersDesc")} />}
          footer={<Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />}
        />
      )}
      <Modal title={t("purchasing.newOrder")} open={creating} onClose={() => setCreating(false)} wide>
        {creating && (
          <OrderForm onDone={(id) => { setCreating(false); if (id) navigate(`/purchasing/orders/${id}`); }} />
        )}
      </Modal>
    </div>
  );
}
