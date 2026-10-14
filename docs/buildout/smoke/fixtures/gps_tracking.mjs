// GPS tracking smoke fixture: times are relative to "now" so the live map's
// recency buckets and today's route history always have data.
const T = "170d2d86-5c22-4bcb-9d74-420c879419b2";
const VEH_1 = "a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d01";
const VEH_2 = "a7e1c0de-0002-4b2c-9d3e-4f5a6b7c8d02";
const VEH_3 = "a7e1c0de-0003-4b2c-9d3e-4f5a6b7c8d03";
const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
const veh = { [VEH_1]: { name: "Truck 12", license_plate: "8KLM392" }, [VEH_2]: { name: "Van 04", license_plate: "7ABC219" }, [VEH_3]: { name: "GF Tractor 7", license_plate: "4TRK771" } };

// Today's track for Truck 12: from local 06:00, every 3 minutes, a 15-minute stop in the middle.
const start = new Date();
start.setHours(6, 0, 0, 0);
const track = [];
for (let i = 0; i < 60; i++) {
  const stopped = i >= 20 && i < 26;
  const k = stopped ? 20 : i < 20 ? i : i - 5;
  const at = new Date(start.getTime() + i * 3 * 60_000);
  if (at.getTime() > Date.now()) break;
  track.push({
    id: `6a000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    tenant_id: T, vehicle_id: VEH_1, recorded_at: at.toISOString(),
    lat: 23.58 + k * 0.004, lng: 58.30 + k * 0.006 + (k > 20 ? 0.01 : 0),
    speed_kmh: stopped ? 0 : 48 + (i % 5) * 4, heading: 45, odometer_km: null,
    source: i % 2 ? "api" : "import", vehicle: veh[VEH_1],
  });
}

const fences = [
  { id: "9f000000-0000-4000-8000-000000000001", tenant_id: T, name: "Main yard", kind: "circle", center_lat: 23.588, center_lng: 58.3829,
    radius_m: 600, polygon: null, color: "blue", active: true, alert_on_enter: true, alert_on_exit: true, notes: null, created_at: ago(5000) },
  { id: "9f000000-0000-4000-8000-000000000002", tenant_id: T, name: "ميناء السلطان قابوس", kind: "polygon", center_lat: null, center_lng: null,
    radius_m: null, polygon: [[23.625, 58.56], [23.625, 58.575], [23.635, 58.575], [23.635, 58.56]], color: "teal", active: true,
    alert_on_enter: false, alert_on_exit: false, notes: null, created_at: ago(4000) },
  { id: "9f000000-0000-4000-8000-000000000003", tenant_id: T, name: "Old depot", kind: "circle", center_lat: 23.55, center_lng: 58.25,
    radius_m: 300, polygon: null, color: "amber", active: false, alert_on_enter: false, alert_on_exit: true, notes: null, created_at: ago(3000) },
];

export default {
  tables: {
    vehicle_last_positions: [
      { vehicle_id: VEH_1, tenant_id: T, position_id: track.at(-1)?.id ?? "6a000000-0000-4000-8000-000000000999", recorded_at: ago(2), lat: 23.6, lng: 58.42, speed_kmh: 62, heading: 90, ignition: true, driver_id: null, vehicle: veh[VEH_1], driver: null },
      { vehicle_id: VEH_2, tenant_id: T, position_id: "6a000000-0000-4000-8000-000000000998", recorded_at: ago(6), lat: 23.589, lng: 58.383, speed_kmh: 0, heading: 0, ignition: false, driver_id: null, vehicle: veh[VEH_2], driver: null },
      { vehicle_id: VEH_3, tenant_id: T, position_id: "6a000000-0000-4000-8000-000000000997", recorded_at: ago(300), lat: 23.63, lng: 58.567, speed_kmh: 0, heading: 0, ignition: false, driver_id: null, vehicle: veh[VEH_3], driver: null },
    ],
    gps_positions: track,
    geofences: fences,
    geofence_events: [
      { id: "9e000000-0000-4000-8000-000000000001", tenant_id: T, geofence_id: fences[0].id, vehicle_id: VEH_2, event: "enter", at: ago(30), position_id: null, created_at: ago(30), vehicle: veh[VEH_2], geofence: { name: fences[0].name, color: "blue" } },
      { id: "9e000000-0000-4000-8000-000000000002", tenant_id: T, geofence_id: fences[0].id, vehicle_id: VEH_1, event: "exit", at: ago(90), position_id: null, created_at: ago(90), vehicle: veh[VEH_1], geofence: { name: fences[0].name, color: "blue" } },
      { id: "9e000000-0000-4000-8000-000000000003", tenant_id: T, geofence_id: fences[1].id, vehicle_id: VEH_3, event: "enter", at: ago(320), position_id: null, created_at: ago(320), vehicle: veh[VEH_3], geofence: { name: fences[1].name, color: "teal" } },
    ],
  },
  rpc: {},
};
