/**
 * Inventory — pure logic for the module pages. The ledger itself (moving
 * average, low-stock alerts) lives in Postgres (app.post_stock_move); these
 * helpers only present what it stored.
 */

export type StockState = "ok" | "low" | "out" | "untracked";

/**
 * The same rule as the server's low-stock list: at or below the reorder
 * point is low, nothing (or a deficit) is out.
 */
export function stockState(
  onHand: number,
  reorderPoint: number | null,
  trackStock: boolean,
): StockState {
  if (!trackStock) return "untracked";
  if (onHand <= 0) return "out";
  if (reorderPoint != null && onHand <= reorderPoint) return "low";
  return "ok";
}

/** Quantities are stored at 3 decimals; show only the ones that matter. */
export function formatQty(n: number | null | undefined, locale?: string): string {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return new Intl.NumberFormat(locale ?? "en-US", { maximumFractionDigits: 3 }).format(Number(n));
}

export interface ValuationRow {
  warehouse_id: string;
  warehouse_name: string;
  category: string | null;
  item_count: number;
  on_hand: number;
  stock_value: number;
}

/** Valuation rows rolled up per warehouse, highest value first. */
export function valueByWarehouse(rows: ValuationRow[]): Array<{ id: string; name: string; value: number }> {
  const map = new Map<string, { id: string; name: string; value: number }>();
  for (const r of rows) {
    const cur = map.get(r.warehouse_id) ?? { id: r.warehouse_id, name: r.warehouse_name, value: 0 };
    cur.value += Number(r.stock_value);
    map.set(r.warehouse_id, cur);
  }
  return [...map.values()].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
}

/** Sum of a numeric column, tolerant of the strings PostgREST returns for numeric. */
export function sumOf<T>(rows: T[], pick: (r: T) => number | string | null | undefined): number {
  return rows.reduce((s, r) => s + Number(pick(r) ?? 0), 0);
}

/** Item totals across warehouses from stock_levels rows. */
export function totalsByItem(levels: Array<{ item_id: string; on_hand: number | string }>): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of levels) m.set(l.item_id, (m.get(l.item_id) ?? 0) + Number(l.on_hand));
  return m;
}
