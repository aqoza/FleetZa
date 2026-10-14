import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Banknote, PackageCheck, Truck, Warehouse } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { listRows } from "../../lib/db";
import { formatMoney } from "../../lib/format";
import { ltrText } from "../../lib/bidi";
import { CURSOR_FILL, GRID_STROKE, TICK_STYLE, TOOLTIP_CONTENT_STYLE, TOOLTIP_ITEM_STYLE, TOOLTIP_LABEL_STYLE } from "../../lib/chart";
import { deliveryKpis, OPEN_DELIVERY_STATUSES } from "../../../shared/deliveries";
import { useTenant } from "../../context/AuthContext";
import { useT, useTp } from "../../i18n";
import { Badge, Bdi, Card, ErrorState, LoadingState, Ltr, StatCard } from "../../components/ui";
import { stopCounts } from "./RoutesPage";
import { driverName, routeTone, todayInTz } from "./labels";
import { ROUTE_SELECT, type DeliveryRoute } from "./types";

const DAY = 86_400_000;

interface KpiRow {
  status: "pending" | "assigned" | "out_for_delivery" | "delivered" | "failed" | "returned";
  attempts: number;
  cod_amount: number;
  cod_collected: number | null;
  delivered_at: string | null;
  failed_at: string | null;
  returned_at: string | null;
}

function dayKey(iso: string, tz: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

export default function OverviewPage() {
  const t = useT();
  const tp = useTp();
  const tenant = useTenant();
  const tz = tenant.timezone;
  const today = todayInTz(tz);
  const since = new Date(Date.now() - 30 * DAY).toISOString();

  const openQ = useQuery({
    queryKey: ["deliveries", "overview-open"],
    queryFn: () =>
      listRows<KpiRow>("deliveries", (q) =>
        q.select("status, attempts, cod_amount, cod_collected, delivered_at, failed_at, returned_at").in("status", OPEN_DELIVERY_STATUSES).limit(5000),
      ),
  });
  const recentQ = useQuery({
    queryKey: ["deliveries", "overview-recent"],
    queryFn: () =>
      listRows<KpiRow>("deliveries", (q) =>
        q.select("status, attempts, cod_amount, cod_collected, delivered_at, failed_at, returned_at")
          .or(`delivered_at.gte.${since},returned_at.gte.${since},failed_at.gte.${since}`).limit(5000),
      ),
  });
  const routesQ = useQuery({
    queryKey: ["delivery_routes", "today", today],
    queryFn: () => listRows<DeliveryRoute>("delivery_routes", (q) => q.select(ROUTE_SELECT).eq("route_date", today).neq("status", "canceled").order("number").limit(50)),
  });

  const kpi = useMemo(() => {
    const open = openQ.data ?? [];
    const recent = recentQ.data ?? [];
    const finished = deliveryKpis(recent.filter((r) => r.status === "delivered" || r.status === "returned"));
    const outstanding = deliveryKpis(open);
    return {
      waiting: open.filter((r) => r.status === "pending").length,
      planned: open.filter((r) => r.status === "assigned").length,
      out: open.filter((r) => r.status === "out_for_delivery").length,
      finished,
      codOutstanding: outstanding.codOutstanding,
    };
  }, [openQ.data, recentQ.data]);

  const chart = useMemo(() => {
    const days: Array<{ day: string; label: string; delivered: number; failed: number }> = [];
    for (let i = 13; i >= 0; i--) {
      const iso = new Date(Date.now() - i * DAY).toISOString();
      days.push({ day: dayKey(iso, tz), label: dayKey(iso, tz).slice(5).replace("-", "/"), delivered: 0, failed: 0 });
    }
    const idx = new Map(days.map((d, i) => [d.day, i]));
    for (const r of recentQ.data ?? []) {
      if (r.delivered_at) {
        const i = idx.get(dayKey(r.delivered_at, tz));
        if (i != null) days[i].delivered++;
      }
      // A failed delivery keeps its last failure time until it is retried.
      if (r.failed_at && (r.status === "failed" || r.status === "returned" || r.status === "pending")) {
        const i = idx.get(dayKey(r.failed_at, tz));
        if (i != null) days[i].failed++;
      }
    }
    return days;
  }, [recentQ.data, tz]);
  const hasChart = chart.some((d) => d.delivered || d.failed);
  const activeRoutes = (routesQ.data ?? []).filter((r) => r.status === "out_for_delivery").length;

  if (openQ.isLoading || recentQ.isLoading) return <LoadingState />;
  const err = openQ.error ?? recentQ.error;
  if (err) return <ErrorState message={(err as Error).message} />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<Warehouse className="h-5 w-5" />}
          label={t("deliveries.kpi.waiting")}
          value={kpi.waiting}
          sub={kpi.planned > 0 ? tp("deliveries.kpi.waitingSub", kpi.planned) : undefined}
        />
        <StatCard
          icon={<Truck className="h-5 w-5" />}
          tone="amber"
          label={t("deliveries.kpi.out")}
          value={kpi.out}
          sub={activeRoutes > 0 ? tp("deliveries.kpi.outSub", activeRoutes) : undefined}
        />
        <StatCard
          icon={<PackageCheck className="h-5 w-5" />}
          tone="green"
          label={t("deliveries.kpi.firstAttempt")}
          value={kpi.finished.firstAttemptPct == null ? "—" : <Ltr>{`${kpi.finished.firstAttemptPct}%`}</Ltr>}
          sub={kpi.finished.finished ? tp("deliveries.kpi.firstAttemptSub", kpi.finished.finished) : t("deliveries.kpi.noData")}
        />
        <StatCard
          icon={<Banknote className="h-5 w-5" />}
          tone="red"
          label={t("deliveries.kpi.cod")}
          value={formatMoney(kpi.codOutstanding, tenant.currency)}
          sub={kpi.finished.codShortCount > 0
            ? tp("deliveries.kpi.codShort", kpi.finished.codShortCount, { amount: ltrText(formatMoney(kpi.finished.codShortfall, tenant.currency)) })
            : undefined}
          subTone="serious"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold text-ink">{t("deliveries.chartTitle")}</h2>
          {!hasChart ? (
            <p className="py-10 text-center text-sm text-ink-3">{t("deliveries.chartEmpty")}</p>
          ) : (
            <div dir="ltr">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={chart} margin={{ top: 5, right: 10, bottom: 5, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
                  <XAxis dataKey="label" tick={TICK_STYLE} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={TICK_STYLE} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: CURSOR_FILL }} contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} itemStyle={TOOLTIP_ITEM_STYLE} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="delivered" name={t("deliveries.chartDelivered")} stackId="a" fill="#1d67f1" />
                  <Bar dataKey="failed" name={t("deliveries.chartFailed")} stackId="a" fill="#0d9488" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-ink">{t("deliveries.todayRoutes")}</h2>
          {routesQ.isLoading ? (
            <LoadingState />
          ) : (routesQ.data ?? []).length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-3">{t("deliveries.todayRoutesEmpty")}</p>
          ) : (
            <ul className="divide-y divide-line">
              {(routesQ.data ?? []).map((r) => {
                const c = stopCounts(r);
                return (
                  <li key={r.id}>
                    <Link to={`/deliveries/routes/${r.id}`} className="flex items-center gap-3 py-2 hover:bg-canvas">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Ltr className="text-sm font-medium text-brand-700">{r.doc_number}</Ltr>
                          <Badge tone={routeTone[r.status]}>{t(`deliveries.route.${r.status}`)}</Badge>
                        </div>
                        <div className="truncate text-xs text-ink-3">
                          <Bdi>{r.vehicle?.name}</Bdi>
                          {r.driver && <> · <Bdi>{driverName(r.driver)}</Bdi></>}
                        </div>
                      </div>
                      <span className="shrink-0 text-xs text-ink-2">{t("deliveries.stopsDone", { done: c.done, total: c.total })}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
