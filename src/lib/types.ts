export type Role = "owner" | "admin" | "manager" | "viewer";
export type DistanceUnit = "km" | "mi";
export type VolumeUnit = "L" | "gal";
export type Language = "en" | "ar";
export type DriverStatus = "active" | "inactive";

export interface Tenant {
  id: string;
  name: string;
  country: string;
  currency: string;
  distance_unit: DistanceUnit;
  volume_unit: VolumeUnit;
  timezone: string;
  tax_registration_number: string | null;
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
  installed_at: string;
  technician: string | null;
  status: SpeedLimiterStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

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
  notes: string | null;
  created_at: string;
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
