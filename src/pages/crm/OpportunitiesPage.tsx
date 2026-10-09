import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Handshake, Plus } from "lucide-react";
import { listPage, listRows, sanitizeSearch } from "../../lib/db";
import { formatDate, formatMoney } from "../../lib/format";
import { OPEN_STAGES, STAGES, weighted, type Stage } from "../../../shared/crm";
import { useAuth } from "../../context/AuthContext";
import { useT } from "../../i18n";
import { Badge, Bdi, Button, EmptyState, ErrorState, Input, LoadingState, Ltr, Modal, Pagination } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { OpportunityForm } from "./forms";
import { personName, stageTone } from "./labels";
import { OPP_SELECT, type Opportunity } from "./types";

const PAGE_SIZE = 25;
type Filter = "open" | "all" | Stage;

export default function OpportunitiesPage() {
  const t = useT();
  const navigate = useNavigate();
  const { isManager, profile } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>("open");
  const [mine, setMine] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [creating, setCreating] = useState(false);
  const term = sanitizeSearch(search);
  const me = profile?.id ?? "";

  const countsQ = useQuery({
    queryKey: ["crm_opportunities", "counts"],
    queryFn: () => listRows<{ stage: Stage }>("crm_opportunities", (q) => q.select("stage").limit(10000)),
  });
  const counts = useMemo(() => {
    const m = new Map<Stage, number>();
    for (const r of countsQ.data ?? []) m.set(r.stage, (m.get(r.stage) ?? 0) + 1);
    return m;
  }, [countsQ.data]);
  const openCount = OPEN_STAGES.reduce((n, s) => n + (counts.get(s) ?? 0), 0);

  const listQ = useQuery({
    queryKey: ["crm_opportunities", "list", { page, filter, term, mine, me }],
    queryFn: () =>
      listPage<Opportunity>("crm_opportunities", page, PAGE_SIZE, (q) => {
        let f = q.select(OPP_SELECT);
        if (filter === "open") f = f.in("stage", OPEN_STAGES);
        else if (filter !== "all") f = f.eq("stage", filter);
        if (mine && me) f = f.eq("owner_id", me);
        if (term) f = f.or(`doc_number.ilike.%${term}%,title.ilike.%${term}%`);
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

  const columns: Array<DataTableColumn<Opportunity>> = [
    {
      id: "number",
      header: t("crm.col.number"),
      cell: (o) => <Ltr className="whitespace-nowrap font-medium text-brand-700">{o.doc_number}</Ltr>,
      sortValue: (o) => o.number ?? 0,
      exportValue: (o) => o.doc_number ?? "",
    },
    {
      id: "title",
      header: t("crm.col.opportunity"),
      cell: (o) => (
        <div className="min-w-0 max-w-80">
          <div className="truncate text-ink"><Bdi>{o.title}</Bdi></div>
          <div className="truncate text-xs text-ink-3">
            {o.customer ? <Bdi>{o.customer.name}</Bdi> : o.lead ? <Bdi>{o.lead.name}</Bdi> : "—"}
          </div>
        </div>
      ),
      exportValue: (o) => `${o.title} · ${o.customer?.name ?? o.lead?.name ?? ""}`,
    },
    {
      id: "amount",
      header: t("crm.col.amount"),
      align: "end",
      minBreakpoint: "sm",
      cell: (o) => <span className="whitespace-nowrap text-ink">{formatMoney(Number(o.amount), o.currency)}</span>,
      sortValue: (o) => Number(o.amount),
      exportValue: (o) => o.amount,
    },
    {
      id: "weighted",
      header: t("crm.col.weighted"),
      align: "end",
      minBreakpoint: "lg",
      cell: (o) => (
        <span className="whitespace-nowrap text-ink-2">
          {formatMoney(weighted({ amount: o.amount, probability: o.probability }), o.currency)}
          <Ltr className="ms-1 text-xs text-ink-3">{`${o.probability}%`}</Ltr>
        </span>
      ),
      sortValue: (o) => weighted({ amount: o.amount, probability: o.probability }),
      exportValue: (o) => weighted({ amount: o.amount, probability: o.probability }),
    },
    {
      id: "close",
      header: t("crm.col.close"),
      minBreakpoint: "md",
      cell: (o) => <span className="whitespace-nowrap text-ink-2">{o.expected_close_date ? formatDate(o.expected_close_date) : "—"}</span>,
      sortValue: (o) => o.expected_close_date ?? "",
      exportValue: (o) => o.expected_close_date ?? "",
    },
    {
      id: "owner",
      header: t("crm.col.owner"),
      minBreakpoint: "lg",
      cell: (o) => (o.owner ? <Bdi className="text-ink-2">{personName(o.owner)}</Bdi> : <span className="text-ink-3">—</span>),
      exportValue: (o) => personName(o.owner),
    },
    {
      id: "stage",
      header: t("crm.col.stage"),
      cell: (o) => <span className="whitespace-nowrap"><Badge tone={stageTone[o.stage]}>{t(`crm.stage.${o.stage}`)}</Badge></span>,
      sortValue: (o) => STAGES.indexOf(o.stage),
      exportValue: (o) => o.stage,
    },
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        {chip("open", t("crm.filter.open"), openCount)}
        {STAGES.map((s) => chip(s, t(`crm.stage.${s}`), counts.get(s) ?? 0))}
        {chip("all", t("crm.filter.all"), countsQ.data?.length ?? 0)}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} placeholder={t("crm.opp.search")} className="w-full sm:max-w-72" />
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <input type="checkbox" className="h-4 w-4 rounded border-line" checked={mine} onChange={(e) => { setMine(e.target.checked); setPage(0); }} />
          {t("crm.filter.mine")}
        </label>
        {isManager && (
          <Button className="ms-auto" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> {t("crm.opp.new")}
          </Button>
        )}
      </div>
      {listQ.isLoading && <LoadingState />}
      {listQ.error && <ErrorState message={(listQ.error as Error).message} />}
      {listQ.data && (
        <DataTable<Opportunity>
          tableId="crm-opportunities"
          exportName="opportunities"
          rows={listQ.data.rows}
          rowKey={(o) => o.id}
          columns={columns}
          onRowClick={(o) => navigate(`/crm/o/${o.id}`)}
          empty={<EmptyState icon={<Handshake className="h-10 w-10" />} title={t("crm.opp.empty")} description={t("crm.opp.emptyHint")} />}
          footer={<Pagination page={page} pageSize={PAGE_SIZE} total={listQ.data.total} onPage={setPage} />}
        />
      )}
      <Modal title={t("crm.opp.newTitle")} open={creating} onClose={() => setCreating(false)} wide>
        {creating && (
          <OpportunityForm
            onCancel={() => setCreating(false)}
            onDone={(id) => {
              setCreating(false);
              void qc.invalidateQueries({ queryKey: ["crm_opportunities"] });
              toast.success(t("crm.opp.saved"));
              navigate(`/crm/o/${id}`);
            }}
          />
        )}
      </Modal>
    </div>
  );
}
