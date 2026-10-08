import type { JobPriority, JobStatus, JobType } from "../../../shared/dispatch";

export interface DispatchJob {
  id: string;
  number: number | null;
  doc_number: string | null;
  customer_id: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  job_type: JobType;
  priority: JobPriority;
  title: string;
  pickup_address: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_address: string | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  window_start: string;
  window_end: string;
  status: JobStatus;
  vehicle_id: string | null;
  driver_id: string | null;
  assigned_at: string | null;
  en_route_at: string | null;
  on_site_at: string | null;
  completed_at: string | null;
  canceled_at: string | null;
  notes: string | null;
  completion_notes: string | null;
  cancel_reason: string | null;
  created_at: string;
  vehicle: { name: string; license_plate: string | null } | null;
  driver: { first_name: string; last_name: string } | null;
  customer: { name: string } | null;
}

export interface BusyRow {
  kind: "vehicle" | "driver";
  resource_id: string;
  job_id: string;
  doc_number: string | null;
  status: JobStatus;
}

export const JOB_SELECT =
  "id, number, doc_number, customer_id, contact_name, contact_phone, job_type, priority, title, pickup_address, pickup_lat, " +
  "pickup_lng, dropoff_address, dropoff_lat, dropoff_lng, window_start, window_end, status, vehicle_id, driver_id, assigned_at, " +
  "en_route_at, on_site_at, completed_at, canceled_at, notes, completion_notes, cancel_reason, created_at, " +
  "vehicle:vehicles!dispatch_jobs_vehicle_id_fkey(name,license_plate), " +
  "driver:drivers!dispatch_jobs_driver_id_fkey(first_name,last_name), " +
  "customer:customers!dispatch_jobs_customer_id_fkey(name)";
