/**
 * HR & payroll — pure helpers for the /hr pages. The database computes the
 * numbers that matter (leave days, payslips); these mirror them for previews
 * and decide the weekend proposed on first use.
 */

/** 0 = Sunday .. 6 = Saturday, the same numbering as Postgres `extract(dow)`. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * The weekend a country's week start implies: a week starting Sunday ends
 * Fri/Sat (most of the GCC), Monday ends Sat/Sun (UAE since 2022, most of the
 * world), Saturday ends on Friday.
 */
export function weekendFromWeekStart(weekStart: 0 | 1 | 6): Weekday[] {
  if (weekStart === 0) return [5, 6];
  if (weekStart === 6) return [5];
  return [0, 6];
}

/** Working days in [start, end] (yyyy-mm-dd, inclusive) for a weekend set. */
export function workdays(start: string, end: string, weekend: readonly number[]): number {
  const s = Date.parse(`${start}T00:00:00Z`);
  const e = Date.parse(`${end}T00:00:00Z`);
  if (Number.isNaN(s) || Number.isNaN(e) || e < s) return 0;
  let n = 0;
  for (let t = s; t <= e; t += 86_400_000) {
    if (!weekend.includes(new Date(t).getUTCDay())) n += 1;
  }
  return n;
}

/** Hours between two "HH:MM" clock times; a check-out before check-in is overnight. */
export function clockHours(checkIn: string, checkOut: string): number | null {
  const m = /^(\d{2}):(\d{2})/;
  const a = m.exec(checkIn);
  const b = m.exec(checkOut);
  if (!a || !b) return null;
  let mins = Number(b[1]) * 60 + Number(b[2]) - (Number(a[1]) * 60 + Number(a[2]));
  if (mins < 0) mins += 24 * 60;
  return Math.round((mins / 60) * 100) / 100;
}

/** First and last day of the month containing `iso` (yyyy-mm-dd). */
export function monthBounds(iso: string): { start: string; end: string } {
  const [y, m] = iso.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, "0");
  return { start: `${y}-${mm}-01`, end: `${y}-${mm}-${String(last).padStart(2, "0")}` };
}

export type LeaveStatus = "pending" | "approved" | "rejected" | "canceled";
export type PayrollStatus = "draft" | "calculated" | "approved" | "paid" | "canceled";

/** Moves a manager can make on a leave request (mirrors app.leave_request_guard). */
export function leaveMoves(status: LeaveStatus): LeaveStatus[] {
  if (status === "pending") return ["approved", "rejected", "canceled"];
  if (status === "approved") return ["canceled"];
  return [];
}

/** Whether a run's payslips and fields can still change. */
export function payrollEditable(status: PayrollStatus): boolean {
  return status === "draft" || status === "calculated";
}
