import type { DeliveryStatus, FailureReason, RouteStatus } from "../../../shared/deliveries";

export interface Delivery {
  id: string;
  number: number | null;
  doc_number: string | null;
  customer_id: string | null;
  reference: string | null;
  route_id: string | null;
  sequence: number | null;
  recipient_name: string;
  recipient_phone: string | null;
  address: string;
  city: string | null;
  lat: number | null;
  lng: number | null;
  parcels: number;
  weight_kg: number | null;
  cod_amount: number;
  cod_collected: number | null;
  instructions: string | null;
  status: DeliveryStatus;
  attempts: number;
  delivered_at: string | null;
  failed_at: string | null;
  returned_at: string | null;
  pod_name: string | null;
  failure_reason: FailureReason | null;
  failure_note: string | null;
  tracking_token: string;
  created_at: string;
  updated_at: string;
  customer: { name: string } | null;
  route: { doc_number: string | null; route_date: string; status: RouteStatus } | null;
}

/** The signature is only loaded on the delivery page. */
export type DeliveryWithPod = Delivery & { pod_signature: string | null };

export interface DeliveryRoute {
  id: string;
  number: number | null;
  doc_number: string | null;
  route_date: string;
  vehicle_id: string;
  driver_id: string | null;
  status: RouteStatus;
  depot_name: string | null;
  depot_lat: number | null;
  depot_lng: number | null;
  started_at: string | null;
  completed_at: string | null;
  canceled_at: string | null;
  notes: string | null;
  created_at: string;
  vehicle: { name: string; license_plate: string | null } | null;
  driver: { first_name: string; last_name: string } | null;
  deliveries: Array<{ status: DeliveryStatus }>;
}

export const DELIVERY_SELECT =
  "id, number, doc_number, customer_id, reference, route_id, sequence, recipient_name, recipient_phone, address, city, lat, lng, " +
  "parcels, weight_kg, cod_amount, cod_collected, instructions, status, attempts, delivered_at, failed_at, returned_at, pod_name, " +
  "failure_reason, failure_note, tracking_token, created_at, updated_at, " +
  "customer:customers!deliveries_customer_id_fkey(name), " +
  "route:delivery_routes!deliveries_route_id_fkey(doc_number,route_date,status)";

export const ROUTE_SELECT =
  "id, number, doc_number, route_date, vehicle_id, driver_id, status, depot_name, depot_lat, depot_lng, started_at, completed_at, " +
  "canceled_at, notes, created_at, " +
  "vehicle:vehicles!delivery_routes_vehicle_id_fkey(name,license_plate), " +
  "driver:drivers!delivery_routes_driver_id_fkey(first_name,last_name), " +
  "deliveries:deliveries!deliveries_route_id_fkey(status)";
