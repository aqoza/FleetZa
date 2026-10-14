/**
 * Workshop (module `workshop`) — pure helpers for the SPA. The booking status
 * table and the overlap rule mirror app.workshop_booking_guard() in migration
 * 20261008000022_workshop.sql; labor hours mirror app.work_order_labor_guard().
 * Change both together.
 */

export type BayType = "general" | "lift" | "inspection" | "wash" | "tire" | "paint" | "electrical";
export type BayStatus = "available" | "occupied" | "out_of_service";
export type BookingStatus = "scheduled" | "in_progress" | "done" | "canceled";

export const BAY_TYPES: BayType[] = ["general", "lift", "inspection", "wash", "tire", "paint", "electrical"];
export const BOOKING_STATUSES: BookingStatus[] = ["scheduled", "in_progress", "done", "canceled"];
/** Bookings that hold their slot. */
export const LIVE_BOOKING_STATUSES: BookingStatus[] = ["scheduled", "in_progress"];

export const BOOKING_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  scheduled: ["in_progress", "canceled"],
  in_progress: ["done"],
  done: [],
  canceled: [],
};

const HOUR = 3_600_000;

export interface Slot {
  id?: string;
  bay_id: string;
  starts_at: string;
  ends_at: string;
  status: BookingStatus;
}

/** Half-open [start, end) overlap, as tstzrange && does. */
export function overlaps(a: { starts_at: string; ends_at: string }, b: { starts_at: string; ends_at: string }): boolean {
  return Date.parse(a.starts_at) < Date.parse(b.ends_at) && Date.parse(b.starts_at) < Date.parse(a.ends_at);
}

/** The live booking in the same bay that a proposed slot would collide with, if any. */
export function findConflict(slot: Slot, others: Slot[]): Slot | null {
  return others.find((o) => o.id !== slot.id && o.bay_id === slot.bay_id && LIVE_BOOKING_STATUSES.includes(o.status)
    && overlaps(o, slot)) ?? null;
}

/** Hours between two timestamps, rounded to 2 decimals like the database. */
export function hoursBetween(startIso: string, endIso: string): number {
  return Math.round(((Date.parse(endIso) - Date.parse(startIso)) / HOUR) * 100) / 100;
}

/** "2:05" style elapsed time for a running clock. */
export function elapsedLabel(startIso: string, now = Date.now()): string {
  const mins = Math.max(0, Math.floor((now - Date.parse(startIso)) / 60_000));
  return `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, "0")}`;
}

/**
 * Where a booking sits on a day timeline that runs from `dayStart` for
 * `spanHours`, as percentages of the width; null when it falls outside.
 */
export function timelinePosition(
  b: { starts_at: string; ends_at: string }, dayStart: Date, spanHours: number,
): { left: number; width: number } | null {
  const start = dayStart.getTime();
  const end = start + spanHours * HOUR;
  const s = Math.max(Date.parse(b.starts_at), start);
  const e = Math.min(Date.parse(b.ends_at), end);
  if (e <= s) return null;
  return { left: ((s - start) / (end - start)) * 100, width: ((e - s) / (end - start)) * 100 };
}

/**
 * Booked share of bay time in [from, to): booked hours of non-canceled
 * bookings clipped to the window, over active bays × `hoursPerDay` × days.
 */
export function bayUtilization(
  bookings: { bay_id: string; starts_at: string; ends_at: string; status: BookingStatus }[],
  bayIds: string[], from: Date, to: Date, hoursPerDay: number,
): { bayId: string; bookedHours: number; pct: number }[] {
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / (24 * HOUR)));
  const capacity = days * hoursPerDay;
  return bayIds.map((bayId) => {
    let ms = 0;
    for (const b of bookings) {
      if (b.bay_id !== bayId || b.status === "canceled") continue;
      const s = Math.max(Date.parse(b.starts_at), from.getTime());
      const e = Math.min(Date.parse(b.ends_at), to.getTime());
      if (e > s) ms += e - s;
    }
    const bookedHours = Math.round((ms / HOUR) * 100) / 100;
    return { bayId, bookedHours, pct: capacity > 0 ? Math.min(100, Math.round((bookedHours / capacity) * 100)) : 0 };
  });
}

export interface LaborRow {
  employee_id: string;
  started_at: string;
  hours: number | null;
  cost: number | null;
}

/** Monday (UTC) of the week a timestamp falls in, as YYYY-MM-DD. */
export function weekStart(iso: string): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** Finished hours and cost per employee, busiest first. */
export function laborByEmployee(rows: LaborRow[]): { employeeId: string; hours: number; cost: number; entries: number }[] {
  const m = new Map<string, { hours: number; cost: number; entries: number }>();
  for (const r of rows) {
    if (r.hours == null) continue;
    const cur = m.get(r.employee_id) ?? { hours: 0, cost: 0, entries: 0 };
    cur.hours += Number(r.hours);
    cur.cost += Number(r.cost ?? 0);
    cur.entries++;
    m.set(r.employee_id, cur);
  }
  return [...m.entries()]
    .map(([employeeId, v]) => ({ employeeId, hours: Math.round(v.hours * 100) / 100, cost: Math.round(v.cost * 1000) / 1000, entries: v.entries }))
    .sort((a, b) => b.hours - a.hours || a.employeeId.localeCompare(b.employeeId));
}

/** Finished hours per week for the last `weeks` weeks ending at `now`, oldest first. */
export function weeklyHours(rows: LaborRow[], weeks: number, now = new Date()): { week: string; hours: number }[] {
  const end = weekStart(now.toISOString());
  const out: { week: string; hours: number }[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(end + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - i * 7);
    out.push({ week: d.toISOString().slice(0, 10), hours: 0 });
  }
  const idx = new Map(out.map((w, i) => [w.week, i]));
  for (const r of rows) {
    if (r.hours == null) continue;
    const i = idx.get(weekStart(r.started_at));
    if (i != null) out[i].hours = Math.round((out[i].hours + Number(r.hours)) * 100) / 100;
  }
  return out;
}
