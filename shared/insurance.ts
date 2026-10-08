/**
 * Insurance rules shared by the SPA and tests. The database (migration
 * 20261008000023_insurance.sql) enforces the claim transitions and policy
 * cover; this mirrors them for the UI and computes the derived figures.
 */

export const POLICY_TYPES = [
  "comprehensive",
  "third_party",
  "third_party_fire_theft",
  "cargo",
  "liability",
  "workers_comp",
  "other",
] as const;
export type PolicyType = (typeof POLICY_TYPES)[number];

export const PREMIUM_FREQUENCIES = ["annual", "semi_annual", "quarterly", "monthly"] as const;
export type PremiumFrequency = (typeof PREMIUM_FREQUENCIES)[number];

export const POLICY_STATUSES = ["upcoming", "active", "expiring", "expired", "canceled"] as const;
export type PolicyStatus = (typeof POLICY_STATUSES)[number];

export const CLAIM_STATUSES = ["draft", "submitted", "under_review", "approved", "rejected", "settled", "withdrawn"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

/** Allowed next statuses; app.claim_guard is the source of truth. */
export const CLAIM_TRANSITIONS: Record<ClaimStatus, readonly ClaimStatus[]> = {
  draft: ["submitted", "withdrawn"],
  submitted: ["under_review", "withdrawn"],
  under_review: ["approved", "rejected"],
  approved: ["settled"],
  rejected: [],
  settled: [],
  withdrawn: [],
};

/** Claims still being worked: counted as open on the pipeline. */
export const OPEN_CLAIM_STATUSES: readonly ClaimStatus[] = ["draft", "submitted", "under_review", "approved"];

/** A policy is "expiring" within this many days of its end date. */
export const EXPIRING_DAYS = 30;

const DAY = 86_400_000;

function toDay(iso: string): number {
  return Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / DAY;
}

/** Whole days from `from` to `to` (both YYYY-MM-DD). */
export function daysBetween(from: string, to: string): number {
  return Math.round(toDay(to) - toDay(from));
}

export interface PolicyDates {
  start_date: string;
  end_date: string;
  canceled_at: string | null;
}

export function policyStatus(p: PolicyDates, today: string): PolicyStatus {
  if (p.canceled_at) return "canceled";
  if (p.end_date < today) return "expired";
  if (p.start_date > today) return "upcoming";
  return daysBetween(today, p.end_date) <= EXPIRING_DAYS ? "expiring" : "active";
}

/** True when the policy gives cover on `day` (term, minus any cancellation). */
export function policyCovers(p: PolicyDates, day: string): boolean {
  if (day < p.start_date || day > p.end_date) return false;
  return !p.canceled_at || day <= p.canceled_at;
}

const PER_YEAR: Record<PremiumFrequency, number> = { annual: 1, semi_annual: 2, quarterly: 4, monthly: 12 };

/** The premium as a yearly amount. */
export function annualPremium(premium: number, frequency: PremiumFrequency): number {
  return premium * PER_YEAR[frequency];
}

export interface PremiumPolicy extends PolicyDates {
  premium: number;
  premium_frequency: PremiumFrequency;
}

/**
 * Premium cost falling in each calendar year: the yearly premium spread evenly
 * over the days the policy was in force (to its cancellation, if any).
 */
export function premiumByYear(policies: readonly PremiumPolicy[], years: readonly number[]): Map<number, number> {
  const out = new Map<number, number>(years.map((y) => [y, 0]));
  for (const p of policies) {
    const daily = annualPremium(p.premium, p.premium_frequency) / 365;
    const end = p.canceled_at && p.canceled_at < p.end_date ? p.canceled_at : p.end_date;
    if (end < p.start_date) continue;
    for (const y of years) {
      const from = p.start_date > `${y}-01-01` ? p.start_date : `${y}-01-01`;
      const to = end < `${y}-12-31` ? end : `${y}-12-31`;
      if (to < from) continue;
      out.set(y, (out.get(y) ?? 0) + daily * (daysBetween(from, to) + 1));
    }
  }
  for (const [y, v] of out) out.set(y, Math.round(v * 100) / 100);
  return out;
}

/** Paid claims over premium; null when there is no premium to compare with. */
export function lossRatio(paidClaims: number, premiums: number): number | null {
  if (premiums <= 0) return null;
  return Math.round((paidClaims / premiums) * 1000) / 10;
}

export interface CoverRow {
  added_on: string;
  removed_on: string | null;
}

/** True when a policy-vehicle row is in effect on `day`. */
export function coverOn(row: CoverRow, day: string): boolean {
  return row.added_on <= day && (row.removed_on == null || row.removed_on >= day);
}

/** Claimed minus what the insurer paid (or approved, while not yet paid). */
export function claimShortfall(c: { amount_claimed: number; amount_approved: number | null; amount_paid: number | null }): number | null {
  const got = c.amount_paid ?? c.amount_approved;
  return got == null ? null : Math.round((c.amount_claimed - got) * 1000) / 1000;
}
