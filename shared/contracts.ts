/**
 * Contract rules shared by the SPA and tests. The database (migration
 * 20261008000027_contracts.sql) enforces the lifecycle and does the billing;
 * this mirrors its period arithmetic and derives the revenue figures.
 */

export const CONTRACT_TYPES = ["lease", "rental", "service", "maintenance", "sla", "speed_limiter_service", "other"] as const;
export type ContractType = (typeof CONTRACT_TYPES)[number];

export const CONTRACT_STATUSES = ["draft", "active", "expired", "terminated", "renewed"] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const FREQUENCIES = ["monthly", "quarterly", "semi_annual", "annual", "one_time"] as const;
export type Frequency = (typeof FREQUENCIES)[number];

/** Months per billing period; null for one-time billing. Mirrors app.contract_period_months. */
export function periodMonths(f: Frequency): number | null {
  switch (f) {
    case "monthly": return 1;
    case "quarterly": return 3;
    case "semi_annual": return 6;
    case "annual": return 12;
    default: return null;
  }
}

/** `date + N months` as Postgres does it: the day is clamped to the month's end. */
export function addMonths(date: string, months: number): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7)) - 1 + months;
  const d = Number(date.slice(8, 10));
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d, last))).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export interface BillingTerms {
  billing_frequency: Frequency;
  next_billing_date: string | null;
  end_date: string | null;
}

export interface Period {
  start: string;
  end: string;
  /** next_billing_date after this period is billed; null when nothing follows. */
  next: string | null;
}

/** The period public.contract_bill_period bills next, or null when nothing is left. */
export function nextPeriod(c: BillingTerms): Period | null {
  const start = c.next_billing_date;
  if (!start || (c.end_date && start > c.end_date)) return null;
  const months = periodMonths(c.billing_frequency);
  if (months == null) return { start, end: c.end_date ?? start, next: null };
  const next = addMonths(start, months);
  let end = addDays(next, -1);
  if (c.end_date && end > c.end_date) end = c.end_date;
  return { start, end, next };
}

export interface RevenueTerms extends BillingTerms {
  status: ContractStatus;
  recurring_amount: number | string;
  /** Sum of covered vehicles' rate overrides, billed each period too. */
  vehicle_amount?: number;
}

const num = (v: number | string | null | undefined) => (v == null || v === "" ? 0 : Number(v) || 0);

/** What one billing period invoices before tax. */
export function periodAmount(c: Pick<RevenueTerms, "recurring_amount" | "vehicle_amount">): number {
  return num(c.recurring_amount) + num(c.vehicle_amount);
}

/** Monthly recurring revenue of an active contract; one-time contracts add none. */
export function mrr(c: RevenueTerms): number {
  if (c.status !== "active") return 0;
  const months = periodMonths(c.billing_frequency);
  return months == null ? 0 : periodAmount(c) / months;
}

export interface MonthBilling {
  month: string; // YYYY-MM
  amount: number;
  count: number;
}

/**
 * Billings active contracts will raise, by month, from `fromMonth` for
 * `months` months. Periods already due count in the first month.
 */
export function projectBillings(contracts: readonly RevenueTerms[], fromMonth: string, months = 6): MonthBilling[] {
  const out: MonthBilling[] = [];
  let y = Number(fromMonth.slice(0, 4));
  let m = Number(fromMonth.slice(5, 7));
  for (let i = 0; i < months; i++) {
    out.push({ month: `${y}-${String(m).padStart(2, "0")}`, amount: 0, count: 0 });
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  const last = out[out.length - 1].month;
  for (const c of contracts) {
    if (c.status !== "active") continue;
    let terms: BillingTerms = c;
    for (let guard = 0; guard < 400; guard++) {
      const p = nextPeriod(terms);
      if (!p) break;
      const key = p.start.slice(0, 7);
      if (key > last) break;
      const slot = key < out[0].month ? out[0] : out.find((o) => o.month === key);
      if (slot) {
        slot.amount += periodAmount(c);
        slot.count += 1;
      }
      if (!p.next) break;
      terms = { ...terms, next_billing_date: p.next };
    }
  }
  return out;
}

/** Days until an active contract ends (negative once past), or null when open-ended. */
export function daysToEnd(c: { end_date: string | null }, today: string): number | null {
  return c.end_date ? daysBetween(today, c.end_date) : null;
}

/** Active and inside its notice window (at least 30 days), like the scanner. */
export function isEndingSoon(c: { status: ContractStatus; end_date: string | null; notice_days: number }, today: string): boolean {
  const d = daysToEnd(c, today);
  return c.status === "active" && d != null && d >= 0 && d <= Math.max(c.notice_days, 30);
}

export function isBillingDue(c: RevenueTerms, today: string): boolean {
  const p = c.status === "active" ? nextPeriod(c) : null;
  return !!p && p.start <= today;
}
