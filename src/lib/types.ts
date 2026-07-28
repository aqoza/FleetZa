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
  /**
   * Letterhead + footer of official documents (docs/SPEED_LIMITERS.md). The
   * Omani RSL certificate prints a bilingual masthead, a services tagline on
   * the flag-colored strip, and a registration line composed from the
   * registration block below — in Arabic (Arabic-Indic digits) and English.
   */
  name_ar: string | null;
  cr_number: string | null;
  po_box: string | null;
  postal_code: string | null;
  city: string | null;
  city_ar: string | null;
  email: string | null;
  phone_secondary: string | null;
  /**
   * Dealer website as written on the letterhead, normally a bare domain
   * ("gawhrat.com"). Printed as text in the registration line of both passes —
   * never fetched or linked, hence no scheme constraint in the database.
   */
  website: string | null;
  services_line: string | null;
  services_line_ar: string | null;
  /**
   * Standard the fitted limiter is certified against, printed in the
   * certificate header (e.g. GSO-1026/2002). Per tenant, not per certificate:
   * it applies to every vehicle a dealer certifies. Print-only text.
   */
  applicable_standard: string | null;
  /** Scanned marks printed in the closing strip; https: or data:image only. */
  signature_url: string | null;
  stamp_url: string | null;
  /**
   * Stamp box height as a percent of the default (50-200, DB-constrained).
   * Seals are scanned at different crops, so one fixed height renders some
   * large and others tiny.
   */
  stamp_scale: number;
  /**
   * Authorized signatory, printed under the signature in the closing strip
   * beneath the "For <trade name>" line. The Arabic form is optional and falls
   * back to `signatory_name` when null.
   */
  signatory_name: string | null;
  signatory_name_ar: string | null;
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
  set_speed_secondary_kmh: number | null;
  tamper_seal_number: string | null;
  /** Issued once for this installation and reprinted on every renewal. */
  uin: string | null;
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
  /**
   * The certificate that IMMEDIATELY replaced this one, or null when this is
   * the one the vehicle currently carries. Maintained by a database trigger
   * keyed on vehicle_id, so a vehicle's certificates form a linked list
   * (oldest → … → previous → newest/null) and exactly one row is ever live.
   *
   * Not the same thing as `renewed_from`: that only records the row an
   * operator pressed Renew on, is null for all imported history, and its
   * chains can cross installation_id. Read it through src/lib/certificateStatus.ts.
   */
  superseded_by: string | null;
  customer_id: string | null;
  job_id: string | null;
  device_id: string | null;
  set_speed_kmh: number | null;
  /**
   * Snapshotted at issuance (from the job/installation/device), like
   * set_speed_kmh — an issued document must reprint identically years later
   * even after the device or installation has moved on.
   */
  set_speed_secondary_kmh: number | null;
  tamper_seal_number: string | null;
  uin: string | null;
  limiter_type: string | null;
  /**
   * Technician named on the issued document. Snapshot for the same reason as
   * the fields above, and the only route for a certificate with no job row.
   */
  technician_name: string | null;
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
  /** Certified type printed on the certificate, e.g. "Electronic Pedal". */
  limiter_type: string | null;
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
  /** Second programmed band — Omani certificates print the pair "70/90 KMPH". */
  set_speed_secondary_kmh: number | null;
  tamper_seal_number: string | null;
  /** Unique identification number of the limiter installation (Oman: OM-…). */
  uin: string | null;
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
  /**
   * Technician preselected when issuing a certificate. A reference, so the
   * picker and this default resolve from the same list; the certificate still
   * snapshots the name at issuance.
   */
  default_technician_id: string | null;
  updated_at: string;
}

// --- Sales & billing (quote → order → invoice → payment) ---

export type ProductKind = "service" | "part" | "fee" | "other";

export interface Product {
  id: string;
  tenant_id: string;
  sku: string | null;
  name: string;
  description: string | null;
  kind: ProductKind;
  unit: string;
  unit_price: number;
  tax_rate: number;
  active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface SalesSettings {
  tenant_id: string;
  quote_prefix: string;
  order_prefix: string;
  invoice_prefix: string;
  quote_valid_days: number;
  payment_terms_days: number;
  /** null = fall back to the tenant country's VAT rate (shared/countries.ts). */
  default_tax_rate: number | null;
  quote_terms: string | null;
  invoice_terms: string | null;
  updated_at: string;
}

/**
 * Every sales document shares this shape. Amounts are maintained by DB
 * triggers from the lines — never written from the client.
 */
interface SalesDocument {
  id: string;
  tenant_id: string;
  number: number;
  /** Human reference, e.g. "QT-00042" (prefix from sales_settings). */
  doc_number: string;
  customer_id: string;
  contact_id: string | null;
  vehicle_id: string | null;
  /** Snapshotted at creation so re-rounding can never touch an issued doc. */
  currency: string;
  currency_decimals: number;
  subtotal: number;
  discount_total: number;
  tax_total: number;
  total: number;
  title: string | null;
  customer_reference: string | null;
  terms: string | null;
  notes: string | null;
  internal_notes: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * What operational work a sales document bills for. Present on quotes, orders
 * and invoices so the link survives the whole chain (the conversion RPCs copy
 * it forward) and "which job produced this invoice" is answerable from either
 * end.
 *
 * One job per document: in this domain a job is one vehicle and one
 * certificate. A consolidated invoice spanning several jobs is a real case and
 * is the reason this would become a link table, but it is not needed for the
 * four supported flows.
 */
export interface SalesDocumentLinks {
  job_id: string | null;
  certificate_id: string | null;
}

/** Line shape shared by quote_lines / sales_order_lines / invoice_lines. */
interface SalesDocumentLine {
  id: string;
  tenant_id: string;
  sort_order: number;
  product_id: string | null;
  vehicle_id: string | null;
  description: string;
  quantity: number;
  unit: string | null;
  unit_price: number;
  discount_percent: number;
  tax_rate: number;
  line_gross: number;
  line_discount: number;
  line_net: number;
  line_tax: number;
  line_total: number;
  created_at: string;
  updated_at: string;
}

export type QuoteStatus =
  | "draft" | "sent" | "accepted" | "declined" | "expired" | "canceled";

export interface Quote extends SalesDocument, SalesDocumentLinks {
  status: QuoteStatus;
  issue_date: string;
  valid_until: string | null;
  /** Capability URL token for the customer-facing quote page. */
  public_token: string;
  sent_at: string | null;
  accepted_at: string | null;
  accepted_by_name: string | null;
  declined_at: string | null;
  decline_reason: string | null;
  revision: number;
  revision_of: string | null;
  sales_order_id: string | null;
}

export interface QuoteLine extends SalesDocumentLine {
  quote_id: string;
}

export type SalesOrderStatus = "draft" | "confirmed" | "fulfilled" | "closed" | "canceled";

export interface SalesOrder extends SalesDocument, SalesDocumentLinks {
  quote_id: string | null;
  /**
   * The customer's own purchase order, as they issued it. Its presence is what
   * makes this order a "PO received"; the scanned document is what an auditor
   * asks for.
   */
  customer_po_number: string | null;
  customer_po_date: string | null;
  customer_po_url: string | null;
  status: SalesOrderStatus;
  order_date: string;
  expected_date: string | null;
  /** Sum of this order's non-void invoices (DB trigger). */
  invoiced_total: number;
  confirmed_at: string | null;
  fulfilled_at: string | null;
  closed_at: string | null;
}

export interface SalesOrderLine extends SalesDocumentLine {
  sales_order_id: string;
}

/** `void` is stored; "overdue" is derived from due_date + balance at render. */
export type InvoiceStatus = "draft" | "issued" | "partially_paid" | "paid" | "void";

export interface Invoice extends SalesDocument, SalesDocumentLinks {
  sales_order_id: string | null;
  /**
   * Snapshot of the PO this invoice was raised against — not joined through
   * the order, because an issued invoice must keep printing it and a direct
   * invoice has no order to join to.
   */
  customer_po_number: string | null;
  status: InvoiceStatus;
  issue_date: string;
  due_date: string | null;
  /** Sum of this invoice's payments (DB trigger). */
  amount_paid: number;
  issued_at: string | null;
  voided_at: string | null;
  void_reason: string | null;
}

export interface InvoiceLine extends SalesDocumentLine {
  invoice_id: string;
}

export type PaymentMethod = "cash" | "bank_transfer" | "card" | "cheque" | "online" | "other";

export interface Payment {
  id: string;
  tenant_id: string;
  invoice_id: string;
  paid_at: string;
  amount: number;
  method: PaymentMethod;
  reference: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** One row from the sales_summary() RPC — the hub's KPI source. */
export interface SalesSummary {
  open_quotes: number;
  open_quote_value: number;
  accepted_quotes_90d: number;
  decided_quotes_90d: number;
  open_orders: number;
  open_order_value: number;
  unbilled_order_value: number;
  outstanding_amount: number;
  overdue_invoices: number;
  overdue_amount: number;
  collected_30d: number;
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
