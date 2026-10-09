import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, UserPlus } from "lucide-react";
import { listPage, listRows, sanitizeSearch } from "../../lib/db";
import { formatDate, formatMoney } from "../../lib/format";
import { LEAD_SOURCES, LEAD_STATUSES, type LeadSource, type LeadStatus } from "../../../shared/crm";
import { useAuth } from "../../context/AuthContext";
import { useT } from "../../i18n";
import { Badge, Bdi, Button, EmptyState, ErrorState, Input, LoadingState, Ltr, Modal, Pagination, Select } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { LeadForm } from "./forms";
import { leadTone, personName } from "./labels";
import { LEAD_SELECT, type Lead } from "./types";

const PAGE_SIZE = 25;
const OPEN: LeadStatus[] = ["new", "contacted", "qualified"];
type Filter = "open" | "all" | LeadStatus;

export default function LeadsPage() {
  const t = useT();
  const navigate = useNavigate();
  const { isManager, profile } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>("open");
  const [source, setSource] = useState<"" | LeadSource>("");
  const [mine, setMine] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [creating, setCreating] = useState(false);
  const term = sanitizeSearch(search);
  const me = profile?.id ?? "";

  const countsQ = useQuery({
    queryKey: ["crm_leads", "counts"],
    queryFn: () => listRows<{ status: LeadStatus }>("crm_leads", (q) => q.select("status").limit(10000)),
  });
  const counts = useMemo(() => {
    const m = new Map<LeadStatus, number>();
    for (const r of countsQ.data ?? []) m.set(r.status, (m.get(r.status) ?? 0) + 1);
    return m;
  }, [countsQ.data]);
  const openCount = OPEN.reduce((n, s) => n + (counts.get(s) ?? 0), 0);

  const listQ = useQuery({
    queryKey: ["crm_leads", "list", { page, filter, term, source, mine, me }],
    queryFn: () =>
      listPage<Lead>("crm_leads", page, PAGE_SIZE, (q) => {
        let f = q.select(LEAD_SELECT);
        if (filter === "open") f = f.in("status", OPEN);
        else if (filter !== "all") f = f.eq("status", filter);
        if (source) f = f.eq("source", source);
        if (mine && me) f = f.eq("owner_id", me);
        if (term) f = f.or(`doc_number.ilike.%${term}%,name.ilike.%${term}%,company_name.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%,interest.ilike.%${term}%`);
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

  const columns: Array<DataTableColumn<Lead>> = [
    {
      id: "number",
      header: t("crm.col.number"),
      cell: (l) => <Ltr className="whitespace-nowrap font-medium text-brand-700">{l.doc_number}</Ltr>,
      sortValue: (l) => l.number ?? 0,
      exportValue: (l) => l.doc_number ?? "",
    },
    {
      id: "lead",
      header: t("crm.col.lead"),
      cell: (l) => (
        <div className="min-w-0 max-w-72">
          <div className="truncate text-ink"><Bdi>{l.company_name || l.name}</Bdi></div>
          <div className="truncate text-xs text-ink-3">
            {l.company_name ? <Bdi>{l.name}</Bdi> : null}
            {l.company_name && l.interest ? " · " : null}
            {l.interest ? <Bdi>{l.interest}</Bdi> : null}
          </div>
        </div>
      ),
      exportValue: (l) => [l.company_name, l.name, l.interest].filter(Boolean).join(" · "),
    },
    {
      id: "source",
      header: t("crm.col.source"),
      minBreakpoint: "md",
      cell: (l) => <span className="whitespace-nowrap text-ink-2">{t(`crm.source.${l.source}`)}</span>,
      exportValue: (l) => l.source,
    },
    {
      id: "value",
      header: t("crm.col.value"),
      minBreakpoint: "sm",
      align: "end",
      cell: (l) => (l.estimated_value == null
        ? <span className="text-ink-3">—</span>
        : <span className="whitespace-nowrap text-ink-2">{formatMoney(Number(l.estimated_value), l.currency)}</span>),
      sortValue: (l) => Number(l.estimated_value ?? 0),
      exportValue: (l) => l.estimated_value ?? "",
    },
    {
      id: "owner",
      header: t("crm.col.owner"),
      minBreakpoint: "lg",
      cell: (l) => (l.owner ? <Bdi className="text-ink-2">{personName(l.owner)}</Bdi> : <span className="text-ink-3">—</span>),
      exportValue: (l) => personName(l.owner),
    },
    {
      id: "created",
      header: t("crm.col.created"),
      minBreakpoint: "lg",
      cell: (l) => <span className="whitespace-nowrap text-ink-2">{formatDate(l.created_at)}</span>,
      sortValue: (l) => l.created_at,
      exportValue: (l) => l.created_at,
    },
    {
      id: "status",
      header: t("crm.col.status"),
      cell: (l) => <span className="whitespace-nowrap"><Badge tone={leadTone[l.status]}>{t(`crm.lead.status.${l.status}`)}</Badge></span>,
      sortValue: (l) => LEAD_STATUSES.indexOf(l.status),
      exportValue: (l) => l.status,
    },
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        {chip("open", t("crm.filter.open"), openCount)}
        {LEAD_STATUSES.map((s) => chip(s, t(`crm.lead.status.${s}`), counts.get(s) ?? 0))}
        {chip("all", t("crm.filter.all"), countsQ.data?.length ?? 0)}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} placeholder={t("crm.lead.search")} className="w-full sm:max-w-72" />
        <div className="w-[calc(50%-0.375rem)] sm:w-44"><Select value={source} onChange={(e) => { setSource(e.target.value as "" | LeadSource); setPage(0); }} aria-label={t("crm.f.source")}>
          <option value="">{t("crm.filter.anySource")}</option>
          {LEAD_SOURCES.map((x) => <option key={x} value={x}>{t(`crm.source.${x}`)}</option>)}
        </Select></div>
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <input type="checkbox" className="h-4 w-4 rounded border-line" checked={mine} onChange={(e) => { setMine(e.target.checked); setPage(0); }} />
          {t("crm.filter.mine")}
        </label>
        {isManager && (
          <Button className="ms-auto" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> {t("crm.lead.new")}
          </Button>
        )}
      </div>
      {listQ.isLoading && <LoadingState />}
      {listQ.error && <ErrorState message={(listQ.error as Error).message} />}
      {listQ.data && (
        <DataTable<Lead>
          tableId="crm-leads"
          exportName="leads"
          rows={listQ.data.rows}
          rowKey={(l) => l.id}
          columns={columns}
          onRowClick={(l) => navigate(`/crm/leads/${l.id}`)}
          empty={<EmptyState icon={<UserPlus className="h-10 w-10" />} title={t("crm.lead.empty")} description={t("crm.lead.emptyHint")} />}
          footer={<Pagination page={page} pageSize={PAGE_SIZE} total={listQ.data.total} onPage={setPage} />}
        />
      )}
      <Modal title={t("crm.lead.newTitle")} open={creating} onClose={() => setCreating(false)} wide>
        {creating && (
          <LeadForm
            onCancel={() => setCreating(false)}
            onDone={(id) => {
              setCreating(false);
              void qc.invalidateQueries({ queryKey: ["crm_leads"] });
              toast.success(t("crm.lead.saved"));
              navigate(`/crm/leads/${id}`);
            }}
          />
        )}
      </Modal>
    </div>
  );
}
