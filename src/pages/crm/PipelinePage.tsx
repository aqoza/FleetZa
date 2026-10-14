import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Handshake, Plus, Scale, Target, Trophy } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { listRows, updateRow } from "../../lib/db";
import { formatDate, formatMoney } from "../../lib/format";
import { CURSOR_FILL, GRID_STROKE, TICK_STYLE, TOOLTIP_CONTENT_STYLE, TOOLTIP_ITEM_STYLE, TOOLTIP_LABEL_STYLE } from "../../lib/chart";
import { OPEN_STAGES, byStage, forecast, pipelineTotals, type Stage } from "../../../shared/crm";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useT, useTp } from "../../i18n";
import { Bdi, Button, Card, ErrorState, LoadingState, Ltr, Modal, StatCard } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { OpportunityForm } from "./forms";
import { dayIn, personName } from "./labels";
import { OPP_SELECT, type Opportunity } from "./types";

const FORECAST_MONTHS = 6;

export default function PipelinePage() {
  const t = useT();
  const tp = useTp();
  const tenant = useTenant();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const today = dayIn(new Date().toISOString(), tenant.timezone);
  const yearAgo = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;

  // Open deals, plus a year of closed ones for the win rate.
  const q = useQuery({
    queryKey: ["crm_opportunities", "pipeline", yearAgo],
    queryFn: () =>
      listRows<Opportunity>("crm_opportunities", (b) =>
        b.select(OPP_SELECT)
          .or(`stage.in.(${OPEN_STAGES.join(",")}),won_at.gte.${yearAgo},lost_at.gte.${yearAgo}`)
          .order("expected_close_date", { ascending: true, nullsFirst: false })
          .limit(2000)),
  });

  const move = useMutation({
    mutationFn: ({ o, to }: { o: Opportunity; to: Stage }) => updateRow("crm_opportunities", o.id, { stage: to }),
    onSuccess: (_d, { to }) => {
      void qc.invalidateQueries({ queryKey: ["crm_opportunities"] });
      toast.success(t("crm.opp.movedTo", { stage: t(`crm.stage.${to}`) }));
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("common.error")),
  });

  const data = useMemo(() => {
    const rows = q.data ?? [];
    const thisMonth = today.slice(0, 7);
    const wonThisMonth = rows.filter((r) => r.stage === "won" && r.won_at && dayIn(r.won_at, tenant.timezone).startsWith(thisMonth));
    return {
      totals: pipelineTotals(rows),
      columns: byStage(rows),
      forecast: forecast(rows, thisMonth, FORECAST_MONTHS),
      wonMonth: wonThisMonth.length,
      wonMonthAmount: wonThisMonth.reduce((s, r) => s + Number(r.amount), 0),
    };
  }, [q.data, today, tenant.timezone]);

  if (q.isLoading) return <LoadingState />;
  if (q.error) return <ErrorState message={(q.error as Error).message} />;
  const money = (n: number) => formatMoney(n, tenant.currency);
  const { totals } = data;
  const hasForecast = data.forecast.some((m) => m.best > 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={<Target className="h-5 w-5" />} tone="blue" label={t("crm.kpi.open")} value={money(totals.openAmount)}
          sub={tp("crm.kpi.openSub", totals.open)} />
        <StatCard icon={<Scale className="h-5 w-5" />} tone="violet" label={t("crm.kpi.weighted")} value={money(totals.weightedAmount)}
          sub={t("crm.kpi.weightedSub")} />
        <StatCard icon={<Trophy className="h-5 w-5" />} tone="green" label={t("crm.kpi.wonMonth")} value={money(data.wonMonthAmount)}
          sub={tp("crm.kpi.wonMonthSub", data.wonMonth)} />
        <StatCard icon={<Handshake className="h-5 w-5" />} tone="amber" label={t("crm.kpi.winRate")}
          value={totals.winRate == null ? "—" : `${Math.round(totals.winRate * 100)}%`}
          sub={t("crm.kpi.winRateSub", { won: totals.won, lost: totals.lost })} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">{t("crm.pipeline.title")}</h2>
          <p className="text-xs text-ink-3">{t("crm.pipeline.hint")}</p>
        </div>
        {isManager && (
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> {t("crm.opp.new")}
          </Button>
        )}
      </div>

      <div className="-mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        <div className="grid min-w-[56rem] grid-cols-4 gap-3">
          {data.columns.map((col, ci) => (
            <section key={col.stage} className="flex min-w-0 flex-col rounded-2xl border border-line bg-canvas p-2.5" aria-label={t(`crm.stage.${col.stage}`)}>
              <header className="mb-2 px-1">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-ink">{t(`crm.stage.${col.stage}`)}</h3>
                  <Ltr className="rounded-full bg-surface px-2 py-0.5 text-xs text-ink-3">{String(col.rows.length)}</Ltr>
                </div>
                <div className="mt-0.5 text-xs text-ink-3">
                  <Ltr>{money(col.amount)}</Ltr> · {t("crm.pipeline.weightedShort", { amount: money(col.weightedAmount) })}
                </div>
              </header>
              <ul className="space-y-2">
                {col.rows.length === 0 && <li className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-xs text-ink-3">{t("crm.pipeline.emptyStage")}</li>}
                {col.rows.map((o) => {
                  const late = !!o.expected_close_date && o.expected_close_date < today;
                  return (
                    <li key={o.id} className="rounded-xl border border-line bg-surface p-3 shadow-card">
                      <Link to={`/crm/o/${o.id}`} className="block min-w-0 hover:underline">
                        <span className="line-clamp-2 text-sm font-medium text-ink"><Bdi>{o.title}</Bdi></span>
                      </Link>
                      <div className="mt-0.5 truncate text-xs text-ink-3">
                        {o.customer ? <Bdi>{o.customer.name}</Bdi> : o.lead ? <Bdi>{o.lead.name}</Bdi> : <Ltr>{o.doc_number}</Ltr>}
                      </div>
                      <div className="mt-2 flex items-baseline justify-between gap-2 text-xs">
                        <Ltr className="font-semibold text-ink">{formatMoney(Number(o.amount), o.currency)}</Ltr>
                        <Ltr className="text-ink-3">{`${o.probability}%`}</Ltr>
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-2 text-xs">
                        <span className={late ? "text-serious" : "text-ink-3"}>
                          {o.expected_close_date ? formatDate(o.expected_close_date) : t("crm.pipeline.noDate")}
                        </span>
                        {o.owner && <span className="truncate text-ink-3"><Bdi>{personName(o.owner)}</Bdi></span>}
                      </div>
                      {isManager && (
                        <div className="mt-2 flex justify-between gap-1 border-t border-line pt-2">
                          <Button variant="ghost" className="px-2 py-1" disabled={ci === 0 || move.isPending}
                            onClick={() => move.mutate({ o, to: OPEN_STAGES[ci - 1] })}
                            aria-label={ci > 0 ? t("crm.pipeline.moveTo", { stage: t(`crm.stage.${OPEN_STAGES[ci - 1]}`) }) : undefined}
                            title={ci > 0 ? t("crm.pipeline.moveTo", { stage: t(`crm.stage.${OPEN_STAGES[ci - 1]}`) }) : undefined}>
                            <ChevronLeft className="h-4 w-4 rtl:-scale-x-100" />
                          </Button>
                          <Button variant="ghost" className="px-2 py-1" disabled={ci === OPEN_STAGES.length - 1 || move.isPending}
                            onClick={() => move.mutate({ o, to: OPEN_STAGES[ci + 1] })}
                            aria-label={ci < OPEN_STAGES.length - 1 ? t("crm.pipeline.moveTo", { stage: t(`crm.stage.${OPEN_STAGES[ci + 1]}`) }) : undefined}
                            title={ci < OPEN_STAGES.length - 1 ? t("crm.pipeline.moveTo", { stage: t(`crm.stage.${OPEN_STAGES[ci + 1]}`) }) : undefined}>
                            <ChevronRight className="h-4 w-4 rtl:-scale-x-100" />
                          </Button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </div>

      <Card className="p-4">
        <h2 className="text-sm font-semibold text-ink">{t("crm.forecast.title")}</h2>
        <p className="mb-3 text-xs text-ink-3">{t("crm.forecast.hint")}</p>
        {!hasForecast ? (
          <p className="py-10 text-center text-sm text-ink-3">{t("crm.forecast.empty")}</p>
        ) : (
          <div dir="ltr">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.forecast} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
                <XAxis dataKey="month" tick={TICK_STYLE} axisLine={false} tickLine={false} tickFormatter={(m: string) => m.slice(2)} />
                <YAxis tick={TICK_STYLE} axisLine={false} tickLine={false} width={56}
                  tickFormatter={(v: number) => new Intl.NumberFormat("en", { notation: "compact" }).format(v)} />
                <Tooltip cursor={{ fill: CURSOR_FILL }} contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_STYLE}
                  itemStyle={TOOLTIP_ITEM_STYLE} formatter={(v) => money(Number(v ?? 0))} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="weighted" name={t("crm.forecast.weighted")} fill="#1d67f1" radius={[4, 4, 0, 0]} />
                <Bar dataKey="best" name={t("crm.forecast.best")} fill="#0d9488" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <Modal title={t("crm.opp.newTitle")} open={creating} onClose={() => setCreating(false)} wide>
        {creating && (
          <OpportunityForm
            onCancel={() => setCreating(false)}
            onDone={() => {
              setCreating(false);
              void qc.invalidateQueries({ queryKey: ["crm_opportunities"] });
              toast.success(t("crm.opp.saved"));
            }}
          />
        )}
      </Modal>
    </div>
  );
}
