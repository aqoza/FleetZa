// Driver behavior smoke fixture: two default drivers, events relative to now,
// driver_scores answered per period so the trend sparklines vary by week.
const T = "170d2d86-5c22-4bcb-9d74-420c879419b2";
const VEH_1 = "a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d01";
const VEH_2 = "a7e1c0de-0002-4b2c-9d3e-4f5a6b7c8d02";
const DRV_1 = "d0c0ffee-0001-4a1b-8c2d-3e4f5a6b7c01";
const DRV_2 = "d0c0ffee-0002-4a1b-8c2d-3e4f5a6b7c02";
const OWNER = "129bbbae-fdfc-4d21-8a86-8949fec2403b";
const ago = (h) => new Date(Date.now() - h * 3_600_000).toISOString();
const day = (d) => new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);
const veh = { [VEH_1]: { name: "Truck 12", license_plate: "8KLM392" }, [VEH_2]: { name: "Van 04", license_plate: "7ABC219" } };
const drv = { [DRV_1]: { first_name: "Maria", last_name: "Lopez" }, [DRV_2]: { first_name: "Omar", last_name: "Haddad" } };

const spec = [
  [DRV_2, VEH_2, 3, "collision_warning", "high", 74, 60],
  [DRV_2, VEH_2, 20, "speeding", "high", 112, 80],
  [DRV_2, VEH_2, 50, "phone_use", "medium", 64, null],
  [DRV_2, VEH_2, 120, "harsh_braking", "medium", 58, null],
  [DRV_1, VEH_1, 30, "harsh_acceleration", "low", 42, null],
  [DRV_1, VEH_1, 200, "speeding", "medium", 92, 80],
  [null, VEH_1, 400, "idling", "low", 0, null],
];
const events = spec.map(([d, v, h, type, sev, speed, limit], i) => ({
  id: `de000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
  tenant_id: T, vehicle_id: v, driver_id: d, occurred_at: ago(h), event_type: type, severity: sev,
  speed_kmh: speed, speed_limit_kmh: limit, duration_s: null, lat: null, lng: null,
  source: i % 3 ? "api" : "manual", notes: null, created_at: ago(h), updated_at: ago(h),
  vehicle: veh[v], driver: d ? drv[d] : null,
}));

export default {
  tables: {
    driving_events: events,
    driver_coaching_sessions: [
      { id: "dc000000-0000-4000-8000-000000000001", tenant_id: T, driver_id: DRV_2, coach_id: OWNER, session_date: day(-2),
        topics: ["speeding", "phone_use", "defensive_driving"], notes: "Review the speeding alert on the coast road.",
        event_ids: [events[1].id, events[2].id], follow_up_date: day(-30), status: "scheduled",
        created_at: ago(5), updated_at: ago(5), driver: drv[DRV_2], coach: { full_name: "Demo Owner", email: "demo@fleetmanage.test" } },
      { id: "dc000000-0000-4000-8000-000000000002", tenant_id: T, driver_id: DRV_1, coach_id: OWNER, session_date: day(40),
        topics: ["fuel_economy"], notes: null, event_ids: [], follow_up_date: null, status: "completed",
        created_at: ago(960), updated_at: ago(960), driver: drv[DRV_1], coach: { full_name: "Demo Owner", email: "demo@fleetmanage.test" } },
    ],
  },
  rpc: {
    driver_scores: (args) => {
      const days = Math.round((Date.parse(args.p_to) - Date.parse(args.p_from)) / 86_400_000);
      const wobble = Math.floor(Date.parse(args.p_to) / (7 * 86_400_000)) % 5;
      if (days <= 7) {
        return [
          { driver_id: DRV_1, events: 1, high_events: 0, penalty: 2, distance_km: 640, score: 96 - wobble / 2, grade: "A" },
          { driver_id: DRV_2, events: 3, high_events: 2, penalty: 40, distance_km: 410, score: 70 + wobble * 2, grade: "C" },
        ];
      }
      return [
        { driver_id: DRV_1, events: 2, high_events: 0, penalty: 10, distance_km: 2380.4, score: 99.6, grade: "A" },
        { driver_id: DRV_2, events: 4, high_events: 2, penalty: 54, distance_km: 210.2, score: 74.3, grade: "C" },
      ];
    },
  },
};
