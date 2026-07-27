import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { addDays, format } from "date-fns";
import {
  Activity,
  AlertTriangle,
  Award,
  Building2,
  Clock,
  Fuel,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  ShieldCheck,
  Truck,
  Wrench,
} from "lucide-react";
import { countRows, listRows } from "../lib/db";
import { certificateBucket } from "../lib/certificateStatus";
import { daysUntil, formatDate, formatDateTime } from "../lib/format";
import { getRecent, type RecentEntity } from "../lib/recent";
import type { Renewal, SpeedLimiterCertificate } from "../lib/types";
import { useAuth } from "../context/AuthContext";
import { useModules } from "../context/ModulesContext";
import { Badge } from "./ui";
import { useT } from "../i18n";

const COLLAPSE_KEY = "fm.contextPanel";

/** A date-only bound `offset` days from today, in the viewer's local calendar. */
const day = (offset: number) => format(addDays(new Date(), offset), "yyyy-MM-dd");

/**
 * The actionable window for "due soon": recently lapsed (still worth chasing
 * this week) through the 60-day horizon.
 *
 * Both due queries used to have an upper bound only. Ordered ascending by date
 * that returns the OLDEST rows in the tenant, not the nearest ones — for a fleet
 * whose paper register was bulk-imported that meant four 2022 certificates
 * pinned to the panel forever, with the handful genuinely due this month sitting
 * hundreds of rows behind them. The lower bound is what makes the list current;
 * the backlog it excludes is counted in the footer instead of being hidden.
 */
const LOOKBACK_DAYS = 30;
const HORIZON_DAYS = 60;

type RenewalRow = Renewal & { vehicles: { name: string } | null };
type CertRow = SpeedLimiterCertificate & { vehicles: { name: string } | null };

/**
 * Where a due certificate actually lives on the certificates list.
 *
 * Linking every item at the bare list was the backlog bug one click later:
 * that list opens on `?filter=all` ordered by expiry ascending, so a
 * certificate due in six days sits hundreds of rows behind the 2022 imports
 * and the user lands on exactly the register the panel was fixed to bypass.
 *
 * `certificateBucket` is the same predicate set the list's chips are built
 * from (`expired`, `d30`, `d60`, `d90`), so the row that was clicked is on the
 * first page of the destination: forward-looking filters read soonest-first,
 * and `expired` reads most-recently-lapsed first. `ok` (>90 days) can only
 * appear if the panel's horizon is widened later; it maps to the `valid` chip.
 */
function certificateHref(cert: CertRow): string {
  const bucket = certificateBucket(cert);
  const filter = bucket === "ok" ? "valid" : bucket;
  return `/speed-limiters/certificates?filter=${filter}`;
}

function SectionHeading({ children }: { children: string }) {
  return (
    <div className="px-1 pb-2 pt-5 text-[11px] font-semibold uppercase tracking-wider text-ink-3 rtl:tracking-normal first:pt-0">
      {children}
    </div>
  );
}

/**
 * Right-hand workspace rail for large displays (2xl+): quick actions, what's
 * due soon, recently viewed, and (for admins) the latest audit activity.
 * Everything is real data; sections gate on the tenant's modules.
 */
export function ContextPanel() {
  const t = useT();
  const { isAdmin } = useAuth();
  const { isEnabled } = useModules();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [recent, setRecent] = useState<RecentEntity[]>([]);

  const renewalsOn = isEnabled("renewals");
  const certsOn = isEnabled("sl_certificates");
  const fuelOn = isEnabled("fuel");
  const slOn = isEnabled("speed_limiters");
  const customersOn = isEnabled("customers");

  // The panel is display-hidden below 2xl — don't spend queries there.
  const [isWide, setIsWide] = useState(() => {
    try {
      return window.matchMedia("(min-width: 1536px)").matches;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1536px)");
    const onChange = (e: MediaQueryListEvent) => setIsWide(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Refresh the recently-viewed list whenever the route changes.
  useEffect(() => {
    setRecent(getRecent());
  }, [location.pathname]);

  const active = isWide && !collapsed;

  const dueRenewalsQ = useQuery({
    queryKey: ["renewals", "panel", "due"],
    enabled: renewalsOn && active,
    queryFn: () =>
      listRows<RenewalRow>("renewals", (q) =>
        q
          .select("*, vehicles(name)")
          .is("completed_at", null)
          .gte("due_date", day(-LOOKBACK_DAYS))
          .lte("due_date", day(HORIZON_DAYS))
          .order("due_date", { ascending: true })
          .limit(4),
      ),
  });

  const dueCertsQ = useQuery({
    queryKey: ["speed_limiter_certificates", "panel", "due"],
    enabled: certsOn && active,
    queryFn: () =>
      listRows<CertRow>("speed_limiter_certificates", (q) =>
        q
          .select("*, vehicles(name)")
          // "Live" — the one certificate the vehicle currently carries. A
          // predecessor that a renewal already replaced is history, never work.
          .is("superseded_by", null)
          .eq("status", "valid")
          .gte("expires_at", day(-LOOKBACK_DAYS))
          .lte("expires_at", day(HORIZON_DAYS))
          .order("expires_at", { ascending: true })
          .limit(4),
      ),
  });

  /**
   * The renewal backlog the window above deliberately leaves out. Head-only
   * counts — no rows cross the wire — and the same predicates the certificates
   * list uses for `?filter=expired`, so the number and its destination agree.
   */
  const certBacklogQ = useQuery({
    queryKey: ["speed_limiter_certificates", "panel", "backlog"],
    enabled: certsOn && active,
    queryFn: () =>
      countRows("speed_limiter_certificates", (q) =>
        q.is("superseded_by", null).eq("status", "valid").lt("expires_at", day(0)),
      ),
  });

  const renewalBacklogQ = useQuery({
    queryKey: ["renewals", "panel", "backlog"],
    enabled: renewalsOn && active,
    queryFn: () =>
      countRows("renewals", (q) => q.is("completed_at", null).lt("due_date", day(0))),
  });

  type AuditRow = { id: number; table_name: string; action: string; at: string };
  const activityQ = useQuery({
    queryKey: ["audit_events", "dashboard"],
    enabled: isAdmin && active,
    queryFn: () =>
      listRows<AuditRow>("audit_events", (q) => q.order("at", { ascending: false }).limit(8)),
  });
  const dueLoading = dueRenewalsQ.isLoading || dueCertsQ.isLoading;
  const certBacklog = certBacklogQ.data ?? 0;
  const renewalBacklog = renewalBacklogQ.data ?? 0;

  function toggle() {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !c;
    });
  }

  const quickActions = [
    { on: true, to: "/vehicles", icon: Truck, label: t("vehicles.add") },
    { on: fuelOn, to: "/fuel", icon: Fuel, label: t("fuel.logFuel") },
    { on: customersOn, to: "/customers", icon: Building2, label: t("customers.newCustomer") },
    { on: slOn, to: "/speed-limiters/jobs", icon: Wrench, label: t("slJobs.newJob") },
  ].filter((a) => a.on);

  const dueItems = [
    ...(dueRenewalsQ.data ?? []).map((r) => ({
      key: `r:${r.id}`,
      icon: ShieldCheck,
      label: r.name || t(`enum.renewalType.${r.renewal_type}` as Parameters<typeof t>[0]),
      meta: r.vehicles?.name ?? "",
      days: daysUntil(r.due_date),
      date: r.due_date,
      // The renewals list has no URL-driven filter (its status select is local
      // state defaulting to "pending", which is where these rows already are),
      // so there is no narrower destination to send an overdue renewal to.
      to: "/renewals",
    })),
    ...(dueCertsQ.data ?? []).map((c) => ({
      key: `c:${c.id}`,
      icon: Award,
      label: c.certificate_number,
      meta: c.vehicles?.name ?? "",
      days: daysUntil(c.expires_at),
      date: c.expires_at,
      to: certificateHref(c),
    })),
  ]
    .sort((a, b) => a.days - b.days)
    .slice(0, 5);

  if (collapsed) {
    return (
      <div className="hidden shrink-0 border-s border-line bg-surface px-1.5 py-3 print:hidden 2xl:block">
        <button
          onClick={toggle}
          aria-label={t("panel.show")}
          title={t("panel.show")}
          className="rounded-lg p-2 text-ink-3 hover:bg-canvas hover:text-ink"
        >
          <PanelRightOpen className="h-4.5 w-4.5 rtl:-scale-x-100" />
        </button>
      </div>
    );
  }

  return (
    <aside className="hidden w-72 shrink-0 overflow-y-auto border-s border-line bg-surface p-4 print:hidden 2xl:block">
      <div className="flex items-center justify-between">
        <SectionHeading>{t("panel.quickActions")}</SectionHeading>
        <button
          onClick={toggle}
          aria-label={t("panel.hide")}
          title={t("panel.hide")}
          className="rounded-lg p-1.5 text-ink-3 hover:bg-canvas hover:text-ink"
        >
          <PanelRightClose className="h-4 w-4 rtl:-scale-x-100" />
        </button>
      </div>
      <div className="space-y-1">
        {quickActions.map(({ to, icon: Icon, label }) => (
          <Link
            key={to + label}
            to={to}
            className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm font-medium text-ink-2 transition-colors hover:bg-canvas hover:text-ink"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-50 text-brand-600">
              <Plus className="h-3.5 w-3.5" />
            </span>
            {label}
            <Icon className="ms-auto h-4 w-4 text-ink-3" />
          </Link>
        ))}
      </div>

      {(renewalsOn || certsOn) && (
        <>
          <SectionHeading>{t("panel.dueSoon")}</SectionHeading>
          {dueLoading ? (
            <p className="px-1 text-sm text-ink-3">{t("common.loading")}</p>
          ) : (
            <>
              {/* "Nothing due" only when there is genuinely nothing — an empty
                  window over a large backlog is the lie this panel used to tell. */}
              {dueItems.length === 0 && certBacklog === 0 && renewalBacklog === 0 && (
                <p className="px-1 text-sm text-ink-3">{t("dashboard.nothingDue")}</p>
              )}
              {dueItems.length > 0 && (
                <ul className="space-y-1">
                  {dueItems.map((item) => (
                    <li key={item.key}>
                      <Link
                        to={item.to}
                        className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-canvas"
                      >
                        <item.icon className="h-4 w-4 shrink-0 text-ink-3" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-ink">
                            {item.label}
                          </span>
                          <span className="block truncate text-xs text-ink-3">
                            {[item.meta, formatDate(item.date)].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                        <Badge tone={item.days < 0 ? "red" : item.days <= 30 ? "yellow" : "slate"}>
                          {item.days < 0
                            ? t("dashboard.overdue")
                            : t("dashboard.dueInDays", { count: item.days })}
                        </Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {certBacklog > 0 && (
                <Link
                  to="/speed-limiters/certificates?filter=expired"
                  className="mt-1 flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-medium text-ink-3 transition-colors hover:bg-canvas hover:text-brand-700"
                >
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warn" />
                  <span className="truncate tabular-nums">
                    {t("panel.certBacklog", { count: certBacklog })}
                  </span>
                </Link>
              )}
              {renewalBacklog > 0 && (
                <Link
                  to="/renewals"
                  className="mt-1 flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-medium text-ink-3 transition-colors hover:bg-canvas hover:text-brand-700"
                >
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warn" />
                  <span className="truncate tabular-nums">
                    {t("panel.renewalBacklog", { count: renewalBacklog })}
                  </span>
                </Link>
              )}
            </>
          )}
        </>
      )}

      {recent.length > 0 && (
        <>
          <SectionHeading>{t("search.recent")}</SectionHeading>
          <ul className="space-y-0.5">
            {recent.slice(0, 5).map((r) => (
              <li key={r.path}>
                <Link
                  to={r.path}
                  className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-ink-2 transition-colors hover:bg-canvas hover:text-ink"
                >
                  <Clock className="h-4 w-4 shrink-0 text-ink-3" />
                  <span className="truncate">{r.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      {isAdmin && (activityQ.data?.length ?? 0) > 0 && (
        <>
          <SectionHeading>{t("dashboard.recentActivity")}</SectionHeading>
          <ul className="space-y-1">
            {(activityQ.data ?? []).slice(0, 4).map((a) => (
              <li key={a.id} className="flex items-center gap-2.5 px-2 py-1">
                <Activity className="h-4 w-4 shrink-0 text-ink-3" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-ink-2">
                    {t(`dashboard.entity.${a.table_name}` as Parameters<typeof t>[0])}
                  </span>
                  <span className="block truncate text-xs text-ink-3">
                    {formatDateTime(a.at)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}
