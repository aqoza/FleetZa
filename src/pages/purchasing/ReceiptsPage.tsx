import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PackageCheck, Search } from "lucide-react";
import { listPage, sanitizeSearch } from "../../lib/db";
import { formatDateTime } from "../../lib/format";
import { useSupplierPicker } from "../../lib/pickers";
import { useTenant } from "../../context/AuthContext";
import { useI18n, useT, useTp } from "../../i18n";
import { Bdi, EmptyState, ErrorState, Input, LoadingState, Ltr, Pagination } from "../../components/ui";
import { Combobox } from "../../components/Combobox";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { supplierName } from "./labels";
import { RECEIPT_SELECT, type PurchaseReceipt } from "./types";

const PAGE_SIZE = 25;

/** Goods receipts are posted from a purchase order; this is the read-only register. */
export default function ReceiptsPage() {
  const t = useT();
  const tp = useTp();
  const { language } = useI18n();
  const tenant = useTenant();
  const navigate = useNavigate();
  const [supplier, setSupplier] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const picker = useSupplierPicker(supplier);
  const term = sanitizeSearch(search);

  const { data, isLoading, error } = useQuery({
    queryKey: ["purchase_receipts", "list", { supplier, term, page }],
    queryFn: () =>
      listPage<PurchaseReceipt>("purchase_receipts", page, PAGE_SIZE, (q) => {
        let f = q.select(RECEIPT_SELECT);
        if (supplier) f = f.eq("supplier_id", supplier);
        if (term) f = f.ilike("doc_number", `%${term}%`);
        return f.order("received_at", { ascending: false });
      }),
  });
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;

  const columns: Array<DataTableColumn<PurchaseReceipt>> = [
    {
      id: "number",
      header: t("purchasing.col.number"),
      cell: (r) => (
        <>
          <span className="whitespace-nowrap font-medium text-ink"><Ltr>{r.doc_number ?? ""}</Ltr></span>
          <div className="text-xs text-ink-3 sm:hidden"><Bdi>{supplierName(r.supplier, language)}</Bdi></div>
        </>
      ),
      sortValue: (r) => r.number,
      exportValue: (r) => r.doc_number ?? "",
    },
    {
      id: "order",
      header: t("purchasing.col.order"),
      cell: (r) =>
        r.order ? (
          <Link to={`/purchasing/orders/${r.order.id}`} className="text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()}>
            <Ltr>{r.order.doc_number ?? ""}</Ltr>
          </Link>
        ) : t("common.dash"),
      sortValue: (r) => r.order?.doc_number ?? null,
      exportValue: (r) => r.order?.doc_number ?? "",
    },
    {
      id: "supplier",
      header: t("purchasing.col.supplier"),
      minBreakpoint: "sm",
      cell: (r) => <Bdi>{supplierName(r.supplier, language)}</Bdi>,
      sortValue: (r) => r.supplier?.name ?? null,
      exportValue: (r) => r.supplier?.name ?? "",
    },
    {
      id: "warehouse",
      header: t("purchasing.col.warehouse"),
      minBreakpoint: "lg",
      cell: (r) => (r.warehouse ? <Bdi>{r.warehouse.name}</Bdi> : t("common.dash")),
      sortValue: (r) => r.warehouse?.name ?? null,
      exportValue: (r) => r.warehouse?.name ?? "",
    },
    {
      id: "lines",
      header: t("purchasing.col.lines"),
      align: "end",
      minBreakpoint: "md",
      cell: (r) => <span className="tabular-nums text-ink-2">{r.lines.length}</span>,
      sortValue: (r) => r.lines.length,
      exportValue: (r) => String(r.lines.length),
    },
    {
      id: "receivedAt",
      header: t("purchasing.col.receivedAt"),
      cell: (r) => (
        <span className="whitespace-nowrap text-ink-2 tabular-nums"><Ltr>{formatDateTime(r.received_at, tenant.timezone)}</Ltr></span>
      ),
      sortValue: (r) => r.received_at,
      exportValue: (r) => r.received_at,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
          <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder={t("action.search")} className="ps-9" />
        </div>
        <div className="w-full sm:w-60">
          <Combobox {...picker} value={supplier} onChange={(v) => { setSupplier(v); setPage(0); }} placeholder={t("purchasing.allSuppliers")} />
        </div>
      </div>
      {isLoading && <LoadingState />}
      {error && <ErrorState message={(error as Error).message} />}
      {!isLoading && !error && (
        <DataTable<PurchaseReceipt>
          tableId="purchase-receipts"
          exportName="goods-receipts"
          rows={rows}
          rowKey={(r) => r.id}
          columns={columns}
          onRowClick={(r) => navigate(`/purchasing/orders/${r.purchase_order_id}`)}
          toolbar={total > 0 ? <span className="text-sm text-ink-3 tabular-nums">{tp("purchasing.receiptCount", total)}</span> : undefined}
          empty={<EmptyState icon={<PackageCheck className="h-10 w-10" />} title={t("purchasing.emptyReceiptsTitle")} description={t("purchasing.emptyReceiptsDesc")} />}
          footer={<Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />}
        />
      )}
    </div>
  );
}
