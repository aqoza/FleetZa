import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Activity } from "lucide-react";
import { listRows } from "../../lib/db";
import { formatDateTime } from "../../lib/format";
import { useAuth } from "../../context/AuthContext";
import { Badge, Card, ErrorState } from "../../components/ui";
import { useT, type MessageKey } from "../../i18n";

/** Chart chrome shared by both dashboards (docs/DESIGN_SYSTEM.md §5). */
export const GRID_STROKE = "#e6e9f0";
export const TICK_STYLE = { fill: "#94a3b8", fontSize: 12 };

export function ListCard({
  title,
  viewAll,
  children,
}: {
  title: string;
  viewAll?: string;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <Card>
      <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {viewAll && (
          <Link to={viewAll} className="text-xs font-medium text-brand-700 hover:underline">
            {t("dashboard.viewAll")}
          </Link>
        )}
      </div>
      {children}
    </Card>
  );
}

export function NothingDue() {
  const t = useT();
  return (
    <div className="px-5 py-10 text-center text-sm text-ink-3">{t("dashboard.nothingDue")}</div>
  );
}

type AuditRow = {
  id: number;
  table_name: string;
  action: "insert" | "update" | "delete";
  at: string;
  diff: Record<string, unknown> | null;
};

/** Audited tables → entity label keys (mirror of the audit trigger list). */
const AUDIT_ENTITY_KEYS: Record<string, MessageKey> = {
  vehicles: "dashboard.entity.vehicles",
  customers: "dashboard.entity.customers",
  contacts: "dashboard.entity.contacts",
  drivers: "dashboard.entity.drivers",
  sl_devices: "dashboard.entity.sl_devices",
  sl_technicians: "dashboard.entity.sl_technicians",
  sl_jobs: "dashboard.entity.sl_jobs",
  speed_limiter_installations: "dashboard.entity.speed_limiter_installations",
  speed_limiter_certificates: "dashboard.entity.speed_limiter_certificates",
  work_orders: "dashboard.entity.work_orders",
  renewals: "dashboard.entity.renewals",
};

const ACTION_TONE: Record<AuditRow["action"], "green" | "blue" | "red"> = {
  insert: "green",
  update: "blue",
  delete: "red",
};

/** Best human identifier available in an audit row's diff payload. */
function auditName(diff: Record<string, unknown> | null): string | null {
  if (!diff) return null;
  for (const key of ["name", "certificate_number", "serial", "title", "task", "first_name"]) {
    const v = diff[key];
    if (typeof v === "string" && v) return v;
  }
  return null;
}

/**
 * Recent-activity card fed by the append-only audit_events table.
 * RLS restricts it to admins; renders nothing for other roles.
 */
export function ActivityCard() {
  const t = useT();
  const { isAdmin } = useAuth();

  const activityQ = useQuery({
    queryKey: ["audit_events", "dashboard"],
    queryFn: () =>
      listRows<AuditRow>("audit_events", (q) => q.order("at", { ascending: false }).limit(8)),
    enabled: isAdmin,
  });

  if (!isAdmin) return null;
  const activity = activityQ.data ?? [];

  return (
    <ListCard title={t("dashboard.recentActivity")}>
      {activityQ.isLoading ? (
        <div className="px-5 py-10 text-center text-sm text-ink-3">{t("common.loading")}</div>
      ) : activityQ.error ? (
        <div className="px-5 py-4">
          <ErrorState message={(activityQ.error as Error).message} />
        </div>
      ) : activity.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-ink-3">
          {t("dashboard.noActivity")}
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {activity.map((a) => {
            const entityKey = AUDIT_ENTITY_KEYS[a.table_name];
            const name = auditName(a.diff);
            return (
              <li key={a.id} className="flex items-center gap-3 px-5 py-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-canvas text-ink-3">
                  <Activity className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink">
                    {entityKey ? t(entityKey) : a.table_name}
                    {name ? ` · ${name}` : ""}
                  </div>
                  <div className="truncate text-xs text-ink-3">{formatDateTime(a.at)}</div>
                </div>
                <Badge tone={ACTION_TONE[a.action]}>{t(`dashboard.activity.${a.action}`)}</Badge>
              </li>
            );
          })}
        </ul>
      )}
    </ListCard>
  );
}
