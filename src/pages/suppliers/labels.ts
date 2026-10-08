import type { BadgeTone } from "../../components/ui";
import type { MessageKey, Language } from "../../i18n";
import type { Supplier, SupplierStatus, SupplierType } from "../../lib/types";

export const supplierTypes: Record<SupplierType, MessageKey> = {
  parts: "suppliers.typeLabel.parts",
  fuel: "suppliers.typeLabel.fuel",
  service: "suppliers.typeLabel.service",
  insurance: "suppliers.typeLabel.insurance",
  carrier: "suppliers.typeLabel.carrier",
  leasing: "suppliers.typeLabel.leasing",
  utilities: "suppliers.typeLabel.utilities",
  equipment: "suppliers.typeLabel.equipment",
  other: "suppliers.typeLabel.other",
};

export const supplierStatus: Record<SupplierStatus, { labelKey: MessageKey; tone: BadgeTone }> = {
  active: { labelKey: "suppliers.status.active", tone: "green" },
  inactive: { labelKey: "suppliers.status.inactive", tone: "slate" },
  // Blocked is a decision someone made, not an alarm to act on — but it does
  // stop purchasing, so it reads stronger than inactive.
  blocked: { labelKey: "suppliers.status.blocked", tone: "red" },
};

/** The name a reader of this language expects first; the other one is secondary. */
export function supplierNames(
  s: Pick<Supplier, "name" | "name_ar">,
  language: Language,
): { primary: string; secondary: string | null } {
  if (language === "ar" && s.name_ar) return { primary: s.name_ar, secondary: s.name };
  return { primary: s.name, secondary: s.name_ar };
}
