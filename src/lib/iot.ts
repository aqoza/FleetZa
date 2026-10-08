/**
 * IoT devices (module `iot_devices`) — pure helpers shared by the screens and
 * mirrored by the database (app.iot_compare, the last_reading shape in
 * migration 20261008000016_iot_devices.sql).
 */

export const DEVICE_TYPES = [
  "temperature", "humidity", "fuel_level", "tire_pressure", "door", "battery", "engine", "obd", "other",
] as const;
export type DeviceType = (typeof DEVICE_TYPES)[number];

export const RULE_OPS = ["gt", "gte", "lt", "lte", "eq"] as const;
export type RuleOp = (typeof RULE_OPS)[number];

export const OP_SYMBOL: Record<RuleOp, string> = { gt: ">", gte: "≥", lt: "<", lte: "≤", eq: "=" };

/** Same rule as app.iot_compare. */
export function compare(value: number, op: RuleOp, threshold: number): boolean {
  switch (op) {
    case "gt": return value > threshold;
    case "gte": return value >= threshold;
    case "lt": return value < threshold;
    case "lte": return value <= threshold;
    case "eq": return value === threshold;
  }
}

/** Metric names: lowercase snake case, as the database checks. */
export const METRIC_RE = /^[a-z][a-z0-9_]{0,49}$/;

/** Usual metric and unit per device type, to prefill forms. */
export const TYPE_DEFAULTS: Record<DeviceType, { metric: string; unit: string }> = {
  temperature: { metric: "temperature", unit: "°C" },
  humidity: { metric: "humidity", unit: "%" },
  fuel_level: { metric: "fuel_level", unit: "%" },
  tire_pressure: { metric: "tire_pressure", unit: "psi" },
  door: { metric: "door_open", unit: "" },
  battery: { metric: "battery", unit: "V" },
  engine: { metric: "coolant_temp", unit: "°C" },
  obd: { metric: "rpm", unit: "rpm" },
  other: { metric: "value", unit: "" },
};

export interface LatestValue {
  metric: string;
  value: number;
  unit: string | null;
  at: string;
}

/** iot_devices.last_reading → newest-first list (bad entries skipped). */
export function latestValues(lastReading: unknown): LatestValue[] {
  if (!lastReading || typeof lastReading !== "object" || Array.isArray(lastReading)) return [];
  const out: LatestValue[] = [];
  for (const [metric, raw] of Object.entries(lastReading as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as { value?: unknown; unit?: unknown; at?: unknown };
    const value = Number(r.value);
    if (!Number.isFinite(value) || typeof r.at !== "string") continue;
    out.push({ metric, value, unit: typeof r.unit === "string" && r.unit ? r.unit : null, at: r.at });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at) || a.metric.localeCompare(b.metric));
}

/** "4.2 °C" with up to 2 decimals; door-style 0/1 metrics stay plain numbers. */
export function formatReading(value: number, unit: string | null, locale?: string): string {
  const n = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
  return unit ? `${n} ${unit}` : n;
}

export type Freshness = "live" | "recent" | "silent" | "never";

/** Seen in the last 15 minutes / 24 hours / longer ago / never. */
export function freshness(lastSeenAt: string | null, now = Date.now()): Freshness {
  if (!lastSeenAt) return "never";
  const age = now - Date.parse(lastSeenAt);
  if (age <= 15 * 60_000) return "live";
  if (age <= 24 * 3_600_000) return "recent";
  return "silent";
}

/** Downsample a long series to at most `max` points by bucket averaging (keeps the chart responsive). */
export function downsample<T extends { t: number; v: number }>(points: T[], max: number): Array<{ t: number; v: number }> {
  if (points.length <= max || max < 2) return points.map(({ t, v }) => ({ t, v }));
  const size = points.length / max;
  const out: Array<{ t: number; v: number }> = [];
  for (let i = 0; i < max; i++) {
    const slice = points.slice(Math.floor(i * size), Math.floor((i + 1) * size));
    if (slice.length === 0) continue;
    out.push({
      t: slice[Math.floor(slice.length / 2)].t,
      v: slice.reduce((s, p) => s + p.v, 0) / slice.length,
    });
  }
  return out;
}
