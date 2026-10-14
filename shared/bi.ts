/**
 * BI analytics (module `bi_analytics`): the metric catalog, period maths and
 * series helpers shared by the dashboard screens and tests. The catalog
 * mirrors app.bi_metric_dimensions in migration 20261008000031_bi_analytics.sql
 * (shared/bi.test.ts compares the two). No I/O.
 */

export const DIMENSIONS = ["none", "month", "week", "vehicle", "driver", "customer", "category", "status"] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export const WIDGET_TYPES = ["kpi", "bar", "line", "pie", "table"] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];

export const PERIODS = ["last_30_days", "last_90_days", "this_year", "last_12_months", "custom"] as const;
export type Period = (typeof PERIODS)[number];

export const SIZES = ["small", "medium", "large"] as const;
export type WidgetSize = (typeof SIZES)[number];

/** How a metric's value reads: money in the tenant currency, a count, liters or km. */
export type MetricUnit = "money" | "count" | "liters" | "km";

export interface MetricDef {
  id: string;
  unit: MetricUnit;
  /** The module whose data it reads; the metric is offered only when that module is on. */
  module: string;
  dimensions: readonly Dimension[];
}

export const METRICS: readonly MetricDef[] = [
  { id: "fuel_cost", unit: "money", module: "fuel", dimensions: ["none", "month", "week", "vehicle", "driver"] },
  { id: "fuel_liters", unit: "liters", module: "fuel", dimensions: ["none", "month", "week", "vehicle", "driver"] },
  { id: "distance_km", unit: "km", module: "fuel", dimensions: ["none", "month", "week", "vehicle"] },
  { id: "maintenance_cost", unit: "money", module: "maintenance", dimensions: ["none", "month", "week", "vehicle", "category"] },
  { id: "work_orders_count", unit: "count", module: "maintenance", dimensions: ["none", "month", "week", "vehicle", "category", "status"] },
  { id: "issues_count", unit: "count", module: "issues", dimensions: ["none", "month", "week", "vehicle", "category", "status"] },
  { id: "inspections_failed", unit: "count", module: "inspections", dimensions: ["none", "month", "week", "vehicle", "driver"] },
  { id: "vehicles_count", unit: "count", module: "fleet", dimensions: ["none", "category", "status"] },
  { id: "revenue_invoiced", unit: "money", module: "billing", dimensions: ["none", "month", "week", "customer", "vehicle", "status"] },
  { id: "payments_received", unit: "money", module: "billing", dimensions: ["none", "month", "week", "customer", "category"] },
  { id: "quotes_count", unit: "count", module: "sales", dimensions: ["none", "month", "week", "customer", "status"] },
  { id: "certificates_issued", unit: "count", module: "sl_certificates", dimensions: ["none", "month", "week", "customer", "vehicle", "status"] },
  { id: "incidents_count", unit: "count", module: "incidents", dimensions: ["none", "month", "week", "vehicle", "driver", "category", "status"] },
  { id: "trips_completed", unit: "count", module: "trip_planning", dimensions: ["none", "month", "week", "vehicle", "driver", "customer"] },
  { id: "deliveries_delivered", unit: "count", module: "logistics_delivery", dimensions: ["none", "month", "week", "customer"] },
  { id: "shipments_revenue", unit: "money", module: "tms", dimensions: ["none", "month", "week", "customer", "vehicle", "driver"] },
  { id: "expenses_total", unit: "money", module: "finance", dimensions: ["none", "month", "week", "vehicle", "category"] },
  { id: "payroll_net", unit: "money", module: "payroll_hr", dimensions: ["none", "month"] },
  { id: "pos_sales", unit: "money", module: "pos", dimensions: ["none", "month", "week", "customer"] },
];

export function metricDef(id: string): MetricDef | undefined {
  return METRICS.find((m) => m.id === id);
}

/** Time dimensions draw as a continuous series; the rest are rankings. */
export function isTimeDimension(d: string): boolean {
  return d === "month" || d === "week";
}

/** The chart that suits a metric/dimension pair when the user has not chosen one. */
export function suggestedType(dimension: Dimension): WidgetType {
  if (dimension === "none") return "kpi";
  if (isTimeDimension(dimension)) return "bar";
  return dimension === "status" || dimension === "category" ? "pie" : "bar";
}

/** Keeps a widget valid when its metric changes: the dimension falls back to the first one the metric has. */
export function coerceDimension(metric: string, dimension: string): Dimension {
  const def = metricDef(metric);
  if (!def) return "none";
  return (def.dimensions as readonly string[]).includes(dimension) ? (dimension as Dimension) : def.dimensions[0];
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
function addDays(isoDate: string, n: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

/** The inclusive [from, to] dates of a period, ending on `today` (the tenant's local date). */
export function periodRange(period: Period, today: string, from?: string | null, to?: string | null): { from: string; to: string } {
  switch (period) {
    case "last_30_days":
      return { from: addDays(today, -29), to: today };
    case "last_90_days":
      return { from: addDays(today, -89), to: today };
    case "this_year":
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case "last_12_months": {
      const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() - 11);
      return { from: iso(d), to: today };
    }
    case "custom":
      return { from: from || today, to: to || today };
  }
}

export interface MetricRow {
  key: string;
  label: string;
  value: number;
}

/** Monday of the ISO week holding `isoDate`. */
export function weekStart(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  return iso(d);
}

/** Fills the months or weeks with no data in [from, to] with zeroes, so a time chart has no gaps. */
export function fillSeries(rows: MetricRow[], dimension: Dimension, from: string, to: string): MetricRow[] {
  if (!isTimeDimension(dimension)) return rows;
  const by = new Map(rows.map((r) => [r.key, Number(r.value)]));
  const out: MetricRow[] = [];
  if (dimension === "month") {
    const d = new Date(`${from.slice(0, 7)}-01T00:00:00Z`);
    const end = to.slice(0, 7);
    for (let i = 0; i < 48; i++) {
      const k = iso(d).slice(0, 7);
      if (k > end) break;
      out.push({ key: k, label: k, value: by.get(k) ?? 0 });
      d.setUTCMonth(d.getUTCMonth() + 1);
    }
  } else {
    let k = weekStart(from);
    for (let i = 0; i < 160 && k <= to; i++) {
      out.push({ key: k, label: k, value: by.get(k) ?? 0 });
      k = addDays(k, 7);
    }
  }
  return out;
}

/** The value a KPI shows: the single total row, or the sum of every row. */
export function totalOf(rows: MetricRow[]): number {
  return rows.reduce((s, r) => s + Number(r.value || 0), 0);
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** A two-column CSV (label, value) of a widget's rows, with a header line. */
export function toCsv(header: [string, string], rows: Array<{ label: string; value: number }>): string {
  return [header.map(csvCell).join(","), ...rows.map((r) => `${csvCell(r.label)},${csvCell(r.value)}`)].join("\n");
}
