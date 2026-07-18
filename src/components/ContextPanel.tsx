import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
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
import { listRows } from "../lib/db";
import { daysUntil, formatDate, formatDateTime } from "../lib/format";
import { getRecent, type RecentEntity } from "../lib/recent";
import type { Renewal, SpeedLimiterCertificate } from "../lib/types";
import { useAuth } from "../context/AuthContext";
import { useModules } from "../context/ModulesContext";
import { Badge } from "./ui";
import { useT } from "../i18n";

const COLLAPSE_KEY = "fm.contextPanel";

type RenewalRow = Renewal & { vehicles: { name: string } | null };
type CertRow = SpeedLimiterCertificate & { vehicles: { name: string } | null };

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
  const horizon = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);

  const dueRenewalsQ = useQuery({
    queryKey: ["renewals", "panel", "due"],
    enabled: renewalsOn && active,
    queryFn: () =>
      listRows<RenewalRow>("renewals", (q) =>
        q
          .select("*, vehicles(name)")
          .is("completed_at", null)
          .lte("due_date", horizon)
          .order("due_date")
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
          .eq("status", "valid")
          .lte("expires_at", horizon)
          .order("expires_at")
          .limit(4),
      ),
  });

  type AuditRow = { id: number; table_name: string; action: string; at: string };
  const activityQ = useQuery({
    queryKey: ["audit_events", "dashboard"],
    enabled: isAdmin && active,
    queryFn: () =>
      listRows<AuditRow>("audit_events", (q) => q.order("at", { ascending: false }).limit(8)),
  });
  const dueLoading = dueRenewalsQ.isLoading || dueCertsQ.isLoading;

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
      to: "/renewals",
    })),
    ...(dueCertsQ.data ?? []).map((c) => ({
      key: `c:${c.id}`,
      icon: Award,
      label: c.certificate_number,
      meta: c.vehicles?.name ?? "",
      days: daysUntil(c.expires_at),
      date: c.expires_at,
      to: "/speed-limiters/certificates",
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
          ) : dueItems.length === 0 ? (
            <p className="px-1 text-sm text-ink-3">{t("dashboard.nothingDue")}</p>
          ) : (
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
