/**
 * Regulatory compliance rules shared by the SPA and tests. The database
 * (migration 20261008000025_regulatory.sql) stores obligations; this derives
 * where each one stands and the compliance figures.
 */

export const CATEGORIES = [
  "permit", "license", "tax", "emissions", "safety", "tachograph", "operating_authority", "insurance", "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const SUBJECT_TYPES = ["company", "vehicle", "driver", "employee"] as const;
export type SubjectType = (typeof SUBJECT_TYPES)[number];

export const OBLIGATION_STATUSES = ["pending", "compliant", "non_compliant", "waived"] as const;
export type ObligationStatus = (typeof OBLIGATION_STATUSES)[number];

/** Countries with curated starter templates; anything else gets the generic list. */
export const TEMPLATE_COUNTRIES = ["AE", "SA", "OM", "QA", "KW", "BH"] as const;

/** Where an obligation stands today. */
export type ObligationState = "compliant" | "waived" | "upcoming" | "due_soon" | "overdue" | "non_compliant";

export const STATE_ORDER: readonly ObligationState[] = ["overdue", "non_compliant", "due_soon", "upcoming", "compliant", "waived"];

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function obligationState(o: { status: ObligationStatus; due_date: string }, leadDays: number, today: string): ObligationState {
  if (o.status === "compliant") return "compliant";
  if (o.status === "waived") return "waived";
  if (o.status === "non_compliant") return "non_compliant";
  const left = daysBetween(today, o.due_date);
  if (left < 0) return "overdue";
  return left <= Math.max(leadDays, 7) ? "due_soon" : "upcoming";
}

/** Overdue and non-compliant obligations are the ones out of standing. */
export function inGoodStanding(s: ObligationState): boolean {
  return s !== "overdue" && s !== "non_compliant";
}

/** `date + N months` as Postgres does it: the day is clamped to the month's end. */
export function addMonths(date: string, months: number): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7)) - 1 + months;
  const d = Number(date.slice(8, 10));
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d, last))).toISOString().slice(0, 10);
}

/** Due date of the obligation public.obligation_complete schedules next. */
export function nextDueDate(dueDate: string, completedOn: string, frequencyMonths: number): string {
  return addMonths(dueDate > completedOn ? dueDate : completedOn, frequencyMonths);
}

export interface RateRow {
  requirement_id: string;
  subject_type: SubjectType;
  subject_id: string | null;
  status: ObligationStatus;
  due_date: string;
}

/**
 * The obligation that counts for each requirement + subject: the open one if
 * there is one (earliest due), else the latest closed one.
 */
export function currentObligations<T extends RateRow>(rows: readonly T[]): T[] {
  const m = new Map<string, T>();
  const open = (r: T) => r.status === "pending" || r.status === "non_compliant";
  for (const r of rows) {
    const k = `${r.requirement_id}|${r.subject_id ?? "company"}`;
    const cur = m.get(k);
    if (!cur) { m.set(k, r); continue; }
    if (open(r) !== open(cur)) { if (open(r)) m.set(k, r); continue; }
    if (open(r) ? r.due_date < cur.due_date : r.due_date > cur.due_date) m.set(k, r);
  }
  return [...m.values()];
}

export interface Rate { total: number; good: number; rate: number | null }

export function rate(states: readonly ObligationState[]): Rate {
  const good = states.filter(inGoodStanding).length;
  return { total: states.length, good, rate: states.length ? Math.round((good / states.length) * 100) : null };
}

/** Compliance rate per key, keys in first-seen order. */
export function ratesBy<K extends string>(items: ReadonlyArray<{ key: K; state: ObligationState }>): Array<{ key: K } & Rate> {
  const m = new Map<K, ObligationState[]>();
  for (const i of items) m.set(i.key, [...(m.get(i.key) ?? []), i.state]);
  return [...m.entries()].map(([key, s]) => ({ key, ...rate(s) }));
}
