// Trip planning smoke fixture: one trip running now with four stops, trips
// dispatched and planned for the coming days (one double-booked), a canceled
// trip and eight weeks of completed trips for the overview chart.
const T = "170d2d86-5c22-4bcb-9d74-420c879419b2";
const VEH_1 = "a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d01";
const VEH_2 = "a7e1c0de-0002-4b2c-9d3e-4f5a6b7c8d02";
const VEH_3 = "a7e1c0de-0003-4b2c-9d3e-4f5a6b7c8d03";
const DRV_1 = "d0c0ffee-0001-4a1b-8c2d-3e4f5a6b7c01";
const DRV_2 = "d0c0ffee-0002-4a1b-8c2d-3e4f5a6b7c02";
const CUST_1 = "c1a0e5f2-3b4d-4e6f-8a9b-0c1d2e3f4a51";
const H = 3_600_000;
const at = (hours) => new Date(Math.floor(Date.now() / H) * H + hours * H).toISOString();
const veh = {
  [VEH_1]: { name: "Truck 12", license_plate: "8KLM392", odometer: 184250 },
  [VEH_2]: { name: "Van 04", license_plate: "7ABC219", odometer: 42310 },
  [VEH_3]: { name: "GF Tractor 7", license_plate: "4TRK771", odometer: 301120 },
};
const drv = { [DRV_1]: { first_name: "Maria", last_name: "Lopez" }, [DRV_2]: { first_name: "Omar", last_name: "Haddad" } };
const id = (n) => `11800000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const trip = (n, o) => ({
  id: id(n), tenant_id: T, number: n, doc_number: `TRP-${String(n).padStart(5, "0")}`, driver_id: null, customer_id: null,
  actual_start: null, actual_end: null, start_odometer: null, end_odometer: null, planned_distance_km: null, actual_distance_km: null,
  estimated_fuel_l: null, estimated_cost: null, notes: null, cancel_reason: null, dispatched_at: null, completed_at: null, canceled_at: null,
  created_at: at(-200), updated_at: at(-1), ...o,
  vehicle: veh[o.vehicle_id], driver: o.driver_id ? drv[o.driver_id] : null, customer: o.customer_id ? { name: "Gulf Freight Co." } : null,
});

const trips = [
  trip(42, { vehicle_id: VEH_1, driver_id: DRV_1, customer_id: CUST_1, status: "in_progress", purpose: "Muscat to Sohar delivery",
    planned_start: at(-3), planned_end: at(3), actual_start: at(-2.75), start_odometer: 184020, planned_distance_km: 230,
    estimated_fuel_l: 69, estimated_cost: 15.87, dispatched_at: at(-20), notes: "Gate pass needed at Sohar port." }),
  trip(43, { vehicle_id: VEH_2, driver_id: DRV_2, status: "dispatched", purpose: "Parts pickup, Rusayl", planned_start: at(20),
    planned_end: at(25), planned_distance_km: 64, estimated_fuel_l: 7.7, estimated_cost: 1.77, dispatched_at: at(-2) }),
  trip(44, { vehicle_id: VEH_2, status: "planned", purpose: "Customer site visit", planned_start: at(22), planned_end: at(26) }),
  trip(45, { vehicle_id: VEH_1, status: "planned", purpose: "Return empties to Barka depot", planned_start: at(46), planned_end: at(50),
    planned_distance_km: 80 }),
  trip(46, { vehicle_id: VEH_3, driver_id: DRV_1, status: "canceled", purpose: "Nizwa transfer", planned_start: at(30), planned_end: at(36),
    canceled_at: at(-5), cancel_reason: "Customer postponed" }),
];
// Completed history: one or two per week for 8 weeks.
for (let w = 0; w < 8; w++) {
  for (let k = 0; k < 1 + (w % 2); k++) {
    const start = -24 * (3 + w * 7 + k * 2);
    const planned = 120 + ((w * 37 + k * 53) % 140);
    const actual = Math.round((planned * (0.95 + ((w + k) % 4) * 0.05)) * 10) / 10;
    trips.push(trip(10 + w * 2 + k, {
      vehicle_id: [VEH_1, VEH_2, VEH_3][(w + k) % 3], driver_id: (w + k) % 2 ? DRV_2 : DRV_1, status: "completed",
      purpose: ["Sohar delivery", "Rusayl pickup", "Nizwa transfer"][(w + k) % 3], planned_start: at(start), planned_end: at(start + 5),
      actual_start: at(start + 0.25), actual_end: at(start + 5.5), start_odometer: 100000 + w * 1000, end_odometer: 100000 + w * 1000 + actual,
      planned_distance_km: planned, actual_distance_km: actual, completed_at: at(start + 5.5), dispatched_at: at(start - 10),
    }));
  }
}

const stop = (n, seq, name, lat, lng, status, o = {}) => ({
  id: `11900000-0000-4000-8000-00000000000${n}`, tenant_id: T, trip_id: id(42), sequence: seq, name, address: null, lat, lng,
  planned_arrival: null, actual_arrival: null, actual_departure: null, status, notes: null, created_at: at(-30), updated_at: at(-1), ...o,
});

export default {
  tables: {
    trips,
    trip_stops: [
      stop(1, 1, "Muscat depot", 23.588, 58.3829, "departed", { address: "Ghala Industrial Area", actual_arrival: at(-2.9), actual_departure: at(-2.7) }),
      stop(2, 2, "Barka cold store", 23.6786, 57.8861, "departed", { planned_arrival: at(-2), actual_arrival: at(-1.8), actual_departure: at(-1.4) }),
      stop(3, 3, "Saham fuel stop", 24.1722, 56.8886, "arrived", { actual_arrival: at(-0.2), notes: "Driver break, 30 min" }),
      stop(4, 4, "مستودع ميناء صحار", 24.3474, 56.7094, "pending", { address: "Sohar Port, Gate 3", planned_arrival: at(2) }),
    ],
  },
  rpc: {
    trip_conflicts: (args) =>
      args.p_exclude === id(44)
        ? [{ trip_id: id(43), doc_number: "TRP-00043", status: "dispatched", purpose: "Parts pickup, Rusayl",
             planned_start: at(20), planned_end: at(25), vehicle_clash: true, driver_clash: false }]
        : [],
    trip_stops_reorder: () => null,
  },
};
