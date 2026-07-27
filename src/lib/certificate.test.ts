import { describe, expect, it } from "vitest";
import {
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
  gsm: "GSM: {value}",
  separator: ", ",
};

const AR: RegistrationLabels = {
  cr: "س.ت: {value}",
  poBox: "ص.ب: {value}",
  postalCode: "الرمز البريدي: {value}",
  gsm: "نقال: {value}",
  separator: "، ",
};

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

describe("registrationLine", () => {
  const block = {
    crNumber: "1170010",
    poBox: "2087",
    postalCode: "131",
    locality: "Muscat, Sultanate of Oman",
    phones: ["77227939", "90407893"],
  };

  it("composes the English footer line in document order", () => {
    expect(registrationLine(block, EN)).toBe(
      "C.R.No.1170010, P.O. Box: 2087, Postal Code: 131, " +
        "Muscat, Sultanate of Oman, GSM: 77227939 / 90407893",
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
        "مسقط، سلطنة عمان، نقال: ٧٧٢٢٧٩٣٩ / ٩٠٤٠٧٨٩٣",
    );
  });

  it("drops empty fields together with their labels", () => {
    expect(
      registrationLine({ crNumber: "1170010", poBox: "  ", phones: [] }, EN),
    ).toBe("C.R.No.1170010");
  });

  it("prints a lone GSM number without the pair separator", () => {
    expect(registrationLine({ phones: ["77227939", null] }, EN)).toBe(
      "GSM: 77227939",
    );
  });

  it("is empty when the tenant has configured no registration block", () => {
    expect(registrationLine({}, EN)).toBe("");
  });
});
