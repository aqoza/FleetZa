import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileSignature, Plus } from "lucide-react";
import { listPage, listRows, sanitizeSearch } from "../../lib/db";
import { formatDate, formatMoney } from "../../lib/format";
import { CONTRACT_STATUSES, CONTRACT_TYPES, type ContractStatus, type ContractType } from "../../../shared/contracts";
import { useAuth } from "../../context/AuthContext";
import { useT } from "../../i18n";
import { Badge, Bdi, Button, EmptyState, ErrorState, Input, LoadingState, Ltr, Modal, Pagination, Select } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { ContractForm } from "./forms";
import { contractPeriodAmount, statusTone } from "./labels";
import { CONTRACT_SELECT, type Contract } from "./types";

const PAGE_SIZE = 25;
type Filter = "all" | ContractStatus;

export default function ContractsPage() {
  const t = useT();
  const navigate = useNavigate();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>("active");
  const [type, setType] = useState<"" | ContractType>("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [creating, setCreating] = useState(false);
  const term = sanitizeSearch(search);

  const countsQ = useQuery({
    queryKey: ["contracts", "counts"],
    queryFn: () => listRows<{ status: ContractStatus }>("contracts", (q) => q.select("status").limit(10000)),
  });
  const counts = useMemo(() => {
    const m = new Map<ContractStatus, number>();
    for (const r of countsQ.data ?? []) m.set(r.status, (m.get(r.status) ?? 0) + 1);
    return m;
  }, [countsQ.data]);

  const listQ = useQuery({
    queryKey: ["contracts", "list", { page, filter, term, type }],
    queryFn: () =>
      listPage<Contract>("contracts", page, PAGE_SIZE, (q) => {
        let f = q.select(CONTRACT_SELECT);
        if (filter !== "all") f = f.eq("status", filter);
        if (type) f = f.eq("contract_type", type);
        if (term) f = f.or(`doc_number.ilike.%${term}%,title.ilike.%${term}%,signed_by_name.ilike.%${term}%`);
        return f.order("created_at", { ascending: false });
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

  const columns: Array<DataTableColumn<Contract>> = [
    {
      id: "number",
      header: t("contracts.col.number"),
      cell: (c) => <Ltr className="whitespace-nowrap font-medium text-brand-700">{c.doc_number}</Ltr>,
      sortValue: (c) => c.number ?? 0,
      exportValue: (c) => c.doc_number ?? "",
    },
    {
      id: "contract",
      header: t("contracts.col.contract"),
      cell: (c) => (
        <div className="min-w-0 max-w-72">
          <div className="truncate text-ink"><Bdi>{c.customer?.name ?? "—"}</Bdi></div>
          <div className="truncate text-xs text-ink-3"><Bdi>{c.title}</Bdi></div>
        </div>
      ),
      exportValue: (c) => `${c.customer?.name ?? ""} · ${c.title}`,
    },
    {
      id: "type",
      header: t("contracts.col.type"),
      minBreakpoint: "md",
      cell: (c) => <span className="whitespace-nowrap text-ink-2">{t(`contracts.type.${c.contract_type}`)}</span>,
      exportValue: (c) => c.contract_type,
    },
    {
      id: "term",
      header: t("contracts.col.term"),
      minBreakpoint: "lg",
      cell: (c) => (
        <span className="whitespace-nowrap text-ink-2">
          <Ltr>{`${formatDate(c.start_date)} – ${c.end_date ? formatDate(c.end_date) : "…"}`}</Ltr>
        </span>
      ),
      sortValue: (c) => c.end_date ?? "9999",
      exportValue: (c) => `${c.start_date} – ${c.end_date ?? ""}`,
    },
    {
      id: "amount",
      header: t("contracts.col.amount"),
      minBreakpoint: "sm",
      align: "end",
      cell: (c) => (
        <span className="whitespace-nowrap">
          <Ltr className="text-ink">{formatMoney(contractPeriodAmount(c), c.currency)}</Ltr>
          <span className="block text-xs text-ink-3">{t(`contracts.freq.${c.billing_frequency}`)}</span>
        </span>
      ),
      sortValue: (c) => contractPeriodAmount(c),
      exportValue: (c) => contractPeriodAmount(c),
    },
    {
      id: "next",
      header: t("contracts.col.nextBilling"),
      minBreakpoint: "lg",
      cell: (c) => (c.status === "active" && c.next_billing_date
        ? <span className="whitespace-nowrap text-ink-2">{formatDate(c.next_billing_date)}</span>
        : <span className="text-ink-3">—</span>),
      sortValue: (c) => c.next_billing_date ?? "9999",
      exportValue: (c) => c.next_billing_date ?? "",
    },
    {
      id: "status",
      header: t("contracts.col.status"),
      cell: (c) => <span className="whitespace-nowrap"><Badge tone={statusTone[c.status]}>{t(`contracts.status.${c.status}`)}</Badge></span>,
      sortValue: (c) => CONTRACT_STATUSES.indexOf(c.status),
      exportValue: (c) => c.status,
    },
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        {CONTRACT_STATUSES.map((s) => chip(s, t(`contracts.status.${s}`), counts.get(s) ?? 0))}
        {chip("all", t("contracts.filter.all"), countsQ.data?.length ?? 0)}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} placeholder={t("contracts.search")} className="w-full sm:max-w-72" />
        <div className="w-full sm:w-52">
          <Select value={type} onChange={(e) => { setType(e.target.value as "" | ContractType); setPage(0); }} aria-label={t("contracts.f.type")}>
            <option value="">{t("contracts.filter.anyType")}</option>
            {CONTRACT_TYPES.map((x) => <option key={x} value={x}>{t(`contracts.type.${x}`)}</option>)}
          </Select>
        </div>
        {isManager && (
          <Button className="ms-auto" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> {t("contracts.new")}
          </Button>
        )}
      </div>
      {listQ.isLoading && <LoadingState />}
      {listQ.error && <ErrorState message={(listQ.error as Error).message} />}
      {listQ.data && (
        <DataTable<Contract>
          tableId="contracts"
          exportName="contracts"
          rows={listQ.data.rows}
          rowKey={(c) => c.id}
          columns={columns}
          onRowClick={(c) => navigate(`/contracts/c/${c.id}`)}
          empty={<EmptyState icon={<FileSignature className="h-10 w-10" />} title={t("contracts.empty")} description={t("contracts.emptyHint")} />}
          footer={<Pagination page={page} pageSize={PAGE_SIZE} total={listQ.data.total} onPage={setPage} />}
        />
      )}
      <Modal title={t("contracts.newTitle")} open={creating} onClose={() => setCreating(false)} wide>
        {creating && (
          <ContractForm
            onCancel={() => setCreating(false)}
            onDone={(id) => {
              setCreating(false);
              void qc.invalidateQueries({ queryKey: ["contracts"] });
              toast.success(t("contracts.saved"));
              navigate(`/contracts/c/${id}`);
            }}
          />
        )}
      </Modal>
    </div>
  );
}
