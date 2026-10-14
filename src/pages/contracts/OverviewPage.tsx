import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, FileSignature, Plus, Receipt, Repeat, TrendingUp } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "../../lib/supabase";
import { listRows, wrapDbError } from "../../lib/db";
import { formatDate, formatMoney } from "../../lib/format";
import { CURSOR_FILL, GRID_STROKE, TICK_STYLE, TOOLTIP_CONTENT_STYLE, TOOLTIP_ITEM_STYLE, TOOLTIP_LABEL_STYLE } from "../../lib/chart";
import { daysToEnd, isBillingDue, isEndingSoon, mrr, nextPeriod, projectBillings } from "../../../shared/contracts";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useModules } from "../../context/ModulesContext";
import { useT, useTp } from "../../i18n";
import { Bdi, Button, Card, ErrorState, LoadingState, Ltr, Modal, StatCard } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { ContractForm } from "./forms";
import { contractPeriodAmount, revenueTerms, todayIn } from "./labels";
import { CONTRACT_SELECT, type Contract } from "./types";

const PROJECTION_MONTHS = 6;

export default function OverviewPage() {
  const t = useT();
  const tp = useTp();
  const tenant = useTenant();
  const { isManager } = useAuth();
  const { isEnabled } = useModules();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const today = todayIn(tenant.timezone);
  const billingOn = isEnabled("billing");
  const canBill = isManager && billingOn;

  const q = useQuery({
    queryKey: ["contracts", "active"],
    queryFn: () =>
      listRows<Contract>("contracts", (b) =>
        b.select(CONTRACT_SELECT).eq("status", "active").order("end_date", { ascending: true, nullsFirst: false }).limit(2000)),
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["contracts"] });
    void qc.invalidateQueries({ queryKey: ["contract_invoices"] });
    void qc.invalidateQueries({ queryKey: ["invoices"] });
  };
  const fail = (err: unknown) => toast.error(err instanceof Error ? err.message : t("common.error"));
  const billOne = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("contract_bill_period", { p_contract_id: id });
      if (error) throw wrapDbError(error);
    },
    onSuccess: () => { refresh(); toast.success(t("contracts.bill.done")); },
    onError: fail,
  });
  const billAll = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("contracts_bill_due");
      if (error) throw wrapDbError(error);
      return Number(data ?? 0);
    },
    onSuccess: (n) => { refresh(); toast.success(tp("contracts.bill.doneAll", n)); },
    onError: fail,
  });

  const data = useMemo(() => {
    const rows = q.data ?? [];
    const terms = rows.map(revenueTerms);
    return {
      mrr: terms.reduce((s, c) => s + mrr(c), 0),
      due: rows.filter((c) => isBillingDue(revenueTerms(c), today)),
      ending: rows.filter((c) => isEndingSoon(c, today)),
      projection: projectBillings(terms, today.slice(0, 7), PROJECTION_MONTHS),
    };
  }, [q.data, today]);

  if (q.isLoading) return <LoadingState />;
  if (q.error) return <ErrorState message={(q.error as Error).message} />;
  const money = (n: number) => formatMoney(n, tenant.currency);
  const active = q.data?.length ?? 0;
  const hasProjection = data.projection.some((m) => m.amount > 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={<Repeat className="h-5 w-5" />} tone="blue" label={t("contracts.kpi.mrr")} value={money(data.mrr)} sub={t("contracts.kpi.mrrSub")} />
        <StatCard icon={<TrendingUp className="h-5 w-5" />} tone="violet" label={t("contracts.kpi.arr")} value={money(data.mrr * 12)} sub={t("contracts.kpi.arrSub")} />
        <StatCard icon={<FileSignature className="h-5 w-5" />} tone="green" label={t("contracts.kpi.active")} value={String(active)}
          sub={tp("contracts.kpi.dueSub", data.due.length)} />
        <StatCard icon={<CalendarClock className="h-5 w-5" />} tone="amber" label={t("contracts.kpi.ending")} value={String(data.ending.length)}
          sub={t("contracts.kpi.endingSub")} />
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {isManager && (
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> {t("contracts.new")}
          </Button>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-ink">{t("contracts.due.title")}</h2>
              <p className="text-xs text-ink-3">{billingOn ? t("contracts.due.hint") : t("contracts.due.billingOff")}</p>
            </div>
            {canBill && data.due.length > 0 && (
              <Button variant="secondary" className="px-2.5 py-1.5" loading={billAll.isPending} onClick={() => billAll.mutate()}>
                <Receipt className="h-4 w-4" /> {t("contracts.due.billAll")}
              </Button>
            )}
          </div>
          {data.due.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-3">{t("contracts.due.empty")}</p>
          ) : (
            <ul className="divide-y divide-line">
              {data.due.map((c) => {
                const p = nextPeriod(c);
                return (
                  <li key={c.id} className="flex items-center gap-3 py-2.5">
                    <Link to={`/contracts/c/${c.id}`} className="min-w-0 flex-1 hover:underline">
                      <span className="block truncate text-sm text-ink"><Bdi>{c.customer?.name ?? c.title}</Bdi></span>
                      <span className="block truncate text-xs text-ink-3">
                        <Ltr>{c.doc_number}</Ltr>
                        {p ? <> · <Ltr>{`${formatDate(p.start)} – ${formatDate(p.end)}`}</Ltr></> : null}
                      </span>
                    </Link>
                    <Ltr className="whitespace-nowrap text-sm font-medium text-ink">{formatMoney(contractPeriodAmount(c), c.currency)}</Ltr>
                    {canBill && (
                      <Button variant="ghost" className="px-2 py-1" loading={billOne.isPending && billOne.variables === c.id}
                        disabled={billOne.isPending || billAll.isPending} onClick={() => billOne.mutate(c.id)}>
                        {t("contracts.bill.now")}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="text-sm font-semibold text-ink">{t("contracts.ending.title")}</h2>
          <p className="mb-3 text-xs text-ink-3">{t("contracts.ending.hint")}</p>
          {data.ending.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-3">{t("contracts.ending.empty")}</p>
          ) : (
            <ul className="divide-y divide-line">
              {data.ending.map((c) => {
                const d = daysToEnd(c, today) ?? 0;
                return (
                  <li key={c.id} className="flex items-center gap-3 py-2.5">
                    <Link to={`/contracts/c/${c.id}`} className="min-w-0 flex-1 hover:underline">
                      <span className="block truncate text-sm text-ink"><Bdi>{c.customer?.name ?? c.title}</Bdi></span>
                      <span className="block truncate text-xs text-ink-3">
                        <Ltr>{c.doc_number}</Ltr> · {c.auto_renew ? t("contracts.ending.renews") : t("contracts.ending.expires")}
                      </span>
                    </Link>
                    <span className="text-end text-xs">
                      <span className="block text-sm text-ink">{formatDate(c.end_date)}</span>
                      <span className={d <= 7 ? "text-serious" : "text-ink-3"}>{d === 0 ? t("contracts.ending.today") : tp("contracts.ending.inDays", d)}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <Card className="p-4">
        <h2 className="text-sm font-semibold text-ink">{t("contracts.projection.title")}</h2>
        <p className="mb-3 text-xs text-ink-3">{t("contracts.projection.hint")}</p>
        {!hasProjection ? (
          <p className="py-10 text-center text-sm text-ink-3">{t("contracts.projection.empty")}</p>
        ) : (
          <div dir="ltr">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.projection} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
                <XAxis dataKey="month" tick={TICK_STYLE} axisLine={false} tickLine={false} tickFormatter={(m: string) => m.slice(2)} />
                <YAxis tick={TICK_STYLE} axisLine={false} tickLine={false} width={56}
                  tickFormatter={(v: number) => new Intl.NumberFormat("en", { notation: "compact" }).format(v)} />
                <Tooltip cursor={{ fill: CURSOR_FILL }} contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_STYLE}
                  itemStyle={TOOLTIP_ITEM_STYLE} formatter={(v) => money(Number(v ?? 0))} />
                <Bar dataKey="amount" name={t("contracts.projection.amount")} fill="#1d67f1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <Modal title={t("contracts.newTitle")} open={creating} onClose={() => setCreating(false)} wide>
        {creating && (
          <ContractForm
            onCancel={() => setCreating(false)}
            onDone={(id) => { setCreating(false); refresh(); toast.success(t("contracts.saved")); navigate(`/contracts/c/${id}`); }}
          />
        )}
      </Modal>
    </div>
  );
}
