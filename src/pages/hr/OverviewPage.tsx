import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Banknote, CalendarClock, CalendarOff, Users } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  CURSOR_FILL, GRID_STROKE, TICK_STYLE, TOOLTIP_CONTENT_STYLE, TOOLTIP_ITEM_STYLE, TOOLTIP_LABEL_STYLE,
} from "../../lib/chart";
import { countRows, listRows } from "../../lib/db";
import { formatCompact, formatDate, formatMoney } from "../../lib/format";
import { employeeName } from "../../lib/employees";
import { useTenant } from "../../context/AuthContext";
import { useI18n, useT, useTp } from "../../i18n";
import { Bdi, Card, ErrorState, LoadingState, Ltr, StatCard } from "../../components/ui";
import { todayIso } from "../employees/shared";
import { useLeaveTypes } from "./hooks";
import { leaveTypeName } from "./labels";
import { SetupHr } from "./SetupHr";
import { LEAVE_SELECT, type LeaveRequest, type PayrollRun } from "./types";

const PREVIEW = 6;

export default function OverviewPage() {
  const t = useT();
  const tp = useTp();
  const { language } = useI18n();
  const tenant = useTenant();
  const today = todayIso();
  const typesQ = useLeaveTypes();

  const statsQ = useQuery({
    queryKey: ["hr", "overview", today],
    queryFn: async () => {
      const [active, pending, away] = await Promise.all([
        countRows("employees", (q) => q.in("status", ["active", "on_leave"])),
        countRows("leave_requests", (q) => q.eq("status", "pending")),
        countRows("leave_requests", (q) => q.eq("status", "approved").lte("start_date", today).gte("end_date", today)),
      ]);
      return { active, pending, away };
    },
  });
  const pendingQ = useQuery({
    queryKey: ["leave_requests", "overview-pending"],
    queryFn: () =>
      listRows<LeaveRequest>("leave_requests", (q) =>
        q.select(LEAVE_SELECT).eq("status", "pending").order("start_date").limit(PREVIEW),
      ),
  });
  const runsQ = useQuery({
    queryKey: ["payroll_runs", "overview"],
    queryFn: () =>
      listRows<PayrollRun>("payroll_runs", (q) =>
        q.neq("status", "canceled").order("period_start", { ascending: false }).limit(PREVIEW),
      ),
  });

  if (statsQ.isLoading || typesQ.isLoading) return <LoadingState />;
  if (statsQ.error) return <ErrorState message={(statsQ.error as Error).message} />;
  const s = statsQ.data!;
  const runs = runsQ.data ?? [];
  const last = runs[0];
  const chart = [...runs].reverse().map((r) => ({
    name: r.period_start.slice(0, 7),
    net: Number(r.total_net),
  }));

  return (
    <div className="space-y-4">
      {(typesQ.data ?? []).length === 0 && <SetupHr />}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={<Users className="h-5 w-5" />} tone="blue" label={t("hr.kpiActive")} value={<Ltr>{s.active}</Ltr>} />
        <StatCard
          icon={<CalendarClock className="h-5 w-5" />}
          tone="amber"
          label={t("hr.kpiPending")}
          value={<Ltr>{s.pending}</Ltr>}
          subTone={s.pending > 0 ? "warn" : "muted"}
          sub={s.pending > 0 ? t("hr.kpiPendingSub") : undefined}
        />
        <StatCard icon={<CalendarOff className="h-5 w-5" />} tone="violet" label={t("hr.kpiAway")} value={<Ltr>{s.away}</Ltr>} />
        <StatCard
          icon={<Banknote className="h-5 w-5" />}
          tone="green"
          label={t("hr.kpiLastRun")}
          value={last ? formatMoney(Number(last.total_net), last.currency ?? tenant.currency) : t("common.dash")}
          sub={last ? `${last.doc_number ?? ""} · ${formatDate(last.period_end, tenant.timezone)}` : t("hr.noRunsTitle")}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-ink">{t("hr.netByRun")}</h2>
          {runsQ.isLoading ? (
            <LoadingState />
          ) : chart.length === 0 ? (
            <p className="text-sm text-ink-3">{t("hr.noRunsDesc")}</p>
          ) : (
            <div dir="ltr">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chart} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
                  <XAxis dataKey="name" tick={TICK_STYLE} axisLine={false} tickLine={false} />
                  <YAxis tick={TICK_STYLE} axisLine={false} tickLine={false} width={48} tickFormatter={(v) => formatCompact(Number(v))} />
                  <Tooltip
                    cursor={{ fill: CURSOR_FILL }}
                    contentStyle={TOOLTIP_CONTENT_STYLE}
                    labelStyle={TOOLTIP_LABEL_STYLE}
                    itemStyle={TOOLTIP_ITEM_STYLE}
                    formatter={(value) => formatMoney(Number(value), tenant.currency)}
                  />
                  <Bar dataKey="net" name={t("hr.totalNet")} fill="#1d67f1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-ink">{t("hr.pendingRequests")}</h2>
            <Link to="/hr/leave" className="text-sm font-medium text-brand-700 hover:underline">{t("hr.seeAll")}</Link>
          </div>
          {pendingQ.isLoading ? (
            <LoadingState />
          ) : (pendingQ.data ?? []).length === 0 ? (
            <p className="text-sm text-ink-3">{t("hr.noPending")}</p>
          ) : (
            <ul className="divide-y divide-line">
              {(pendingQ.data ?? []).map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-ink">
                      <Bdi>{r.employee ? employeeName(r.employee, language) : t("common.dash")}</Bdi>
                    </div>
                    <div className="truncate text-xs text-ink-3">
                      <Bdi>{leaveTypeName(r.leave_type, language)}</Bdi> · {formatDate(r.start_date, tenant.timezone)}
                    </div>
                  </div>
                  <span className="shrink-0 text-ink-2 tabular-nums">{tp("hr.daysCount", Number(r.days))}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
