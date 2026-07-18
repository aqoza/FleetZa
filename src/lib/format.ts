import type { DistanceUnit, Tenant, VolumeUnit } from "./types";

const KM_PER_MILE = 1.609344;
const LITERS_PER_US_GAL = 3.785411784;

// --- unit conversion (DB stores km + liters canonically) ---

export function kmToDisplay(km: number, unit: DistanceUnit): number {
  return unit === "mi" ? km / KM_PER_MILE : km;
}

export function displayToKm(value: number, unit: DistanceUnit): number {
  return unit === "mi" ? value * KM_PER_MILE : value;
}

export function litersToDisplay(liters: number, unit: VolumeUnit): number {
  return unit === "gal" ? liters / LITERS_PER_US_GAL : liters;
}

export function displayToLiters(value: number, unit: VolumeUnit): number {
  return unit === "gal" ? value * LITERS_PER_US_GAL : value;
}

// --- formatting ---

/**
 * Module-level formatting context. When set (e.g. from the tenant's country
 * config), all formatters below use this locale; when undefined they fall back
 * to the browser default, preserving prior behavior.
 */
let activeLocale: string | undefined;

export function configureFormatting(opts: { locale?: string }): void {
  activeLocale = opts.locale;
}

/** Compact notation (1.5K, 3M) in the tenant locale — evaluated per call, not frozen at import. */
export function formatCompact(n: number): string {
  return new Intl.NumberFormat(activeLocale, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

export function formatMoney(amount: number | null | undefined, currency: string): string {
  if (amount === null || amount === undefined) return "—";
  try {
    return new Intl.NumberFormat(activeLocale, { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export function formatDistance(km: number | null | undefined, unit: DistanceUnit): string {
  if (km === null || km === undefined) return "—";
  const v = kmToDisplay(km, unit);
  return `${new Intl.NumberFormat(activeLocale, { maximumFractionDigits: 0 }).format(v)} ${unit}`;
}

export function formatVolume(liters: number | null | undefined, unit: VolumeUnit): string {
  if (liters === null || liters === undefined) return "—";
  const v = litersToDisplay(liters, unit);
  return `${new Intl.NumberFormat(activeLocale, { maximumFractionDigits: 2 }).format(v)} ${unit}`;
}

export function formatDate(iso: string | null | undefined, timezone?: string): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return new Intl.DateTimeFormat(activeLocale, {
    dateStyle: "medium",
    ...(iso.length > 10 && timezone ? { timeZone: timezone } : {}),
  }).format(d);
}

export function formatDateTime(iso: string | null | undefined, timezone?: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat(activeLocale, {
    dateStyle: "medium",
    timeStyle: "short",
    ...(timezone ? { timeZone: timezone } : {}),
  }).format(new Date(iso));
}

/** Days from today until a date (negative = overdue). */
export function daysUntil(dateIso: string): number {
  const target = new Date(dateIso.length === 10 ? `${dateIso}T00:00:00` : dateIso).getTime();
  return Math.ceil((target - Date.now()) / 86_400_000);
}

/** Fuel efficiency label for the tenant's units (L/100km or MPG). */
export function efficiencyLabel(tenant: Tenant): string {
  return tenant.volume_unit === "gal" && tenant.distance_unit === "mi" ? "MPG" : "L/100km";
}

export function computeEfficiency(
  distanceKm: number,
  liters: number,
  tenant: Tenant,
): number | null {
  if (distanceKm <= 0 || liters <= 0) return null;
  if (tenant.volume_unit === "gal" && tenant.distance_unit === "mi") {
    return distanceKm / KM_PER_MILE / (liters / LITERS_PER_US_GAL); // MPG
  }
  return (liters / distanceKm) * 100; // L/100km
}
