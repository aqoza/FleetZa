import { useQuery } from "@tanstack/react-query";
import { listRows, wrapDbError } from "../../lib/db";
import { supabase } from "../../lib/supabase";
import type { ValuationRow } from "../../lib/inventory";
import { useEntityPicker, type Picker } from "../../lib/pickers";
import type { Tables } from "../../lib/database.types";
import type { InventoryItem, Warehouse } from "./types";

/** A tenant has a handful of warehouses: one small, cached list. */
export function useWarehouses() {
  return useQuery({
    queryKey: ["warehouses", "all"],
    queryFn: () => listRows<Warehouse>("warehouses", (q) => q.order("is_default", { ascending: false }).order("name").limit(500)),
    staleTime: 60_000,
  });
}

export function useInventoryItemPicker(
  selectedId: string,
  opts: { activeOnly?: boolean; enabled?: boolean } = {},
): Picker {
  const { activeOnly = true, enabled } = opts;
  return useEntityPicker<InventoryItem>({
    table: "inventory_items",
    selectedId,
    searchColumns: ["name", "name_ar", "sku", "barcode"],
    orderBy: "name",
    toOption: (i) => ({ value: i.id, label: i.name, meta: i.sku ?? undefined }),
    filter: activeOnly ? (q) => q.eq("active", true) : undefined,
    scope: ["inventory_items", activeOnly],
    enabled,
  });
}

/** Active suppliers for the item's preferred source (suppliers module). */
export function usePreferredSupplierPicker(selectedId: string, enabled: boolean): Picker {
  return useEntityPicker<Tables<"suppliers">>({
    table: "suppliers",
    selectedId,
    searchColumns: ["name", "name_ar", "doc_number", "phone"],
    orderBy: "name",
    toOption: (s) => ({ value: s.id, label: s.name, meta: s.doc_number ?? undefined }),
    filter: (q) => q.eq("status", "active"),
    scope: ["suppliers", "active"],
    enabled,
  });
}

export interface InventorySummary {
  item_count: number;
  tracked_item_count: number;
  warehouse_count: number;
  stock_value: number;
  low_stock_count: number;
  out_of_stock_count: number;
}

export interface LowStockRow {
  item_id: string;
  sku: string | null;
  name: string;
  name_ar: string | null;
  uom: string;
  category: string | null;
  on_hand: number;
  reorder_point: number | null;
  reorder_qty: number | null;
  suggested_qty: number;
  cost_price: number;
  preferred_supplier_id: string | null;
}

/** Totals come from SQL (inventory_* RPCs), never from summing a capped select. */
export function useInventorySummary() {
  return useQuery({
    queryKey: ["inventory_report", "summary"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("inventory_summary");
      if (error) throw wrapDbError(error);
      return ((data ?? []) as unknown as InventorySummary[])[0] ?? null;
    },
  });
}

export function useLowStock(limit: number) {
  return useQuery({
    queryKey: ["inventory_report", "low_stock", limit],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("inventory_low_stock", { p_limit: limit });
      if (error) throw wrapDbError(error);
      return (data ?? []) as unknown as LowStockRow[];
    },
  });
}

export function useValuation() {
  return useQuery({
    queryKey: ["inventory_report", "valuation"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("inventory_valuation");
      if (error) throw wrapDbError(error);
      return (data ?? []) as unknown as ValuationRow[];
    },
  });
}
