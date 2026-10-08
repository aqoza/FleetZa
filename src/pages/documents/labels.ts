import type { BadgeTone } from "../../components/ui";
import type { MessageKey } from "../../i18n";
import type { ExpiryState } from "../../lib/documents";
import type { DocCategory, LinkType } from "./types";

export const categoryLabels: Record<DocCategory, MessageKey> = {
  general: "documents.categoryLabel.general",
  contract: "documents.categoryLabel.contract",
  invoice: "documents.categoryLabel.invoice",
  receipt: "documents.categoryLabel.receipt",
  photo: "documents.categoryLabel.photo",
  license: "documents.categoryLabel.license",
  insurance: "documents.categoryLabel.insurance",
  permit: "documents.categoryLabel.permit",
  report: "documents.categoryLabel.report",
  certificate: "documents.categoryLabel.certificate",
  other: "documents.categoryLabel.other",
};

export const expiryMeta: Record<ExpiryState, { labelKey: MessageKey; tone: BadgeTone }> = {
  none: { labelKey: "documents.expiryState.none", tone: "slate" },
  ok: { labelKey: "documents.expiryState.ok", tone: "green" },
  soon: { labelKey: "documents.expiryState.soon", tone: "yellow" },
  expired: { labelKey: "documents.expiryState.expired", tone: "red" },
};

/**
 * Linkable record types: the module that owns the table and where its record
 * opens. Employee files are visible to managers and the employee themself
 * (documents RLS), so linking one narrows who can see the document.
 */
export const linkTypes: Record<LinkType, { labelKey: MessageKey; module: string; href: (id: string) => string }> = {
  vehicle: { labelKey: "documents.entity.vehicle", module: "fleet", href: (id) => `/vehicles/${id}` },
  driver: { labelKey: "documents.entity.driver", module: "drivers", href: () => "/drivers" },
  customer: { labelKey: "documents.entity.customer", module: "customers", href: (id) => `/customers/${id}` },
  supplier: { labelKey: "documents.entity.supplier", module: "suppliers", href: (id) => `/suppliers/${id}` },
  employee: { labelKey: "documents.entity.employee", module: "employees", href: (id) => `/employees/${id}` },
};

/** Label for any stored entity_type, including ones other modules write (hr_*). */
export function entityTypeLabel(entityType: string): MessageKey {
  if (entityType in linkTypes) return linkTypes[entityType as LinkType].labelKey;
  if (entityType.startsWith("hr_")) return "documents.entity.hr";
  return "documents.entity.other";
}
