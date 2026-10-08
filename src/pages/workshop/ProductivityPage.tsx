import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock, Coins, Gauge } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { listRows } from "../../lib/db";
import { formatMoney } from "../../lib/format";
import { CURSOR_FILL, GRID_STROKE, TICK_STYLE, TOOLTIP_CONTENT_STYLE, TOOLTIP_ITEM_STYLE, TOOLTIP_LABEL_STYLE } from "../../lib/chart";
import { bayUtilization, laborByEmployee, weeklyHours, weekStart, type BookingStatus } from "../../../shared/workshop";
import { useTenant } from "../../context/AuthContext";
import { useT, useTp } from "../../i18n";
import { Bdi, Card, ErrorState, Field, LoadingState, Ltr, Select, StatCard } from "../../components/ui";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { personName } from "./labels";
import { BAY_SELECT, type Bay } from "./types";

const WEEKS = 8;
const DAY = 86_400_000;

interface LaborStat {
  employee_id: string;
  started_at: string;
  hours: number | null;
  cost: number | null;
  employee: { first_name: string; last_name: string | null } | null;
}

export default function ProductivityPage() {
  const t = useT();
  const tp = useTp();
  const tenant = useTenant();
  const thisWeek = weekStart(new Date().toISOString());
  const weeks = useMemo(() => Array.from({ length: WEEKS }, (_, i) =>
    new Date(Date.parse(thisWeek + "T00:00:00Z") - i * 7 * DAY).toISOString().slice(0, 10)), [thisWeek]);
  const [week, setWeek] = useState(thisWeek);
  const [hoursPerDay, setHoursPerDay] = useState(10);
  const from = new Date(week + "T00:00:00Z");
  const to = new Date(from.getTime() + 7 * DAY);
  const since = weeks[weeks.length - 1] + "T00:00:00Z";

  const laborQ = useQuery({
    queryKey: ["work_order_labor", "stats", since],
    queryFn: () =>
      listRows<LaborStat>("work_order_labor", (q) =>
        q.select("employee_id, started_at, hours, cost, employee:employees!work_order_labor_employee_id_fkey(first_name,last_name)")
          .gte("started_at", since).not("hours", "is", null).limit(5000)),
  });
  const baysQ = useQuery({
    queryKey: ["workshop_bays", "active"],
    queryFn: () => listRows<Bay>("workshop_bays", (q) => q.select(BAY_SELECT).eq("active", true).order("name").limit(100)),
  });
  const bookingsQ = useQuery({
    queryKey: ["workshop_bookings", "week", week],
    queryFn: () =>
      listRows<{ bay_id: string; starts_at: string; ends_at: string; status: BookingStatus }>("workshop_bookings", (q) =>
        q.select("bay_id, starts_at, ends_at, status").lt("starts_at", to.toISOString()).gt("ends_at", from.toISOString()).limit(2000)),
  });

  const weekRows = (laborQ.data ?? []).filter((r) => weekStart(r.started_at) === week);
  const names = new Map((laborQ.data ?? []).map((r) => [r.employee_id, personName(r.employee)]));
  const byEmp = laborByEmployee(weekRows);
  const chart = weeklyHours(laborQ.data ?? [], WEEKS).map((w) => ({ ...w, label: w.week.slice(5).replace("-", "/") }));
  const bays = baysQ.data ?? [];
  const util = bayUtilization(bookingsQ.data ?? [], bays.map((b) => b.id), from, to, hoursPerDay);
  const avgUtil = util.length ? Math.round(util.reduce((s, u) => s + u.pct, 0) / util.length) : null;
  const totalHours = Math.round(byEmp.reduce((s, e) => s + e.hours, 0) * 100) / 100;
  const totalCost = byEmp.reduce((s, e) => s + e.cost, 0);

  if (laborQ.isLoading || baysQ.isLoading) return <LoadingState />;
  const err = laborQ.error ?? baysQ.error ?? bookingsQ.error;
  if (err) return <ErrorState message={(err as Error).message} />;

  type Row = (typeof byEmp)[number];
  const columns: Array<DataTableColumn<Row>> = [
    { id: "employee", header: t("workshop.prod.col.employee"), cell: (r) => <Bdi className="text-ink">{names.get(r.employeeId)}</Bdi>, exportValue: (r) => names.get(r.employeeId) ?? "" },
    { id: "hours", header: t("workshop.prod.col.hours"), align: "end", cell: (r) => <Ltr className="text-ink">{String(r.hours)}</Ltr>, sortValue: (r) => r.hours, exportValue: (r) => r.hours },
    { id: "entries", header: t("workshop.prod.col.entries"), align: "end", minBreakpoint: "sm", cell: (r) => <span className="text-ink-2">{r.entries}</span>, sortValue: (r) => r.entries, exportValue: (r) => r.entries },
    { id: "cost", header: t("workshop.prod.col.cost"), align: "end", cell: (r) => <span className="whitespace-nowrap text-ink-2">{formatMoney(r.cost, tenant.currency)}</span>, sortValue: (r) => r.cost, exportValue: (r) => r.cost },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t("workshop.prod.week")}>
          <Select value={week} onChange={(e) => setWeek(e.target.value)} className="w-44">
            {weeks.map((w) => <option key={w} value={w}>{w}</option>)}
          </Select>
        </Field>
        <Field label={t("workshop.prod.hoursPerDay")}>
          <Select value={String(hoursPerDay)} onChange={(e) => setHoursPerDay(Number(e.target.value))} className="w-36">
            {[8, 9, 10, 12, 16, 24].map((h) => <option key={h} value={h}>{tp("workshop.prod.hoursOption", h)}</option>)}
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard icon={<Clock className="h-5 w-5" />} label={t("workshop.prod.totalHours")} value={<Ltr>{String(totalHours)}</Ltr>} />
        <StatCard icon={<Coins className="h-5 w-5" />} tone="amber" label={t("workshop.prod.totalCost")} value={formatMoney(totalCost, tenant.currency)} />
        <StatCard icon={<Gauge className="h-5 w-5" />} tone="green" label={t("workshop.prod.avgUtil")} value={avgUtil == null ? "—" : <Ltr>{`${avgUtil}%`}</Ltr>} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h2 className="mb-2 text-sm font-semibold text-ink">{t("workshop.prod.byEmployee")}</h2>
          <DataTable<Row> tableId="workshop_productivity" exportName="workshop-hours" rows={byEmp} rowKey={(r) => r.employeeId} columns={columns}
            empty={<p className="py-8 text-center text-sm text-ink-3">{t("workshop.prod.empty")}</p>} />
        </div>
        <Card className="p-4">
          <h2 className="text-sm font-semibold text-ink">{t("workshop.prod.utilization")}</h2>
          <p className="mb-3 text-xs text-ink-3">{t("workshop.prod.utilizationHint", { hours: tp("workshop.prod.hoursOption", hoursPerDay) })}</p>
          {bays.length === 0 ? <p className="py-6 text-center text-sm text-ink-3">{t("workshop.prod.noBays")}</p> : (
            <ul className="space-y-3">
              {util.map((u) => (
                <li key={u.bayId}>
                  <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                    <Bdi className="truncate text-ink">{bays.find((b) => b.id === u.bayId)?.name}</Bdi>
                    <span className="shrink-0 text-xs text-ink-3">
                      {t("workshop.prod.booked", { hours: String(u.bookedHours) })} · <Ltr>{`${u.pct}%`}</Ltr>
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-canvas" dir="ltr">
                    <div className="h-full rounded-full bg-chart-1" style={{ width: `${u.pct}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink">{t("workshop.prod.chartTitle")}</h2>
        {!chart.some((w) => w.hours) ? <p className="py-10 text-center text-sm text-ink-3">{t("workshop.prod.chartEmpty")}</p> : (
          <div dir="ltr">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chart} margin={{ top: 5, right: 10, bottom: 5, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
                <XAxis dataKey="label" tick={TICK_STYLE} axisLine={false} tickLine={false} />
                <YAxis tick={TICK_STYLE} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: CURSOR_FILL }} contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} itemStyle={TOOLTIP_ITEM_STYLE} />
                <Bar dataKey="hours" name={t("workshop.prod.chartHours")} fill="#1d67f1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>
    </div>
  );
}
