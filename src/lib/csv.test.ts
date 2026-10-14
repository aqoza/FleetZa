import { describe, expect, it } from "vitest";
import { csvEscape, serializeCsv } from "./csv";

describe("CSV downloads", () => {
  it("CSV-DOWNLOAD-001 preserves Unicode, commas, quotes and line breaks", () => {
    expect(serializeCsv([["Vehicle", "Cost"], ['عربة, "A"\r\nB', 30]]))
      .toBe('\uFEFFVehicle,Cost\r\n"عربة, ""A""\r\nB",30');
    expect(csvEscape("a\rb")).toBe('"a\rb"');
  });

  it("CSV-DOWNLOAD-002 treats formula-like names as text", () => {
    for (const text of ["=1+1", "+123", "-1+2", "@SUM(A1)", "  =1", "\t=1", "\r=1", "\n=1"]) {
      expect(csvEscape(text).replace(/^"/, "").startsWith("'")).toBe(true);
    }
    expect(csvEscape(-25)).toBe("-25");
    expect(csvEscape(0)).toBe("0");
    expect(csvEscape("20.00")).toBe("20.00");
  });

  it("exports empty cells and header-only reports", () => {
    expect(serializeCsv([["Vehicle", "Average"], ["Demo", ""]])).toBe("\uFEFFVehicle,Average\r\nDemo,");
    expect(serializeCsv([["Vehicle", "Average"]])).toBe("\uFEFFVehicle,Average");
  });
});
