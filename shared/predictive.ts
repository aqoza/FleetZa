/**
 * Predictive maintenance (module `predictive_ai`) — deterministic, explainable
 * risk scoring. Pure and shared by the SPA; mirrored in SQL by
 * public.predictive_vehicle_health() (migration
 * 20261008000017_predictive_maintenance.sql). Change both together.
 *
 * No machine learning: every point in a score comes from one named factor
 * with the numbers behind it, so a manager can see why a vehicle is flagged.
 *
 *   usage      avg daily km = least-squares slope of odometer readings over
 *              the last 180 days (fuel logs, work orders, inspections, the
 *              vehicle's current odometer); needs ≥ 2 readings ≥ 7 days apart
 *   service    days until the next service reminder by km (via usage) or date
 *   factors    service_overdue 30 | service_due_14d 20 | service_due_30d 10
 *              open_critical_issue 20 | open_high_issue 10
 *              repeat_failure (≥ 2 issues in 90 d) 15
 *              issue_rate ≥ 2 per 1,000 km (180 d) 15 | ≥ 1 → 8
 *              cost_rising (last 90 d > 1.5 × previous 90 d) 10
 *              cost_new (previous 90 d had none) 5
 *              age ≥ 10 years 10 | ≥ 6 years 5
 *              inspection_overdue (none in 90 days) 10
 *   score      min(100, Σ points); band high ≥ 60, medium ≥ 30, else low
 */

export const MIN_SPAN_DAYS = 7;
/** Distance floor for the issue rate, so a barely-driven vehicle with one issue isn't "20 per 1,000 km". */
export const MIN_RATE_KM = 500;
export const INSPECTION_MAX_DAYS = 90;

export type RiskBand = "low" | "medium" | "high";

export type FactorCode =
  | "service_overdue"
  | "service_due_14d"
  | "service_due_30d"
  | "open_critical_issue"
  | "open_high_issue"
  | "repeat_failure"
  | "issue_rate_high"
  | "issue_rate"
  | "cost_rising"
  | "cost_new"
  | "age_10y"
  | "age_6y"
  | "inspection_overdue";

export const FACTOR_POINTS: Record<FactorCode, number> = {
  service_overdue: 30,
  service_due_14d: 20,
  service_due_30d: 10,
  open_critical_issue: 20,
  open_high_issue: 10,
  repeat_failure: 15,
  issue_rate_high: 15,
  issue_rate: 8,
  cost_rising: 10,
  cost_new: 5,
  age_10y: 10,
  age_6y: 5,
  inspection_overdue: 10,
};

export interface Factor {
  code: FactorCode;
  points: number;
  /** The number behind the factor (days, count, rate, ratio, years), for display. */
  value: number | null;
}

export interface OdometerPoint {
  /** Epoch milliseconds. */
  t: number;
  km: number;
}

export interface Reminder {
  due_km: number | null;
  /** YYYY-MM-DD */
  due_date: string | null;
}

export interface HealthInputs {
  odometer: number;
  readings: OdometerPoint[];
  reminders: Reminder[];
  issues_90d: number;
  issues_180d: number;
  open_critical: number;
  open_high: number;
  cost_90d: number;
  cost_prev_90d: number;
  age_years: number | null;
  days_since_inspection: number | null;
}

export interface Health {
  avg_daily_km: number | null;
  days_to_service: number | null;
  service_overdue: boolean;
  issue_rate: number;
  factors: Factor[];
  risk_score: number;
  band: RiskBand;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const DAY_MS = 86_400_000;

/** Least-squares km/day; null with fewer than 2 readings or under MIN_SPAN_DAYS of spread. Never negative. */
export function dailyKm(points: OdometerPoint[]): number | null {
  if (points.length < 2) return null;
  const xs = points.map((p) => p.t / DAY_MS);
  const span = Math.max(...xs) - Math.min(...xs);
  if (span < MIN_SPAN_DAYS) return null;
  const n = points.length;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = points.reduce((s, p) => s + p.km, 0) / n;
  let sxy = 0;
  let sxx = 0;
  points.forEach((p, i) => {
    sxy += (xs[i] - mx) * (p.km - my);
    sxx += (xs[i] - mx) ** 2;
  });
  if (sxx === 0) return null;
  return Math.max(0, round1(sxy / sxx));
}

/** Days from `today` (YYYY-MM-DD) to a date. */
export function daysBetween(today: string, date: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
}

export function riskBand(score: number): RiskBand {
  return score >= 60 ? "high" : score >= 30 ? "medium" : "low";
}

export function vehicleHealth(input: HealthInputs, today: string): Health {
  const avg = dailyKm(input.readings);
  let days: number | null = null;
  let overdue = false;
  for (const r of input.reminders) {
    if (r.due_km != null) {
      if (input.odometer >= r.due_km) overdue = true;
      if (avg != null && avg > 0) {
        const d = Math.floor((r.due_km - input.odometer) / avg);
        days = days == null ? d : Math.min(days, d);
      }
    }
    if (r.due_date) {
      const d = daysBetween(today, r.due_date);
      if (d < 0) overdue = true;
      days = days == null ? d : Math.min(days, d);
    }
  }
  if (days != null && days < 0) overdue = true;

  const km180 = avg != null ? avg * 180 : 0;
  const rate = round1((input.issues_180d * 1000) / Math.max(km180, MIN_RATE_KM));

  const factors: Factor[] = [];
  const add = (code: FactorCode, value: number | null) => factors.push({ code, points: FACTOR_POINTS[code], value });
  if (overdue) add("service_overdue", days);
  else if (days != null && days <= 14) add("service_due_14d", days);
  else if (days != null && days <= 30) add("service_due_30d", days);
  if (input.open_critical > 0) add("open_critical_issue", input.open_critical);
  else if (input.open_high > 0) add("open_high_issue", input.open_high);
  if (input.issues_90d >= 2) add("repeat_failure", input.issues_90d);
  if (rate >= 2) add("issue_rate_high", rate);
  else if (rate >= 1) add("issue_rate", rate);
  if (input.cost_prev_90d > 0 && input.cost_90d > input.cost_prev_90d * 1.5) {
    add("cost_rising", round1(input.cost_90d / input.cost_prev_90d));
  } else if (input.cost_prev_90d === 0 && input.cost_90d > 0) {
    add("cost_new", null);
  }
  if (input.age_years != null && input.age_years >= 10) add("age_10y", input.age_years);
  else if (input.age_years != null && input.age_years >= 6) add("age_6y", input.age_years);
  if (input.days_since_inspection == null || input.days_since_inspection > INSPECTION_MAX_DAYS) {
    add("inspection_overdue", input.days_since_inspection);
  }

  const score = Math.min(100, factors.reduce((s, f) => s + f.points, 0));
  return {
    avg_daily_km: avg,
    days_to_service: days,
    service_overdue: overdue,
    issue_rate: rate,
    factors,
    risk_score: score,
    band: riskBand(score),
  };
}

/** Projected odometer `days` from now on the current usage. */
export function projectOdometer(odometer: number, avgDailyKm: number | null, days: number): number {
  return Math.round(odometer + (avgDailyKm ?? 0) * days);
}
