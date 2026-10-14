import { describe, expect, it } from "vitest";
import { auditTableLabel } from "./auditLabels";
import { enSecurity } from "../i18n/messages/en/security";
import { arSecurity } from "../i18n/messages/ar/security";

describe("AUDIT-UI-001: activity labels", () => {
  it("localizes invoice activity in English and Arabic", () => {
    const english = (key: string) => (enSecurity as Record<string, unknown>)[key] as string;
    const arabic = (key: string) => (arSecurity as Record<string, unknown>)[key] as string;
    expect(auditTableLabel(english, "invoices")).toBe("Invoices");
    expect(auditTableLabel(arabic, "invoices")).toBe("الفواتير");
  });

  it("uses a localized fallback for new or unexpected tables", () => {
    const english = (key: string) => (enSecurity as Record<string, unknown>)[key] as string;
    expect(auditTableLabel(english, "future_module_records")).toBe("Record");
    expect(auditTableLabel(english, "")).toBe("Record");
  });
});
