import type { BadgeTone } from "../../components/ui";
import type { DepreciationInput, DepreciationMethod } from "../../lib/depreciation";
import { employeeName } from "../../lib/employees";
import type { Asset, AssetCategory, AssetEventType, AssetStatus } from "./types";

export const categories: Record<AssetCategory, `assets.category.${AssetCategory}`> = {
  equipment: "assets.category.equipment",
  tool: "assets.category.tool",
  it: "assets.category.it",
  furniture: "assets.category.furniture",
  trailer: "assets.category.trailer",
  container: "assets.category.container",
  generator: "assets.category.generator",
  other: "assets.category.other",
};

export const statuses: Record<AssetStatus, { labelKey: `assets.status.${AssetStatus}`; tone: BadgeTone }> = {
  in_service: { labelKey: "assets.status.in_service", tone: "green" },
  in_storage: { labelKey: "assets.status.in_storage", tone: "blue" },
  in_repair: { labelKey: "assets.status.in_repair", tone: "yellow" },
  lost: { labelKey: "assets.status.lost", tone: "red" },
  disposed: { labelKey: "assets.status.disposed", tone: "slate" },
};

/** Statuses a person can set from the form; disposal only happens through the dispose flow. */
export const editableStatuses: AssetStatus[] = ["in_service", "in_storage", "in_repair", "lost"];

export const methods: Record<DepreciationMethod, `assets.method.${DepreciationMethod}`> = {
  straight_line: "assets.method.straight_line",
  declining_balance: "assets.method.declining_balance",
  none: "assets.method.none",
};

export const eventTypes: Record<AssetEventType, `assets.event.${AssetEventType}`> = {
  assigned: "assets.event.assigned",
  returned: "assets.event.returned",
  moved: "assets.event.moved",
  serviced: "assets.event.serviced",
  inspected: "assets.event.inspected",
  repaired: "assets.event.repaired",
  disposed: "assets.event.disposed",
  note: "assets.event.note",
};

/** Events a person logs by hand; the rest come from the assign, return and dispose flows. */
export const manualEvents: AssetEventType[] = ["moved", "serviced", "inspected", "repaired", "note"];

export function depreciationInput(a: Asset): DepreciationInput {
  return {
    method: a.depreciation_method,
    cost: Number(a.purchase_cost ?? 0),
    salvage: Number(a.salvage_value ?? 0),
    lifeMonths: a.useful_life_months,
    purchaseDate: a.purchase_date,
  };
}

/** Minor-unit digits of a currency (OMR 3, AED 2, JPY 0). */
export function currencyDecimals(currency: string): number {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/** Today as YYYY-MM-DD in local time. */
export function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "Aisha Khan · Truck 1", or "" when nobody holds it. */
export function holderLabel(
  h: Pick<Asset, "employee" | "vehicle">,
  language: "en" | "ar",
): string {
  return [h.employee ? employeeName(h.employee, language) : null, h.vehicle?.name ?? null].filter(Boolean).join(" · ");
}
