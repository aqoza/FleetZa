import type { AtFault, IncidentStatus, IncidentType, PartyType, Severity } from "../../../shared/incidents";

export interface Incident {
  id: string;
  number: number | null;
  doc_number: string | null;
  vehicle_id: string;
  driver_id: string | null;
  occurred_at: string;
  location: string | null;
  lat: number | null;
  lng: number | null;
  incident_type: IncidentType;
  severity: Severity;
  description: string;
  injuries: number;
  fatalities: number;
  police_report_number: string | null;
  police_station: string | null;
  at_fault: AtFault;
  estimated_damage: number | null;
  actual_cost: number | null;
  currency: string;
  vehicle_drivable: boolean;
  status: IncidentStatus;
  driving_event_id: string | null;
  issue_id: string | null;
  work_order_id: string | null;
  claim_id: string | null;
  root_cause: string | null;
  corrective_actions: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  vehicle: { name: string; license_plate: string | null } | null;
  driver: { first_name: string; last_name: string } | null;
  work_order: { number: number; status: string } | null;
}

export const INCIDENT_SELECT =
  "id, number, doc_number, vehicle_id, driver_id, occurred_at, location, lat, lng, incident_type, severity, description, " +
  "injuries, fatalities, police_report_number, police_station, at_fault, estimated_damage, actual_cost, currency, " +
  "vehicle_drivable, status, driving_event_id, issue_id, work_order_id, claim_id, root_cause, corrective_actions, " +
  "resolved_at, closed_at, notes, created_at, updated_at, " +
  "vehicle:vehicles!incidents_vehicle_id_fkey(name, license_plate), " +
  "driver:drivers!incidents_driver_id_fkey(first_name, last_name), " +
  "work_order:work_orders!incidents_work_order_id_fkey(number, status)";

export interface Party {
  id: string;
  incident_id: string;
  party_type: PartyType;
  name: string;
  phone: string | null;
  vehicle_plate: string | null;
  insurer: string | null;
  insurance_policy_number: string | null;
  statement: string | null;
}

export const PARTY_SELECT = "id, incident_id, party_type, name, phone, vehicle_plate, insurer, insurance_policy_number, statement";

export interface IncidentEvent {
  id: string;
  status: IncidentStatus;
  at: string;
}
