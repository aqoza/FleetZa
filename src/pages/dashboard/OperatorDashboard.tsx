import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format, subMonths } from "date-fns";
import { AlertTriangle, BellRing, Building2, Truck, Wrench } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { listRows } from "../../lib/db";
import {
  daysUntil,
  formatCompact,
  formatDate,
  formatDistance,
  formatMoney,
} from "../../lib/format";
import { renewalTypes, vehicleStatus, workOrderStatus } from "../../lib/labels";
import type {
  FuelLog,
  Issue,
  Renewal,
  ServiceReminder,
  SpeedLimiterCertificate,
  Vehicle,
  VehicleStatus,
  WorkOrder,
} from "../../lib/types";
import { useTenant } from "../../context/AuthContext";
import { useModules } from "../../context/ModulesContext";
import {
  Badge,
  ErrorState,
  LoadingState,
  PageHeader,
  StatCard,
  Card,
} from "../../components/ui";
import { useT } from "../../i18n";
import { ActivityCard, GRID_STROKE, ListCard, NothingDue, TICK_STYLE } from "./shared";

type ReminderRow = ServiceReminder & { vehicles: { name: string; odometer: number } };
type RenewalRow = Renewal & { vehicles: { name: string } | null };
type WorkOrderRow = WorkOrder & {
  work_order_lines: { quantity: number; unit_cost: number }[];
};
type CertificateRow = SpeedLimiterCertificate & { vehicles: { name: string } | null };

/** Status palette (reserved for state; validated — docs/DESIGN_SYSTEM.md). */
const STATUS_COLORS: Record<VehicleStatus, string> = {
  active: "#059669",
  in_shop: "#d97706",
  out_of_service: "#dc2626",
  retired: "#64748b",
};

/** CVD-validated series pair (docs/DESIGN_SYSTEM.md — never same-hue pairs). */
const FUEL_COLOR = "#1d67f1";
const MAINTENANCE_COLOR = "#0d9488";

/** Overdue / due-soon state for a reminder, plus a sort key (lower = more urgent). */
function reminderDue(r: ReminderRow) {
  const days = r.due_date ? daysUntil(r.due_date) : null;
  const kmLeft = r.due_km != null ? r.due_km - r.vehicles.odometer : null;
  const overdue = (days !== null && days < 0) || (kmLeft !== null && kmLeft <= 0);
  const dueSoon =
    overdue || (days !== null && days <= 30) || (kmLeft !== null && kmLeft <= 1000);
  const urgency = Math.min(
    days ?? Number.POSITIVE_INFINITY,
    kmLeft !== null ? (kmLeft / 1000) * 30 : Number.POSITIVE_INFINITY,
  );
  return { overdue, dueSoon, urgency };
}

/** Home dashboard for fleet-operator tenants: own-fleet health, spend, upcoming work. */
export default function OperatorDashboard() {
  const tenant = useTenant();
  const t = useT();
  const { isEnabled } = useModules();

  const customersOn = isEnabled("customers");
  const issuesOn = isEnabled("issues");
  const maintenanceOn = isEnabled("maintenance");
  const preventiveOn = isEnabled("preventive");
  const renewalsOn = isEnabled("renewals");
  const fuelOn = isEnabled("fuel");
  const slCertsOn = isEnabled("sl_certificates");

  const vehiclesQ = useQuery({
    queryKey: ["vehicles", "dashboard"],
    queryFn: () => listRows<Vehicle>("vehicles"),
  });

  const issuesQ = useQuery({
    queryKey: ["issues", "dashboard", "open"],
    queryFn: () =>
      listRows<Issue>("issues", (q) => q.in("status", ["open", "in_progress"])),
    enabled: issuesOn,
  });

  const workOrdersQ = useQuery({
    queryKey: ["work_orders", "dashboard", "open"],
    queryFn: () =>
      listRows<WorkOrderRow>("work_orders", (q) =>
        q
          .select("*, work_order_lines(quantity, unit_cost)")
          .in("status", ["open", "in_progress"])
          .order("created_at", { ascending: false }),
      ),
    enabled: maintenanceOn,
  });

  const maintenanceQ = useQuery({
    queryKey: ["work_orders", "dashboard", "completed"],
    queryFn: () =>
      listRows<WorkOrderRow>("work_orders", (q) =>
        q
          .select("*, work_order_lines(quantity, unit_cost)")
          .eq("status", "completed")
          .gte("completed_at", subMonths(new Date(), 6).toISOString()),
      ),
    enabled: maintenanceOn,
  });

  const remindersQ = useQuery({
    queryKey: ["service_reminders", "dashboard"],
    queryFn: () =>
      listRows<ReminderRow>("service_reminders", (q) =>
        q.select("*, vehicles(name, odometer)").eq("active", true),
      ),
    enabled: preventiveOn,
  });

  const renewalsQ = useQuery({
    queryKey: ["renewals", "dashboard"],
    queryFn: () =>
      listRows<RenewalRow>("renewals", (q) =>
        q.select("*, vehicles(name)").is("completed_at", null).order("due_date"),
      ),
    enabled: renewalsOn,
  });

  const fuelQ = useQuery({
    queryKey: ["fuel_logs", "dashboard"],
    queryFn: () =>
      listRows<FuelLog>("fuel_logs", (q) =>
        q.gte("filled_at", subMonths(new Date(), 6).toISOString()),
      ),
    enabled: fuelOn,
  });

  const certificatesQ = useQuery({
    queryKey: ["speed_limiter_certificates", "dashboard"],
    queryFn: () =>
      listRows<CertificateRow>("speed_limiter_certificates", (q) =>
        q.select("*, vehicles(name)").order("expires_at").limit(20),
      ),
    enabled: slCertsOn,
  });

  const vehicles = vehiclesQ.data ?? [];
  /** Vehicles that make up YOUR fleet: company-owned only when the customers module is on. */
  const fleetVehicles = useMemo(
    () => (customersOn ? vehicles.filter((v) => v.ownership === "company") : vehicles),
    [vehicles, customersOn],
  );
  const reminders = remindersQ.data ?? [];
  const renewals = renewalsQ.data ?? [];

  const monthly = useMemo(() => {
    const months = Array.from({ length: 6 }, (_, i) => {
      const d = subMonths(new Date(), 5 - i);
      return { key: format(d, "yyyy-MM"), month: format(d, "MMM"), fuel: 0, maintenance: 0 };
    });
    const byKey = new Map(months.map((m) => [m.key, m]));
    for (const f of fuelQ.data ?? []) {
      const bucket = byKey.get(format(new Date(f.filled_at), "yyyy-MM"));
      if (bucket) bucket.fuel += f.total_cost;
    }
    for (const w of maintenanceQ.data ?? []) {
      if (!w.completed_at) continue;
      const bucket = byKey.get(format(new Date(w.completed_at), "yyyy-MM"));
      if (bucket) {
        bucket.maintenance += w.work_order_lines.reduce(
          (sum, l) => sum + l.quantity * l.unit_cost,
          0,
        );
      }
    }
    return months;
  }, [fuelQ.data, maintenanceQ.data]);

  const statusData = useMemo(
    () =>
      (Object.keys(vehicleStatus) as VehicleStatus[]).map((s) => ({
        key: s,
        name: t(vehicleStatus[s].labelKey),
        value: fleetVehicles.filter((v) => v.status === s).length,
        color: STATUS_COLORS[s],
      })),
    [fleetVehicles, t],
  );

  const dueReminders = useMemo(
    () =>
      reminders
        .map((r) => ({ reminder: r, ...reminderDue(r) }))
        .filter((r) => r.dueSoon)
        .sort((a, b) => a.urgency - b.urgency),
    [reminders],
  );

  const dueRenewals = useMemo(
    () =>
      renewals
        .map((r) => ({ renewal: r, days: daysUntil(r.due_date) }))
        .filter((r) => r.days <= 60),
    [renewals],
  );

  const dueCertificates = useMemo(
    () =>
      (certificatesQ.data ?? [])
        .map((c) => ({ certificate: c, days: daysUntil(c.expires_at) }))
        .filter((c) => c.days <= 60),
    [certificatesQ.data],
  );

  const attentionCount =
    (preventiveOn ? dueReminders.filter((r) => r.overdue).length : 0) +
    (renewalsOn ? dueRenewals.filter((r) => r.days < 0).length : 0) +
    (slCertsOn ? dueCertificates.filter((c) => c.days <= 30).length : 0);
  const attentionOn = preventiveOn || renewalsOn || slCertsOn;

  const openWorkOrders = workOrdersQ.data ?? [];

  const queries = [
    vehiclesQ,
    issuesQ,
    workOrdersQ,
    maintenanceQ,
    remindersQ,
    renewalsQ,
    fuelQ,
    certificatesQ,
  ];
  const isLoading = queries.some((q) => q.isLoading);
  const firstError = queries.map((q) => q.error).find(Boolean);

  return (
    <>
      <PageHeader title={t("nav.dashboard")} description={t("dashboard.subtitle")} />

      {isLoading && <LoadingState />}
      {!isLoading && firstError && <ErrorState message={firstError.message} />}

      {!isLoading && !firstError && (
        <div className="space-y-5">
          {/* KPI cards */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {customersOn ? (
              <>
                <StatCard
                  icon={<Truck className="h-5 w-5" />}
                  tone="blue"
                  label={t("dashboard.companyVehicles")}
                  value={fleetVehicles.length}
                  sub={t("dashboard.nActive", {
                    count: fleetVehicles.filter((v) => v.status === "active").length,
                  })}
                  subTone="good"
                />
                <StatCard
                  icon={<Building2 className="h-5 w-5" />}
                  tone="green"
                  label={t("dashboard.customerVehicles")}
                  value={vehicles.filter((v) => v.ownership === "customer").length}
                />
              </>
            ) : (
              <StatCard
                icon={<Truck className="h-5 w-5" />}
                tone="blue"
                label={t("dashboard.totalVehicles")}
                value={vehicles.length}
                sub={t("dashboard.nActive", {
                  count: vehicles.filter((v) => v.status === "active").length,
                })}
                subTone="good"
              />
            )}
            {issuesOn && (
              <StatCard
                icon={<AlertTriangle className="h-5 w-5" />}
                tone="amber"
                label={t("dashboard.openIssues")}
                value={issuesQ.data?.length ?? 0}
              />
            )}
            {maintenanceOn && (
              <StatCard
                icon={<Wrench className="h-5 w-5" />}
                tone="violet"
                label={t("dashboard.openWorkOrders")}
                value={openWorkOrders.length}
              />
            )}
            {attentionOn && (
              <StatCard
                icon={<BellRing className="h-5 w-5" />}
                tone="red"
                label={t("dashboard.attentionNeeded")}
                value={attentionCount}
                sub={t("dashboard.attentionSub")}
                subTone={attentionCount > 0 ? "serious" : "muted"}
              />
            )}
          </div>

          {/* Spend + fleet status */}
          <div className="grid gap-4 xl:grid-cols-3">
            {(fuelOn || maintenanceOn) && (
              <Card className="p-5 xl:col-span-2">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-ink">
                    {t("dashboard.monthlySpend")}
                  </h2>
                  <div className="flex items-center gap-4 text-xs text-ink-2">
                    {fuelOn && (
                      <span className="flex items-center gap-1.5">
                        <span
                          className="h-2.5 w-2.5 rounded-sm"
                          style={{ backgroundColor: FUEL_COLOR }}
                        />
                        {t("nav.fuel")}
                      </span>
                    )}
                    {maintenanceOn && (
                      <span className="flex items-center gap-1.5">
                        <span
                          className="h-2.5 w-2.5 rounded-sm"
                          style={{ backgroundColor: MAINTENANCE_COLOR }}
                        />
                        {t("nav.maintenance")}
                      </span>
                    )}
                  </div>
                </div>
                <div dir="ltr">
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={monthly} barCategoryGap="28%">
                      <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
                      <XAxis dataKey="month" tick={TICK_STYLE} tickLine={false} axisLine={false} />
                      <YAxis
                        tick={TICK_STYLE}
                        tickLine={false}
                        axisLine={false}
                        width={44}
                        tickFormatter={(v) => formatCompact(Number(v))}
                      />
                      <Tooltip
                        cursor={{ fill: "rgba(148, 163, 184, 0.08)" }}
                        formatter={(value) => formatMoney(Number(value), tenant.currency)}
                      />
                      {fuelOn && (
                        <Bar
                          dataKey="fuel"
                          name={t("nav.fuel")}
                          stackId="spend"
                          fill={FUEL_COLOR}
                          radius={maintenanceOn ? undefined : [4, 4, 0, 0]}
                        />
                      )}
                      {maintenanceOn && (
                        <Bar
                          dataKey="maintenance"
                          name={t("nav.maintenance")}
                          stackId="spend"
                          fill={MAINTENANCE_COLOR}
                          radius={[4, 4, 0, 0]}
                        />
                      )}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            )}

            <Card className="p-5">
              <h2 className="text-sm font-semibold text-ink">{t("dashboard.fleetStatus")}</h2>
              <div className="relative mx-auto mt-2 h-[190px] max-w-[220px]">
                <div dir="ltr" className="h-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={statusData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={62}
                        outerRadius={88}
                        paddingAngle={2}
                        stroke="#ffffff"
                        strokeWidth={2}
                      >
                        {statusData.map((s) => (
                          <Cell key={s.key} fill={s.color} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-[26px] font-bold leading-none tracking-tight text-ink tabular-nums">
                    {fleetVehicles.length}
                  </span>
                  <span className="mt-1 text-xs text-ink-3">{t("dashboard.vehiclesLabel")}</span>
                </div>
              </div>
              <ul className="mt-4 space-y-2.5">
                {statusData.map((s) => {
                  const pct =
                    fleetVehicles.length > 0
                      ? Math.round((s.value / fleetVehicles.length) * 1000) / 10
                      : 0;
                  return (
                    <li key={s.key} className="flex items-center gap-2 text-sm text-ink-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: s.color }}
                      />
                      <span className="truncate">{s.name}</span>
                      <span className="ms-auto font-semibold text-ink tabular-nums">{s.value}</span>
                      <span className="w-12 text-end text-xs text-ink-3 tabular-nums">{pct}%</span>
                    </li>
                  );
                })}
              </ul>
            </Card>
          </div>

          {/* Due-soon boards */}
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {preventiveOn && (
              <ListCard title={t("dashboard.dueSoonService")} viewAll="/maintenance">
                {dueReminders.length === 0 ? (
                  <NothingDue />
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {dueReminders.slice(0, 6).map(({ reminder: r, overdue }) => (
                      <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-ink">{r.task}</div>
                          <div className="truncate text-xs text-ink-3">
                            {r.vehicles.name}
                            {" · "}
                            {[
                              r.due_date ? formatDate(r.due_date) : null,
                              r.due_km != null
                                ? formatDistance(r.due_km, tenant.distance_unit)
                                : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </div>
                        </div>
                        <Badge tone={overdue ? "red" : "yellow"}>
                          {overdue ? t("dashboard.overdue") : t("dashboard.dueSoon")}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </ListCard>
            )}

            {renewalsOn && (
              <ListCard title={t("dashboard.dueSoonRenewals")} viewAll="/renewals">
                {dueRenewals.length === 0 ? (
                  <NothingDue />
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {dueRenewals.slice(0, 6).map(({ renewal: r, days }) => (
                      <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-ink">
                            {t(renewalTypes[r.renewal_type])}
                            {r.name ? ` — ${r.name}` : ""}
                          </div>
                          <div className="truncate text-xs text-ink-3">
                            {r.vehicles?.name ?? t("common.dash")} · {formatDate(r.due_date)}
                          </div>
                        </div>
                        <Badge tone={days < 0 ? "red" : days <= 30 ? "yellow" : "slate"}>
                          {days < 0
                            ? t("dashboard.overdue")
                            : days === 0
                              ? t("dashboard.dueToday")
                              : t("dashboard.dueInDays", { count: days })}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </ListCard>
            )}

            {slCertsOn && (
              <ListCard title={t("dashboard.slCertsTitle")} viewAll="/speed-limiters/certificates">
                {dueCertificates.length === 0 ? (
                  <NothingDue />
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {dueCertificates.slice(0, 6).map(({ certificate: c, days }) => (
                      <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-ink">
                            {c.certificate_number}
                          </div>
                          <div className="truncate text-xs text-ink-3">
                            {c.vehicles?.name ?? t("common.dash")} · {formatDate(c.expires_at)}
                          </div>
                        </div>
                        <Badge tone={days < 0 ? "red" : "yellow"}>
                          {days < 0
                            ? t("dashboard.expired")
                            : days === 0
                              ? t("dashboard.dueToday")
                              : t("dashboard.dueInDays", { count: days })}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </ListCard>
            )}
          </div>

          {/* Recent work + activity */}
          <div className="grid gap-4 lg:grid-cols-2">
            {maintenanceOn && (
              <ListCard title={t("dashboard.recentWorkOrders")} viewAll="/maintenance">
                {openWorkOrders.length === 0 ? (
                  <NothingDue />
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {openWorkOrders.slice(0, 6).map((w) => {
                      const meta = workOrderStatus[w.status];
                      return (
                        <li
                          key={w.id}
                          className="flex items-center justify-between gap-3 px-5 py-3"
                        >
                          <div className="min-w-0">
                            <Link
                              to={`/maintenance/work-orders/${w.id}`}
                              className="block truncate text-sm font-medium text-brand-700 hover:underline"
                            >
                              #{w.number} {w.title}
                            </Link>
                            <div className="truncate text-xs text-ink-3">
                              {formatDate(w.scheduled_date ?? w.created_at)}
                            </div>
                          </div>
                          <Badge tone={meta.tone}>{t(meta.labelKey)}</Badge>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </ListCard>
            )}

            <ActivityCard />
          </div>
        </div>
      )}
    </>
  );
}
