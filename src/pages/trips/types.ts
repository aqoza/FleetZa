import type { StopStatus, TripStatus } from "../../../shared/trips";

export interface Trip {
  id: string;
  number: number | null;
  doc_number: string | null;
  vehicle_id: string;
  driver_id: string | null;
  customer_id: string | null;
  status: TripStatus;
  purpose: string;
  planned_start: string;
  planned_end: string;
  actual_start: string | null;
  actual_end: string | null;
  start_odometer: number | null;
  end_odometer: number | null;
  planned_distance_km: number | null;
  actual_distance_km: number | null;
  estimated_fuel_l: number | null;
  estimated_cost: number | null;
  notes: string | null;
  cancel_reason: string | null;
  dispatched_at: string | null;
  completed_at: string | null;
  canceled_at: string | null;
  vehicle: { name: string; license_plate: string | null; odometer: number } | null;
  driver: { first_name: string; last_name: string } | null;
  customer: { name: string } | null;
}

export interface TripStop {
  id: string;
  trip_id: string;
  sequence: number;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  planned_arrival: string | null;
  actual_arrival: string | null;
  actual_departure: string | null;
  status: StopStatus;
  notes: string | null;
}

export interface TripConflict {
  trip_id: string;
  doc_number: string | null;
  status: TripStatus;
  purpose: string;
  planned_start: string;
  planned_end: string;
  vehicle_clash: boolean;
  driver_clash: boolean;
}

export const TRIP_SELECT =
  "id, number, doc_number, vehicle_id, driver_id, customer_id, status, purpose, planned_start, planned_end, " +
  "actual_start, actual_end, start_odometer, end_odometer, planned_distance_km, actual_distance_km, estimated_fuel_l, " +
  "estimated_cost, notes, cancel_reason, dispatched_at, completed_at, canceled_at, " +
  "vehicle:vehicles!trips_vehicle_id_fkey(name,license_plate,odometer), " +
  "driver:drivers!trips_driver_id_fkey(first_name,last_name), " +
  "customer:customers!trips_customer_id_fkey(name)";

export const STOP_SELECT =
  "id, trip_id, sequence, name, address, lat, lng, planned_arrival, actual_arrival, actual_departure, status, notes";

/** Numeric columns arrive as strings from PostgREST. */
export function normalizeTrip(t: Trip): Trip {
  const n = (v: number | null) => (v == null ? null : Number(v));
  return {
    ...t,
    start_odometer: n(t.start_odometer),
    end_odometer: n(t.end_odometer),
    planned_distance_km: n(t.planned_distance_km),
    actual_distance_km: n(t.actual_distance_km),
    estimated_fuel_l: n(t.estimated_fuel_l),
    estimated_cost: n(t.estimated_cost),
  };
}
