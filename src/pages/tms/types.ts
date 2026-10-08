import type { CarrierType, ServiceLevel, ShipmentMode, ShipmentStatus } from "../../../shared/tms";

export interface Shipment {
  id: string;
  number: number | null;
  doc_number: string | null;
  customer_id: string;
  status: ShipmentStatus;
  mode: ShipmentMode;
  service_level: ServiceLevel;
  origin_name: string | null;
  origin_address: string | null;
  origin_city: string;
  origin_country: string | null;
  destination_name: string | null;
  destination_address: string | null;
  destination_city: string;
  destination_country: string | null;
  pickup_window_start: string | null;
  pickup_window_end: string | null;
  delivery_window_start: string | null;
  delivery_window_end: string | null;
  cargo_description: string | null;
  pieces: number | null;
  weight_kg: number | null;
  volume_m3: number | null;
  hazardous: boolean;
  carrier_type: CarrierType;
  vehicle_id: string | null;
  driver_id: string | null;
  carrier_supplier_id: string | null;
  freight_charge: number;
  fuel_surcharge: number;
  other_charges: number;
  total_charge: number;
  carrier_cost: number | null;
  margin: number | null;
  currency: string;
  customer_ref: string | null;
  bol_number: string | null;
  booked_at: string | null;
  dispatched_at: string | null;
  picked_up_at: string | null;
  delivered_at: string | null;
  closed_at: string | null;
  canceled_at: string | null;
  received_by: string | null;
  pod_notes: string | null;
  cancel_reason: string | null;
  notes: string | null;
  invoice_id: string | null;
  created_at: string;
  updated_at: string;
  customer: { name: string } | null;
  vehicle: { name: string; license_plate: string | null } | null;
  driver: { first_name: string; last_name: string } | null;
  carrier: { name: string } | null;
  invoice: { doc_number: string | null; status: string } | null;
}

export interface ShipmentEvent {
  id: string;
  shipment_id: string;
  status: ShipmentStatus | null;
  at: string;
  location: string | null;
  note: string | null;
  created_at: string;
}

export interface FreightRateRow {
  id: string;
  origin_city: string;
  destination_city: string;
  mode: ShipmentMode;
  customer_id: string | null;
  rate_per_kg: number | null;
  rate_per_trip: number | null;
  min_charge: number;
  valid_from: string;
  valid_to: string | null;
  notes: string | null;
  customer: { name: string } | null;
}

export const SHIPMENT_SELECT =
  "id, number, doc_number, customer_id, status, mode, service_level, origin_name, origin_address, origin_city, origin_country, " +
  "destination_name, destination_address, destination_city, destination_country, pickup_window_start, pickup_window_end, " +
  "delivery_window_start, delivery_window_end, cargo_description, pieces, weight_kg, volume_m3, hazardous, carrier_type, vehicle_id, " +
  "driver_id, carrier_supplier_id, freight_charge, fuel_surcharge, other_charges, total_charge, carrier_cost, margin, currency, " +
  "customer_ref, bol_number, booked_at, dispatched_at, picked_up_at, delivered_at, closed_at, canceled_at, received_by, pod_notes, " +
  "cancel_reason, notes, invoice_id, created_at, updated_at, " +
  "customer:customers!shipments_customer_id_fkey(name), " +
  "vehicle:vehicles!shipments_vehicle_id_fkey(name,license_plate), " +
  "driver:drivers!shipments_driver_id_fkey(first_name,last_name), " +
  "carrier:suppliers!shipments_carrier_supplier_id_fkey(name), " +
  "invoice:invoices!shipments_invoice_id_fkey(doc_number,status)";

export const RATE_SELECT =
  "id, origin_city, destination_city, mode, customer_id, rate_per_kg, rate_per_trip, min_charge, valid_from, valid_to, notes, " +
  "customer:customers!freight_rates_customer_id_fkey(name)";
