import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardCheck, Plus, X } from "lucide-react";
import { getRow, listPage, listRows } from "../../lib/db";
import { formatDate } from "../../lib/format";
import { SUBJECT_TYPES, STATE_ORDER, obligationState, type ObligationStatus, type SubjectType } from "../../../shared/regulatory";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useI18n, useT } from "../../i18n";
import { Badge, Bdi, Button, EmptyState, ErrorState, LoadingState, Ltr, Modal, Pagination, Select } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { ObligationForm } from "./forms";
import { ObligationDialog, useDueText } from "./ObligationDialog";
import { addDays, reqTitle, stateTone, todayIn, useSubjectNames } from "./labels";
import { OBL_SELECT, type Obligation, type Requirement } from "./types";

const PAGE_SIZE = 25;
const SOON_DAYS = 30;
type Filter = "open" | "overdue" | "soon" | "later" | "compliant" | "waived" | "all";
const FILTERS: Filter[] = ["open", "overdue", "soon", "later", "compliant", "waived", "all"];

export default function ObligationsPage() {
  const t = useT();
  const { language } = useI18n();
  const tenant = useTenant();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const dueText = useDueText();
  const [params, setParams] = useSearchParams();
  const requirementId = params.get("requirement") ?? "";
  const [filter, setFilter] = useState<Filter>("open");
  const [subjectType, setSubjectType] = useState<"" | SubjectType>("");
  const [page, setPage] = useState(0);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const today = todayIn(tenant.timezone);
  const soon = addDays(today, SOON_DAYS);

  const reqQ = useQuery({
    queryKey: ["compliance_requirements", "one", requirementId],
    enabled: !!requirementId,
    queryFn: () => getRow<Requirement>("compliance_requirements", requirementId),
  });

  const countsQ = useQuery({
    queryKey: ["compliance_obligations", "counts", requirementId, subjectType],
    queryFn: () =>
      listRows<{ status: ObligationStatus; due_date: string }>("compliance_obligations", (q) => {
        let f = q.select("status, due_date");
        if (requirementId) f = f.eq("requirement_id", requirementId);
        if (subjectType) f = f.eq("subject_type", subjectType);
        return f.limit(20000);
      }),
  });
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { open: 0, overdue: 0, soon: 0, later: 0, compliant: 0, waived: 0, all: 0 };
    for (const r of countsQ.data ?? []) {
      c.all += 1;
      if (r.status === "compliant") c.compliant += 1;
      else if (r.status === "waived") c.waived += 1;
      else {
        c.open += 1;
        if (r.status === "non_compliant" || r.due_date < today) c.overdue += 1;
        else if (r.due_date <= soon) c.soon += 1;
        else c.later += 1;
      }
    }
    return c;
  }, [countsQ.data, today, soon]);

  const listQ = useQuery({
    queryKey: ["compliance_obligations", "list", { page, filter, subjectType, requirementId, today }],
    queryFn: () =>
      listPage<Obligation>("compliance_obligations", page, PAGE_SIZE, (q) => {
        let f = q.select(OBL_SELECT);
        if (requirementId) f = f.eq("requirement_id", requirementId);
        if (subjectType) f = f.eq("subject_type", subjectType);
        if (filter === "open") f = f.in("status", ["pending", "non_compliant"]);
        else if (filter === "overdue") f = f.or(`status.eq.non_compliant,and(status.eq.pending,due_date.lt.${today})`);
        else if (filter === "soon") f = f.eq("status", "pending").gte("due_date", today).lte("due_date", soon);
        else if (filter === "later") f = f.eq("status", "pending").gt("due_date", soon);
        else if (filter !== "all") f = f.eq("status", filter);
        const recentFirst = filter === "compliant" || filter === "waived" || filter === "all";
        return f.order("due_date", { ascending: !recentFirst });
      }),
  });
  const rows = listQ.data?.rows ?? [];
  const nameOf = useSubjectNames(rows);
  const opened = rows.find((r) => r.id === openId) ?? null;

  const pick = (f: Filter) => { setFilter(f); setPage(0); };
  const subjectLabel = (o: Obligation) =>
    o.subject_type === "company" ? t("regulatory.subject.companyWide") : nameOf(o.subject_id)?.name ?? "…";

  const columns: Array<DataTableColumn<Obligation>> = [
    {
      id: "requirement",
      header: t("regulatory.col.requirement"),
      cell: (o) => (
        <div className="min-w-0 max-w-72">
          <div className="truncate text-ink"><Bdi>{reqTitle(o.requirement, language)}</Bdi></div>
          <Ltr className="text-xs text-ink-3">{o.requirement?.code}</Ltr>
        </div>
      ),
      exportValue: (o) => `${o.requirement?.code ?? ""} ${o.requirement?.title ?? ""}`,
    },
    {
      id: "subject",
      header: t("regulatory.col.subject"),
      cell: (o) => {
        const n = nameOf(o.subject_id);
        return (
          <div className="min-w-0 max-w-56">
            <div className="truncate text-ink-2"><Bdi>{subjectLabel(o)}</Bdi></div>
            {o.subject_type !== "company" && (
              <div className="truncate text-xs text-ink-3">
                {t(`regulatory.subject.${o.subject_type}`)}{n?.meta && <> · <Ltr>{n.meta}</Ltr></>}
              </div>
            )}
          </div>
        );
      },
      exportValue: (o) => subjectLabel(o),
    },
    {
      id: "due",
      header: t("regulatory.col.due"),
      cell: (o) => (
        <div className="whitespace-nowrap">
          <div className="text-ink-2">{formatDate(o.due_date)}</div>
          {(o.status === "pending" || o.status === "non_compliant") && <div className="text-xs text-ink-3">{dueText(o.due_date)}</div>}
        </div>
      ),
      sortValue: (o) => o.due_date,
      exportValue: (o) => o.due_date,
    },
    {
      id: "responsible",
      header: t("regulatory.col.responsible"),
      minBreakpoint: "lg",
      cell: (o) => (o.responsible ? <Bdi className="text-ink-2">{o.responsible.full_name || o.responsible.email}</Bdi> : <span className="text-ink-3">—</span>),
      exportValue: (o) => o.responsible?.full_name ?? "",
    },
    {
      id: "completed",
      header: t("regulatory.col.completed"),
      minBreakpoint: "md",
      cell: (o) => <span className="whitespace-nowrap text-ink-2">{o.completed_on ? formatDate(o.completed_on) : "—"}</span>,
      sortValue: (o) => o.completed_on ?? "",
      exportValue: (o) => o.completed_on ?? "",
    },
    {
      id: "state",
      header: t("regulatory.col.status"),
      cell: (o) => {
        const s = obligationState(o, o.requirement?.lead_days ?? 30, today);
        return <span className="whitespace-nowrap"><Badge tone={stateTone[s]}>{t(`regulatory.state.${s}`)}</Badge></span>;
      },
      sortValue: (o) => STATE_ORDER.indexOf(obligationState(o, o.requirement?.lead_days ?? 30, today)),
      exportValue: (o) => o.status,
    },
  ];

  return (
    <div>
      {requirementId && (
        <div className="mb-3 inline-flex max-w-full items-center gap-2 rounded-full border border-line bg-canvas px-3 py-1 text-sm text-ink">
          <span className="truncate">{t("regulatory.o.forRequirement", { title: reqTitle(reqQ.data, language) || "…" })}</span>
          <button type="button" aria-label={t("regulatory.o.clearRequirement")} className="text-ink-3 hover:text-ink"
            onClick={() => { params.delete("requirement"); setParams(params, { replace: true }); setPage(0); }}>
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      <div className="mb-3 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => pick(f)}
            aria-pressed={filter === f}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${
              filter === f ? "border-brand-600 bg-brand-600 text-white" : "border-line bg-surface text-ink-2 hover:bg-canvas"
            }`}
          >
            {t(`regulatory.filter.${f}`)}
            <Ltr className={`text-xs ${filter === f ? "text-white/80" : f === "overdue" && counts.overdue > 0 ? "text-serious" : "text-ink-3"}`}>
              {String(counts[f])}
            </Ltr>
          </button>
        ))}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="w-full sm:w-48">
          <Select value={subjectType} onChange={(e) => { setSubjectType(e.target.value as "" | SubjectType); setPage(0); }}
            aria-label={t("regulatory.col.subject")}>
            <option value="">{t("regulatory.filter.anySubject")}</option>
            {SUBJECT_TYPES.map((s) => <option key={s} value={s}>{t(`regulatory.subjects.${s}`)}</option>)}
          </Select>
        </div>
        {isManager && (
          <Button className="ms-auto" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> {t("regulatory.o.add")}
          </Button>
        )}
      </div>
      {listQ.isLoading && <LoadingState />}
      {listQ.error && <ErrorState message={(listQ.error as Error).message} />}
      {listQ.data && (
        <DataTable<Obligation>
          tableId="compliance_obligations"
          exportName="compliance-obligations"
          rows={rows}
          rowKey={(o) => o.id}
          columns={columns}
          onRowClick={(o) => setOpenId(o.id)}
          empty={<EmptyState icon={<ClipboardCheck className="h-10 w-10" />} title={t("regulatory.o.empty")} description={t("regulatory.o.emptyHint")} />}
          footer={<Pagination page={page} pageSize={PAGE_SIZE} total={listQ.data.total} onPage={setPage} />}
        />
      )}
      <ObligationDialog obligation={opened} subjectName={opened ? subjectLabel(opened) : undefined} onClose={() => setOpenId(null)} />
      <Modal title={t("regulatory.o.newTitle")} open={creating} onClose={() => setCreating(false)}>
        {creating && (
          <ObligationForm
            requirementId={requirementId || undefined}
            onCancel={() => setCreating(false)}
            onDone={() => {
              setCreating(false);
              void qc.invalidateQueries({ queryKey: ["compliance_obligations"] });
              toast.success(t("regulatory.o.saved"));
            }}
          />
        )}
      </Modal>
    </div>
  );
}
