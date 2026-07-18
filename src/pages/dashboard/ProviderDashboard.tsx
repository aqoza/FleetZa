import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format, startOfMonth, subMonths } from "date-fns";
import { Award, Building2, PackageOpen, Truck, Wrench } from "lucide-react";
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
import { countRows, listRows } from "../../lib/db";
import { daysUntil, formatDate } from "../../lib/format";
import type { SlJob, SpeedLimiterCertificate } from "../../lib/types";
import { useModules } from "../../context/ModulesContext";
import {
  Badge,
  Card,
  ErrorState,
  LoadingState,
  PageHeader,
  StatCard,
} from "../../components/ui";
import { useT, type MessageKey } from "../../i18n";
import { ActivityCard, InsightsStrip, ListCard, type Insight } from "./shared";
import {
  CURSOR_FILL,
  GRID_STROKE,
  TICK_STYLE,
  TOOLTIP_CONTENT_STYLE,
  TOOLTIP_ITEM_STYLE,
  TOOLTIP_LABEL_STYLE,
} from "../../lib/chart";

type UpcomingJob = SlJob & {
  customers: { name: string } | null;
  vehicles: { name: string } | null;
};
type CertRow = SpeedLimiterCertificate & {
  customers: { name: string } | null;
  vehicles: { name: string } | null;
};

/** Device-stock donut palette (CVD-validated; neutral = retired by design). */
const DEVICE_COLORS: Record<string, string> = {
  in_stock: "#1d67f1",
  installed: "#059669",
  faulty: "#dc2626",
  retired: "#64748b",
};
const DEVICE_STATUSES = ["in_stock", "installed", "faulty", "retired"] as const;
const DEVICE_LABEL_KEYS: Record<(typeof DEVICE_STATUSES)[number], MessageKey> = {
  in_stock: "speedLimiters.deviceStatus.in_stock",
  installed: "speedLimiters.deviceStatus.installed",
  faulty: "speedLimiters.deviceStatus.faulty",
  retired: "speedLimiters.deviceStatus.retired",
};

type PipelineStatus = "scheduled" | "in_progress" | "completed" | "qc_approved";
const PIPELINE: Array<{ status: PipelineStatus; labelKey: MessageKey; dot: string }> = [
  { status: "scheduled", labelKey: "speedLimiters.jobStatus.scheduled", dot: "bg-brand-500" },
  { status: "in_progress", labelKey: "speedLimiters.jobStatus.in_progress", dot: "bg-warn" },
  { status: "completed", labelKey: "speedLimiters.jobStatus.completed", dot: "bg-good" },
  { status: "qc_approved", labelKey: "speedLimiters.jobStatus.qc_approved", dot: "bg-violet-500" },
];

const INSTALL_COLOR = "#1d67f1";

/**
 * Home dashboard for service-provider tenants: the install-and-certify funnel —
 * customers, device stock, job pipeline, and certificates at risk.
 *
 * Query keys are table-first (["<table>", "provider", ...]) so the app-wide
 * convention of invalidating by table prefix keeps every KPI fresh after
 * mutations elsewhere. Sections gate on their modules: the archetype picks the
 * layout, module enablement decides what actually renders and queries.
 */
export default function ProviderDashboard() {
  const t = useT();
  const { isEnabled } = useModules();
  const customersOn = isEnabled("customers");
  const slOn = isEnabled("speed_limiters");
  const certsOn = slOn && isEnabled("sl_certificates");
  const issuesOn = isEnabled("issues");
  const maintenanceOn = isEnabled("maintenance");

  const today = format(new Date(), "yyyy-MM-dd");
  const horizon60 = format(new Date(Date.now() + 60 * 86_400_000), "yyyy-MM-dd");

  const customersCountQ = useQuery({
    queryKey: ["customers", "provider", "count"],
    queryFn: () => countRows("customers", (q) => q.eq("status", "active")),
    enabled: customersOn,
  });

  const deviceCountsQ = useQuery({
    queryKey: ["sl_devices", "provider", "counts"],
    queryFn: async () => {
      const values = await Promise.all(
        DEVICE_STATUSES.map((s) => countRows("sl_devices", (q) => q.eq("status", s))),
      );
      return Object.fromEntries(DEVICE_STATUSES.map((s, i) => [s, values[i]])) as Record<
        (typeof DEVICE_STATUSES)[number],
        number
      >;
    },
    enabled: slOn,
  });

  const jobCountsQ = useQuery({
    queryKey: ["sl_jobs", "provider", "counts"],
    queryFn: async () => {
      const values = await Promise.all(
        PIPELINE.map(({ status }) => countRows("sl_jobs", (q) => q.eq("status", status))),
      );
      return Object.fromEntries(PIPELINE.map(({ status }, i) => [status, values[i]])) as Record<
        PipelineStatus,
        number
      >;
    },
    enabled: slOn,
  });

  const validCertsQ = useQuery({
    queryKey: ["speed_limiter_certificates", "provider", "validCount"],
    queryFn: () =>
      countRows("speed_limiter_certificates", (q) =>
        q.eq("status", "valid").gte("expires_at", today),
      ),
    enabled: certsOn,
  });

  /** Exact expiring-within-60d count — the display list below is capped, the KPI is not. */
  const expiringCountQ = useQuery({
    queryKey: ["speed_limiter_certificates", "provider", "expiringCount"],
    queryFn: () =>
      countRows("speed_limiter_certificates", (q) =>
        q.eq("status", "valid").gte("expires_at", today).lte("expires_at", horizon60),
      ),
    enabled: certsOn,
  });

  // Soonest-expiring valid certificates (bounded) — feeds the expiry list and
  // the customers-at-risk grouping.
  const expiringQ = useQuery({
    queryKey: ["speed_limiter_certificates", "provider", "expiring"],
    queryFn: () =>
      listRows<CertRow>("speed_limiter_certificates", (q) =>
        q
          .select("*, customers(name), vehicles(name)")
          .eq("status", "valid")
          .gte("expires_at", today)
          .lte("expires_at", horizon60)
          .order("expires_at")
          .limit(50),
      ),
    enabled: certsOn,
  });

  const upcomingQ = useQuery({
    queryKey: ["sl_jobs", "provider", "upcoming"],
    queryFn: () =>
      listRows<UpcomingJob>("sl_jobs", (q) =>
        q
          .select("*, customers(name), vehicles(name)")
          .in("status", ["scheduled", "in_progress"])
          .order("scheduled_date", { ascending: true, nullsFirst: false })
          .limit(6),
      ),
    enabled: slOn,
  });

  // Exact per-month completed-installation counts — head counts per bucket, no
  // row transfer, immune to the 1,000-row response cap.
  const trendQ = useQuery({
    queryKey: ["sl_jobs", "provider", "trend"],
    queryFn: async () => {
      const buckets = Array.from({ length: 6 }, (_, i) => {
        const start = startOfMonth(subMonths(new Date(), 5 - i));
        const end = startOfMonth(subMonths(new Date(), 4 - i));
        return { month: format(start, "MMM"), start: start.toISOString(), end: end.toISOString() };
      });
      const values = await Promise.all(
        buckets.map(({ start, end }) =>
          countRows("sl_jobs", (q) =>
            q
              .in("job_type", ["installation", "replacement"])
              .in("status", ["completed", "qc_approved", "closed"])
              .gte("completed_at", start)
              .lt("completed_at", end),
          ),
        ),
      );
      return buckets.map((b, i) => ({ month: b.month, installs: values[i] }));
    },
    enabled: slOn,
  });

  // Compact own-fleet strip (fleet is always on; providers often run trucks too).
  const fleetCountsQ = useQuery({
    queryKey: ["vehicles", "provider", "counts"],
    queryFn: async () => {
      const [company, active] = await Promise.all([
        countRows("vehicles", (q) => q.eq("ownership", "company")),
        countRows("vehicles", (q) => q.eq("ownership", "company").eq("status", "active")),
      ]);
      return { company, active };
    },
  });
  const issuesCountQ = useQuery({
    queryKey: ["issues", "provider", "count"],
    queryFn: () => countRows("issues", (q) => q.in("status", ["open", "in_progress"])),
    enabled: issuesOn,
  });
  const wosCountQ = useQuery({
    queryKey: ["work_orders", "provider", "count"],
    queryFn: () => countRows("work_orders", (q) => q.in("status", ["open", "in_progress"])),
    enabled: maintenanceOn,
  });

  const deviceData = useMemo(() => {
    const counts = deviceCountsQ.data;
    return DEVICE_STATUSES.map((s) => ({
      key: s,
      name: t(DEVICE_LABEL_KEYS[s]),
      value: counts?.[s] ?? 0,
      color: DEVICE_COLORS[s],
    }));
  }, [deviceCountsQ.data, t]);
  const deviceTotal = deviceData.reduce((sum, d) => sum + d.value, 0);

  // Grouped by customer_id (names are not unique); customer-less certificates
  // pool under a dash with no link.
  const atRisk = useMemo(() => {
    const byCustomer = new Map<
      string,
      { name: string; id: string | null; count: number; soonest: string }
    >();
    for (const c of expiringQ.data ?? []) {
      const key = c.customer_id ?? "__none__";
      const cur = byCustomer.get(key);
      if (cur) {
        cur.count += 1;
      } else {
        byCustomer.set(key, {
          name: c.customers?.name ?? t("common.dash"),
          id: c.customer_id,
          count: 1,
          soonest: c.expires_at,
        });
      }
    }
    return [...byCustomer.entries()]
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [expiringQ.data, t]);

  const expiring = expiringQ.data ?? [];
  const upcoming = upcomingQ.data ?? [];
  const jobCounts = jobCountsQ.data;
  const openJobs = (jobCounts?.scheduled ?? 0) + (jobCounts?.in_progress ?? 0);

  // Deterministic, rule-based insights from data already on this page.
  const insights: Insight[] = [];
  const expiring30 = expiring.filter((c) => daysUntil(c.expires_at) <= 30).length;
  if (certsOn && expiring30 > 0) {
    insights.push({
      key: "certs",
      tone: "serious",
      text: t("insights.certsExpiring", { count: expiring30 }),
      to: "/speed-limiters/certificates",
    });
  }
  if (slOn && (jobCounts?.completed ?? 0) > 0) {
    insights.push({
      key: "qc",
      tone: "warn",
      text: t("insights.qcBacklog", { count: jobCounts?.completed ?? 0 }),
      to: "/speed-limiters/jobs",
    });
  }
  if (slOn && (deviceCountsQ.data?.in_stock ?? 0) === 0 && (jobCounts?.scheduled ?? 0) > 0) {
    insights.push({
      key: "stock",
      tone: "serious",
      text: t("insights.stockOut", { count: jobCounts?.scheduled ?? 0 }),
      to: "/speed-limiters/devices",
    });
  }

  const queries = [
    customersCountQ,
    deviceCountsQ,
    jobCountsQ,
    validCertsQ,
    expiringCountQ,
    expiringQ,
    upcomingQ,
    trendQ,
    fleetCountsQ,
    issuesCountQ,
    wosCountQ,
  ];
  const isLoading = queries.some((q) => q.isLoading);
  const firstError = queries.map((q) => q.error).find(Boolean);

  return (
    <>
      <PageHeader title={t("nav.dashboard")} description={t("dashboard.provider.subtitle")} />

      {isLoading && <LoadingState />}
      {!isLoading && firstError && <ErrorState message={(firstError as Error).message} />}

      {!isLoading && !firstError && (
        <div className="space-y-5">
          {/* KPI cards */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {customersOn && (
              <StatCard
                icon={<Building2 className="h-5 w-5" />}
                tone="green"
                label={t("dashboard.kpiCustomers")}
                value={customersCountQ.data ?? 0}
              />
            )}
            {slOn && (
              <>
                <StatCard
                  icon={<PackageOpen className="h-5 w-5" />}
                  tone="blue"
                  label={t("dashboard.kpiDevicesInStock")}
                  value={deviceCountsQ.data?.in_stock ?? 0}
                  sub={t("dashboard.nInstalled", { count: deviceCountsQ.data?.installed ?? 0 })}
                />
                <StatCard
                  icon={<Wrench className="h-5 w-5" />}
                  tone="violet"
                  label={t("dashboard.kpiOpenJobs")}
                  value={openJobs}
                  sub={t("dashboard.nScheduled", { count: jobCounts?.scheduled ?? 0 })}
                />
              </>
            )}
            {certsOn && (
              <StatCard
                icon={<Award className="h-5 w-5" />}
                tone="amber"
                label={t("dashboard.kpiValidCerts")}
                value={validCertsQ.data ?? 0}
                sub={t("dashboard.nExpiring60", { count: expiringCountQ.data ?? 0 })}
                subTone={(expiringCountQ.data ?? 0) > 0 ? "warn" : "muted"}
              />
            )}
          </div>

          <InsightsStrip insights={insights} />

          {/* Installations trend + device stock */}
          {slOn && (
            <div className="grid gap-4 xl:grid-cols-3">
              <Card className="p-5 xl:col-span-2">
                <h2 className="mb-4 text-sm font-semibold text-ink">
                  {t("dashboard.installationsTrend")}
                </h2>
                <div dir="ltr">
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={trendQ.data ?? []} barCategoryGap="28%">
                      <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
                      <XAxis dataKey="month" tick={TICK_STYLE} tickLine={false} axisLine={false} />
                      <YAxis
                        tick={TICK_STYLE}
                        tickLine={false}
                        axisLine={false}
                        width={32}
                        allowDecimals={false}
                      />
                      <Tooltip cursor={{ fill: CURSOR_FILL }} contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} itemStyle={TOOLTIP_ITEM_STYLE} />
                      <Bar
                        dataKey="installs"
                        name={t("dashboard.installationsTrend")}
                        fill={INSTALL_COLOR}
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <Card className="p-5">
                <h2 className="text-sm font-semibold text-ink">{t("dashboard.deviceStock")}</h2>
                <div className="relative mx-auto mt-2 h-[190px] max-w-[220px]">
                  <div dir="ltr" className="h-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={deviceData}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={62}
                          outerRadius={88}
                          paddingAngle={2}
                          stroke="var(--color-surface)"
                          strokeWidth={2}
                        >
                          {deviceData.map((d) => (
                            <Cell key={d.key} fill={d.color} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} itemStyle={TOOLTIP_ITEM_STYLE} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-[26px] font-bold leading-none tracking-tight text-ink tabular-nums">
                      {deviceTotal}
                    </span>
                    <span className="mt-1 text-xs text-ink-3">{t("dashboard.devicesLabel")}</span>
                  </div>
                </div>
                <ul className="mt-4 space-y-2.5">
                  {deviceData.map((d) => {
                    const pct =
                      deviceTotal > 0 ? Math.round((d.value / deviceTotal) * 1000) / 10 : 0;
                    return (
                      <li key={d.key} className="flex items-center gap-2 text-sm text-ink-2">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: d.color }}
                        />
                        <span className="truncate">{d.name}</span>
                        <span className="ms-auto font-semibold text-ink tabular-nums">
                          {d.value}
                        </span>
                        <span className="w-12 text-end text-xs text-ink-3 tabular-nums">
                          {pct}%
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            </div>
          )}

          {/* Upcoming jobs (with pipeline) + customers at risk */}
          <div className="grid gap-4 lg:grid-cols-2">
            {slOn && (
              <ListCard title={t("dashboard.upcomingJobs")} viewAll="/speed-limiters/jobs">
                <div className="flex flex-wrap gap-x-5 gap-y-2 border-b border-line px-5 py-3">
                  {PIPELINE.map(({ status, labelKey, dot }) => (
                    <span key={status} className="flex items-center gap-1.5 text-xs text-ink-2">
                      <span className={`h-2 w-2 rounded-full ${dot}`} />
                      {t(labelKey)}
                      <span className="font-semibold text-ink tabular-nums">
                        {jobCounts?.[status] ?? 0}
                      </span>
                    </span>
                  ))}
                </div>
                {upcoming.length === 0 ? (
                  <div className="px-5 py-10 text-center text-sm text-ink-3">
                    {t("dashboard.noUpcomingJobs")}
                  </div>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {upcoming.map((j) => (
                      <li key={j.id} className="flex items-center justify-between gap-3 px-5 py-3">
                        <div className="min-w-0">
                          <Link
                            to={`/speed-limiters/jobs/${j.id}`}
                            className="block truncate text-sm font-medium text-brand-700 hover:underline"
                          >
                            #{j.number} · {j.customers?.name ?? t("common.dash")}
                          </Link>
                          <div className="truncate text-xs text-ink-3">
                            {j.vehicles?.name ?? t("common.dash")}
                            {j.scheduled_date ? ` · ${formatDate(j.scheduled_date)}` : ""}
                          </div>
                        </div>
                        <Badge tone={j.status === "in_progress" ? "yellow" : "blue"}>
                          {t(`speedLimiters.jobStatus.${j.status}` as MessageKey)}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </ListCard>
            )}

            {certsOn && (
              <ListCard title={t("dashboard.customersAtRisk")} viewAll="/customers">
                {atRisk.length === 0 ? (
                  <div className="px-5 py-10 text-center text-sm text-ink-3">
                    {t("dashboard.noCustomersAtRisk")}
                  </div>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {atRisk.map((c) => (
                      <li
                        key={c.key}
                        className="flex items-center justify-between gap-3 px-5 py-3"
                      >
                        <div className="min-w-0">
                          {c.id ? (
                            <Link
                              to={`/customers/${c.id}`}
                              className="block truncate text-sm font-medium text-brand-700 hover:underline"
                            >
                              {c.name}
                            </Link>
                          ) : (
                            <div className="truncate text-sm font-medium text-ink">{c.name}</div>
                          )}
                          <div className="truncate text-xs text-ink-3">
                            {formatDate(c.soonest)}
                          </div>
                        </div>
                        <Badge tone="yellow">
                          {t("dashboard.nCertsExpiring", { count: c.count })}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </ListCard>
            )}
          </div>

          {/* Expiring certificates + activity */}
          <div className="grid gap-4 lg:grid-cols-2">
            {certsOn && (
              <ListCard title={t("dashboard.slCertsTitle")} viewAll="/speed-limiters/certificates">
                {expiring.length === 0 ? (
                  <div className="px-5 py-10 text-center text-sm text-ink-3">
                    {t("dashboard.nothingDue")}
                  </div>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {expiring.slice(0, 6).map((c) => {
                      const days = daysUntil(c.expires_at);
                      return (
                        <li
                          key={c.id}
                          className="flex items-center justify-between gap-3 px-5 py-3"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-ink">
                              {c.certificate_number}
                            </div>
                            <div className="truncate text-xs text-ink-3">
                              {[c.customers?.name, c.vehicles?.name, formatDate(c.expires_at)]
                                .filter(Boolean)
                                .join(" · ")}
                            </div>
                          </div>
                          <Badge tone={days <= 30 ? "red" : "yellow"}>
                            {days === 0
                              ? t("dashboard.dueToday")
                              : t("dashboard.dueInDays", { count: days })}
                          </Badge>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </ListCard>
            )}

            <ActivityCard />
          </div>

          {/* Compact own-fleet strip — only when the provider runs company vehicles */}
          {(fleetCountsQ.data?.company ?? 0) > 0 && (
            <Card className="flex flex-wrap items-center gap-x-8 gap-y-3 p-5">
              <div className="flex items-center gap-2.5">
                <Truck className="h-4.5 w-4.5 text-ink-3" />
                <span className="text-sm font-semibold text-ink">{t("dashboard.ownFleet")}</span>
              </div>
              <div className="flex flex-wrap items-center gap-x-8 gap-y-2 text-sm text-ink-2">
                <span>
                  <span className="me-1.5 font-bold text-ink tabular-nums">
                    {fleetCountsQ.data?.company ?? 0}
                  </span>
                  {t("dashboard.vehiclesLabel")}
                </span>
                <span>{t("dashboard.nActive", { count: fleetCountsQ.data?.active ?? 0 })}</span>
                {issuesOn && (
                  <span>
                    <span className="me-1.5 font-bold text-ink tabular-nums">
                      {issuesCountQ.data ?? 0}
                    </span>
                    {t("dashboard.openIssues")}
                  </span>
                )}
                {maintenanceOn && (
                  <span>
                    <span className="me-1.5 font-bold text-ink tabular-nums">
                      {wosCountQ.data ?? 0}
                    </span>
                    {t("dashboard.openWorkOrders")}
                  </span>
                )}
              </div>
              <Link
                to="/vehicles"
                className="ms-auto text-xs font-medium text-brand-700 hover:underline"
              >
                {t("dashboard.viewAll")}
              </Link>
            </Card>
          )}
        </div>
      )}
    </>
  );
}
