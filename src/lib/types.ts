export type Role = "owner" | "admin" | "manager" | "viewer";
export type DistanceUnit = "km" | "mi";
export type VolumeUnit = "L" | "gal";
export type Language = "en" | "ar";
export type DriverStatus = "active" | "inactive";

export type TenantArchetype = "fleet_operator" | "service_provider";

export interface Tenant {
  id: string;
  name: string;
  /** Business type: drives the home dashboard and onboarding module set. */
  archetype: TenantArchetype;
  country: string;
  currency: string;
  distance_unit: DistanceUnit;
  volume_unit: VolumeUnit;
  timezone: string;
  tax_registration_number: string | null;
  /** Dealer contact block printed on RSL certificates (and future letterheads). */
  address: string | null;
  phone: string | null;
  created_at: string;
}

export interface Profile {
  id: string;
  tenant_id: string;
  email: string;
  full_name: string;
  phone: string | null;
  role: Role;
  language: Language;
  created_at: string;
}

export interface Invitation {
  id: string;
  tenant_id: string;
  email: string;
  role: Exclude<Role, "owner">;
  token: string;
  status: "pending" | "accepted" | "revoked";
  invited_by: string | null;
  expires_at: string;
  created_at: string;
}

export type VehicleStatus = "active" | "in_shop" | "out_of_service" | "retired";
export type VehicleType =
  | "car" | "van" | "truck" | "bus" | "trailer" | "equipment" | "motorcycle" | "other";
export type FuelType =
  | "gasoline" | "diesel" | "electric" | "hybrid" | "cng" | "lpg" | "other";

export interface Vehicle {
  id: string;
  tenant_id: string;
  name: string;
  vin: string | null;
  /** 'company' = the tenant's own fleet; 'customer' requires customer_id. */
  ownership: "company" | "customer";
  customer_id: string | null;
  chassis_number: string | null;
  engine_number: string | null;
  fleet_number: string | null;
  license_plate: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  vehicle_type: VehicleType;
  status: VehicleStatus;
  fuel_type: FuelType;
  odometer: number; // canonical km
  odometer_updated_at: string | null;
  purchase_date: string | null;
  purchase_price: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Driver {
  id: string;
  tenant_id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  license_number: string | null;
  license_class: string | null;
  license_expiry: string | null;
  hire_date: string | null;
  status: DriverStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface VehicleAssignment {
  id: string;
  tenant_id: string;
  vehicle_id: string;
  driver_id: string;
  started_at: string;
  ended_at: string | null;
  notes: string | null;
  created_at: string;
}

export interface ServiceReminder {
  id: string;
  tenant_id: string;
  vehicle_id: string;
  task: string;
  notes: string | null;
  interval_months: number | null;
  interval_km: number | null;
  due_date: string | null;
  due_km: number | null;
  last_completed_at: string | null;
  last_completed_km: number | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export type WorkOrderStatus = "open" | "in_progress" | "completed" | "canceled";
export type Priority = "low" | "normal" | "high" | "critical";

export interface WorkOrder {
  id: string;
  tenant_id: string;
  vehicle_id: string;
  number: number;
  title: string;
  description: string | null;
  status: WorkOrderStatus;
  priority: Priority;
  vendor: string | null;
  odometer: number | null;
  tax_rate: number;
  scheduled_date: string | null;
  completed_at: string | null;
  issue_id: string | null;
  reminder_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkOrderLine {
  id: string;
  tenant_id: string;
  work_order_id: string;
  category: "labor" | "part" | "fee" | "other";
  description: string;
  quantity: number;
  unit_cost: number;
  created_at: string;
}

export interface FuelLog {
  id: string;
  tenant_id: string;
  vehicle_id: string;
  driver_id: string | null;
  filled_at: string;
  odometer: number | null; // canonical km
  volume: number; // canonical liters
  total_cost: number;
  is_full_tank: boolean;
  vendor: string | null;
  notes: string | null;
  created_at: string;
}

export interface InspectionItem {
  id: string;
  label: string;
  section?: string;
}

export interface InspectionTemplate {
  id: string;
  tenant_id: string;
  name: string;
  items: InspectionItem[];
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface InspectionResult {
  item_id: string;
  label: string;
  result: "pass" | "fail" | "na";
  note?: string;
}

export interface Inspection {
  id: string;
  tenant_id: string;
  vehicle_id: string;
  driver_id: string | null;
  template_id: string | null;
  performed_at: string;
  odometer: number | null;
  status: "pass" | "fail";
  results: InspectionResult[];
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export type IssueStatus = "open" | "in_progress" | "resolved" | "closed";

export interface Issue {
  id: string;
  tenant_id: string;
  vehicle_id: string;
  title: string;
  description: string | null;
  status: IssueStatus;
  priority: Priority;
  source: "manual" | "inspection";
  inspection_id: string | null;
  work_order_id: string | null;
  reported_by: string | null;
  reported_at: string;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TenantModule {
  tenant_id: string;
  module_id: string;
  enabled: boolean;
  enabled_at: string;
  enabled_by: string | null;
}

export type SpeedLimiterStatus = "active" | "maintenance" | "removed";

export interface SpeedLimiterInstallation {
  id: string;
  tenant_id: string;
  vehicle_id: string;
  device_serial: string;
  brand: string | null;
  model: string | null;
  set_speed_kmh: number | null;
  tamper_seal_number: string | null;
  installed_at: string;
  technician: string | null;
  status: SpeedLimiterStatus;
  customer_id: string | null;
  device_id: string | null;
  job_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type SlCertificateStatus = "valid" | "revoked";

export interface SpeedLimiterCertificate {
  id: string;
  tenant_id: string;
  installation_id: string | null;
  vehicle_id: string;
  certificate_number: string;
  issuing_authority: string | null;
  issued_at: string;
  expires_at: string;
  renewed_from: string | null;
  customer_id: string | null;
  job_id: string | null;
  device_id: string | null;
  set_speed_kmh: number | null;
  /** Snapshotted at issuance (from the job/installation), like set_speed_kmh. */
  tamper_seal_number: string | null;
  status: SlCertificateStatus;
  revoked_at: string | null;
  revoked_reason: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// --- Speed limiter enterprise (service-provider) model ---

export interface Customer {
  id: string;
  tenant_id: string;
  name: string;
  cr_number: string | null;
  tax_number: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  billing_terms: string | null;
  credit_limit: number | null;
  status: "active" | "inactive";
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Contact {
  id: string;
  tenant_id: string;
  customer_id: string;
  name: string;
  title: string | null;
  department: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  is_primary: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type SlDeviceStatus = "in_stock" | "installed" | "faulty" | "retired";

export interface SlDevice {
  id: string;
  tenant_id: string;
  serial: string;
  manufacturer: string | null;
  model: string | null;
  firmware_version: string | null;
  imei: string | null;
  purchase_date: string | null;
  purchase_price: number | null;
  supplier: string | null;
  warranty_until: string | null;
  status: SlDeviceStatus;
  current_vehicle_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface SlTechnician {
  id: string;
  tenant_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export type SlJobType =
  | "installation" | "inspection" | "maintenance" | "removal" | "replacement" | "emergency";
export type SlJobStatus =
  | "scheduled" | "in_progress" | "completed" | "qc_approved" | "closed" | "canceled";

export interface SlChecklistItem {
  id: string;
  label: string;
  done: boolean;
}

export interface SlJob {
  id: string;
  tenant_id: string;
  number: number;
  job_type: SlJobType;
  customer_id: string | null;
  vehicle_id: string;
  device_id: string | null;
  technician_id: string | null;
  status: SlJobStatus;
  scheduled_date: string | null;
  set_speed_kmh: number | null;
  tamper_seal_number: string | null;
  checklist: SlChecklistItem[];
  location: string | null;
  started_at: string | null;
  completed_at: string | null;
  duration_minutes: number | null;
  qc_by: string | null;
  qc_at: string | null;
  customer_signed: boolean;
  technician_signed: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface SlSettings {
  tenant_id: string;
  cert_prefix: string;
  cert_next_number: number;
  cert_validity_months: number;
  updated_at: string;
}

export type RenewalType =
  | "registration" | "insurance" | "permit" | "emission_test" | "roadworthiness" | "other";

export interface Renewal {
  id: string;
  tenant_id: string;
  vehicle_id: string;
  renewal_type: RenewalType;
  name: string | null;
  due_date: string;
  amount: number | null;
  recurrence_months: number | null;
  completed_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}
