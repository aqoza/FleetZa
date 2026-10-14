import type { BadgeTone } from "../../components/ui";
import type { LinkState, RequestStatus, RequestType } from "../../../shared/customerPortal";

export interface ServiceRequest {
  id: string;
  number: number | null;
  doc_number: string | null;
  customer_id: string;
  access_id: string | null;
  request_type: RequestType;
  vehicle_id: string | null;
  description: string;
  preferred_date: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  status: RequestStatus;
  scheduled_for: string | null;
  internal_notes: string | null;
  handled_by: string | null;
  resolved_at: string | null;
  created_at: string;
  customer: { name: string } | null;
  vehicle: { name: string; license_plate: string | null } | null;
  handler: { full_name: string | null; email: string } | null;
  link: { label: string | null } | null;
}

export const REQUEST_SELECT =
  "id, number, doc_number, customer_id, access_id, request_type, vehicle_id, description, preferred_date, contact_name, " +
  "contact_phone, status, scheduled_for, internal_notes, handled_by, resolved_at, created_at, " +
  "customer:customers!portal_service_requests_customer_id_fkey(name), " +
  "vehicle:vehicles!portal_service_requests_vehicle_id_fkey(name, license_plate), " +
  "handler:profiles!portal_service_requests_handled_by_fkey(full_name, email), " +
  "link:customer_portal_access!portal_service_requests_access_id_fkey(label)";

export interface PortalLink {
  id: string;
  customer_id: string;
  token: string;
  label: string | null;
  active: boolean;
  expires_at: string | null;
  show_vehicles: boolean;
  show_certificates: boolean;
  show_invoices: boolean;
  show_quotes: boolean;
  show_contracts: boolean;
  allow_requests: boolean;
  last_accessed_at: string | null;
  access_count: number;
  created_at: string;
  customer: { name: string } | null;
}

export const LINK_SELECT =
  "id, customer_id, token, label, active, expires_at, show_vehicles, show_certificates, show_invoices, show_quotes, show_contracts, " +
  "allow_requests, last_accessed_at, access_count, created_at, customer:customers!customer_portal_access_customer_id_fkey(name)";

export const requestTone: Record<RequestStatus, BadgeTone> = {
  new: "blue",
  in_review: "yellow",
  scheduled: "purple",
  done: "green",
  rejected: "slate",
};

export const linkTone: Record<LinkState, BadgeTone> = { active: "green", revoked: "slate", expired: "yellow" };

export function personName(p: { full_name: string | null; email: string } | null | undefined): string {
  return p ? p.full_name || p.email : "";
}
