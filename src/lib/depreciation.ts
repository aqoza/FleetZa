/**
 * Asset depreciation (module `assets`) — pure, monthly, nothing stored.
 *
 * straight_line: (cost − salvage) / life, the same amount every month.
 * declining_balance: double-declining on the opening book value (rate =
 *   2 / life per month), switching to straight line over the remaining
 *   months as soon as that gives more, so the asset lands exactly on salvage
 *   at the end of its life. Never goes below salvage.
 * none: book value stays at cost.
 *
 * Month 1 is the month of purchase. Amounts round to the currency's decimals
 * at the end, not per month, so the schedule sums exactly to cost − salvage.
 */

export type DepreciationMethod = "straight_line" | "declining_balance" | "none";

export interface DepreciationInput {
  method: DepreciationMethod;
  cost: number;
  salvage: number;
  lifeMonths: number | null;
  /** ISO date (YYYY-MM-DD) the asset was bought. */
  purchaseDate: string | null;
}

export interface ScheduleYear {
  /** 1-based year of life. */
  year: number;
  /** ISO date of the first month in this year of life. */
  from: string;
  depreciation: number;
  closingValue: number;
}

/** Whole months from the purchase month up to and including `asOf`'s month. */
export function monthsElapsed(purchaseDate: string, asOf: string): number {
  const [py, pm] = purchaseDate.split("-").map(Number);
  const [ay, am] = asOf.split("-").map(Number);
  return Math.max(0, (ay - py) * 12 + (am - pm) + 1);
}

function usable(input: DepreciationInput): boolean {
  return input.method !== "none" && !!input.lifeMonths && input.lifeMonths > 0 && input.cost > 0
    && input.salvage < input.cost && !!input.purchaseDate;
}

/** Depreciation charged in each month of life, unrounded. */
export function monthlyCharges(input: DepreciationInput): number[] {
  if (!usable(input)) return [];
  const life = input.lifeMonths!;
  const base = input.cost - input.salvage;
  if (input.method === "straight_line") return Array.from({ length: life }, () => base / life);

  const rate = 2 / life;
  const out: number[] = [];
  let book = input.cost;
  for (let m = 0; m < life; m++) {
    const remaining = life - m;
    const declining = book * rate;
    const straight = (book - input.salvage) / remaining;
    const charge = Math.min(Math.max(declining, straight), book - input.salvage);
    out.push(charge);
    book -= charge;
  }
  return out;
}

function round(v: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

/** Book value at the end of `asOf`'s month (cost before purchase or without inputs). */
export function bookValue(input: DepreciationInput, asOf: string, decimals = 2): number {
  if (!usable(input)) return round(input.cost, decimals);
  const charges = monthlyCharges(input);
  const n = Math.min(monthsElapsed(input.purchaseDate!, asOf), charges.length);
  const used = charges.slice(0, n).reduce((s, c) => s + c, 0);
  return round(Math.max(input.salvage, input.cost - used), decimals);
}

/** Accumulated depreciation to the end of `asOf`'s month. */
export function accumulatedDepreciation(input: DepreciationInput, asOf: string, decimals = 2): number {
  return round(input.cost - bookValue(input, asOf, 12), decimals);
}

function addMonths(iso: string, months: number): string {
  const [y, m] = iso.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}-01`;
}

/** Year-of-life schedule; the last year's closing value is exactly salvage. */
export function yearlySchedule(input: DepreciationInput, decimals = 2): ScheduleYear[] {
  const charges = monthlyCharges(input);
  if (charges.length === 0) return [];
  const out: ScheduleYear[] = [];
  let book = input.cost;
  for (let i = 0; i < charges.length; i += 12) {
    const year = charges.slice(i, i + 12).reduce((s, c) => s + c, 0);
    const opening = round(book, decimals);
    book -= year;
    const closing = i + 12 >= charges.length ? round(input.salvage, decimals) : round(book, decimals);
    out.push({ year: i / 12 + 1, from: addMonths(input.purchaseDate!, i), depreciation: round(opening - closing, decimals), closingValue: closing });
  }
  return out;
}

/** Gain (positive) or loss on disposal against the book value at that date. */
export function disposalResult(input: DepreciationInput, disposedOn: string, proceeds: number, decimals = 2): number {
  return round(proceeds - bookValue(input, disposedOn, decimals), decimals);
}
