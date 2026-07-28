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
 * The UIN format: `OM-<last 5 chassis digits>-<document number>`, e.g. chassis
 * JHHLCK1F7PK026626 on certificate GOM-WO-202601 gives OM-26626-202601. Letters
 * in the chassis are ignored — the rule counts digits — and a chassis with
 * fewer than five is left-padded to keep the segment a fixed width.
 *
 * Returns null when there is nothing to derive from, so the caller keeps
 * whatever UIN was recorded rather than printing a malformed identifier.
 *
 * Use `resolveUin` rather than calling this directly: the number identifies the
 * *installation*, so it is only derived for a limiter that has none yet.
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

/**
 * The UIN for a certificate about to be issued.
 *
 * The number identifies the fitted limiter, not the document, so it is minted
 * **once** — on the first certificate issued for an installation — and every
 * later renewal reprints it. A number already recorded (typed by a technician,
 * carried by the installation, or copied from the certificate being renewed)
 * therefore always wins; deriving is the last resort.
 *
 * Mirrors the precedence in `issue_certificate`.
 */
export function resolveUin(
  recorded: string | null | undefined,
  chassis: string | null | undefined,
  certificateNumber: string | null | undefined,
): string | null {
  const existing = recorded?.trim();
  if (existing) return existing;
  return buildUin(chassis, certificateNumber);
}

/**
 * U+2068 FIRST STRONG ISOLATE / U+2069 POP DIRECTIONAL ISOLATE — the text-level
 * equivalent of `<bdi>`, for values embedded in a string that has no markup.
 */
const FIRST_STRONG_ISOLATE = String.fromCodePoint(0x2068);
const POP_DIRECTIONAL_ISOLATE = String.fromCodePoint(0x2069);

/** U+00A0 NO-BREAK SPACE. */
const NO_BREAK_SPACE = String.fromCodePoint(0x00a0);

/**
 * A phone number, pinned so the bidi algorithm cannot rearrange it inside the
 * `dir="rtl"` Arabic footer. A number written in full — "+968 7521 7675" — is
 * entirely weak or neutral to the algorithm, and it takes **two** fixes, both
 * verified against the Unicode bidi algorithm rather than assumed:
 *
 * 1. Isolates around the value. The leading "+" is neutral, so unisolated it
 *    resolves against the surrounding Arabic and migrates to the far end of the
 *    number, printing "٩٦٨+".
 * 2. No-break spaces *between the digit groups*. Arabic-Indic digits are bidi
 *    class AN, and an ordinary space between two AN runs resolves to R (rule
 *    N1), which splits the number into chunks that are then laid out
 *    right-to-left: "+968 7521 7675" prints as "+٧٦٧٥ ٧٥٢١ ٩٦٨". U+00A0 is a
 *    common separator, which rule W4 folds *into* the number, keeping it one
 *    unbroken left-to-right run. It also stops a certificate line-breaking in
 *    the middle of a phone number, which is worth having on its own.
 *
 * Neither fix is sufficient alone; the isolate corrects the "+" and the
 * no-break spaces correct the groups. See the bidi cases in the test file.
 */
function isolatePhone(value: string): string {
  const bound = value.replace(/\s+/g, NO_BREAK_SPACE);
  return `${FIRST_STRONG_ISOLATE}${bound}${POP_DIRECTIONAL_ISOLATE}`;
}

export interface RegistrationBlock {
  crNumber?: string | null;
  poBox?: string | null;
  postalCode?: string | null;
  /** Locality as the dealer writes it, e.g. "Muscat, Sultanate of Oman". */
  locality?: string | null;
  /** Bare domain as the dealer writes it, e.g. "gawhrat.com". */
  website?: string | null;
  /** The number customers call for service — labelled in its own right. */
  phone?: string | null;
  /** The dealer's second line, labelled separately from `phone`. */
  phoneSecondary?: string | null;
}

/** Label templates for one language; each carries its own `{value}` slot. */
export interface RegistrationLabels {
  cr: string;
  poBox: string;
  postalCode: string;
  website: string;
  /** e.g. "Service & Support: {value}". */
  phone: string;
  /** e.g. "Alternative Contact: {value}". */
  phoneSecondary: string;
  /** ", " in English, "، " in Arabic. */
  separator: string;
}

/**
 * The footer registration line: "C.R.No.1170010, P.O. Box: 2087, Postal Code:
 * 131, Muscat, Sultanate of Oman, Website: gawhrat.com, Service & Support:
 * +968 7521 7675, Alternative Contact: +968 9040 7893".
 *
 * Order follows the printed document: the legal registration identifiers, then
 * the locality, then the website, then each contact number under its own label
 * (the dealer names them differently, so they are no longer slash-joined into
 * one "GSM:" segment). Empty fields drop out **with** their label, so a
 * partially configured tenant still prints a clean line.
 *
 * The e-mail address is deliberately *not* a segment here: the certificate
 * prints it on its own line below the registration line, matching the dealer's
 * scanned original, so the print page renders it separately.
 *
 * `digits` converts numerals for the Arabic pass. It is applied to the
 * registration identifiers and the phone numbers — those read as prose on an
 * Arabic document — but **never** to the website, which is a machine-readable
 * address: "24auto.om" rewritten as "٢٤auto.om" is not reachable. The same
 * reasoning applies to the e-mail the print page renders separately.
 */
export function registrationLine(
  block: RegistrationBlock,
  labels: RegistrationLabels,
  digits: (value: string) => string = (value) => value,
): string {
  const clean = (value: string | null | undefined) => value?.trim() || null;
  const fill = (template: string, value: string) =>
    template.replaceAll("{value}", value);
  /** A phone: numerals localised, then pinned against bidi reordering. */
  const contact = (template: string, value: string) =>
    fill(template, isolatePhone(digits(value)));

  const crNumber = clean(block.crNumber);
  const poBox = clean(block.poBox);
  const postalCode = clean(block.postalCode);
  const locality = clean(block.locality);
  const website = clean(block.website);
  const phone = clean(block.phone);
  const phoneSecondary = clean(block.phoneSecondary);

  const segments = [
    crNumber && fill(labels.cr, digits(crNumber)),
    poBox && fill(labels.poBox, digits(poBox)),
    postalCode && fill(labels.postalCode, digits(postalCode)),
    locality && digits(locality),
    website && fill(labels.website, website),
    phone && contact(labels.phone, phone),
    phoneSecondary && contact(labels.phoneSecondary, phoneSecondary),
  ].filter((s): s is string => Boolean(s));

  return segments.join(labels.separator);
}
