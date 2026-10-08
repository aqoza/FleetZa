import type { BadgeTone } from "../../components/ui";
import type { StopStatus, TripStatus } from "../../../shared/trips";

export const statusTone: Record<TripStatus, BadgeTone> = {
  planned: "slate",
  dispatched: "blue",
  in_progress: "yellow",
  completed: "green",
  canceled: "red",
};

export const stopTone: Record<StopStatus, BadgeTone> = {
  pending: "slate",
  arrived: "blue",
  departed: "green",
  skipped: "yellow",
};

export const TRIP_STATUSES: TripStatus[] = ["planned", "dispatched", "in_progress", "completed", "canceled"];

/** Validated pair: chart-2 (teal) for planned, chart-1 (blue) for actual. */
export const SERIES_PLANNED = "#0d9488";
export const SERIES_ACTUAL = "#1d67f1";

export const driverName = (d: { first_name: string; last_name: string } | null) =>
  d ? `${d.first_name} ${d.last_name}`.trim() : null;

/** YYYY-MM-DD of an instant in a time zone. */
export function dayInTz(iso: string | number | Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

/** HH:MM of an instant in a time zone, in the given locale. */
export function timeInTz(iso: string, timeZone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

/** ISO instant → value for a datetime-local input (browser time, like the rest of the app). */
export function toInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

/** datetime-local value → ISO instant. */
export function fromInput(v: string): string | null {
  return v ? new Date(v).toISOString() : null;
}
