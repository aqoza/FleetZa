import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { listRows } from "../../lib/db";
import { formatDate, formatDateTime } from "../../lib/format";
import { timelineBar } from "../../../shared/dispatch";
import { useTenant } from "../../context/AuthContext";
import { useT } from "../../i18n";
import { Bdi, Button, Card, EmptyState, ErrorState, LoadingState, Ltr } from "../../components/ui";
import { dayInTz, dayStartMs, driverName } from "./labels";
import { JOB_SELECT, type DispatchJob } from "./types";

const DAY = 86_400_000;
const HOURS = [0, 3, 6, 9, 12, 15, 18, 21];

const barTone: Record<DispatchJob["status"], string> = {
  new: "bg-ink-3/30 text-ink",
  assigned: "bg-chart-1 text-white",
  en_route: "bg-chart-2 text-white",
  on_site: "bg-warn text-white",
  completed: "bg-good text-white",
  canceled: "bg-serious text-white",
};

/** Shift a YYYY-MM-DD day by n days (calendar arithmetic, zone-free). */
function shiftDay(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
}

export default function TodayPage() {
  const t = useT();
  const tenant = useTenant();
  const tz = tenant.timezone;
  const today = dayInTz(Date.now(), tz);
  const [day, setDay] = useState(today);
  const start = dayStartMs(day, tz);
  const end = dayStartMs(shiftDay(day, 1), tz);

  const q = useQuery({
    queryKey: ["dispatch_jobs", "day", day, tz],
    refetchInterval: day === today ? 60_000 : false,
    queryFn: () =>
      listRows<DispatchJob>("dispatch_jobs", (b) =>
        b.select(JOB_SELECT).neq("status", "canceled")
          .lt("window_start", new Date(end).toISOString()).gt("window_end", new Date(start).toISOString())
          .order("window_start").limit(500),
      ),
  });

  const rows = useMemo(() => {
    const byVehicle = new Map<string, { id: string; name: string; jobs: DispatchJob[] }>();
    const unassigned: DispatchJob[] = [];
    for (const j of q.data ?? []) {
      if (!j.vehicle_id || !j.vehicle) {
        unassigned.push(j);
        continue;
      }
      const r = byVehicle.get(j.vehicle_id) ?? { id: j.vehicle_id, name: j.vehicle.name, jobs: [] as DispatchJob[] };
      r.jobs.push(j);
      byVehicle.set(j.vehicle_id, r);
    }
    const list = [...byVehicle.values()].sort((a, b) => a.name.localeCompare(b.name));
    return { list, unassigned };
  }, [q.data]);

  // Bars are scaled to the real length of the day (23 or 25 h on DST changes).
  const span = end - start;
  const bar = (j: DispatchJob) => {
    const b = timelineBar(j.window_start, j.window_end, start);
    if (!b) return null;
    const scale = DAY / span;
    return { left: Math.min(b.left * scale, 100), width: Math.min(b.width * scale, 100 - b.left * scale) };
  };
  const nowPct = Date.now() >= start && Date.now() < end ? ((Date.now() - start) / span) * 100 : null;
  const dateLabel = formatDate(new Date(start + span / 2).toISOString(), tz);

  const renderRow = (key: string, label: ReactNode, jobs: DispatchJob[]) => (
    <div key={key} className="grid grid-cols-[7rem_1fr] items-center gap-2 border-t border-line py-2 sm:grid-cols-[10rem_1fr]">
      <div className="min-w-0 truncate text-sm text-ink">{label}</div>
      <div dir="ltr" className="relative h-8 rounded-md bg-canvas">
        {HOURS.map((h) => (
          <span key={h} className="absolute inset-y-0 border-s border-line" style={{ left: `${(h / 24) * 100}%` }} />
        ))}
        {nowPct != null && <span className="absolute inset-y-0 z-10 w-0.5 bg-serious" style={{ left: `${nowPct}%` }} />}
        {jobs.map((j) => {
          const b = bar(j);
          if (!b) return null;
          const who = driverName(j.driver);
          return (
            <Link
              key={j.id}
              to={`/dispatch/jobs/${j.id}`}
              title={`${j.doc_number} · ${j.title}${who ? ` · ${who}` : ""}\n${formatDateTime(j.window_start, tz)} – ${formatDateTime(j.window_end, tz)}\n${t(`dispatch.status.${j.status}`)}`}
              className={`absolute inset-y-1 overflow-hidden rounded px-1 text-[11px] font-medium leading-6 whitespace-nowrap hover:opacity-90 ${barTone[j.status]}`}
              style={{ left: `${b.left}%`, width: `${b.width}%` }}
            >
              {j.doc_number}
            </Link>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={() => setDay(shiftDay(day, -1))} aria-label={t("pagination.prev")}>
          <ChevronLeft className="h-4 w-4 rtl:-scale-x-100" />
        </Button>
        <Button variant="secondary" onClick={() => setDay(today)} disabled={day === today}>
          {t("dispatch.tab.today")}
        </Button>
        <Button variant="secondary" onClick={() => setDay(shiftDay(day, 1))} aria-label={t("pagination.next")}>
          <ChevronRight className="h-4 w-4 rtl:-scale-x-100" />
        </Button>
        <h2 className="ms-2 text-base font-semibold text-ink">{t("dispatch.todayTitle", { date: dateLabel })}</h2>
      </div>
      {q.isLoading && <LoadingState />}
      {q.error && <ErrorState message={(q.error as Error).message} />}
      {q.data && (
        <Card className="p-4">
          {q.data.length === 0 ? (
            <EmptyState icon={<CalendarDays className="h-10 w-10" />} title={t("dispatch.todayEmpty")} />
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[36rem]">
                <div className="grid grid-cols-[7rem_1fr] gap-2 pb-1 sm:grid-cols-[10rem_1fr]">
                  <span />
                  <div dir="ltr" className="relative h-4 text-[11px] text-ink-3">
                    {HOURS.map((h) => (
                      <span key={h} className="absolute -translate-x-1/2 first:translate-x-0" style={{ left: `${(h / 24) * 100}%` }}>
                        {`${String(h).padStart(2, "0")}:00`}
                      </span>
                    ))}
                  </div>
                </div>
                {rows.list.map((r) => renderRow(r.id, <Bdi>{r.name}</Bdi>, r.jobs))}
                {rows.unassigned.length > 0 && renderRow("unassigned", <span className="text-ink-3">{t("dispatch.unassignedRow")}</span>, rows.unassigned)}
                {nowPct != null && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-3">
                    <span className="inline-block h-3 w-0.5 bg-serious" /> {t("dispatch.now")} <Ltr>{formatDateTime(new Date().toISOString(), tz)}</Ltr>
                  </p>
                )}
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
