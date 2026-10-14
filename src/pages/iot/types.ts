import type { DeviceType, RuleOp } from "../../lib/iot";

export type DeviceStatus = "active" | "inactive" | "faulty";
export type AlertSeverity = "info" | "warning" | "critical";
export type AlertStatus = "open" | "acknowledged" | "resolved";

export interface IotDevice {
  id: string;
  serial: string;
  name: string;
  device_type: DeviceType;
  vehicle_id: string | null;
  asset_label: string | null;
  status: DeviceStatus;
  last_seen_at: string | null;
  last_reading: unknown;
  notes: string | null;
  created_at: string;
  vehicle: { name: string; license_plate: string | null } | null;
}

export interface IotReading {
  id: string;
  device_id: string;
  recorded_at: string;
  metric: string;
  value: number;
  unit: string | null;
  source: "api" | "manual";
}

export interface AlertRule {
  id: string;
  name: string;
  device_id: string | null;
  device_type: DeviceType | null;
  metric: string;
  op: RuleOp;
  threshold: number;
  severity: AlertSeverity;
  cooldown_minutes: number;
  notify: boolean;
  active: boolean;
  notes: string | null;
  device: { name: string; serial: string } | null;
}

export interface IotAlert {
  id: string;
  rule_id: string | null;
  device_id: string;
  rule_name: string;
  metric: string;
  op: RuleOp;
  threshold: number;
  value: number;
  unit: string | null;
  severity: AlertSeverity;
  triggered_at: string;
  status: AlertStatus;
  acknowledged_at: string | null;
  resolved_at: string | null;
  note: string | null;
  device: { name: string; serial: string } | null;
}

export const DEVICE_SELECT =
  "id, serial, name, device_type, vehicle_id, asset_label, status, last_seen_at, last_reading, notes, created_at, " +
  "vehicle:vehicles!iot_devices_vehicle_id_fkey(name,license_plate)";
export const RULE_SELECT =
  "id, name, device_id, device_type, metric, op, threshold, severity, cooldown_minutes, notify, active, notes, " +
  "device:iot_devices!iot_alert_rules_device_id_fkey(name,serial)";
export const ALERT_SELECT =
  "id, rule_id, device_id, rule_name, metric, op, threshold, value, unit, severity, triggered_at, status, " +
  "acknowledged_at, resolved_at, note, device:iot_devices!iot_alerts_device_id_fkey(name,serial)";
