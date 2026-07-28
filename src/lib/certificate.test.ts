import { describe, expect, it } from "vitest";
import {
  buildUin,
  resolveUin,
  formatDocumentDate,
  formatSpeedBand,
  registrationLine,
  toArabicDigits,
  type RegistrationLabels,
} from "./certificate";

const EN: RegistrationLabels = {
  cr: "C.R.No.{value}",
  poBox: "P.O. Box: {value}",
  postalCode: "Postal Code: {value}",
  website: "Website: {value}",
  phone: "Service & Support: {value}",
  phoneSecondary: "Alternative Contact: {value}",
  separator: ", ",
};

const AR: RegistrationLabels = {
  cr: "س.ت: {value}",
  poBox: "ص.ب: {value}",
  postalCode: "الرمز البريدي: {value}",
  website: "الموقع الإلكتروني: {value}",
  phone: "الخدمة والدعم: {value}",
  phoneSecondary: "رقم بديل: {value}",
  separator: "، ",
};

// U+2068 FIRST STRONG ISOLATE / U+2069 POP DIRECTIONAL ISOLATE / U+00A0 NO-BREAK
// SPACE. Spelled by codepoint because all three are invisible: pasted literally
// into an assertion they would be indistinguishable from a stray character or
// from an ordinary space.
const FSI = String.fromCodePoint(0x2068);
const PDI = String.fromCodePoint(0x2069);
const NBSP = String.fromCodePoint(0x00a0);

/** "+968 7521 7675" as it must appear inside a label's `{value}` slot. */
const pinned = (digits: string) => FSI + digits.replaceAll(" ", NBSP) + PDI;

describe("toArabicDigits", () => {
  it("maps every Latin digit and leaves other characters alone", () => {
    expect(toArabicDigits("0123456789")).toBe("٠١٢٣٤٥٦٧٨٩");
    expect(toArabicDigits("P.O. Box: 2087")).toBe("P.O. Box: ٢٠٨٧");
    expect(toArabicDigits("مسقط")).toBe("مسقط");
  });
});

describe("formatSpeedBand", () => {
  it("prints both programmed bands as the pair the document uses", () => {
    expect(formatSpeedBand(70, 90, "KMPH")).toBe("70/90 KMPH");
  });

  it("prints a single band when only one speed was certified", () => {
    expect(formatSpeedBand(80, null, "KMPH")).toBe("80 KMPH");
    expect(formatSpeedBand(null, 90, "KMPH")).toBe("90 KMPH");
  });

  it("returns null when nothing was certified, so the caller can dash it", () => {
    expect(formatSpeedBand(null, null, "KMPH")).toBeNull();
    expect(formatSpeedBand(undefined, undefined, "KMPH")).toBeNull();
  });

  it("keeps a zero band rather than treating it as absent", () => {
    expect(formatSpeedBand(0, 90, "KMPH")).toBe("0/90 KMPH");
  });
});

describe("formatDocumentDate", () => {
  it("renders DD-MM-YYYY regardless of locale", () => {
    expect(formatDocumentDate("2022-08-03")).toBe("03-08-2022");
    expect(formatDocumentDate("2026-08-02")).toBe("02-08-2026");
  });

  it("accepts a timestamp and keeps the calendar date", () => {
    expect(formatDocumentDate("2026-01-09T22:15:00Z")).toBe("09-01-2026");
  });

  it("returns null for missing or unparseable input", () => {
    expect(formatDocumentDate(null)).toBeNull();
    expect(formatDocumentDate("")).toBeNull();
    expect(formatDocumentDate("not-a-date")).toBeNull();
  });
});

describe("buildUin", () => {
  it("builds OM-<last 5 chassis digits>-<document number>", () => {
    expect(buildUin("JHHLCK1F7PK026626", "GOM-WO-202601")).toBe("OM-26626-202601");
  });

  it("counts digits, not characters, so letters in the chassis are skipped", () => {
    // ...1C5837 — the naive last five characters would be "C5837".
    expect(buildUin("RA6PAEHD3RU1C5837", "GOM-WO-202602")).toBe("OM-15837-202602");
  });

  it("left-pads a chassis with fewer than five digits", () => {
    expect(buildUin("AB12", "GOM-WO-202604")).toBe("OM-00012-202604");
  });

  it("takes the numeric tail of the document number", () => {
    expect(buildUin("JHHLCK1F7PK026626", "SOM-WS-00486")).toBe("OM-26626-00486");
    expect(buildUin("JHHLCK1F7PK026626", "202607")).toBe("OM-26626-202607");
  });

  it("returns null when there is nothing to derive from", () => {
    expect(buildUin("ABCDEF", "GOM-WO-202605")).toBeNull();
    expect(buildUin(null, "GOM-WO-202606")).toBeNull();
    expect(buildUin("JHHLCK1F7PK026626", "")).toBeNull();
    expect(buildUin(undefined, undefined)).toBeNull();
  });
});

describe("resolveUin", () => {
  const CHASSIS = "JHHLCK1F7PK026626";

  it("mints a UIN for a limiter that has none yet", () => {
    expect(resolveUin(null, CHASSIS, "GOM-WO-202601")).toBe("OM-26626-202601");
  });

  it("reprints the recorded UIN on renewal instead of minting a new one", () => {
    // The renewal allocates a fresh document number, but the limiter keeps its
    // number for life — this is the whole point of the rule.
    expect(resolveUin("OM-26626-202601", CHASSIS, "GOM-WO-202699")).toBe(
      "OM-26626-202601",
    );
  });

  it("never overwrites a real ROP-issued number with a derived one", () => {
    expect(resolveUin("OM-8626-102013", CHASSIS, "GOM-WO-202601")).toBe(
      "OM-8626-102013",
    );
  });

  it("treats a blank recorded value as absent", () => {
    expect(resolveUin("   ", CHASSIS, "GOM-WO-202601")).toBe("OM-26626-202601");
  });

  it("stays null when nothing is recorded and nothing can be derived", () => {
    expect(resolveUin(null, null, "GOM-WO-202601")).toBeNull();
  });
});

describe("registrationLine", () => {
  const block = {
    crNumber: "1170010",
    poBox: "2087",
    postalCode: "131",
    locality: "Muscat, Sultanate of Oman",
    website: "gawhrat.com",
    phone: "+968 7521 7675",
    phoneSecondary: "+968 9040 7893",
  };

  it("composes the English footer line in document order", () => {
    // Registration identifiers, locality, website, then each number under its
    // own label — the order the dealer's printed footer reads in.
    expect(registrationLine(block, EN)).toBe(
      "C.R.No.1170010, P.O. Box: 2087, Postal Code: 131, " +
        "Muscat, Sultanate of Oman, Website: gawhrat.com, " +
        `Service & Support: ${pinned("+968 7521 7675")}, ` +
        `Alternative Contact: ${pinned("+968 9040 7893")}`,
    );
  });

  it("composes the Arabic line with Arabic-Indic digits and comma", () => {
    expect(
      registrationLine(
        { ...block, locality: "مسقط، سلطنة عمان" },
        AR,
        toArabicDigits,
      ),
    ).toBe(
      "س.ت: ١١٧٠٠١٠، ص.ب: ٢٠٨٧، الرمز البريدي: ١٣١، " +
        "مسقط، سلطنة عمان، الموقع الإلكتروني: gawhrat.com، " +
        `الخدمة والدعم: ${pinned("+٩٦٨ ٧٥٢١ ٧٦٧٥")}، ` +
        `رقم بديل: ${pinned("+٩٦٨ ٩٠٤٠ ٧٨٩٣")}`,
    );
  });

  it("isolates each phone value, not its label", () => {
    // The isolates must hug the number. Wrapping the label too would drag the
    // Arabic words into an LTR run and break the line instead of the number.
    const line = registrationLine({ phone: "+968 7521 7675" }, AR, toArabicDigits);
    expect(line).toBe(`الخدمة والدعم: ${pinned("+٩٦٨ ٧٥٢١ ٧٦٧٥")}`);
    expect(line.startsWith(FSI)).toBe(false);
    expect(line.endsWith(PDI)).toBe(true);
    // The label keeps its ordinary space; only the number's spaces are bound.
    expect(line.slice(0, line.indexOf(FSI))).not.toContain(NBSP);
  });

  it("binds the digit groups of a phone with no-break spaces", () => {
    // Verified against the Unicode bidi algorithm, not assumed. Arabic-Indic
    // digits are class AN, and an ordinary space between two AN runs resolves
    // to R (rule N1) — which splits the number into chunks laid out
    // right-to-left, so "+968 7521 7675" reaches paper as "+٧٦٧٥ ٧٥٢١ ٩٦٨".
    // U+00A0 is a common separator that rule W4 folds into the number, keeping
    // it one unbroken run. The isolate alone does NOT fix this; it only fixes
    // the leading "+". Both are needed, so both are asserted.
    const line = registrationLine({ phone: "+968 7521 7675" }, AR, toArabicDigits);
    expect(line).toContain(`+٩٦٨${NBSP}٧٥٢١${NBSP}٧٦٧٥`);
    expect(line).not.toContain("٩٦٨ ٧٥٢١"); // no ordinary space survives inside
  });

  it("collapses any run of whitespace in a phone into a single bound space", () => {
    // Tenants type numbers by hand; a stray double space would otherwise leave
    // an unbound gap the bidi algorithm can still break the number across.
    expect(registrationLine({ phone: "+968  7521\t7675" }, EN)).toBe(
      `Service & Support: ${pinned("+968 7521 7675")}`,
    );
  });

  it("keeps the website in Latin digits on the Arabic pass", () => {
    // A domain is a machine-readable address, not prose: "٢٤auto.om" is not
    // reachable. Contrast the postal code beside it, which does convert.
    expect(
      registrationLine({ postalCode: "131", website: "24auto.om" }, AR, toArabicDigits),
    ).toBe("الرمز البريدي: ١٣١، الموقع الإلكتروني: 24auto.om");
  });

  it("leaves the e-mail address to the caller", () => {
    // The certificate prints e-mail on its own line below this one, matching the
    // dealer's scanned original, so it is deliberately not a segment here — and
    // that also spares the address the Arabic-Indic conversion a domain cannot
    // survive. `RegistrationBlock` has no email field; nothing leaks in.
    const tenantWithEmail = { crNumber: "1170010", email: "sales@gawhrat.com" };
    expect(registrationLine(tenantWithEmail, EN)).toBe("C.R.No.1170010");
  });

  it("drops empty fields together with their labels", () => {
    expect(
      registrationLine({ crNumber: "1170010", poBox: "  ", website: "" }, EN),
    ).toBe("C.R.No.1170010");
  });

  it("prints a lone contact number under its own label", () => {
    // A tenant with one line must not print a dangling separator or an empty
    // "Alternative Contact:".
    expect(registrationLine({ phone: "+968 7521 7675" }, EN)).toBe(
      `Service & Support: ${pinned("+968 7521 7675")}`,
    );
    expect(registrationLine({ phoneSecondary: "+968 9040 7893" }, EN)).toBe(
      `Alternative Contact: ${pinned("+968 9040 7893")}`,
    );
  });

  it("is empty when the tenant has configured no registration block", () => {
    expect(registrationLine({}, EN)).toBe("");
  });
});
