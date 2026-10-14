/**
 * Incident rules shared by the SPA and tests. The database (migration
 * 20261008000024_incidents.sql) enforces the transitions; this mirrors them
 * for the UI and builds the overview and driver figures.
 */

export const INCIDENT_TYPES = [
  "collision", "theft", "vandalism", "injury", "near_miss", "breakdown", "fire", "weather", "other",
] as const;
export type IncidentType = (typeof INCIDENT_TYPES)[number];

export const SEVERITIES = ["minor", "moderate", "major", "critical"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const AT_FAULT = ["our_driver", "third_party", "shared", "unknown", "none"] as const;
export type AtFault = (typeof AT_FAULT)[number];

export const INCIDENT_STATUSES = ["reported", "investigating", "awaiting_repair", "resolved", "closed"] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const PARTY_TYPES = ["third_party_driver", "witness", "passenger", "pedestrian", "police", "other"] as const;
export type PartyType = (typeof PARTY_TYPES)[number];

/** Allowed next statuses; app.incident_guard is the source of truth. */
export const INCIDENT_TRANSITIONS: Record<IncidentStatus, readonly IncidentStatus[]> = {
  reported: ["investigating", "resolved"],
  investigating: ["awaiting_repair", "resolved"],
  awaiting_repair: ["resolved"],
  resolved: ["closed", "investigating"],
  closed: [],
};

export const OPEN_STATUSES: readonly IncidentStatus[] = ["reported", "investigating", "awaiting_repair"];

export function isSerious(s: Severity): boolean {
  return s === "major" || s === "critical";
}

/** Closing a major or critical incident needs a root cause. */
export function needsRootCause(i: { severity: Severity; root_cause: string | null }): boolean {
  return isSerious(i.severity) && !(i.root_cause ?? "").trim();
}

/** What an incident cost: the actual cost once known, else the estimate. */
export function incidentCost(i: { actual_cost: number | null; estimated_damage: number | null }): number {
  return i.actual_cost ?? i.estimated_damage ?? 0;
}

/** Faults that count against our driver. */
export function ourFault(f: AtFault): boolean {
  return f === "our_driver" || f === "shared";
}

export interface StatRow {
  occurred_at: string;
  incident_type: IncidentType;
  severity: Severity;
  injuries: number;
  actual_cost: number | null;
  estimated_damage: number | null;
}

/** "YYYY-MM" of the last `months` months ending with `today`'s month. */
export function lastMonths(today: string, months: number): string[] {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7)) - 1;
  const out: string[] = [];
  for (let k = months - 1; k >= 0; k--) {
    const d = new Date(Date.UTC(y, m - k, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

/** Month key of an instant in a time zone. */
export function monthIn(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" }).format(new Date(iso)).slice(0, 7);
}

export function monthlyStats(rows: readonly StatRow[], months: readonly string[], timeZone: string) {
  const out = new Map(months.map((m) => [m, { month: m, count: 0, serious: 0, cost: 0 }]));
  for (const r of rows) {
    const b = out.get(monthIn(r.occurred_at, timeZone));
    if (!b) continue;
    b.count += 1;
    if (isSerious(r.severity)) b.serious += 1;
    b.cost += incidentCost(r);
  }
  return [...out.values()].map((b) => ({ ...b, cost: Math.round(b.cost * 100) / 100 }));
}

export function byType(rows: readonly StatRow[]): Array<{ type: IncidentType; count: number; cost: number }> {
  const m = new Map<IncidentType, { type: IncidentType; count: number; cost: number }>();
  for (const r of rows) {
    const b = m.get(r.incident_type) ?? { type: r.incident_type, count: 0, cost: 0 };
    b.count += 1;
    b.cost += incidentCost(r);
    m.set(r.incident_type, b);
  }
  return [...m.values()].sort((a, b) => b.count - a.count || b.cost - a.cost);
}

export interface DriverRow extends StatRow {
  driver_id: string | null;
  at_fault: AtFault;
}

export interface DriverStats {
  driverId: string;
  count: number;
  atFault: number;
  serious: number;
  injuries: number;
  cost: number;
  last: string;
}

/** Per-driver history, worst first (at-fault, then count, then cost). */
export function driverStats(rows: readonly DriverRow[]): DriverStats[] {
  const m = new Map<string, DriverStats>();
  for (const r of rows) {
    if (!r.driver_id) continue;
    const s = m.get(r.driver_id) ?? { driverId: r.driver_id, count: 0, atFault: 0, serious: 0, injuries: 0, cost: 0, last: r.occurred_at };
    s.count += 1;
    if (ourFault(r.at_fault)) s.atFault += 1;
    if (isSerious(r.severity)) s.serious += 1;
    s.injuries += r.injuries;
    s.cost += incidentCost(r);
    if (r.occurred_at > s.last) s.last = r.occurred_at;
    m.set(r.driver_id, s);
  }
  return [...m.values()]
    .map((s) => ({ ...s, cost: Math.round(s.cost * 100) / 100 }))
    .sort((a, b) => b.atFault - a.atFault || b.count - a.count || b.cost - a.cost);
}
