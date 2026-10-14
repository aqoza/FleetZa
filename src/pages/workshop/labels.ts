import type { BadgeTone } from "../../components/ui";
import type { BayStatus, BookingStatus } from "../../../shared/workshop";

export const bayTone: Record<BayStatus, BadgeTone> = {
  available: "green",
  occupied: "purple",
  out_of_service: "red",
};

export const bookingTone: Record<BookingStatus, BadgeTone> = {
  scheduled: "blue",
  in_progress: "purple",
  done: "green",
  canceled: "slate",
};

/** Timeline bar fill per status (chart palette for the live ones). */
export const bookingBar: Record<BookingStatus, string> = {
  scheduled: "bg-chart-1 text-white",
  in_progress: "bg-chart-2 text-white",
  done: "bg-line text-ink-2",
  canceled: "bg-canvas text-ink-3 line-through",
};

export const personName = (p: { first_name: string; last_name: string | null } | null) =>
  p ? `${p.first_name} ${p.last_name ?? ""}`.trim() : "";

/** YYYY-MM-DD of now in a time zone. */
export function todayInTz(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** Offset (ms) of a time zone from UTC at a given instant. */
function tzOffsetMs(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - at.getTime();
}

/** The instant a wall-clock time (YYYY-MM-DD, hour) happens in a time zone. */
export function zonedInstant(day: string, hour: number, timeZone: string): Date {
  const guess = new Date(`${day}T${String(hour).padStart(2, "0")}:00:00Z`);
  return new Date(guess.getTime() - tzOffsetMs(timeZone, guess));
}

/** ISO timestamp → value for <input type="datetime-local"> in the browser's zone. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const fromLocalInput = (v: string): string | null => (v ? new Date(v).toISOString() : null);

/** Hour:minute in a time zone. */
export function clockTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, { timeZone, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}
