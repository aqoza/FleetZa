import type { Factor, RiskBand } from "../../../shared/predictive";

/** One row of public.predictive_vehicle_health(). */
export interface HealthRow {
  vehicle_id: string;
  odometer: number;
  avg_daily_km: number | null;
  days_to_service: number | null;
  service_overdue: boolean;
  predicted_service_date: string | null;
  issues_90d: number;
  issues_180d: number;
  issue_rate: number;
  open_critical: number;
  open_high: number;
  cost_90d: number;
  cost_prev_90d: number;
  age_years: number | null;
  days_since_inspection: number | null;
  factors: Factor[];
  risk_score: number;
  band: RiskBand;
}

export type PredictionStatus = "open" | "actioned" | "dismissed";

export interface Prediction {
  id: string;
  vehicle_id: string;
  computed_at: string;
  risk_score: number;
  band: RiskBand;
  predicted_service_date: string | null;
  factors: Factor[];
  status: PredictionStatus;
  work_order_id: string | null;
  note: string | null;
  vehicle: { name: string; license_plate: string | null } | null;
  work_order: { number: number; status: string } | null;
}

export const PREDICTION_SELECT =
  "id, vehicle_id, computed_at, risk_score, band, predicted_service_date, factors, status, work_order_id, note, " +
  "vehicle:vehicles!maintenance_predictions_vehicle_id_fkey(name,license_plate), " +
  "work_order:work_orders!maintenance_predictions_work_order_id_fkey(number,status)";
