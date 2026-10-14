import type { BadgeTone } from "../../components/ui";
import type { MessageKey } from "../../i18n";
import type { BillStatus, PoMove, PoStatus } from "../../lib/purchasing";

export const poStatus: Record<PoStatus, { labelKey: MessageKey; tone: BadgeTone }> = {
  draft: { labelKey: "purchasing.po.status.draft", tone: "slate" },
  sent: { labelKey: "purchasing.po.status.sent", tone: "blue" },
  confirmed: { labelKey: "purchasing.po.status.confirmed", tone: "purple" },
  partially_received: { labelKey: "purchasing.po.status.partially_received", tone: "yellow" },
  received: { labelKey: "purchasing.po.status.received", tone: "green" },
  closed: { labelKey: "purchasing.po.status.closed", tone: "slate" },
  canceled: { labelKey: "purchasing.po.status.canceled", tone: "slate" },
};

export const poMove: Record<PoMove, { labelKey: MessageKey; doneKey: MessageKey }> = {
  sent: { labelKey: "purchasing.po.move.sent", doneKey: "purchasing.po.done.sent" },
  confirmed: { labelKey: "purchasing.po.move.confirmed", doneKey: "purchasing.po.done.confirmed" },
  draft: { labelKey: "purchasing.po.move.draft", doneKey: "purchasing.po.done.draft" },
  closed: { labelKey: "purchasing.po.move.closed", doneKey: "purchasing.po.done.closed" },
  canceled: { labelKey: "purchasing.po.move.canceled", doneKey: "purchasing.po.done.canceled" },
};

export const billStatus: Record<BillStatus, { labelKey: MessageKey; tone: BadgeTone }> = {
  draft: { labelKey: "purchasing.bill.status.draft", tone: "slate" },
  open: { labelKey: "purchasing.bill.status.open", tone: "blue" },
  partially_paid: { labelKey: "purchasing.bill.status.partially_paid", tone: "yellow" },
  paid: { labelKey: "purchasing.bill.status.paid", tone: "green" },
  void: { labelKey: "purchasing.bill.status.void", tone: "slate" },
};

/** The supplier's Arabic name on an Arabic page when there is one. */
export function supplierName(s: { name: string; name_ar: string | null } | null | undefined, language: "en" | "ar"): string {
  if (!s) return "";
  return language === "ar" && s.name_ar ? s.name_ar : s.name;
}
