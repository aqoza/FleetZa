import type { BadgeTone } from "../../components/ui";
import type { JobPriority, JobStatus } from "../../../shared/dispatch";
import { useT, useTp } from "../../i18n";

export const statusTone: Record<JobStatus, BadgeTone> = {
  new: "slate",
  assigned: "blue",
  en_route: "purple",
  on_site: "yellow",
  completed: "green",
  canceled: "red",
};

export const priorityTone: Record<JobPriority, BadgeTone> = {
  urgent: "red",
  high: "yellow",
  normal: "slate",
  low: "slate",
};

export const JOB_STATUSES: JobStatus[] = ["new", "assigned", "en_route", "on_site", "completed", "canceled"];

export const driverName = (d: { first_name: string; last_name: string } | null) =>
  d ? `${d.first_name} ${d.last_name}`.trim() : null;

/** "45 minutes", "2 h 10 min", "3 days" in the UI language. */
export function useDuration() {
  const t = useT();
  const tp = useTp();
  return (minutes: number): string => {
    const m = Math.max(0, Math.round(minutes));
    if (m < 60) return tp("dispatch.dur.minutes", m);
    if (m < 48 * 60) return t("dispatch.dur.hours", { h: Math.floor(m / 60), m: m % 60 });
    return tp("dispatch.dur.days", Math.floor(m / 1440));
  };
}

/** YYYY-MM-DD of an instant in a time zone. */
export function dayInTz(iso: string | number | Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

/** Epoch ms of local midnight for a YYYY-MM-DD day in a time zone. */
export function dayStartMs(day: string, timeZone: string): number {
  const utc = Date.parse(`${day}T00:00:00Z`);
  // Offset of the zone at that instant: format UTC midnight in the zone and diff.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(utc));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asLocal = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return utc - (asLocal - utc);
}

/** ISO instant → value for a datetime-local input (browser time, like the rest of the app). */
export function toInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export function fromInput(v: string): string | null {
  return v ? new Date(v).toISOString() : null;
}
