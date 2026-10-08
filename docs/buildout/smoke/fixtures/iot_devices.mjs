// IoT devices smoke fixture: three sensors, a day of reefer temperatures
// relative to now (one excursion above the 8 °C rule), rules and alerts.
const T = "170d2d86-5c22-4bcb-9d74-420c879419b2";
const VEH_1 = "a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d01";
const D1 = "10700000-0000-4000-8000-000000000001";
const D2 = "10700000-0000-4000-8000-000000000002";
const D3 = "10700000-0000-4000-8000-000000000003";
const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
const veh = { name: "Truck 12", license_plate: "8KLM392" };

const temps = [];
for (let i = 96; i >= 0; i--) {
  const excursion = i >= 30 && i <= 34;
  const v = excursion ? 8.6 + (34 - Math.abs(32 - i)) * 0.1 : 4 + Math.sin(i / 6) * 1.2;
  temps.push({ id: `10800000-0000-4000-8000-${String(i).padStart(12, "0")}`, tenant_id: T, device_id: D1,
    recorded_at: ago(i * 15), metric: "temperature", value: Math.round(v * 10) / 10, unit: "°C",
    source: i % 4 ? "api" : "manual", created_at: ago(i * 15) });
}
const last = temps.at(-1);

const devices = [
  { id: D1, tenant_id: T, serial: "TMP-001", name: "Reefer probe", device_type: "temperature", vehicle_id: VEH_1, asset_id: null,
    asset_label: null, status: "active", last_seen_at: last.recorded_at,
    last_reading: { temperature: { value: last.value, unit: "°C", at: last.recorded_at }, humidity: { value: 71, unit: "%", at: ago(3) } },
    notes: null, created_at: ago(90000), updated_at: ago(3), vehicle: veh },
  { id: D2, tenant_id: T, serial: "FUEL-01", name: "خزان الوقود الرئيسي", device_type: "fuel_level", vehicle_id: null, asset_id: null,
    asset_label: "Depot tank", status: "active", last_seen_at: ago(600),
    last_reading: { fuel_level: { value: 38.5, unit: "%", at: ago(600) }, battery: { value: 11.2, unit: "V", at: ago(600) } },
    notes: null, created_at: ago(90000), updated_at: ago(600), vehicle: null },
  { id: D3, tenant_id: T, serial: "TPMS-7", name: "Tire sensors trailer 7", device_type: "tire_pressure", vehicle_id: null, asset_id: null,
    asset_label: null, status: "faulty", last_seen_at: null, last_reading: {}, notes: "Waiting for replacement.", created_at: ago(9000),
    updated_at: ago(9000), vehicle: null },
];

const rules = [
  { id: "10900000-0000-4000-8000-000000000001", tenant_id: T, name: "Reefer too warm", device_id: D1, device_type: null, metric: "temperature",
    op: "gt", threshold: 8, severity: "critical", cooldown_minutes: 30, notify: true, active: true, notes: null,
    device: { name: "Reefer probe", serial: "TMP-001" } },
  { id: "10900000-0000-4000-8000-000000000002", tenant_id: T, name: "Low battery", device_id: null, device_type: null, metric: "battery",
    op: "lt", threshold: 11.5, severity: "warning", cooldown_minutes: 240, notify: true, active: true, notes: null, device: null },
  { id: "10900000-0000-4000-8000-000000000003", tenant_id: T, name: "Fuel below 20%", device_id: null, device_type: "fuel_level", metric: "fuel_level",
    op: "lte", threshold: 20, severity: "info", cooldown_minutes: 60, notify: false, active: false, notes: null, device: null },
];

const alert = (n, rule, dev, value, unit, min, status, note = null) => ({
  id: `10a00000-0000-4000-8000-00000000000${n}`, tenant_id: T, rule_id: rule.id, device_id: dev.id, reading_id: null,
  rule_name: rule.name, metric: rule.metric, op: rule.op, threshold: rule.threshold, value, unit, severity: rule.severity,
  triggered_at: ago(min), status, acknowledged_at: status === "open" ? null : ago(min - 5), acknowledged_by: null,
  resolved_at: status === "resolved" ? ago(min - 20) : null, resolved_by: null, note, created_at: ago(min), updated_at: ago(min),
  device: { name: dev.name, serial: dev.serial },
});

export default {
  tables: {
    iot_devices: devices,
    iot_readings: temps,
    iot_alert_rules: rules,
    iot_alerts: [
      alert(1, rules[0], devices[0], 9.1, "°C", 480, "open"),
      alert(2, rules[1], devices[1], 11.2, "V", 600, "acknowledged"),
      alert(3, rules[0], devices[0], 8.4, "°C", 4000, "resolved", "Door seal replaced"),
    ],
  },
  rpc: {},
};
