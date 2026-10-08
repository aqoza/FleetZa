import type { ClaimStatus, PolicyType, PremiumFrequency } from "../../../shared/insurance";

export interface Policy {
  id: string;
  policy_number: string;
  insurer_supplier_id: string | null;
  insurer_name: string | null;
  policy_type: PolicyType;
  coverage_amount: number | null;
  premium: number;
  premium_frequency: PremiumFrequency;
  deductible: number | null;
  currency: string;
  start_date: string;
  end_date: string;
  auto_renew: boolean;
  broker: string | null;
  canceled_at: string | null;
  cancel_reason: string | null;
  notes: string | null;
  created_at: string;
  insurer: { name: string } | null;
}

export const POLICY_SELECT =
  "id, policy_number, insurer_supplier_id, insurer_name, policy_type, coverage_amount, premium, premium_frequency, " +
  "deductible, currency, start_date, end_date, auto_renew, broker, canceled_at, cancel_reason, notes, created_at, " +
  "insurer:suppliers!insurance_policies_insurer_supplier_id_fkey(name)";

export interface PolicyVehicle {
  id: string;
  policy_id: string;
  vehicle_id: string;
  added_on: string;
  removed_on: string | null;
  vehicle: { name: string; license_plate: string | null; status: string } | null;
}

export const POLICY_VEHICLE_SELECT =
  "id, policy_id, vehicle_id, added_on, removed_on, " +
  "vehicle:vehicles!insurance_policy_vehicles_vehicle_id_fkey(name, license_plate, status)";

export interface Claim {
  id: string;
  number: number | null;
  doc_number: string | null;
  policy_id: string;
  vehicle_id: string | null;
  incident_id: string | null;
  status: ClaimStatus;
  claim_date: string;
  loss_date: string;
  description: string;
  amount_claimed: number;
  amount_approved: number | null;
  amount_paid: number | null;
  deductible_applied: number | null;
  currency: string;
  insurer_reference: string | null;
  adjuster_name: string | null;
  adjuster_phone: string | null;
  submitted_at: string | null;
  decided_at: string | null;
  settled_at: string | null;
  withdrawn_at: string | null;
  rejection_reason: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  policy: { policy_number: string; insurer_name: string | null; insurer: { name: string } | null } | null;
  vehicle: { name: string; license_plate: string | null } | null;
}

export const CLAIM_SELECT =
  "id, number, doc_number, policy_id, vehicle_id, incident_id, status, claim_date, loss_date, description, amount_claimed, " +
  "amount_approved, amount_paid, deductible_applied, currency, insurer_reference, adjuster_name, adjuster_phone, " +
  "submitted_at, decided_at, settled_at, withdrawn_at, rejection_reason, notes, created_at, updated_at, " +
  "policy:insurance_policies!insurance_claims_policy_id_fkey(policy_number, insurer_name, " +
  "insurer:suppliers!insurance_policies_insurer_supplier_id_fkey(name)), " +
  "vehicle:vehicles!insurance_claims_vehicle_id_fkey(name, license_plate)";
