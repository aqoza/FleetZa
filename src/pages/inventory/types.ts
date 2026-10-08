import type { Tables } from "../../lib/database.types";

export type ItemType = "part" | "consumable" | "fluid" | "tire" | "tool" | "merchandise" | "other";
export type MoveType =
  | "receipt" | "issue" | "transfer_in" | "transfer_out" | "adjustment" | "sale" | "return" | "consumption";

export type InventoryItem = Omit<Tables<"inventory_items">, "item_type"> & { item_type: ItemType };
export type Warehouse = Tables<"warehouses">;
export type StockLevel = Tables<"stock_levels">;
export type StockMove = Omit<Tables<"stock_moves">, "move_type"> & { move_type: MoveType };

export type StockOp = "receive" | "issue" | "transfer" | "adjust";
