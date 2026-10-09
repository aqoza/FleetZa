import type { ContractStatus, ContractType, Frequency } from "../../../shared/contracts";

export interface Contract {
  id: string;
  number: number | null;
  doc_number: string | null;
  customer_id: string;
  contract_type: ContractType;
  title: string;
  start_date: string;
  end_date: string | null;
  status: ContractStatus;
  billing_frequency: Frequency;
  recurring_amount: number;
  currency: string;
  tax_rate: number | null;
  auto_renew: boolean;
  notice_days: number;
  next_billing_date: string | null;
  terms: string | null;
  signed_at: string | null;
  signed_by_name: string | null;
  activated_at: string | null;
  terminated_at: string | null;
  termination_reason: string | null;
  renewed_to: string | null;
  renewed_from: string | null;
  notes: string | null;
  created_at: string;
  customer: { name: string } | null;
  vehicles: Array<{ rate_override: number | null }>;
}

export const CONTRACT_SELECT =
  "id, number, doc_number, customer_id, contract_type, title, start_date, end_date, status, billing_frequency, recurring_amount, " +
  "currency, tax_rate, auto_renew, notice_days, next_billing_date, terms, signed_at, signed_by_name, activated_at, terminated_at, " +
  "termination_reason, renewed_to, renewed_from, notes, created_at, " +
  "customer:customers!contracts_customer_id_fkey(name), " +
  "vehicles:contract_vehicles!contract_vehicles_contract_id_fkey(rate_override)";

export interface CoveredVehicle {
  id: string;
  vehicle_id: string;
  rate_override: number | null;
  vehicle: { name: string; license_plate: string | null } | null;
}

export const COVERED_SELECT =
  "id, vehicle_id, rate_override, vehicle:vehicles!contract_vehicles_vehicle_id_fkey(name, license_plate)";

export interface BilledPeriod {
  id: string;
  period_start: string;
  period_end: string;
  created_at: string;
  invoice_id: string;
  invoice: { doc_number: string | null; status: string; total: number; currency: string } | null;
}

export const BILLED_SELECT =
  "id, period_start, period_end, created_at, invoice_id, " +
  "invoice:invoices!contract_invoices_invoice_id_fkey(doc_number, status, total, currency)";
