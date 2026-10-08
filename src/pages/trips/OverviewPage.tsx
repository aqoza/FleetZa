import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Gauge, Route, Truck } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  GRID_STROKE, TICK_STYLE, TOOLTIP_CONTENT_STYLE, TOOLTIP_ITEM_STYLE, TOOLTIP_LABEL_STYLE,
} from "../../lib/chart";
import { listRows } from "../../lib/db";
import { formatDateTime, formatDistance, kmToDisplay } from "../../lib/format";
import { addDays, weekDates } from "../../../shared/trips";
import { getCountry } from "../../../shared/countries";
import { useTenant } from "../../context/AuthContext";
import { useI18n, useT, useTp } from "../../i18n";
import { Badge, Bdi, Card, ErrorState, LoadingState, Ltr, StatCard } from "../../components/ui";
import { dayInTz, SERIES_ACTUAL, SERIES_PLANNED, statusTone } from "./labels";
import { normalizeTrip, TRIP_SELECT, type Trip } from "./types";

const DAY = 86_400_000;

export default function OverviewPage() {
  const t = useT();
  const tp = useTp();
  const { language } = useI18n();
  const tenant = useTenant();
  const tz = tenant.timezone;
  const unit = tenant.distance_unit;
  const locale = language === "ar" ? "ar-u-nu-latn" : getCountry(tenant.country).locale;
  const today = dayInTz(Date.now(), tz);

  const activeQ = useQuery({
    queryKey: ["trips", "overview", "active"],
    queryFn: async () =>
      (
        await listRows<Trip>("trips", (q) =>
          q.select(TRIP_SELECT).in("status", ["planned", "dispatched", "in_progress"])
            .lt("planned_start", new Date(Date.now() + 8 * DAY).toISOString()).order("planned_start").limit(500),
        )
      ).map(normalizeTrip),
  });
  const doneQ = useQuery({
    queryKey: ["trips", "overview", "completed"],
    queryFn: async () =>
      (
        await listRows<Pick<Trip, "id" | "planned_start" | "completed_at" | "planned_distance_km" | "actual_distance_km">>("trips", (q) =>
          q.select("id, planned_start, completed_at, planned_distance_km, actual_distance_km").eq("status", "completed")
            .gte("completed_at", new Date(Date.now() - 56 * DAY).toISOString()).limit(2000),
        )
      ).map((r) => ({
        ...r,
        planned_distance_km: r.planned_distance_km == null ? null : Number(r.planned_distance_km),
        actual_distance_km: r.actual_distance_km == null ? null : Number(r.actual_distance_km),
      })),
  });

  const kpi = useMemo(() => {
    const active = activeQ.data ?? [];
    const done = doneQ.data ?? [];
    const in7 = addDays(today, 7);
    const upcoming = active.filter((r) => r.status !== "in_progress" && dayInTz(r.planned_start, tz) <= in7);
    const since30 = Date.now() - 30 * DAY;
    const done30 = done.filter((r) => r.completed_at && Date.parse(r.completed_at) >= since30);
    return {
      today:
        active.filter((r) => dayInTz(r.planned_start, tz) === today).length +
        done.filter((r) => dayInTz(r.planned_start, tz) === today).length,
      running: active.filter((r) => r.status === "in_progress").length,
      upcoming: upcoming.length,
      unassigned: upcoming.filter((r) => !r.driver_id).length,
      km30: done30.reduce((s, r) => s + (r.actual_distance_km ?? 0), 0),
      done30: done30.length,
    };
  }, [activeQ.data, doneQ.data, today, tz]);

  const weeks = useMemo(() => {
    const starts = Array.from({ length: 8 }, (_, i) => weekDates(addDays(today, -7 * (7 - i)), 0)[0]);
    const rows = starts.map((s) => ({
      start: s,
      label: new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${s}T00:00:00Z`)),
      planned: 0,
      actual: 0,
    }));
    for (const r of doneQ.data ?? []) {
      if (!r.completed_at) continue;
      const d = dayInTz(r.completed_at, tz);
      const w = [...rows].reverse().find((x) => x.start <= d);
      if (!w) continue;
      w.planned += r.planned_distance_km ?? 0;
      w.actual += r.actual_distance_km ?? 0;
    }
    return rows.map((r) => ({ ...r, planned: Math.round(kmToDisplay(r.planned, unit)), actual: Math.round(kmToDisplay(r.actual, unit)) }));
  }, [doneQ.data, today, tz, unit, locale]);
  const hasChart = weeks.some((w) => w.actual > 0 || w.planned > 0);

  if (activeQ.isLoading || doneQ.isLoading) return <LoadingState />;
  const err = activeQ.error ?? doneQ.error;
  if (err) return <ErrorState message={(err as Error).message} />;

  const next = (activeQ.data ?? []).filter((r) => r.status !== "in_progress").slice(0, 6);
  const running = (activeQ.data ?? []).filter((r) => r.status === "in_progress");

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={<CalendarDays className="h-5 w-5" />} label={t("trips.kpi.today")} value={kpi.today} />
        <StatCard icon={<Truck className="h-5 w-5" />} tone="amber" label={t("trips.kpi.running")} value={kpi.running} />
        <StatCard
          icon={<Route className="h-5 w-5" />}
          label={t("trips.kpi.upcoming")}
          value={kpi.upcoming}
          sub={kpi.unassigned > 0 ? tp("trips.kpi.unassigned", kpi.unassigned) : undefined}
          subTone="serious"
        />
        <StatCard
          icon={<Gauge className="h-5 w-5" />}
          tone="green"
          label={t("trips.kpi.distance")}
          value={<span dir="ltr">{formatDistance(kpi.km30, unit)}</span>}
          sub={tp("trips.kpi.trips", kpi.done30)}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="p-4 lg:col-span-3">
          <h2 className="mb-3 text-sm font-semibold text-ink">{t("trips.chartTitle")}</h2>
          {hasChart ? (
            <div dir="ltr" className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weeks} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                  <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={TICK_STYLE} axisLine={false} tickLine={false} />
                  <YAxis tick={TICK_STYLE} axisLine={false} tickLine={false} width={56} />
                  <Tooltip
                    contentStyle={TOOLTIP_CONTENT_STYLE}
                    itemStyle={TOOLTIP_ITEM_STYLE}
                    labelStyle={TOOLTIP_LABEL_STYLE}
                    formatter={(v) => `${Number(v).toLocaleString()} ${unit}`}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="planned" name={t("trips.series.planned")} fill={SERIES_PLANNED} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="actual" name={t("trips.series.actual")} fill={SERIES_ACTUAL} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="py-10 text-center text-sm text-ink-3">{t("trips.chartEmpty")}</p>
          )}
        </Card>
        <Card className="p-4 lg:col-span-2">
          <h2 className="mb-2 text-sm font-semibold text-ink">{t("trips.upNext")}</h2>
          {running.length + next.length === 0 ? (
            <p className="text-sm text-ink-3">{t("trips.weekEmpty")}</p>
          ) : (
            <ul className="divide-y divide-line">
              {[...running, ...next].map((r) => (
                <li key={r.id}>
                  <Link to={`/trips/${r.id}`} className="flex items-center gap-3 py-2 transition-colors hover:text-brand-700">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Ltr className="text-sm font-medium text-ink">{r.doc_number}</Ltr>
                        <Bdi className="truncate text-sm text-ink-2">{r.vehicle?.name ?? ""}</Bdi>
                      </div>
                      <div className="truncate text-xs text-ink-3">
                        {formatDateTime(r.planned_start, tz)} · <Bdi>{r.purpose}</Bdi>
                      </div>
                    </div>
                    <Badge tone={statusTone[r.status]}>{t(`trips.status.${r.status}`)}</Badge>
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
