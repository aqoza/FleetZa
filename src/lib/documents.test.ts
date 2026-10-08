import { describe, expect, it } from "vitest";
import {
  daysBetween, defaultDocumentName, expiryState, formatBytes, parseTags, safeFileName, storagePath,
} from "./documents";

describe("documents helpers", () => {
  it("counts calendar days", () => {
    expect(daysBetween("2026-10-08", "2026-10-08")).toBe(0);
    expect(daysBetween("2026-10-08", "2026-11-07")).toBe(30);
    expect(daysBetween("2026-10-08", "2026-10-01")).toBe(-7);
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2);
  });

  it("buckets expiry", () => {
    expect(expiryState(null, "2026-10-08")).toBe("none");
    expect(expiryState("2026-10-07", "2026-10-08")).toBe("expired");
    expect(expiryState("2026-10-08", "2026-10-08")).toBe("soon");
    expect(expiryState("2026-11-07", "2026-10-08")).toBe("soon");
    expect(expiryState("2026-11-08", "2026-10-08")).toBe("ok");
  });

  it("makes storage-safe names", () => {
    expect(safeFileName("Mulkiya 2026 (scan).PDF")).toBe("Mulkiya-2026-scan.pdf");
    expect(safeFileName("../../etc/passwd")).toBe("etc-passwd");
    expect(safeFileName("عقد الإيجار.pdf")).toBe("عقد-الإيجار.pdf");
    expect(safeFileName("   ")).toBe("file");
    expect(safeFileName("archive.tar.gz")).toBe("archive.tar.gz");
    expect(safeFileName("x".repeat(300) + ".png")).toBe("x".repeat(100) + ".png");
  });

  it("builds the tenant-folder path", () => {
    expect(storagePath("t1", "d1", "a b.jpg")).toBe("t1/d1/a-b.jpg");
  });

  it("derives a default name", () => {
    expect(defaultDocumentName("Insurance card.jpeg")).toBe("Insurance card");
    expect(defaultDocumentName(".env")).toBe(".env");
  });

  it("formats sizes", () => {
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(25 * 1024 * 1024)).toBe("25 MB");
  });

  it("parses tags", () => {
    expect(parseTags("Truck 7, renewal,truck 7 ,\n, عقود، 2026")).toEqual(["Truck 7", "renewal", "عقود", "2026"]);
  });
});
