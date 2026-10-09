import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, Landmark, RefreshCw, Scale } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "../../lib/supabase";
import { listRows, wrapDbError } from "../../lib/db";
import { formatDate, formatMoney } from "../../lib/format";
import { ltrText } from "../../lib/bidi";
import { CURSOR_FILL, GRID_STROKE, TICK_STYLE, TOOLTIP_CONTENT_STYLE, TOOLTIP_ITEM_STYLE, TOOLTIP_LABEL_STYLE } from "../../lib/chart";
import { accountBalances, monthKeys, monthlySeries, type MonthlyRow } from "../../../shared/finance";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useI18n, useT, useTp } from "../../i18n";
import { Badge, Bdi, Button, Card, ErrorState, LoadingState, Ltr, StatCard } from "../../components/ui";
import { useToast } from "../../components/Toast";
import {
  ENTRY_SELECT, accountName, addMonthsIso, entryTone, todayIn, useAccounts, useBalances, useFinanceSettings, type JournalEntry,
} from "./types";

const MONTHS = 6;
const PENDING_KEYS = ["invoice", "payment", "expense", "vendor_bill", "vendor_payment", "payroll", "reverse"] as const;

export default function OverviewPage() {
  const t = useT();
  const tp = useTp();
  const { language } = useI18n();
  const tenant = useTenant();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const today = todayIn(tenant.timezone);
  const from = addMonthsIso(today, -(MONTHS - 1));

  const accountsQ = useAccounts();
  const settingsQ = useFinanceSettings();
  const balancesQ = useBalances(null, today);
  const monthlyQ = useQuery({
    queryKey: ["finance_monthly", from, today],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("finance_monthly", { p_from: from, p_to: today });
      if (error) throw wrapDbError(error);
      return (data ?? []) as MonthlyRow[];
    },
  });
  const pendingQ = useQuery({
    queryKey: ["finance_pending"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("finance_pending_counts");
      if (error) throw wrapDbError(error);
      return (data ?? {}) as Record<string, number>;
    },
  });
  const recentQ = useQuery({
    queryKey: ["journal_entries", "recent"],
    queryFn: () =>
      listRows<JournalEntry>("journal_entries", (q) =>
        q.select(ENTRY_SELECT).order("entry_date", { ascending: false }).order("number", { ascending: false }).limit(6)),
  });

  const sync = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("finance_sync");
      if (error) throw wrapDbError(error);
      return data as { posted: number; reversed: number; skipped: number };
    },
    onSuccess: (r) => {
      for (const k of ["finance_pending", "finance_balances", "finance_monthly", "journal_entries", "expenses"]) {
        void qc.invalidateQueries({ queryKey: [k] });
      }
      toast.success(tp("finance.sync.posted", r.posted + r.reversed));
      if (r.skipped > 0) toast.error(tp("finance.sync.skipped", r.skipped));
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("common.error")),
  });

  const data = useMemo(() => {
    const accounts = accountsQ.data ?? [];
    const balances = accountBalances(accounts, balancesQ.data ?? []);
    const map = settingsQ.data?.accounts ?? {};
    const cashIds = new Set([map.cash, map.bank].filter(Boolean));
    const cashAccounts = balances.filter((b) => cashIds.has(b.account.id));
    const series = monthlySeries(monthlyQ.data ?? [], monthKeys(from, today));
    const thisMonth = series[series.length - 1] ?? { income: 0, expense: 0, net: 0 };
    const lastMonth = series[series.length - 2] ?? { income: 0, expense: 0, net: 0 };
    return { cashAccounts, cash: cashAccounts.reduce((s, b) => s + b.natural, 0), series, thisMonth, lastMonth };
  }, [accountsQ.data, balancesQ.data, settingsQ.data, monthlyQ.data, from, today]);

  if (accountsQ.isLoading || balancesQ.isLoading) return <LoadingState />;
  const err = accountsQ.error ?? balancesQ.error ?? monthlyQ.error;
  if (err) return <ErrorState message={(err as Error).message} />;
  if ((accountsQ.data ?? []).length === 0) return null;

  const money = (n: number) => formatMoney(n, tenant.currency);
  const pending = pendingQ.data ?? {};
  const pendingTotal = PENDING_KEYS.reduce((s, k) => s + Number(pending[k] ?? 0), 0);
  const netChange = data.thisMonth.net - data.lastMonth.net;
  const hasSeries = data.series.some((m) => m.income !== 0 || m.expense !== 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={<Landmark className="h-5 w-5" />} tone="blue" label={t("finance.kpi.cash")} value={<Ltr>{money(data.cash)}</Ltr>}
          sub={t("finance.kpi.cashSub")} />
        <StatCard icon={<ArrowUpRight className="h-5 w-5 rtl:-scale-x-100" />} tone="green" label={t("finance.kpi.income")}
          value={<Ltr>{money(data.thisMonth.income)}</Ltr>} sub={t("finance.kpi.lastMonth", { amount: ltrText(money(data.lastMonth.income)) })} />
        <StatCard icon={<ArrowDownRight className="h-5 w-5 rtl:-scale-x-100" />} tone="amber" label={t("finance.kpi.expense")}
          value={<Ltr>{money(data.thisMonth.expense)}</Ltr>} sub={t("finance.kpi.lastMonth", { amount: ltrText(money(data.lastMonth.expense)) })} />
        <StatCard icon={<Scale className="h-5 w-5" />} tone="violet" label={t("finance.kpi.net")} value={<Ltr>{money(data.thisMonth.net)}</Ltr>}
          sub={netChange === 0 ? t("finance.kpi.netSame") : t(netChange > 0 ? "finance.kpi.netUp" : "finance.kpi.netDown", { amount: ltrText(money(Math.abs(netChange))) })}
          subTone={netChange > 0 ? "good" : netChange < 0 ? "serious" : "muted"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <h2 className="text-sm font-semibold text-ink">{t("finance.chart.title")}</h2>
          <p className="mb-3 text-xs text-ink-3">{t("finance.chart.hint")}</p>
          {!hasSeries ? (
            <p className="py-10 text-center text-sm text-ink-3">{t("finance.chart.empty")}</p>
          ) : (
            <div dir="ltr">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={data.series} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
                  <XAxis dataKey="month" tick={TICK_STYLE} axisLine={false} tickLine={false} tickFormatter={(m: string) => m.slice(2)} />
                  <YAxis tick={TICK_STYLE} axisLine={false} tickLine={false} width={56}
                    tickFormatter={(v: number) => new Intl.NumberFormat("en", { notation: "compact" }).format(v)} />
                  <Tooltip cursor={{ fill: CURSOR_FILL }} contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_STYLE}
                    itemStyle={TOOLTIP_ITEM_STYLE} formatter={(v) => money(Number(v ?? 0))} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="income" name={t("finance.chart.income")} fill="#1d67f1" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="expense" name={t("finance.chart.expense")} fill="#0d9488" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card className="p-4">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-ink">{t("finance.pending.title")}</h2>
              <p className="text-xs text-ink-3">{t("finance.pending.hint")}</p>
            </div>
            {isManager && pendingTotal > 0 && (
              <Button variant="secondary" className="px-2.5 py-1.5" loading={sync.isPending} onClick={() => sync.mutate()}>
                <RefreshCw className="h-4 w-4" /> {t("finance.pending.postAll")}
              </Button>
            )}
          </div>
          {pendingTotal === 0 ? (
            <p className="py-6 text-center text-sm text-ink-3">{t("finance.pending.empty")}</p>
          ) : (
            <ul className="divide-y divide-line">
              {PENDING_KEYS.filter((k) => Number(pending[k] ?? 0) > 0).map((k) => (
                <li key={k} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="text-ink-2">{t(`finance.pending.${k}`)}</span>
                  <Ltr className="font-medium text-ink">{String(pending[k])}</Ltr>
                </li>
              ))}
            </ul>
          )}
          {data.cashAccounts.length > 0 && (
            <>
              <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-ink-3">{t("finance.kpi.cash")}</h3>
              <ul className="space-y-1.5 text-sm">
                {data.cashAccounts.map((b) => (
                  <li key={b.account.id} className="flex justify-between gap-3">
                    <span className="truncate text-ink-2"><Bdi>{accountName(b.account, language)}</Bdi></span>
                    <Ltr className="text-ink">{money(b.natural)}</Ltr>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </div>

      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink">{t("finance.recent.title")}</h2>
          <Link to="/finance/journal" className="text-sm text-brand-700 hover:underline">{t("finance.recent.all")}</Link>
        </div>
        {(recentQ.data ?? []).length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-3">{t("finance.journal.empty")}</p>
        ) : (
          <ul className="divide-y divide-line">
            {(recentQ.data ?? []).map((e) => (
              <li key={e.id}>
                <Link to={`/finance/journal/${e.id}`} className="flex items-center gap-3 py-2.5 hover:bg-canvas">
                  <Ltr className="w-24 shrink-0 text-sm font-medium text-brand-700">{e.doc_number}</Ltr>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink"><Bdi>{e.memo || t(`finance.source.${e.source_type}`)}</Bdi></span>
                    <span className="block text-xs text-ink-3">{formatDate(e.entry_date)} · {t(`finance.source.${e.source_type}`)}</span>
                  </span>
                  <Ltr className="hidden whitespace-nowrap text-sm text-ink sm:inline">{money(e.total)}</Ltr>
                  <Badge tone={entryTone[e.status]}>{t(`finance.entryStatus.${e.status}`)}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
