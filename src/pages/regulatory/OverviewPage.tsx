import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertOctagon, BookOpenCheck, CalendarClock, ShieldCheck } from "lucide-react";
import { listRows } from "../../lib/db";
import { formatDate } from "../../lib/format";
import {
  SUBJECT_TYPES, currentObligations, obligationState, rate, ratesBy, type Category, type SubjectType,
} from "../../../shared/regulatory";
import { useTenant } from "../../context/AuthContext";
import { useI18n, useT, useTp } from "../../i18n";
import { Badge, Bdi, Button, Card, ErrorState, LoadingState, Ltr, StatCard } from "../../components/ui";
import { ObligationDialog, useDueText } from "./ObligationDialog";
import { addDays, reqTitle, stateTone, todayIn, useSubjectNames } from "./labels";
import { OBL_SELECT, type Obligation } from "./types";

const SOON_DAYS = 30;

export default function OverviewPage() {
  const t = useT();
  const tp = useTp();
  const { language } = useI18n();
  const tenant = useTenant();
  const dueText = useDueText();
  const today = todayIn(tenant.timezone);
  const [openId, setOpenId] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["compliance_obligations", "overview"],
    queryFn: () => listRows<Obligation>("compliance_obligations", (b) => b.select(OBL_SELECT).order("due_date").limit(20000)),
  });
  const reqQ = useQuery({
    queryKey: ["compliance_requirements", "overview"],
    queryFn: () => listRows<{ id: string; verified: boolean }>("compliance_requirements", (b) => b.select("id, verified").eq("active", true).limit(5000)),
  });

  const stats = useMemo(() => {
    const cur = currentObligations((q.data ?? []).filter((o) => o.requirement?.active !== false))
      .map((o) => ({ o, state: obligationState(o, o.requirement?.lead_days ?? 30, today) }));
    const soon = addDays(today, SOON_DAYS);
    return {
      overall: rate(cur.map((c) => c.state)),
      overdue: cur.filter((c) => c.state === "overdue" || c.state === "non_compliant"),
      dueSoon: cur.filter((c) => c.o.status === "pending" && c.o.due_date >= today && c.o.due_date <= soon).length,
      byCategory: ratesBy(cur.map((c) => ({ key: (c.o.requirement?.category ?? "other") as Category, state: c.state })))
        .sort((a, b) => (a.rate ?? 101) - (b.rate ?? 101)),
      bySubject: new Map(ratesBy(cur.map((c) => ({ key: c.o.subject_type, state: c.state }))).map((r) => [r.key, r])),
    };
  }, [q.data, today]);

  const overdueRows = stats.overdue.slice(0, 10).map((c) => c.o);
  const nameOf = useSubjectNames(overdueRows);
  const opened = overdueRows.find((o) => o.id === openId) ?? null;
  const subjectLabel = (o: Obligation) => (o.subject_type === "company" ? t("regulatory.subject.companyWide") : nameOf(o.subject_id)?.name ?? "…");

  if (q.isLoading) return <LoadingState />;
  if (q.error) return <ErrorState message={(q.error as Error).message} />;
  const reqs = reqQ.data ?? [];
  const unverified = reqs.filter((r) => !r.verified).length;

  if ((q.data ?? []).length === 0) {
    return (
      <Card className="p-6 text-center">
        <BookOpenCheck className="mx-auto mb-3 h-10 w-10 text-ink-3" />
        <h2 className="text-base font-semibold text-ink">{t("regulatory.start.title")}</h2>
        <p className="mx-auto mt-1 max-w-xl text-sm text-ink-3">{t("regulatory.start.body")}</p>
        <div className="mt-4">
          <Link to="/regulatory/requirements"><Button>{t("regulatory.start.cta")}</Button></Link>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={<ShieldCheck className="h-5 w-5" />} tone={stats.overall.rate != null && stats.overall.rate < 90 ? "amber" : "green"}
          label={t("regulatory.kpi.rate")} value={stats.overall.rate == null ? "—" : `${stats.overall.rate}%`}
          sub={t("regulatory.kpi.rateSub", { good: stats.overall.good, total: stats.overall.total })} />
        <StatCard icon={<AlertOctagon className="h-5 w-5" />} tone={stats.overdue.length > 0 ? "red" : "slate"}
          label={t("regulatory.kpi.overdue")} value={stats.overdue.length} sub={t("regulatory.kpi.overdueSub")}
          subTone={stats.overdue.length > 0 ? "serious" : undefined} />
        <StatCard icon={<CalendarClock className="h-5 w-5" />} tone="amber" label={t("regulatory.kpi.soon")} value={stats.dueSoon}
          sub={t("regulatory.kpi.soonSub")} />
        <StatCard icon={<BookOpenCheck className="h-5 w-5" />} tone="blue" label={t("regulatory.kpi.requirements")} value={reqs.length}
          sub={unverified > 0 ? tp("regulatory.kpi.unverified", unverified) : t("regulatory.kpi.allVerified")}
          subTone={unverified > 0 ? "serious" : undefined} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <h2 className="text-sm font-semibold text-ink">{t("regulatory.byCategory")}</h2>
          <p className="mb-3 text-xs text-ink-3">{t("regulatory.byCategoryHint")}</p>
          <ul className="space-y-3">
            {stats.byCategory.map((c) => (
              <li key={c.key}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-ink">{t(`regulatory.cat.${c.key}`)}</span>
                  <Ltr className="text-xs text-ink-3">{`${c.rate ?? 0}% · ${c.good}/${c.total}`}</Ltr>
                </div>
                <div dir="ltr" className="mt-1 h-1.5 rounded-full bg-canvas">
                  <div className={`h-1.5 rounded-full ${(c.rate ?? 0) >= 90 ? "bg-chart-2" : "bg-chart-1"}`} style={{ width: `${c.rate ?? 0}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-ink">{t("regulatory.bySubject")}</h2>
          <ul className="divide-y divide-line">
            {SUBJECT_TYPES.map((s: SubjectType) => {
              const r = stats.bySubject.get(s);
              return (
                <li key={s} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-sm text-ink">{t(`regulatory.subjects.${s}`)}</span>
                  {r ? (
                    <span className="text-end">
                      <Ltr className={`block text-sm font-semibold ${(r.rate ?? 0) >= 90 ? "text-good" : "text-warn"}`}>{`${r.rate}%`}</Ltr>
                      <Ltr className="block text-xs text-ink-3">{`${r.good}/${r.total}`}</Ltr>
                    </span>
                  ) : <span className="text-xs text-ink-3">—</span>}
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      <Card className="p-4">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">{t("regulatory.overdueTitle")}</h2>
            <p className="text-xs text-ink-3">{t("regulatory.overdueHint")}</p>
          </div>
          {stats.overdue.length > 10 && (
            <Link to="/regulatory/obligations" className="shrink-0 text-sm text-brand-700 hover:underline">
              {tp("regulatory.overdueAll", stats.overdue.length)}
            </Link>
          )}
        </div>
        {overdueRows.length === 0 ? (
          <p className="py-4 text-center text-sm text-good">{t("regulatory.overdueEmpty")}</p>
        ) : (
          <ul className="divide-y divide-line">
            {overdueRows.map((o) => {
              const s = obligationState(o, o.requirement?.lead_days ?? 30, today);
              return (
                <li key={o.id}>
                  <button type="button" onClick={() => setOpenId(o.id)} className="flex w-full items-center gap-3 py-2 text-start hover:bg-canvas">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-ink"><Bdi>{reqTitle(o.requirement, language)}</Bdi></div>
                      <div className="truncate text-xs text-ink-3">
                        {o.subject_type !== "company" && <>{t(`regulatory.subject.${o.subject_type}`)} · </>}<Bdi>{subjectLabel(o)}</Bdi>
                      </div>
                    </div>
                    <div className="shrink-0 text-end">
                      <Badge tone={stateTone[s]}>{t(`regulatory.state.${s}`)}</Badge>
                      <div className="text-xs text-ink-3">{s === "overdue" ? dueText(o.due_date) : formatDate(o.due_date)}</div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <ObligationDialog obligation={opened} subjectName={opened ? subjectLabel(opened) : undefined} onClose={() => setOpenId(null)} />
    </div>
  );
}
