/**
 * Country engine — single source of truth for per-country configuration:
 * currency, tax rules, locale-driven date/number formatting, week structure,
 * and vehicle-regulation defaults. Shared by the SPA and the Worker.
 *
 * Formatting locales use `en-<CC>` so CLDR applies each region's date order,
 * separators, and currency conventions (incl. 3-decimal dinars/rials) while
 * keeping Latin digits in an English UI.
 *
 * Tax rates verified 2026-07 against PwC tax summaries / vatcalc / VATupdate.
 */

export type RenewalTypeCode =
  | "registration" | "insurance" | "permit" | "emission_test" | "roadworthiness" | "other";

export interface CountryRenewalDefault {
  type: RenewalTypeCode;
  /** Regulatory or colloquial name, e.g. "MVPI (Fahas)" */
  label: string;
  /** Recommended recurrence in months */
  months: number;
}

export interface CountryTax {
  /** Standard rate, percent (0 when no general consumption tax) */
  rate: number;
  /** "VAT", "KDV", "GST", "Sales tax" */
  label: string;
  /** What the tax registration id is called locally, e.g. "TRN" */
  registrationLabel: string;
  note?: string;
}

export interface CountryConfig {
  code: string;
  name: string;
  region: "middle-east" | "other";
  currency: string;
  /** Minor-unit digits (informational; Intl derives it from the currency) */
  currencyDecimals: number;
  /** BCP-47 locale used for date/number/currency formatting */
  locale: string;
  /** Default IANA timezone offered at onboarding */
  timezone: string;
  distanceUnit: "km" | "mi";
  volumeUnit: "L" | "gal";
  /** 0 = Sunday, 1 = Monday, 6 = Saturday */
  weekStart: 0 | 1 | 6;
  tax: CountryTax;
  regulations: {
    renewals: CountryRenewalDefault[];
    notes?: string[];
  };
}

const NO_TAX: CountryTax = { rate: 0, label: "Tax", registrationLabel: "Tax number" };

const GENERIC_RENEWALS: CountryRenewalDefault[] = [
  { type: "registration", label: "Vehicle registration", months: 12 },
  { type: "insurance", label: "Vehicle insurance", months: 12 },
];

function other(
  code: string,
  name: string,
  currency: string,
  timezone: string,
  opts: Partial<Pick<CountryConfig, "distanceUnit" | "volumeUnit" | "weekStart" | "locale" | "currencyDecimals" | "tax">> = {},
): CountryConfig {
  return {
    code,
    name,
    region: "other",
    currency,
    currencyDecimals: opts.currencyDecimals ?? 2,
    locale: opts.locale ?? `en-${code}`,
    timezone,
    distanceUnit: opts.distanceUnit ?? "km",
    volumeUnit: opts.volumeUnit ?? "L",
    weekStart: opts.weekStart ?? 1,
    tax: opts.tax ?? NO_TAX,
    regulations: { renewals: GENERIC_RENEWALS },
  };
}

/** Middle East entries — the detailed, regulation-aware set. */
const MIDDLE_EAST: CountryConfig[] = [
  {
    code: "AE", name: "United Arab Emirates", region: "middle-east",
    currency: "AED", currencyDecimals: 2, locale: "en-AE",
    timezone: "Asia/Dubai", distanceUnit: "km", volumeUnit: "L", weekStart: 1,
    tax: { rate: 5, label: "VAT", registrationLabel: "TRN" },
    regulations: {
      renewals: [
        { type: "registration", label: "Registration (Mulkiya)", months: 12 },
        { type: "roadworthiness", label: "Vehicle testing (RTA/ADP)", months: 12 },
        { type: "insurance", label: "Motor insurance", months: 12 },
      ],
      notes: ["Registration renewal requires passing the annual vehicle test for vehicles over 3 years old."],
    },
  },
  {
    code: "SA", name: "Saudi Arabia", region: "middle-east",
    currency: "SAR", currencyDecimals: 2, locale: "en-SA",
    timezone: "Asia/Riyadh", distanceUnit: "km", volumeUnit: "L", weekStart: 0,
    tax: { rate: 15, label: "VAT", registrationLabel: "VAT registration number (TIN)" },
    regulations: {
      renewals: [
        { type: "registration", label: "Registration (Istimara)", months: 12 },
        { type: "roadworthiness", label: "Periodic inspection (MVPI / Fahas)", months: 12 },
        { type: "insurance", label: "Motor insurance", months: 12 },
      ],
    },
  },
  {
    code: "QA", name: "Qatar", region: "middle-east",
    currency: "QAR", currencyDecimals: 2, locale: "en-QA",
    timezone: "Asia/Qatar", distanceUnit: "km", volumeUnit: "L", weekStart: 0,
    tax: { rate: 0, label: "VAT", registrationLabel: "Tax number", note: "No VAT in force yet; a 5% GCC-framework VAT is anticipated." },
    regulations: {
      renewals: [
        { type: "registration", label: "Registration (Istimara)", months: 12 },
        { type: "roadworthiness", label: "Fahes technical inspection", months: 12 },
        { type: "insurance", label: "Motor insurance", months: 12 },
      ],
    },
  },
  {
    code: "KW", name: "Kuwait", region: "middle-east",
    currency: "KWD", currencyDecimals: 3, locale: "en-KW",
    timezone: "Asia/Kuwait", distanceUnit: "km", volumeUnit: "L", weekStart: 0,
    tax: { rate: 0, label: "VAT", registrationLabel: "Tax number", note: "No VAT in force yet." },
    regulations: {
      renewals: [
        { type: "registration", label: "Vehicle registration", months: 12 },
        { type: "roadworthiness", label: "Technical inspection", months: 12 },
        { type: "insurance", label: "Motor insurance", months: 12 },
      ],
    },
  },
  {
    code: "BH", name: "Bahrain", region: "middle-east",
    currency: "BHD", currencyDecimals: 3, locale: "en-BH",
    timezone: "Asia/Bahrain", distanceUnit: "km", volumeUnit: "L", weekStart: 0,
    tax: { rate: 10, label: "VAT", registrationLabel: "VAT account number" },
    regulations: {
      renewals: [
        { type: "registration", label: "Vehicle registration", months: 12 },
        { type: "roadworthiness", label: "Technical inspection", months: 12 },
        { type: "insurance", label: "Motor insurance", months: 12 },
      ],
    },
  },
  {
    code: "OM", name: "Oman", region: "middle-east",
    currency: "OMR", currencyDecimals: 3, locale: "en-OM",
    timezone: "Asia/Muscat", distanceUnit: "km", volumeUnit: "L", weekStart: 0,
    tax: { rate: 5, label: "VAT", registrationLabel: "VATIN" },
    regulations: {
      renewals: [
        { type: "registration", label: "Registration (Mulkiya)", months: 12 },
        { type: "roadworthiness", label: "Technical inspection", months: 12 },
        { type: "insurance", label: "Motor insurance", months: 12 },
      ],
    },
  },
  {
    code: "YE", name: "Yemen", region: "middle-east",
    currency: "YER", currencyDecimals: 0, locale: "en-YE",
    timezone: "Asia/Aden", distanceUnit: "km", volumeUnit: "L", weekStart: 0,
    tax: { rate: 5, label: "GST", registrationLabel: "Tax number" },
    regulations: { renewals: GENERIC_RENEWALS },
  },
  {
    code: "IQ", name: "Iraq", region: "middle-east",
    currency: "IQD", currencyDecimals: 0, locale: "en-IQ",
    timezone: "Asia/Baghdad", distanceUnit: "km", volumeUnit: "L", weekStart: 0,
    tax: { rate: 0, label: "Sales tax", registrationLabel: "Tax number", note: "No general VAT; selective sales taxes apply to specific goods and services." },
    regulations: { renewals: GENERIC_RENEWALS },
  },
  {
    code: "IR", name: "Iran", region: "middle-east",
    currency: "IRR", currencyDecimals: 0, locale: "en-IR",
    timezone: "Asia/Tehran", distanceUnit: "km", volumeUnit: "L", weekStart: 6,
    tax: { rate: 10, label: "VAT", registrationLabel: "Tax number" },
    regulations: {
      renewals: [
        { type: "registration", label: "Vehicle registration", months: 12 },
        { type: "roadworthiness", label: "Technical inspection (Moayene Fanni)", months: 12 },
        { type: "insurance", label: "Third-party insurance", months: 12 },
      ],
    },
  },
  {
    code: "JO", name: "Jordan", region: "middle-east",
    currency: "JOD", currencyDecimals: 3, locale: "en-JO",
    timezone: "Asia/Amman", distanceUnit: "km", volumeUnit: "L", weekStart: 0,
    tax: { rate: 16, label: "GST", registrationLabel: "Tax number" },
    regulations: {
      renewals: [
        { type: "registration", label: "Vehicle license", months: 12 },
        { type: "roadworthiness", label: "Mechanical inspection", months: 12 },
        { type: "insurance", label: "Motor insurance", months: 12 },
      ],
    },
  },
  {
    code: "LB", name: "Lebanon", region: "middle-east",
    currency: "LBP", currencyDecimals: 0, locale: "en-LB",
    timezone: "Asia/Beirut", distanceUnit: "km", volumeUnit: "L", weekStart: 1,
    tax: { rate: 11, label: "VAT", registrationLabel: "VAT number" },
    regulations: {
      renewals: [
        { type: "registration", label: "Vehicle registration", months: 12 },
        { type: "roadworthiness", label: "Mécanique inspection", months: 12 },
        { type: "insurance", label: "Motor insurance", months: 12 },
      ],
    },
  },
  {
    code: "SY", name: "Syria", region: "middle-east",
    currency: "SYP", currencyDecimals: 0, locale: "en-SY",
    timezone: "Asia/Damascus", distanceUnit: "km", volumeUnit: "L", weekStart: 0,
    tax: NO_TAX,
    regulations: { renewals: GENERIC_RENEWALS },
  },
  {
    code: "IL", name: "Israel", region: "middle-east",
    currency: "ILS", currencyDecimals: 2, locale: "en-IL",
    timezone: "Asia/Jerusalem", distanceUnit: "km", volumeUnit: "L", weekStart: 0,
    tax: { rate: 18, label: "VAT", registrationLabel: "VAT number (Osek Murshe)" },
    regulations: {
      renewals: [
        { type: "registration", label: "Vehicle license (Rishyon Rechev)", months: 12 },
        { type: "roadworthiness", label: "Annual test (Test)", months: 12 },
        { type: "insurance", label: "Compulsory insurance (Bituach Chova)", months: 12 },
      ],
    },
  },
  {
    code: "PS", name: "Palestine", region: "middle-east",
    currency: "ILS", currencyDecimals: 2, locale: "en-PS",
    timezone: "Asia/Hebron", distanceUnit: "km", volumeUnit: "L", weekStart: 0,
    tax: { rate: 16, label: "VAT", registrationLabel: "VAT number" },
    regulations: { renewals: GENERIC_RENEWALS },
  },
  {
    code: "EG", name: "Egypt", region: "middle-east",
    currency: "EGP", currencyDecimals: 2, locale: "en-EG",
    timezone: "Africa/Cairo", distanceUnit: "km", volumeUnit: "L", weekStart: 0,
    tax: { rate: 14, label: "VAT", registrationLabel: "Tax registration number" },
    regulations: {
      renewals: [
        { type: "registration", label: "Vehicle license", months: 12 },
        { type: "roadworthiness", label: "Technical inspection", months: 12 },
        { type: "insurance", label: "Motor insurance", months: 12 },
      ],
    },
  },
  {
    code: "TR", name: "Türkiye", region: "middle-east",
    currency: "TRY", currencyDecimals: 2, locale: "en-TR",
    timezone: "Europe/Istanbul", distanceUnit: "km", volumeUnit: "L", weekStart: 1,
    tax: { rate: 20, label: "KDV", registrationLabel: "Vergi numarası (tax number)" },
    regulations: {
      renewals: [
        { type: "roadworthiness", label: "Araç muayenesi (TÜVTÜRK)", months: 12 },
        { type: "insurance", label: "Trafik sigortası", months: 12 },
        { type: "emission_test", label: "Egzoz emisyon ölçümü", months: 12 },
      ],
      notes: ["Commercial vehicles are inspected annually; private cars every two years."],
    },
  },
];

/** Rest-of-world entries (previously supported onboarding list, unchanged behavior). */
const OTHERS: CountryConfig[] = [
  other("US", "United States", "USD", "America/New_York", { distanceUnit: "mi", volumeUnit: "gal", weekStart: 0 }),
  other("GB", "United Kingdom", "GBP", "Europe/London", { distanceUnit: "mi" }),
  other("IN", "India", "INR", "Asia/Kolkata", { weekStart: 0 }),
  other("AU", "Australia", "AUD", "Australia/Sydney"),
  other("CA", "Canada", "CAD", "America/Toronto", { weekStart: 0 }),
  other("DE", "Germany", "EUR", "Europe/Berlin"),
  other("FR", "France", "EUR", "Europe/Paris"),
  other("ES", "Spain", "EUR", "Europe/Madrid"),
  other("IT", "Italy", "EUR", "Europe/Rome"),
  other("NL", "Netherlands", "EUR", "Europe/Amsterdam"),
  other("SG", "Singapore", "SGD", "Asia/Singapore", { weekStart: 0 }),
  other("CH", "Switzerland", "CHF", "Europe/Zurich"),
  other("SE", "Sweden", "SEK", "Europe/Stockholm"),
  other("NO", "Norway", "NOK", "Europe/Oslo"),
  other("DK", "Denmark", "DKK", "Europe/Copenhagen"),
  other("NZ", "New Zealand", "NZD", "Pacific/Auckland"),
  other("ZA", "South Africa", "ZAR", "Africa/Johannesburg", { weekStart: 0 }),
  other("BR", "Brazil", "BRL", "America/Sao_Paulo", { weekStart: 0 }),
  other("MX", "Mexico", "MXN", "America/Mexico_City", { weekStart: 0 }),
  other("NG", "Nigeria", "NGN", "Africa/Lagos", { weekStart: 0 }),
  other("KE", "Kenya", "KES", "Africa/Nairobi", { weekStart: 0 }),
  other("PL", "Poland", "PLN", "Europe/Warsaw"),
  other("ID", "Indonesia", "IDR", "Asia/Jakarta", { currencyDecimals: 0, weekStart: 0 }),
  other("MY", "Malaysia", "MYR", "Asia/Kuala_Lumpur"),
  other("TH", "Thailand", "THB", "Asia/Bangkok", { weekStart: 0 }),
  other("PH", "Philippines", "PHP", "Asia/Manila", { weekStart: 0 }),
  other("VN", "Vietnam", "VND", "Asia/Ho_Chi_Minh", { currencyDecimals: 0 }),
  other("KR", "South Korea", "KRW", "Asia/Seoul", { currencyDecimals: 0, weekStart: 0 }),
  other("JP", "Japan", "JPY", "Asia/Tokyo", { currencyDecimals: 0, weekStart: 0 }),
  other("CN", "China", "CNY", "Asia/Shanghai"),
];

export const COUNTRIES: Record<string, CountryConfig> = Object.fromEntries(
  [...MIDDLE_EAST, ...OTHERS].map((c) => [c.code, c]),
);

const FALLBACK: CountryConfig = other("XX", "Other", "USD", "UTC", { weekStart: 1 });

/** Resolve a country config; unknown codes get a safe generic fallback. */
export function getCountry(code: string | null | undefined): CountryConfig {
  return (code && COUNTRIES[code.toUpperCase()]) || FALLBACK;
}

export function isSupportedCountry(code: string): boolean {
  return Boolean(COUNTRIES[code.toUpperCase()]);
}

export function middleEastCountries(): CountryConfig[] {
  return MIDDLE_EAST.slice().sort((a, b) => a.name.localeCompare(b.name));
}

export function otherCountries(): CountryConfig[] {
  return OTHERS.slice().sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Tax helpers — line amounts are entered NET; tax is added on top.
// ---------------------------------------------------------------------------

export interface TaxBreakdown {
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  total: number;
}

export function taxBreakdown(subtotal: number, taxRate: number, decimals = 2): TaxBreakdown {
  const safeRate = Number.isFinite(taxRate) && taxRate > 0 ? taxRate : 0;
  const f = 10 ** decimals;
  const taxAmount = Math.round(((subtotal * safeRate) / 100) * f) / f; // subtotal * rate% rounded to the currency's minor units
  return { subtotal, taxRate: safeRate, taxAmount, total: subtotal + taxAmount };
}
