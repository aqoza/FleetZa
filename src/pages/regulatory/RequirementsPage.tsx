import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpenCheck, Plus, Sparkles } from "lucide-react";
import { listPage, sanitizeSearch } from "../../lib/db";
import { CATEGORIES, SUBJECT_TYPES, type Category, type SubjectType } from "../../../shared/regulatory";
import { useAuth } from "../../context/AuthContext";
import { useI18n, useT, useTp } from "../../i18n";
import { Badge, Bdi, Button, EmptyState, ErrorState, Input, LoadingState, Ltr, Modal, Pagination, Select } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { RequirementForm, SeedForm } from "./forms";
import { reqTitle } from "./labels";
import { REQ_SELECT, type Requirement } from "./types";

const PAGE_SIZE = 25;
type Active = "active" | "inactive" | "all";

export function useFrequencyText() {
  const t = useT();
  const tp = useTp();
  return (months: number | null) => (months == null ? t("regulatory.oneOff") : tp("regulatory.everyMonths", months));
}

export default function RequirementsPage() {
  const t = useT();
  const { language } = useI18n();
  const navigate = useNavigate();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const tp = useTp();
  const frequency = useFrequencyText();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<"" | Category>("");
  const [subject, setSubject] = useState<"" | SubjectType>("");
  const [active, setActive] = useState<Active>("active");
  const [page, setPage] = useState(0);
  const [modal, setModal] = useState<"new" | "seed" | null>(null);
  const term = sanitizeSearch(search);

  const listQ = useQuery({
    queryKey: ["compliance_requirements", "list", { page, term, category, subject, active }],
    queryFn: () =>
      listPage<Requirement>("compliance_requirements", page, PAGE_SIZE, (q) => {
        let f = q.select(REQ_SELECT);
        if (category) f = f.eq("category", category);
        if (subject) f = f.eq("applies_to", subject);
        if (active !== "all") f = f.eq("active", active === "active");
        if (term) f = f.or(`code.ilike.%${term}%,title.ilike.%${term}%,title_ar.ilike.%${term}%,authority.ilike.%${term}%`);
        return f.order("code");
      }),
  });

  const columns: Array<DataTableColumn<Requirement>> = [
    {
      id: "code",
      header: t("regulatory.f.code"),
      cell: (r) => <Ltr className="whitespace-nowrap font-medium text-brand-700">{r.code}</Ltr>,
      sortValue: (r) => r.code,
      exportValue: (r) => r.code,
    },
    {
      id: "title",
      header: t("regulatory.f.title"),
      cell: (r) => (
        <div className="min-w-0 max-w-80">
          <div className="flex items-center gap-2">
            <Bdi className="truncate text-ink">{reqTitle(r, language)}</Bdi>
            {!r.verified && <span className="shrink-0 whitespace-nowrap"><Badge tone="yellow">{t("regulatory.r.unverified")}</Badge></span>}
            {!r.active && <span className="shrink-0 whitespace-nowrap"><Badge tone="slate">{t("regulatory.r.inactive")}</Badge></span>}
          </div>
          {r.authority && <div className="truncate text-xs text-ink-3"><Bdi>{r.authority}</Bdi></div>}
        </div>
      ),
      exportValue: (r) => r.title,
    },
    {
      id: "applies",
      header: t("regulatory.f.appliesTo"),
      minBreakpoint: "sm",
      cell: (r) => <span className="whitespace-nowrap text-ink-2">{t(`regulatory.subjects.${r.applies_to}`)}</span>,
      exportValue: (r) => r.applies_to,
    },
    {
      id: "category",
      header: t("regulatory.f.category"),
      minBreakpoint: "md",
      cell: (r) => <span className="whitespace-nowrap text-ink-2">{t(`regulatory.cat.${r.category}`)}</span>,
      exportValue: (r) => r.category,
    },
    {
      id: "frequency",
      header: t("regulatory.f.frequencyShort"),
      minBreakpoint: "lg",
      cell: (r) => <span className="whitespace-nowrap text-ink-2">{frequency(r.frequency_months)}</span>,
      sortValue: (r) => r.frequency_months ?? 999,
      exportValue: (r) => r.frequency_months ?? "",
    },
    {
      id: "country",
      header: t("regulatory.f.countryShort"),
      minBreakpoint: "lg",
      cell: (r) => <Ltr className="text-ink-2">{r.country ?? "—"}</Ltr>,
      exportValue: (r) => r.country ?? "",
    },
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        {(["active", "inactive", "all"] as const).map((a) => (
          <button key={a} type="button" onClick={() => { setActive(a); setPage(0); }} aria-pressed={active === a}
            className={`rounded-full border px-3 py-1 text-sm ${
              active === a ? "border-brand-600 bg-brand-600 text-white" : "border-line bg-surface text-ink-2 hover:bg-canvas"
            }`}>
            {t(`regulatory.r.filter.${a}`)}
          </button>
        ))}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} placeholder={t("regulatory.r.search")} className="w-full sm:max-w-64" />
        <div className="w-[calc(50%-0.375rem)] sm:w-44">
          <Select value={category} onChange={(e) => { setCategory(e.target.value as "" | Category); setPage(0); }} aria-label={t("regulatory.f.category")}>
            <option value="">{t("regulatory.filter.anyCategory")}</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{t(`regulatory.cat.${c}`)}</option>)}
          </Select>
        </div>
        <div className="w-[calc(50%-0.375rem)] sm:w-44">
          <Select value={subject} onChange={(e) => { setSubject(e.target.value as "" | SubjectType); setPage(0); }} aria-label={t("regulatory.f.appliesTo")}>
            <option value="">{t("regulatory.filter.anySubject")}</option>
            {SUBJECT_TYPES.map((s) => <option key={s} value={s}>{t(`regulatory.subjects.${s}`)}</option>)}
          </Select>
        </div>
        {isManager && (
          <div className="ms-auto flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setModal("seed")}><Sparkles className="h-4 w-4" /> {t("regulatory.seed.open")}</Button>
            <Button onClick={() => setModal("new")}><Plus className="h-4 w-4" /> {t("regulatory.r.add")}</Button>
          </div>
        )}
      </div>
      {listQ.isLoading && <LoadingState />}
      {listQ.error && <ErrorState message={(listQ.error as Error).message} />}
      {listQ.data && (
        <DataTable<Requirement>
          tableId="compliance_requirements"
          exportName="compliance-requirements"
          rows={listQ.data.rows}
          rowKey={(r) => r.id}
          columns={columns}
          onRowClick={(r) => navigate(`/regulatory/requirements/${r.id}`)}
          empty={
            <EmptyState icon={<BookOpenCheck className="h-10 w-10" />} title={t("regulatory.r.empty")} description={t("regulatory.r.emptyHint")}
              action={isManager ? <Button onClick={() => setModal("seed")}><Sparkles className="h-4 w-4" /> {t("regulatory.seed.open")}</Button> : undefined} />
          }
          footer={<Pagination page={page} pageSize={PAGE_SIZE} total={listQ.data.total} onPage={setPage} />}
        />
      )}
      <Modal title={t("regulatory.r.newTitle")} open={modal === "new"} onClose={() => setModal(null)} wide>
        {modal === "new" && (
          <RequirementForm onCancel={() => setModal(null)}
            onDone={(id) => { setModal(null); void qc.invalidateQueries({ queryKey: ["compliance_requirements"] }); toast.success(t("regulatory.r.saved")); navigate(`/regulatory/requirements/${id}`); }} />
        )}
      </Modal>
      <Modal title={t("regulatory.seed.title")} open={modal === "seed"} onClose={() => setModal(null)}>
        {modal === "seed" && (
          <SeedForm onCancel={() => setModal(null)}
            onDone={(n) => {
              setModal(null);
              void qc.invalidateQueries({ queryKey: ["compliance_requirements"] });
              if (n > 0) toast.success(tp("regulatory.seed.added", n));
              else toast.success(t("regulatory.seed.none"));
            }} />
        )}
      </Modal>
    </div>
  );
}
