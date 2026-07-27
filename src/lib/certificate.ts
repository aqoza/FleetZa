/**
 * Pure text rules for the official Road Speed Limiter certificate — the Omani
 * dealer format described in docs/SPEED_LIMITERS.md.
 *
 * The document is bilingual and legally consequential, so its number and date
 * rendering lives here rather than inside the print page: it is unit-tested,
 * and it deliberately does *not* follow the tenant's UI locale (a certificate
 * reads the same in Muscat and in Dubai).
 */

const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";

/** Latin → Arabic-Indic digits, for the Arabic half of a bilingual document. */
export function toArabicDigits(value: string): string {
  return value.replace(/[0-9]/g, (d) => ARABIC_INDIC[Number(d)]);
}

/**
 * The certified speed exactly as the certificate prints it. Omani limiters are
 * programmed with two bands and the document shows the pair ("70/90 KMPH"); a
 * single-band installation prints one number. Returns null when no speed was
 * certified so the caller can fall back to the document's dash.
 */
export function formatSpeedBand(
  primary: number | null | undefined,
  secondary: number | null | undefined,
  unit: string,
): string | null {
  const bands = [primary, secondary].filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v),
  );
  if (bands.length === 0) return null;
  return `${bands.join("/")} ${unit}`;
}

/**
 * DD-MM-YYYY. Official documents state dates unambiguously and identically in
 * both languages, so this bypasses Intl (whose `medium` style would render
 * "3 Aug 2022" in English and switch numerals under an Arabic locale).
 */
export function formatDocumentDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return null;
  const [, year, month, day] = match;
  return `${day}-${month}-${year}`;
}

/**
 * The UIN printed on the certificate: `OM-<last 5 chassis digits>-<document
 * number>`, e.g. chassis JHHLCK1F7PK026626 on certificate GOM-WO-202601 gives
 * OM-26626-202601. Letters in the chassis are ignored — the rule counts digits
 * — and a chassis with fewer than five is left-padded to keep the segment a
 * fixed width.
 *
 * Returns null when there is nothing to derive from, so the caller keeps
 * whatever UIN was recorded rather than printing a malformed identifier.
 *
 * Mirrors `app.build_uin` in the database (see the RSL migrations); the two
 * must agree, because certificates are issued through both paths.
 */
export function buildUin(
  chassis: string | null | undefined,
  certificateNumber: string | null | undefined,
): string | null {
  const digits = (chassis ?? "").replace(/\D/g, "");
  const number = (certificateNumber ?? "").trim();
  if (!digits || !number) return null;
  // The document number's numeric tail: "GOM-WO-202601" → "202601".
  const tail = number.slice(number.lastIndexOf("-") + 1) || number;
  return `OM-${digits.slice(-5).padStart(5, "0")}-${tail}`;
}

export interface RegistrationBlock {
  crNumber?: string | null;
  poBox?: string | null;
  postalCode?: string | null;
  /** Locality as the dealer writes it, e.g. "Muscat, Sultanate of Oman". */
  locality?: string | null;
  phones?: (string | null | undefined)[];
}

/** Label templates for one language; each carries its own `{value}` slot. */
export interface RegistrationLabels {
  cr: string;
  poBox: string;
  postalCode: string;
  gsm: string;
  /** ", " in English, "، " in Arabic. */
  separator: string;
}

/**
 * The footer registration line: "C.R.No.1170010, P.O. Box: 2087, Postal Code:
 * 131, Muscat, Sultanate of Oman, GSM: 77227939 / 90407893". Empty fields drop
 * out with their label, so a partially configured tenant still prints a clean
 * line. `digits` converts numerals for the Arabic pass.
 */
export function registrationLine(
  block: RegistrationBlock,
  labels: RegistrationLabels,
  digits: (value: string) => string = (value) => value,
): string {
  const fill = (template: string, value: string) =>
    template.replaceAll("{value}", digits(value));

  const phones = (block.phones ?? [])
    .map((p) => p?.trim())
    .filter((p): p is string => Boolean(p))
    .join(" / ");

  const segments = [
    block.crNumber?.trim() && fill(labels.cr, block.crNumber.trim()),
    block.poBox?.trim() && fill(labels.poBox, block.poBox.trim()),
    block.postalCode?.trim() && fill(labels.postalCode, block.postalCode.trim()),
    block.locality?.trim() && digits(block.locality.trim()),
    phones && fill(labels.gsm, phones),
  ].filter((s): s is string => Boolean(s));

  return segments.join(labels.separator);
}
