import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Activity, Gauge, Route as RouteIcon } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  CURSOR_FILL, GRID_STROKE, TICK_STYLE, TOOLTIP_CONTENT_STYLE, TOOLTIP_ITEM_STYLE, TOOLTIP_LABEL_STYLE,
} from "../../lib/chart";
import { getRow, listRows } from "../../lib/db";
import { formatDistance } from "../../lib/format";
import type { Driver } from "../../lib/types";
import { DRIVING_EVENT_TYPES, eventPenalty, type DrivingEventType, type Severity } from "../../../shared/driverScore";
import { useTenant } from "../../context/AuthContext";
import { useT } from "../../i18n";
import { Badge, Bdi, Card, ErrorState, LoadingState, StatCard } from "../../components/ui";
import { gradeTone, lastDays, personName, SERIES_1 } from "./labels";
import { useScores } from "./hooks";
import { EventsTable } from "./EventsPage";
import { CoachingList } from "./CoachingPage";

export default function DriverPage() {
  const { id = "" } = useParams();
  const t = useT();
  const tenant = useTenant();
  const driverQ = useQuery({ queryKey: ["drivers", id], queryFn: () => getRow<Driver>("drivers", id) });
  const scoresQ = useScores(30);
  const score = scoresQ.data?.find((r) => r.driver_id === id);

  const recentQ = useQuery({
    queryKey: ["driving_events", "by-type", id],
    queryFn: () =>
      listRows<{ event_type: DrivingEventType; severity: Severity }>("driving_events", (q) =>
        q.select("event_type, severity").eq("driver_id", id).gte("occurred_at", lastDays(90)[0]).limit(5000),
      ),
  });
  const byType = useMemo(() => {
    const points = new Map<DrivingEventType, number>();
    for (const e of recentQ.data ?? []) points.set(e.event_type, (points.get(e.event_type) ?? 0) + eventPenalty(e.event_type, e.severity));
    return DRIVING_EVENT_TYPES.filter((ty) => points.has(ty))
      .map((ty) => ({ name: t(`driverBehavior.type.${ty}`), points: points.get(ty)! }))
      .sort((a, b) => b.points - a.points);
  }, [recentQ.data, t]);

  if (driverQ.isLoading) return <LoadingState />;
  if (driverQ.error) return <ErrorState message={(driverQ.error as Error).message} />;
  if (!driverQ.data) return <ErrorState message={t("driverBehavior.notFound")} />;
  const driver = driverQ.data;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/driver-behavior" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
          <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" /> {t("driverBehavior.back")}
        </Link>
        <h2 className="text-lg font-semibold text-ink">
          <Bdi>{personName(driver)}</Bdi>
        </h2>
        {score && <Badge tone={gradeTone[score.grade]}>{score.grade}</Badge>}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          icon={<Gauge className="h-5 w-5" />}
          label={t("driverBehavior.detail.score")}
          value={score ? score.score.toFixed(1) : "—"}
          sub={score ? undefined : t("driverBehavior.detail.noScore")}
        />
        <StatCard
          icon={<RouteIcon className="h-5 w-5" />}
          tone="green"
          label={t("driverBehavior.detail.distance")}
          value={<span dir="ltr">{formatDistance(score?.distance_km ?? 0, tenant.distance_unit)}</span>}
        />
        <StatCard
          icon={<Activity className="h-5 w-5" />}
          tone="violet"
          label={t("driverBehavior.kpi.events")}
          value={score?.events ?? 0}
          sub={score && score.high_events > 0 ? `${t("driverBehavior.kpi.highEvents")}: ${score.high_events}` : undefined}
          subTone="serious"
        />
      </div>

      <Card className="p-4">
        <h3 className="mb-3 text-sm font-semibold text-ink">{t("driverBehavior.detail.byType")}</h3>
        {recentQ.error && <ErrorState message={(recentQ.error as Error).message} />}
        {recentQ.data && byType.length === 0 && <p className="text-sm text-ink-3">{t("driverBehavior.detail.byTypeEmpty")}</p>}
        {byType.length > 0 && (
          <div dir="ltr" style={{ height: Math.max(140, byType.length * 34 + 30) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byType} layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={TICK_STYLE} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" width={140} tick={TICK_STYLE} axisLine={false} tickLine={false} />
                <Tooltip
                  cursor={{ fill: CURSOR_FILL }}
                  contentStyle={TOOLTIP_CONTENT_STYLE}
                  labelStyle={TOOLTIP_LABEL_STYLE}
                  itemStyle={TOOLTIP_ITEM_STYLE}
                />
                <Bar dataKey="points" name={t("driverBehavior.points")} fill={SERIES_1} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-ink">{t("driverBehavior.detail.events")}</h3>
        <EventsTable driverId={id} />
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold text-ink">{t("driverBehavior.detail.coaching")}</h3>
        <CoachingList driverId={id} />
      </section>
    </div>
  );
}
