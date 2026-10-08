import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileWarning, Plus } from "lucide-react";
import { listPage, listRows, sanitizeSearch } from "../../lib/db";
import { formatDate, formatMoney } from "../../lib/format";
import { CLAIM_STATUSES, OPEN_CLAIM_STATUSES, type ClaimStatus } from "../../../shared/insurance";
import { useAuth } from "../../context/AuthContext";
import { useT } from "../../i18n";
import { Badge, Bdi, Button, EmptyState, ErrorState, Input, LoadingState, Ltr, Modal, Pagination } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { ClaimForm } from "./forms";
import { claimInsurer, claimTone } from "./labels";
import { CLAIM_SELECT, type Claim } from "./types";

const PAGE_SIZE = 25;
type Filter = "open" | "all" | ClaimStatus;

export default function ClaimsPage() {
  const t = useT();
  const navigate = useNavigate();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>("open");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [creating, setCreating] = useState(false);
  const term = sanitizeSearch(search);

  const countsQ = useQuery({
    queryKey: ["insurance_claims", "counts"],
    queryFn: () => listRows<{ status: ClaimStatus }>("insurance_claims", (q) => q.select("status").limit(10000)),
  });
  const counts = useMemo(() => {
    const m = new Map<ClaimStatus, number>();
    for (const r of countsQ.data ?? []) m.set(r.status, (m.get(r.status) ?? 0) + 1);
    return m;
  }, [countsQ.data]);
  const openCount = OPEN_CLAIM_STATUSES.reduce((n, s) => n + (counts.get(s) ?? 0), 0);

  const listQ = useQuery({
    queryKey: ["insurance_claims", "list", { page, filter, term }],
    queryFn: () =>
      listPage<Claim>("insurance_claims", page, PAGE_SIZE, (q) => {
        let f = q.select(CLAIM_SELECT);
        if (filter === "open") f = f.in("status", OPEN_CLAIM_STATUSES);
        else if (filter !== "all") f = f.eq("status", filter);
        if (term) f = f.or(`doc_number.ilike.%${term}%,description.ilike.%${term}%,insurer_reference.ilike.%${term}%`);
        return f.order("claim_date", { ascending: false }).order("number", { ascending: false });
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

  const columns: Array<DataTableColumn<Claim>> = [
    {
      id: "number",
      header: t("insurance.cc.number"),
      cell: (c) => <Ltr className="whitespace-nowrap font-medium text-brand-700">{c.doc_number}</Ltr>,
      sortValue: (c) => c.number ?? 0,
      exportValue: (c) => c.doc_number ?? "",
    },
    {
      id: "description",
      header: t("insurance.cc.description"),
      cell: (c) => (
        <div className="min-w-0 max-w-80">
          <div className="truncate text-ink"><Bdi>{c.description}</Bdi></div>
          {c.vehicle && <div className="truncate text-xs text-ink-3"><Bdi>{c.vehicle.name}</Bdi></div>}
        </div>
      ),
      exportValue: (c) => c.description,
    },
    {
      id: "policy",
      header: t("insurance.cc.policy"),
      minBreakpoint: "lg",
      cell: (c) => (
        <div className="min-w-0">
          <Ltr className="text-ink-2">{c.policy?.policy_number}</Ltr>
          <div className="truncate text-xs text-ink-3"><Bdi>{claimInsurer(c)}</Bdi></div>
        </div>
      ),
      exportValue: (c) => c.policy?.policy_number ?? "",
    },
    {
      id: "loss",
      header: t("insurance.cc.lossDate"),
      minBreakpoint: "md",
      cell: (c) => <span className="whitespace-nowrap text-ink-2">{formatDate(c.loss_date)}</span>,
      sortValue: (c) => c.loss_date,
      exportValue: (c) => c.loss_date,
    },
    {
      id: "claimed",
      header: t("insurance.cc.claimed"),
      minBreakpoint: "sm",
      align: "end",
      cell: (c) => <span className="whitespace-nowrap text-ink">{formatMoney(c.amount_claimed, c.currency)}</span>,
      sortValue: (c) => c.amount_claimed,
      exportValue: (c) => c.amount_claimed,
    },
    {
      id: "paid",
      header: t("insurance.cc.approvedPaid"),
      minBreakpoint: "md",
      align: "end",
      cell: (c) => {
        const v = c.amount_paid ?? c.amount_approved;
        return v == null ? <span className="text-ink-3">—</span> : <span className="whitespace-nowrap text-ink-2">{formatMoney(v, c.currency)}</span>;
      },
      sortValue: (c) => c.amount_paid ?? c.amount_approved ?? -1,
      exportValue: (c) => c.amount_paid ?? c.amount_approved ?? "",
    },
    {
      id: "status",
      header: t("insurance.cc.status"),
      cell: (c) => <span className="whitespace-nowrap"><Badge tone={claimTone[c.status]}>{t(`insurance.claim.${c.status}`)}</Badge></span>,
      sortValue: (c) => CLAIM_STATUSES.indexOf(c.status),
      exportValue: (c) => c.status,
    },
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        {chip("open", t("insurance.filter.open"), openCount)}
        {CLAIM_STATUSES.map((s) => chip(s, t(`insurance.claim.${s}`), counts.get(s) ?? 0))}
        {chip("all", t("insurance.filter.all"), countsQ.data?.length ?? 0)}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} placeholder={t("insurance.c.search")} className="w-full sm:max-w-80" />
        {isManager && (
          <Button className="ms-auto" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> {t("insurance.c.new")}
          </Button>
        )}
      </div>
      {listQ.isLoading && <LoadingState />}
      {listQ.error && <ErrorState message={(listQ.error as Error).message} />}
      {listQ.data && (
        <DataTable<Claim>
          tableId="insurance_claims"
          exportName="insurance-claims"
          rows={listQ.data.rows}
          rowKey={(c) => c.id}
          columns={columns}
          onRowClick={(c) => navigate(`/insurance/claims/${c.id}`)}
          empty={<EmptyState icon={<FileWarning className="h-10 w-10" />} title={t("insurance.c.empty")} description={t("insurance.c.emptyHint")} />}
          footer={<Pagination page={page} pageSize={PAGE_SIZE} total={listQ.data.total} onPage={setPage} />}
        />
      )}
      <Modal title={t("insurance.c.newTitle")} open={creating} onClose={() => setCreating(false)} wide>
        {creating && (
          <ClaimForm
            onCancel={() => setCreating(false)}
            onDone={(id) => {
              setCreating(false);
              void qc.invalidateQueries({ queryKey: ["insurance_claims"] });
              toast.success(t("insurance.c.saved"));
              navigate(`/insurance/claims/${id}`);
            }}
          />
        )}
      </Modal>
    </div>
  );
}
