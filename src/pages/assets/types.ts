import type { DepreciationMethod } from "../../lib/depreciation";

export type AssetCategory = "equipment" | "tool" | "it" | "furniture" | "trailer" | "container" | "generator" | "other";
export type AssetStatus = "in_service" | "in_storage" | "in_repair" | "disposed" | "lost";
export type AssetEventType = "assigned" | "returned" | "moved" | "serviced" | "inspected" | "repaired" | "disposed" | "note";

interface Holder {
  employee: { first_name: string; last_name: string | null; name_ar: string | null } | null;
  vehicle: { name: string; license_plate: string | null } | null;
}

export interface Asset extends Holder {
  id: string;
  doc_number: string | null;
  name: string;
  category: AssetCategory;
  serial_number: string | null;
  model: string | null;
  manufacturer: string | null;
  status: AssetStatus;
  location: string | null;
  warehouse_id: string | null;
  branch_id: string | null;
  assigned_employee_id: string | null;
  assigned_vehicle_id: string | null;
  assigned_at: string | null;
  purchase_date: string | null;
  purchase_cost: number | null;
  supplier_id: string | null;
  warranty_expiry: string | null;
  depreciation_method: DepreciationMethod;
  useful_life_months: number | null;
  salvage_value: number;
  disposed_at: string | null;
  disposal_value: number | null;
  notes: string | null;
  created_at: string;
}

export interface AssetEvent extends Holder {
  id: string;
  asset_id: string;
  event_type: AssetEventType;
  at: string;
  detail: string | null;
  cost: number | null;
  employee_id: string | null;
  vehicle_id: string | null;
  created_at: string;
}

/** Holder names ride along as embeds; employees are manager-readable only, so a viewer sees the vehicle. */
export const ASSET_SELECT =
  "*, employee:employees!assets_assigned_employee_id_fkey(first_name,last_name,name_ar)," +
  " vehicle:vehicles!assets_assigned_vehicle_id_fkey(name,license_plate)";

export const EVENT_SELECT =
  "*, employee:employees!asset_events_employee_id_fkey(first_name,last_name,name_ar)," +
  " vehicle:vehicles!asset_events_vehicle_id_fkey(name,license_plate)";
