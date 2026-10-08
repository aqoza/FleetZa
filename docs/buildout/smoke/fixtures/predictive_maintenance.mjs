// Predictive maintenance smoke fixture: scores for the three base vehicles
// (one high, one medium, one low), fuel-log odometer readings for Truck 12's
// forecast, and saved predictions in each status.
const T = "170d2d86-5c22-4bcb-9d74-420c879419b2";
const VEH_1 = "a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d01";
const VEH_2 = "a7e1c0de-0002-4b2c-9d3e-4f5a6b7c8d02";
const VEH_3 = "a7e1c0de-0003-4b2c-9d3e-4f5a6b7c8d03";
const DAY = 86_400_000;
const ago = (d) => new Date(Date.now() - d * DAY).toISOString();
const inDays = (d) => new Date(Date.now() + d * DAY).toISOString().slice(0, 10);

const f = (code, points, value) => ({ code, points, value });
const health = [
  {
    vehicle_id: VEH_1, odometer: 184250, avg_daily_km: 412.6, days_to_service: 6, service_overdue: false,
    predicted_service_date: inDays(6), issues_90d: 3, issues_180d: 4, issue_rate: 0.1, open_critical: 1, open_high: 0,
    cost_90d: 9200, cost_prev_90d: 3100, age_years: 4, days_since_inspection: 12,
    factors: [f("service_due_14d", 20, 6), f("open_critical_issue", 20, 1), f("repeat_failure", 15, 3), f("cost_rising", 10, 3)],
    risk_score: 65, band: "high",
  },
  {
    vehicle_id: VEH_3, odometer: 301120, avg_daily_km: 268, days_to_service: -9, service_overdue: true,
    predicted_service_date: inDays(-9), issues_90d: 1, issues_180d: 1, issue_rate: 0, open_critical: 0, open_high: 0,
    cost_90d: 0, cost_prev_90d: 0, age_years: 5, days_since_inspection: null,
    factors: [f("service_overdue", 30, -9), f("inspection_overdue", 10, null)],
    risk_score: 40, band: "medium",
  },
  {
    vehicle_id: VEH_2, odometer: 42310, avg_daily_km: null, days_to_service: null, service_overdue: false,
    predicted_service_date: null, issues_90d: 0, issues_180d: 0, issue_rate: 0, open_critical: 0, open_high: 0,
    cost_90d: 650, cost_prev_90d: 0, age_years: 3, days_since_inspection: 40,
    factors: [f("cost_new", 5, null)], risk_score: 5, band: "low",
  },
];

const fuel = [];
for (let i = 0; i < 16; i++) {
  const d = 170 - i * 10;
  fuel.push({
    id: `11100000-0000-4000-8000-${String(i).padStart(12, "0")}`, tenant_id: T, vehicle_id: VEH_1, driver_id: null,
    filled_at: ago(d), odometer: Math.round(184250 - 412.6 * (d - 20) + (i % 3) * 600 - 600), liters: 300, total_cost: 1050,
    created_at: ago(d), updated_at: ago(d),
  });
}

const veh = (id) => ({ [VEH_1]: { name: "Truck 12", license_plate: "8KLM392" }, [VEH_2]: { name: "Van 04", license_plate: "7ABC219" },
  [VEH_3]: { name: "GF Tractor 7", license_plate: "4TRK771" } })[id];
const prediction = (n, h, days, status, extra = {}) => ({
  id: `11200000-0000-4000-8000-00000000000${n}`, tenant_id: T, vehicle_id: h.vehicle_id, computed_at: ago(days),
  risk_score: h.risk_score, band: h.band, predicted_service_date: h.predicted_service_date, factors: h.factors, status,
  work_order_id: null, note: null, created_at: ago(days), updated_at: ago(days), vehicle: veh(h.vehicle_id), work_order: null, ...extra,
});

export default {
  tables: {
    fuel_logs: fuel,
    maintenance_predictions: [
      prediction(1, health[0], 1, "open"),
      prediction(2, health[1], 1, "open"),
      prediction(3, health[1], 30, "actioned", {
        work_order_id: "11300000-0000-4000-8000-000000000001", work_order: { number: 118, status: "completed" },
      }),
      prediction(4, health[2], 45, "dismissed", { note: "Cost was a one-off tyre purchase." }),
    ],
  },
  rpc: {
    predictive_vehicle_health: () => health,
    predictive_snapshot: () => 2,
  },
};
