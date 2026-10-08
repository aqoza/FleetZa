import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { FileText, Plus, Search } from "lucide-react";
import { listPage, sanitizeSearch } from "../../lib/db";
import { formatDate, formatMoney } from "../../lib/format";
import { BILL_STATUSES, billBalance, type BillStatus } from "../../lib/purchasing";
import { useSupplierPicker } from "../../lib/pickers";
import { useAuth } from "../../context/AuthContext";
import { useI18n, useT, useTp } from "../../i18n";
import { Badge, Bdi, Button, EmptyState, ErrorState, Input, LoadingState, Ltr, Modal, Pagination, Select } from "../../components/ui";
import { Combobox } from "../../components/Combobox";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { todayIso } from "../employees/shared";
import { BillForm } from "./BillForm";
import { DueNote } from "./DueNote";
import { billStatus, supplierName } from "./labels";
import { BILL_SELECT, type VendorBill } from "./types";

const PAGE_SIZE = 25;
const UNPAID: BillStatus[] = ["draft", "open", "partially_paid"];

export default function BillsPage() {
  const t = useT();
  const tp = useTp();
  const { language } = useI18n();
  const { isManager } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState<"unpaid" | "all" | BillStatus>("unpaid");
  const [supplier, setSupplier] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [creating, setCreating] = useState(false);
  const picker = useSupplierPicker(supplier);
  const term = sanitizeSearch(search);
  const today = todayIso();

  const { data, isLoading, error } = useQuery({
    queryKey: ["vendor_bills", "list", { status, supplier, term, page }],
    queryFn: () =>
      listPage<VendorBill>("vendor_bills", page, PAGE_SIZE, (q) => {
        let f = q.select(BILL_SELECT);
        if (status === "unpaid") f = f.in("status", UNPAID);
        else if (status !== "all") f = f.eq("status", status);
        if (supplier) f = f.eq("supplier_id", supplier);
        if (term) f = f.or(`doc_number.ilike.%${term}%,supplier_invoice_number.ilike.%${term}%`);
        return status === "unpaid"
          ? f.order("due_date", { ascending: true, nullsFirst: false }).order("number", { ascending: false })
          : f.order("bill_date", { ascending: false }).order("number", { ascending: false });
      }),
  });
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;

  const columns: Array<DataTableColumn<VendorBill>> = [
    {
      id: "number",
      header: t("purchasing.col.number"),
      cell: (b) => (
        <>
          <Link to={`/purchasing/bills/${b.id}`} className="whitespace-nowrap font-medium text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()}>
            <Ltr>{b.doc_number ?? ""}</Ltr>
          </Link>
          {b.supplier_invoice_number && (
            <div className="text-xs text-ink-3"><Ltr>{b.supplier_invoice_number}</Ltr></div>
          )}
          <div className="text-xs text-ink-3 sm:hidden"><Bdi>{supplierName(b.supplier, language)}</Bdi></div>
        </>
      ),
      sortValue: (b) => b.number,
      exportValue: (b) => b.doc_number ?? "",
    },
    {
      id: "supplier",
      header: t("purchasing.col.supplier"),
      minBreakpoint: "sm",
      cell: (b) => <Bdi>{supplierName(b.supplier, language)}</Bdi>,
      sortValue: (b) => b.supplier?.name ?? null,
      exportValue: (b) => b.supplier?.name ?? "",
    },
    {
      id: "date",
      header: t("purchasing.col.date"),
      minBreakpoint: "lg",
      cell: (b) => <span className="whitespace-nowrap text-ink-2 tabular-nums"><Ltr>{formatDate(b.bill_date)}</Ltr></span>,
      sortValue: (b) => b.bill_date,
      exportValue: (b) => b.bill_date,
    },
    {
      id: "due",
      header: t("purchasing.col.due"),
      minBreakpoint: "md",
      cell: (b) =>
        b.due_date ? (
          <div className="whitespace-nowrap">
            <div className="text-ink-2 tabular-nums"><Ltr>{formatDate(b.due_date)}</Ltr></div>
            <DueNote bill={b} today={today} />
          </div>
        ) : t("common.dash"),
      sortValue: (b) => b.due_date,
      exportValue: (b) => b.due_date ?? "",
    },
    {
      id: "total",
      header: t("purchasing.col.total"),
      align: "end",
      minBreakpoint: "md",
      cell: (b) => <span className="whitespace-nowrap tabular-nums text-ink-2"><Ltr>{formatMoney(Number(b.total), b.currency)}</Ltr></span>,
      sortValue: (b) => Number(b.total),
      exportValue: (b) => String(b.total),
    },
    {
      id: "balance",
      header: t("purchasing.col.balance"),
      align: "end",
      cell: (b) => (
        <span className="whitespace-nowrap font-medium tabular-nums">
          <Ltr>{b.status === "void" ? t("common.dash") : formatMoney(billBalance(b, b.currency_decimals), b.currency)}</Ltr>
        </span>
      ),
      sortValue: (b) => (b.status === "void" ? 0 : billBalance(b, b.currency_decimals)),
      exportValue: (b) => String(b.status === "void" ? 0 : billBalance(b, b.currency_decimals)),
    },
    {
      id: "status",
      header: t("common.status"),
      cell: (b) => <span className="whitespace-nowrap"><Badge tone={billStatus[b.status].tone}>{t(billStatus[b.status].labelKey)}</Badge></span>,
      sortValue: (b) => BILL_STATUSES.indexOf(b.status),
      exportValue: (b) => b.status,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
          <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder={t("purchasing.searchBills")} className="ps-9" />
        </div>
        <div className="w-full sm:w-60">
          <Combobox {...picker} value={supplier} onChange={(v) => { setSupplier(v); setPage(0); }} placeholder={t("purchasing.allSuppliers")} />
        </div>
        <Select value={status} onChange={(e) => { setStatus(e.target.value as typeof status); setPage(0); }} className="max-w-48">
          <option value="unpaid">{t("purchasing.openOnly")}</option>
          <option value="all">{t("purchasing.allStatuses")}</option>
          {BILL_STATUSES.map((s) => <option key={s} value={s}>{t(billStatus[s].labelKey)}</option>)}
        </Select>
        {isManager && (
          <div className="ms-auto">
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> {t("purchasing.newBill")}
            </Button>
          </div>
        )}
      </div>
      {isLoading && <LoadingState />}
      {error && <ErrorState message={(error as Error).message} />}
      {!isLoading && !error && (
        <DataTable<VendorBill>
          tableId="vendor-bills"
          exportName="vendor-bills"
          rows={rows}
          rowKey={(b) => b.id}
          columns={columns}
          onRowClick={(b) => navigate(`/purchasing/bills/${b.id}`)}
          toolbar={total > 0 ? <span className="text-sm text-ink-3 tabular-nums">{tp("purchasing.billCount", total)}</span> : undefined}
          empty={<EmptyState icon={<FileText className="h-10 w-10" />} title={t("purchasing.emptyBillsTitle")} description={t("purchasing.emptyBillsDesc")} />}
          footer={<Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />}
        />
      )}
      <Modal title={t("purchasing.newBill")} open={creating} onClose={() => setCreating(false)}>
        {creating && <BillForm onDone={(id) => { setCreating(false); if (id) navigate(`/purchasing/bills/${id}`); }} />}
      </Modal>
    </div>
  );
}
