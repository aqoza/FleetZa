import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Clock, Coins, TrendingUp, Truck } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { listRows } from "../../lib/db";
import { formatMoney } from "../../lib/format";
import { ltrText } from "../../lib/bidi";
import { CURSOR_FILL, GRID_STROKE, TICK_STYLE, TOOLTIP_CONTENT_STYLE, TOOLTIP_ITEM_STYLE, TOOLTIP_LABEL_STYLE } from "../../lib/chart";
import { ACTIVE_SHIPMENT_STATUSES, marginStats, onTimePct, weeklyRevenue, type ShipmentStatsRow } from "../../../shared/tms";
import { useTenant } from "../../context/AuthContext";
import { useT, useTp } from "../../i18n";
import { Badge, Bdi, Card, ErrorState, LoadingState, Ltr, StatCard } from "../../components/ui";
import { shipmentTone } from "./labels";
import { Lane } from "./ShipmentsPage";
import type { Shipment } from "./types";

const DAY = 86_400_000;
const WEEKS = 8;

type StatRow = ShipmentStatsRow & { created_at: string };
type OpenRow = Pick<Shipment, "id" | "doc_number" | "status" | "origin_city" | "destination_city" | "pickup_window_start" | "updated_at"> & {
  customer: { name: string } | null;
};

export default function OverviewPage() {
  const t = useT();
  const tp = useTp();
  const tenant = useTenant();
  const since30 = new Date(Date.now() - 30 * DAY).toISOString();
  const sinceChart = new Date(Date.now() - WEEKS * 7 * DAY).toISOString();

  const openQ = useQuery({
    queryKey: ["shipments", "overview-open"],
    queryFn: () =>
      listRows<OpenRow>("shipments", (q) =>
        q.select("id, doc_number, status, origin_city, destination_city, pickup_window_start, updated_at, " +
                 "customer:customers!shipments_customer_id_fkey(name)")
          .in("status", ACTIVE_SHIPMENT_STATUSES).order("updated_at", { ascending: false }).limit(2000)),
  });
  const statsQ = useQuery({
    queryKey: ["shipments", "overview-stats"],
    queryFn: () =>
      listRows<StatRow>("shipments", (q) =>
        q.select("status, total_charge, carrier_cost, delivered_at, delivery_window_end, created_at")
          .not("status", "in", "(draft,canceled)")
          .or(`delivered_at.gte.${sinceChart},and(delivered_at.is.null,created_at.gte.${sinceChart})`).limit(5000)),
  });

  const kpi = useMemo(() => {
    const open = openQ.data ?? [];
    const rows = statsQ.data ?? [];
    const last30 = rows.filter((r) => (r.delivered_at ?? r.created_at) >= since30);
    const delivered30 = last30.filter((r) => r.delivered_at);
    return {
      onRoad: open.filter((r) => r.status === "dispatched" || r.status === "in_transit" || r.status === "exception").length,
      exceptions: open.filter((r) => r.status === "exception").length,
      onTime: onTimePct(delivered30),
      judged: delivered30.filter((r) => r.delivery_window_end).length,
      money: marginStats(last30),
    };
  }, [openQ.data, statsQ.data, since30]);

  const chart = useMemo(
    () => weeklyRevenue(statsQ.data ?? [], WEEKS).map((w) => ({ ...w, label: w.week.slice(5).replace("-", "/") })),
    [statsQ.data],
  );
  const hasChart = chart.some((w) => w.revenue || w.cost);
  const attention = (openQ.data ?? []).filter((r) => r.status === "exception" || r.status === "booked").slice(0, 8);

  if (openQ.isLoading || statsQ.isLoading) return <LoadingState />;
  const err = openQ.error ?? statsQ.error;
  if (err) return <ErrorState message={(err as Error).message} />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<Truck className="h-5 w-5 rtl:-scale-x-100" />}
          label={t("tms.kpi.inTransit")}
          value={kpi.onRoad}
          sub={kpi.exceptions > 0 ? tp("tms.kpi.inTransitSub", kpi.exceptions) : undefined}
          subTone="serious"
        />
        <StatCard
          icon={<Clock className="h-5 w-5" />}
          tone="green"
          label={t("tms.kpi.onTime")}
          value={kpi.onTime == null ? "—" : <Ltr>{`${kpi.onTime}%`}</Ltr>}
          sub={kpi.judged > 0 ? tp("tms.kpi.onTimeSub", kpi.judged) : t("tms.kpi.noData")}
        />
        <StatCard
          icon={<Coins className="h-5 w-5" />}
          tone="amber"
          label={t("tms.kpi.revenue")}
          value={formatMoney(kpi.money.revenue, tenant.currency)}
          sub={kpi.money.count > 0 ? tp("tms.kpi.revenueSub", kpi.money.count) : t("tms.kpi.noData")}
        />
        <StatCard
          icon={<TrendingUp className="h-5 w-5 rtl:-scale-x-100" />}
          tone={kpi.money.margin < 0 ? "red" : "green"}
          label={t("tms.kpi.margin")}
          value={<Ltr>{formatMoney(kpi.money.margin, tenant.currency)}</Ltr>}
          sub={kpi.money.marginPct != null ? t("tms.kpi.marginSub", { pct: ltrText(`${kpi.money.marginPct}%`) }) : undefined}
          subTone={kpi.money.margin < 0 ? "serious" : "muted"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold text-ink">{t("tms.chartTitle")}</h2>
          {!hasChart ? (
            <p className="py-10 text-center text-sm text-ink-3">{t("tms.chartEmpty")}</p>
          ) : (
            <div dir="ltr">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={chart} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
                  <XAxis dataKey="label" tick={TICK_STYLE} axisLine={false} tickLine={false} />
                  <YAxis tick={TICK_STYLE} axisLine={false} tickLine={false} width={56} />
                  <Tooltip cursor={{ fill: CURSOR_FILL }} contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_STYLE}
                    itemStyle={TOOLTIP_ITEM_STYLE} formatter={(v) => formatMoney(Number(v), tenant.currency)} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="revenue" name={t("tms.chartRevenue")} fill="#1d67f1" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="cost" name={t("tms.chartCost")} fill="#0d9488" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-ink">{t("tms.attention")}</h2>
          {attention.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-3">{t("tms.attentionEmpty")}</p>
          ) : (
            <ul className="divide-y divide-line">
              {attention.map((s) => (
                <li key={s.id}>
                  <Link to={`/tms/s/${s.id}`} className="flex items-center gap-3 py-2 hover:bg-canvas">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Ltr className="text-sm font-medium text-brand-700">{s.doc_number}</Ltr>
                        <Badge tone={shipmentTone[s.status]}>
                          {s.status === "booked" ? t("tms.awaitingDispatch") : t(`tms.status.${s.status}`)}
                        </Badge>
                      </div>
                      <div className="truncate text-xs text-ink-3">
                        <Bdi>{s.customer?.name}</Bdi> · <Lane s={s} />
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
