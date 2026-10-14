import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CarFront, Coins, FileWarning, ShieldCheck } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "../../lib/supabase";
import { listRows, wrapDbError } from "../../lib/db";
import { formatDate, formatMoney } from "../../lib/format";
import { ltrText } from "../../lib/bidi";
import { CURSOR_FILL, GRID_STROKE, TICK_STYLE, TOOLTIP_CONTENT_STYLE, TOOLTIP_ITEM_STYLE, TOOLTIP_LABEL_STYLE } from "../../lib/chart";
import {
  OPEN_CLAIM_STATUSES, annualPremium, daysBetween, lossRatio, policyStatus, premiumByYear, type ClaimStatus, type PremiumFrequency,
} from "../../../shared/insurance";
import { useTenant } from "../../context/AuthContext";
import { useT, useTp } from "../../i18n";
import { Badge, Bdi, Card, ErrorState, LoadingState, Ltr, StatCard } from "../../components/ui";
import { addDays, insurerName, policyTone, todayInTz } from "./labels";

const YEARS = 3;
const SOON_DAYS = 60;

interface PolicyRow {
  id: string;
  policy_number: string;
  insurer_name: string | null;
  insurer: { name: string } | null;
  premium: number;
  premium_frequency: PremiumFrequency;
  start_date: string;
  end_date: string;
  canceled_at: string | null;
}
interface ClaimRow {
  status: ClaimStatus;
  amount_claimed: number;
  amount_paid: number | null;
  settled_at: string | null;
}
interface UninsuredRow {
  id: string;
  name: string;
  license_plate: string | null;
  status: string;
}

export default function OverviewPage() {
  const t = useT();
  const tp = useTp();
  const tenant = useTenant();
  const today = todayInTz(tenant.timezone);
  const thisYear = Number(today.slice(0, 4));
  const years = useMemo(() => Array.from({ length: YEARS }, (_, i) => thisYear - YEARS + 1 + i), [thisYear]);
  const windowStart = `${years[0]}-01-01`;

  const polQ = useQuery({
    queryKey: ["insurance_policies", "overview", windowStart],
    queryFn: () =>
      listRows<PolicyRow>("insurance_policies", (q) =>
        q.select("id, policy_number, insurer_name, premium, premium_frequency, start_date, end_date, canceled_at, " +
                 "insurer:suppliers!insurance_policies_insurer_supplier_id_fkey(name)")
          .gte("end_date", windowStart).order("end_date").limit(5000)),
  });
  const claimQ = useQuery({
    queryKey: ["insurance_claims", "overview", windowStart],
    queryFn: () =>
      listRows<ClaimRow>("insurance_claims", (q) =>
        q.select("status, amount_claimed, amount_paid, settled_at")
          .or(`status.in.(${OPEN_CLAIM_STATUSES.join(",")}),settled_at.gte.${windowStart}`).limit(10000)),
  });
  const uninsuredQ = useQuery({
    queryKey: ["insurance_uninsured", today],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("insurance_uninsured_vehicles");
      if (error) throw wrapDbError(error);
      return (data ?? []) as UninsuredRow[];
    },
  });

  const stats = useMemo(() => {
    const pols = polQ.data ?? [];
    const claims = claimQ.data ?? [];
    const inForce = pols.filter((p) => ["active", "expiring"].includes(policyStatus(p, today)));
    const premiums = premiumByYear(pols, years);
    const paid = new Map<number, number>(years.map((y) => [y, 0]));
    for (const c of claims) {
      if (c.status !== "settled" || !c.settled_at) continue;
      const y = Number(c.settled_at.slice(0, 4));
      if (paid.has(y)) paid.set(y, (paid.get(y) ?? 0) + (c.amount_paid ?? 0));
    }
    const open = claims.filter((c) => OPEN_CLAIM_STATUSES.includes(c.status));
    return {
      inForce: inForce.length,
      expiring: inForce.filter((p) => policyStatus(p, today) === "expiring").length,
      annual: inForce.reduce((s, p) => s + annualPremium(p.premium, p.premium_frequency), 0),
      openCount: open.length,
      openAmount: open.reduce((s, c) => s + c.amount_claimed, 0),
      chart: years.map((y) => ({
        year: String(y),
        premium: premiums.get(y) ?? 0,
        claims: Math.round((paid.get(y) ?? 0) * 100) / 100,
        ratio: lossRatio(paid.get(y) ?? 0, premiums.get(y) ?? 0),
      })),
      soon: pols
        .filter((p) => !p.canceled_at && p.end_date >= today && p.end_date <= addDays(today, SOON_DAYS))
        .slice(0, 8),
    };
  }, [polQ.data, claimQ.data, today, years]);

  if (polQ.isLoading || claimQ.isLoading) return <LoadingState />;
  const err = polQ.error ?? claimQ.error;
  if (err) return <ErrorState message={(err as Error).message} />;
  const uninsured = uninsuredQ.data ?? [];
  const hasChart = stats.chart.some((r) => r.premium || r.claims);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<ShieldCheck className="h-5 w-5" />}
          tone="green"
          label={t("insurance.kpi.inForce")}
          value={stats.inForce}
          sub={stats.expiring > 0 ? tp("insurance.kpi.inForceSub", stats.expiring) : undefined}
          subTone="serious"
        />
        <StatCard
          icon={<Coins className="h-5 w-5" />}
          tone="amber"
          label={t("insurance.kpi.annualPremium")}
          value={formatMoney(stats.annual, tenant.currency)}
          sub={t("insurance.kpi.annualPremiumSub")}
        />
        <StatCard
          icon={<FileWarning className="h-5 w-5" />}
          tone="violet"
          label={t("insurance.kpi.openClaims")}
          value={stats.openCount}
          sub={stats.openCount > 0 ? t("insurance.kpi.openClaimsSub", { amount: ltrText(formatMoney(stats.openAmount, tenant.currency)) }) : undefined}
        />
        <StatCard
          icon={<CarFront className="h-5 w-5" />}
          tone={uninsured.length > 0 ? "red" : "slate"}
          label={t("insurance.kpi.uninsured")}
          value={uninsuredQ.isLoading ? "…" : uninsured.length}
          sub={t("insurance.kpi.uninsuredSub")}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <h2 className="text-sm font-semibold text-ink">{t("insurance.chartTitle")}</h2>
          <p className="mb-3 text-xs text-ink-3">{t("insurance.chartHint")}</p>
          {!hasChart ? (
            <p className="py-10 text-center text-sm text-ink-3">{t("insurance.chartEmpty")}</p>
          ) : (
            <>
              <div dir="ltr">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={stats.chart} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
                    <XAxis dataKey="year" tick={TICK_STYLE} axisLine={false} tickLine={false} />
                    <YAxis tick={TICK_STYLE} axisLine={false} tickLine={false} width={64} />
                    <Tooltip cursor={{ fill: CURSOR_FILL }} contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_STYLE}
                      itemStyle={TOOLTIP_ITEM_STYLE} formatter={(v) => formatMoney(Number(v), tenant.currency)} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="premium" name={t("insurance.chartPremium")} fill="#1d67f1" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="claims" name={t("insurance.chartClaims")} fill="#0d9488" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div dir="ltr" className="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-3">
                {stats.chart.map((r) => (
                  <div key={r.year} className="text-center">
                    <Ltr className="block text-xs text-ink-3">{r.year}</Ltr>
                    <Ltr className="block text-sm font-semibold text-ink">{r.ratio == null ? "—" : `${r.ratio}%`}</Ltr>
                  </div>
                ))}
              </div>
              <p className="mt-1 text-center text-xs text-ink-3">{t("insurance.lossRatioHint")}</p>
            </>
          )}
        </Card>
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-ink">{t("insurance.soonTitle")}</h2>
          {stats.soon.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-3">{t("insurance.soonEmpty")}</p>
          ) : (
            <ul className="divide-y divide-line">
              {stats.soon.map((p) => {
                const st = policyStatus(p, today);
                return (
                  <li key={p.id}>
                    <Link to={`/insurance/policies/${p.id}`} className="flex items-center gap-3 py-2 hover:bg-canvas">
                      <div className="min-w-0 flex-1">
                        <Ltr className="text-sm font-medium text-brand-700">{p.policy_number}</Ltr>
                        <div className="truncate text-xs text-ink-3"><Bdi>{insurerName(p)}</Bdi></div>
                      </div>
                      <div className="shrink-0 text-end">
                        <Badge tone={policyTone[st]}>{p.end_date === today ? t("insurance.endsToday") : tp("insurance.daysLeftShort", daysBetween(today, p.end_date))}</Badge>
                        <div className="text-xs text-ink-3">{formatDate(p.end_date)}</div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <Card className="p-4">
        <h2 className="text-sm font-semibold text-ink">{t("insurance.uninsuredTitle")}</h2>
        <p className="mb-3 text-xs text-ink-3">{t("insurance.uninsuredHint")}</p>
        {uninsuredQ.isLoading ? <LoadingState /> : uninsuredQ.error ? (
          <ErrorState message={(uninsuredQ.error as Error).message} />
        ) : uninsured.length === 0 ? (
          <p className="py-4 text-center text-sm text-good">{t("insurance.uninsuredEmpty")}</p>
        ) : (
          <ul className="grid gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
            {uninsured.slice(0, 30).map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-3 border-b border-line py-2">
                <Link to={`/vehicles/${v.id}`} className="min-w-0 truncate text-sm text-ink hover:underline"><Bdi>{v.name}</Bdi></Link>
                {v.license_plate && <Ltr className="shrink-0 text-xs text-ink-3">{v.license_plate}</Ltr>}
              </li>
            ))}
          </ul>
        )}
        {uninsured.length > 30 && <p className="mt-2 text-xs text-ink-3">{tp("insurance.uninsuredMore", uninsured.length - 30)}</p>}
      </Card>
    </div>
  );
}
