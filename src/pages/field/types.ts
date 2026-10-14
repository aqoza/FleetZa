import type { Json } from "../../lib/database.types";
import type { FieldPriority, FieldTaskStatus } from "../../lib/field";

export interface EmployeeRef {
  id: string;
  first_name: string;
  last_name: string | null;
  name_ar: string | null;
}

export interface FieldTask {
  id: string;
  doc_number: string | null;
  title: string;
  description: string | null;
  employee_id: string;
  customer_id: string | null;
  vehicle_id: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  scheduled_start: string | null;
  due_at: string | null;
  priority: FieldPriority;
  status: FieldTaskStatus;
  checklist: Json;
  completion_notes: string | null;
  signature_data: string | null;
  accepted_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  canceled_at: string | null;
  created_at: string;
  employee: EmployeeRef | null;
  customer: { id: string; name: string } | null;
  vehicle: { id: string; name: string; license_plate: string | null } | null;
}

/** List rows leave out the signature image and notes. */
export const TASK_LIST_SELECT =
  "id, doc_number, title, employee_id, customer_id, vehicle_id, address, lat, lng, scheduled_start, due_at, priority, status, checklist, created_at, completed_at, employee:employees(id, first_name, last_name, name_ar), customer:customers(id, name), vehicle:vehicles(id, name, license_plate)";

export const TASK_SELECT =
  "*, employee:employees(id, first_name, last_name, name_ar), customer:customers(id, name), vehicle:vehicles(id, name, license_plate)";

export interface FieldCheckin {
  id: string;
  employee_id: string;
  task_id: string | null;
  kind: "check_in" | "check_out";
  at: string;
  lat: number | null;
  lng: number | null;
  accuracy_m: number | null;
  note: string | null;
  employee: EmployeeRef | null;
  task: { id: string; doc_number: string | null; title: string } | null;
}

export const CHECKIN_SELECT =
  "id, employee_id, task_id, kind, at, lat, lng, accuracy_m, note, employee:employees(id, first_name, last_name, name_ar), task:field_tasks(id, doc_number, title)";
