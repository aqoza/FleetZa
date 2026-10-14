import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, Coins, HeartPulse } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { listRows } from "../../lib/db";
import { formatDateTime, formatMoney } from "../../lib/format";
import { CURSOR_FILL, GRID_STROKE, TICK_STYLE, TOOLTIP_CONTENT_STYLE, TOOLTIP_ITEM_STYLE, TOOLTIP_LABEL_STYLE } from "../../lib/chart";
import {
  OPEN_STATUSES, byType, incidentCost, isSerious, lastMonths, monthlyStats, type DriverRow, type IncidentStatus,
} from "../../../shared/incidents";
import { useTenant } from "../../context/AuthContext";
import { useT, useTp } from "../../i18n";
import { Badge, Bdi, Card, ErrorState, LoadingState, Ltr, StatCard } from "../../components/ui";
import { severityTone, statusTone } from "./labels";

const MONTHS = 12;

interface Row extends DriverRow {
  id: string;
  doc_number: string | null;
  status: IncidentStatus;
  description: string;
  vehicle: { name: string } | null;
}

function todayIn(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export default function OverviewPage() {
  const t = useT();
  const tp = useTp();
  const tenant = useTenant();
  const months = useMemo(() => lastMonths(todayIn(tenant.timezone), MONTHS), [tenant.timezone]);
  // A day of slack either side of the window; monthlyStats buckets in the tenant's zone.
  const since = new Date(Date.UTC(Number(months[0].slice(0, 4)), Number(months[0].slice(5, 7)) - 1, 0)).toISOString();

  const q = useQuery({
    queryKey: ["incidents", "overview", since],
    queryFn: () =>
      listRows<Row>("incidents", (b) =>
        b.select("id, doc_number, status, description, occurred_at, incident_type, severity, injuries, actual_cost, " +
                 "estimated_damage, driver_id, at_fault, vehicle:vehicles!incidents_vehicle_id_fkey(name)")
          .or(`occurred_at.gte.${since},status.in.(${OPEN_STATUSES.join(",")})`)
          .order("occurred_at", { ascending: false }).limit(10000)),
  });

  const stats = useMemo(() => {
    const all = q.data ?? [];
    const inWindow = all.filter((r) => r.occurred_at >= since);
    const open = all.filter((r) => OPEN_STATUSES.includes(r.status));
    const monthly = monthlyStats(inWindow, months, tenant.timezone);
    return {
      open: open.length,
      openSerious: open.filter((r) => isSerious(r.severity)).length,
      injuries: inWindow.reduce((s, r) => s + r.injuries, 0),
      cost: inWindow.reduce((s, r) => s + incidentCost(r), 0),
      count: inWindow.length,
      monthly,
      types: byType(inWindow),
      attention: open.filter((r) => isSerious(r.severity)).slice(0, 6),
    };
  }, [q.data, since, months, tenant.timezone]);

  if (q.isLoading) return <LoadingState />;
  if (q.error) return <ErrorState message={(q.error as Error).message} />;
  const maxType = Math.max(1, ...stats.types.map((x) => x.count));
  const chart = stats.monthly.map((m) => ({ ...m, other: m.count - m.serious }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={<Activity className="h-5 w-5" />} tone="blue" label={t("incidents.kpi.open")} value={stats.open}
          sub={tp("incidents.kpi.openSub", stats.count)} />
        <StatCard icon={<AlertTriangle className="h-5 w-5" />} tone={stats.openSerious > 0 ? "red" : "slate"}
          label={t("incidents.kpi.serious")} value={stats.openSerious} sub={t("incidents.kpi.seriousSub")}
          subTone={stats.openSerious > 0 ? "serious" : undefined} />
        <StatCard icon={<HeartPulse className="h-5 w-5" />} tone="violet" label={t("incidents.kpi.injuries")} value={stats.injuries}
          sub={t("incidents.kpi.windowSub")} />
        <StatCard icon={<Coins className="h-5 w-5" />} tone="amber" label={t("incidents.kpi.cost")} value={formatMoney(stats.cost, tenant.currency)}
          sub={t("incidents.kpi.costSub")} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <h2 className="text-sm font-semibold text-ink">{t("incidents.chartTitle")}</h2>
          <p className="mb-3 text-xs text-ink-3">{t("incidents.chartHint")}</p>
          {stats.count === 0 ? (
            <p className="py-10 text-center text-sm text-ink-3">{t("incidents.chartEmpty")}</p>
          ) : (
            <div dir="ltr">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chart} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
                  <XAxis dataKey="month" tick={TICK_STYLE} axisLine={false} tickLine={false} tickFormatter={(m: string) => m.slice(2)} />
                  <YAxis tick={TICK_STYLE} axisLine={false} tickLine={false} width={32} allowDecimals={false} />
                  <Tooltip cursor={{ fill: CURSOR_FILL }} contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} itemStyle={TOOLTIP_ITEM_STYLE} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="other" stackId="a" name={t("incidents.chartOther")} fill="#1d67f1" />
                  <Bar dataKey="serious" stackId="a" name={t("incidents.chartSerious")} fill="#0d9488" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-ink">{t("incidents.byTypeTitle")}</h2>
          {stats.types.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-3">{t("incidents.chartEmpty")}</p>
          ) : (
            <ul className="space-y-3">
              {stats.types.map((x) => (
                <li key={x.type}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="text-ink">{t(`incidents.type.${x.type}`)}</span>
                    <Ltr className="text-xs text-ink-3">{`${x.count} · ${formatMoney(x.cost, tenant.currency)}`}</Ltr>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-canvas">
                    <div className="h-1.5 rounded-full bg-chart-1" style={{ width: `${(x.count / maxType) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="p-4">
        <h2 className="text-sm font-semibold text-ink">{t("incidents.attentionTitle")}</h2>
        <p className="mb-3 text-xs text-ink-3">{t("incidents.attentionHint")}</p>
        {stats.attention.length === 0 ? (
          <p className="py-4 text-center text-sm text-good">{t("incidents.attentionEmpty")}</p>
        ) : (
          <ul className="divide-y divide-line">
            {stats.attention.map((r) => (
              <li key={r.id}>
                <Link to={`/incidents/i/${r.id}`} className="flex items-center gap-3 py-2 hover:bg-canvas">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Ltr className="text-sm font-medium text-brand-700">{r.doc_number}</Ltr>
                      <Badge tone={severityTone[r.severity]}>{t(`incidents.severity.${r.severity}`)}</Badge>
                    </div>
                    <div className="truncate text-xs text-ink-3">
                      <Bdi>{r.vehicle?.name}</Bdi> · <Bdi>{r.description}</Bdi>
                    </div>
                  </div>
                  <div className="shrink-0 text-end">
                    <Badge tone={statusTone[r.status]}>{t(`incidents.status.${r.status}`)}</Badge>
                    <div className="text-xs text-ink-3">{formatDateTime(r.occurred_at, tenant.timezone)}</div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
