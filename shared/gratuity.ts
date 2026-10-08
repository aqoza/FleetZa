/**
 * End-of-service gratuity — pure, unit-tested estimates shown on the employee
 * page when payroll_hr is on. Not legal advice: the card says it is an
 * estimate, and the inputs (wage basis, dates, reason) are the manager's.
 *
 * UAE (Federal Decree-Law 33 of 2021, art. 51): 21 days' basic wage per year
 *   for the first five years, 30 days per year after that, pro-rata for part
 *   years; nothing under one year of service; capped at two years' wage. The
 *   daily wage is the monthly basic x 12 / 365. Resigning no longer reduces it.
 * KSA (Labor Law art. 84-85): half a month's wage per year for the first five
 *   years, a full month per year after that, pro-rata. On resignation the
 *   award is cut: under 2 years nothing, 2 to 5 years one third, 5 to 10
 *   years two thirds, 10 years or more in full.
 */

export type GratuityScheme = "uae" | "ksa";
export type SeparationReason = "termination" | "resignation";

export interface GratuityInput {
  scheme: GratuityScheme;
  /** Monthly wage the award is based on (UAE: basic; KSA: basic + housing). */
  monthlyWage: number;
  /** yyyy-mm-dd */
  startDate: string;
  /** yyyy-mm-dd, the last working day (inclusive). */
  endDate: string;
  reason: SeparationReason;
}

export interface GratuityResult {
  /** Calendar days of service, both ends included. */
  serviceDays: number;
  /** Service in years (days / 365). */
  years: number;
  /** Award before any resignation reduction or cap. */
  fullAmount: number;
  /** Share of the full award that applies (1, 2/3, 1/3 or 0). */
  factor: number;
  /** True when the UAE two-year cap cut the award. */
  capped: boolean;
  amount: number;
}

const MS_PER_DAY = 86_400_000;

/** Whole calendar days from start to end, both included; 0 when reversed. */
export function serviceDays(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 0;
  return Math.round((end - start) / MS_PER_DAY) + 1;
}

/** KSA art. 85: the share of the award an employee who resigns keeps. */
export function ksaResignationFactor(years: number): number {
  if (years < 2) return 0;
  if (years < 5) return 1 / 3;
  if (years < 10) return 2 / 3;
  return 1;
}

/** The scheme a tenant's country suggests: UAE rules for AE, KSA otherwise. */
export function schemeForCountry(country: string | null | undefined): GratuityScheme {
  return (country ?? "").toUpperCase() === "AE" ? "uae" : "ksa";
}

export function computeGratuity(input: GratuityInput): GratuityResult {
  const days = serviceDays(input.startDate, input.endDate);
  const years = days / 365;
  const wage = Math.max(0, Number.isFinite(input.monthlyWage) ? input.monthlyWage : 0);
  const first = Math.min(years, 5);
  const after = Math.max(years - 5, 0);

  if (input.scheme === "uae") {
    if (years < 1) return { serviceDays: days, years, fullAmount: 0, factor: 1, capped: false, amount: 0 };
    const daily = (wage * 12) / 365;
    const full = daily * (21 * first + 30 * after);
    const cap = wage * 24;
    return {
      serviceDays: days,
      years,
      fullAmount: full,
      factor: 1,
      capped: full > cap,
      amount: Math.min(full, cap),
    };
  }

  const full = wage * (0.5 * first + after);
  const factor = input.reason === "resignation" ? ksaResignationFactor(years) : 1;
  return { serviceDays: days, years, fullAmount: full, factor, capped: false, amount: full * factor };
}
