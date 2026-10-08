import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Activity, AlertTriangle, Gauge, GraduationCap, Info } from "lucide-react";
import { formatDistance } from "../../lib/format";
import { useTenant } from "../../context/AuthContext";
import { useT, useTp } from "../../i18n";
import { Badge, Bdi, Card, EmptyState, ErrorState, LoadingState, Pagination, Select, StatCard } from "../../components/ui";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { gradeTone, personName } from "./labels";
import { useDriverNames, useScores, useScoreTrend } from "./hooks";
import { Sparkline } from "./Sparkline";
import type { ScoreRow } from "./types";

const PAGE_SIZE = 25;
const PERIODS = [7, 30, 90] as const;
const AT_RISK = 70;

type Ranked = ScoreRow & { rank: number };

export default function ScoreboardPage() {
  const t = useT();
  const tp = useTp();
  const tenant = useTenant();
  const navigate = useNavigate();
  const [days, setDays] = useState<number>(30);
  const [page, setPage] = useState(0);
  const scoresQ = useScores(days);
  const trendQ = useScoreTrend();

  const ranked = useMemo<Ranked[]>(
    () =>
      [...(scoresQ.data ?? [])]
        .sort((a, b) => b.score - a.score || a.penalty - b.penalty)
        .map((r, i) => ({ ...r, rank: i + 1 })),
    [scoresQ.data],
  );
  const pageRows = ranked.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const namesQ = useDriverNames(pageRows.map((r) => r.driver_id));
  const name = (id: string) => personName(namesQ.data?.get(id)) || "…";

  const kpi = useMemo(() => {
    const rows = scoresQ.data ?? [];
    const avg = rows.length ? rows.reduce((s, r) => s + r.score, 0) / rows.length : null;
    return {
      avg,
      events: rows.reduce((s, r) => s + r.events, 0),
      high: rows.reduce((s, r) => s + r.high_events, 0),
      atRisk: rows.filter((r) => r.score < AT_RISK).length,
    };
  }, [scoresQ.data]);

  const columns: Array<DataTableColumn<Ranked>> = [
    {
      id: "rank",
      header: t("driverBehavior.col.rank"),
      cell: (r) => <span className="text-ink-3 tabular-nums">{r.rank}</span>,
      sortValue: (r) => r.rank,
    },
    {
      id: "driver",
      header: t("driverBehavior.col.driver"),
      cell: (r) => <Bdi className="font-medium text-ink">{name(r.driver_id)}</Bdi>,
      exportValue: (r) => name(r.driver_id),
    },
    {
      id: "grade",
      header: t("driverBehavior.col.grade"),
      cell: (r) => <Badge tone={gradeTone[r.grade]}>{r.grade}</Badge>,
      sortValue: (r) => r.grade,
    },
    {
      id: "score",
      header: t("driverBehavior.col.score"),
      align: "end",
      cell: (r) => <span className="font-semibold text-ink tabular-nums">{r.score.toFixed(1)}</span>,
      sortValue: (r) => r.score,
    },
    {
      id: "events",
      header: t("driverBehavior.col.events"),
      align: "end",
      minBreakpoint: "sm",
      cell: (r) => <span className="text-ink-2 tabular-nums">{r.events}</span>,
      sortValue: (r) => r.events,
    },
    {
      id: "high",
      header: t("driverBehavior.col.high"),
      align: "end",
      minBreakpoint: "md",
      cell: (r) => (
        <span className={r.high_events > 0 ? "font-medium text-serious tabular-nums" : "text-ink-3 tabular-nums"}>
          {r.high_events}
        </span>
      ),
      sortValue: (r) => r.high_events,
    },
    {
      id: "distance",
      header: t("driverBehavior.col.distance"),
      align: "end",
      minBreakpoint: "md",
      cell: (r) => <span className="whitespace-nowrap text-ink-2 tabular-nums">{formatDistance(r.distance_km, tenant.distance_unit)}</span>,
      sortValue: (r) => r.distance_km,
      exportValue: (r) => r.distance_km,
    },
    {
      id: "trend",
      header: t("driverBehavior.col.trend"),
      minBreakpoint: "lg",
      cell: (r) => {
        const values = trendQ.data?.get(r.driver_id);
        return values ? <Sparkline values={values} label={t("driverBehavior.trendHint")} /> : <span className="text-ink-3">—</span>;
      },
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm font-medium text-ink-2" htmlFor="db-period">{t("driverBehavior.period")}</label>
        <Select
          id="db-period"
          value={days}
          onChange={(e) => {
            setDays(Number(e.target.value));
            setPage(0);
          }}
          className="max-w-44"
        >
          {PERIODS.map((d) => (
            <option key={d} value={d}>{tp("driverBehavior.lastNDays", d)}</option>
          ))}
        </Select>
      </div>

      {scoresQ.isLoading && <LoadingState />}
      {scoresQ.error && <ErrorState message={(scoresQ.error as Error).message} />}
      {scoresQ.data && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              icon={<Gauge className="h-5 w-5" />}
              label={t("driverBehavior.kpi.avgScore")}
              value={kpi.avg == null ? "—" : kpi.avg.toFixed(1)}
            />
            <StatCard icon={<Activity className="h-5 w-5" />} tone="violet" label={t("driverBehavior.kpi.events")} value={kpi.events} />
            <StatCard icon={<AlertTriangle className="h-5 w-5" />} tone="red" label={t("driverBehavior.kpi.highEvents")} value={kpi.high} />
            <StatCard
              icon={<GraduationCap className="h-5 w-5" />}
              tone="amber"
              label={t("driverBehavior.kpi.atRisk")}
              value={kpi.atRisk}
              sub={tp("driverBehavior.kpi.atRiskSub", kpi.atRisk)}
              subTone={kpi.atRisk > 0 ? "warn" : "muted"}
            />
          </div>

          <DataTable<Ranked>
            tableId="driver-scores"
            exportName="driver-scores"
            rows={pageRows}
            rowKey={(r) => r.driver_id}
            columns={columns}
            onRowClick={(r) => navigate(`/driver-behavior/drivers/${r.driver_id}`)}
            empty={
              <EmptyState
                icon={<Gauge className="h-10 w-10" />}
                title={t("driverBehavior.scoreEmpty")}
                description={t("driverBehavior.scoreEmptyHint")}
              />
            }
            footer={<Pagination page={page} pageSize={PAGE_SIZE} total={ranked.length} onPage={setPage} />}
          />

          <Card className="flex items-start gap-2 p-4 text-xs text-ink-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{t("driverBehavior.scoreHint")}</p>
          </Card>
        </>
      )}
    </div>
  );
}
