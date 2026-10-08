import type { BayStatus, BayType, BookingStatus } from "../../../shared/workshop";

export interface Bay {
  id: string;
  name: string;
  code: string | null;
  bay_type: BayType;
  status: BayStatus;
  active: boolean;
  notes: string | null;
  created_at: string;
}

export interface Booking {
  id: string;
  bay_id: string;
  work_order_id: string;
  starts_at: string;
  ends_at: string;
  status: BookingStatus;
  started_at: string | null;
  finished_at: string | null;
  notes: string | null;
  bay: { name: string; code: string | null } | null;
  work_order: { number: number; title: string; status: string; vehicles: { name: string } | null } | null;
}

export interface Labor {
  id: string;
  work_order_id: string;
  employee_id: string;
  started_at: string;
  ended_at: string | null;
  hours: number | null;
  hourly_rate: number;
  cost: number | null;
  notes: string | null;
  employee: { first_name: string; last_name: string | null } | null;
  work_order: { number: number; title: string; vehicles: { name: string } | null } | null;
}

export const BAY_SELECT = "id, name, code, bay_type, status, active, notes, created_at";

export const BOOKING_SELECT =
  "id, bay_id, work_order_id, starts_at, ends_at, status, started_at, finished_at, notes, " +
  "bay:workshop_bays!workshop_bookings_bay_id_fkey(name,code), " +
  "work_order:work_orders!workshop_bookings_work_order_id_fkey(number,title,status,vehicles(name))";

export const LABOR_SELECT =
  "id, work_order_id, employee_id, started_at, ended_at, hours, hourly_rate, cost, notes, " +
  "employee:employees!work_order_labor_employee_id_fkey(first_name,last_name), " +
  "work_order:work_orders!work_order_labor_work_order_id_fkey(number,title,vehicles(name))";
