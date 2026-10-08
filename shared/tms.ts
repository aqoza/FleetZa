/**
 * Transport management (module `tms`) — pure helpers for the SPA. The status
 * table mirrors app.shipment_guard() and quoteFreight() mirrors
 * public.quote_freight() in migration 20261008000021_tms.sql. Change both
 * together.
 */

export type ShipmentStatus =
  | "draft" | "booked" | "dispatched" | "in_transit" | "exception" | "delivered" | "closed" | "canceled";
export type ShipmentMode = "road_ftl" | "road_ltl" | "courier" | "other";
export type ServiceLevel = "economy" | "standard" | "express";
export type CarrierType = "own" | "third_party";

export const SHIPMENT_STATUSES: ShipmentStatus[] =
  ["draft", "booked", "dispatched", "in_transit", "exception", "delivered", "closed", "canceled"];
export const SHIPMENT_MODES: ShipmentMode[] = ["road_ftl", "road_ltl", "courier", "other"];
export const SERVICE_LEVELS: ServiceLevel[] = ["economy", "standard", "express"];
/** Shipments on the road or about to be. */
export const ACTIVE_SHIPMENT_STATUSES: ShipmentStatus[] = ["booked", "dispatched", "in_transit", "exception"];

export const SHIPMENT_TRANSITIONS: Record<ShipmentStatus, ShipmentStatus[]> = {
  draft: ["booked", "canceled"],
  booked: ["dispatched", "canceled"],
  dispatched: ["in_transit", "canceled"],
  in_transit: ["delivered", "exception"],
  exception: ["in_transit", "delivered"],
  delivered: ["closed"],
  closed: [],
  canceled: [],
};

export const canTransition = (from: ShipmentStatus, to: ShipmentStatus) => SHIPMENT_TRANSITIONS[from].includes(to);
/** Closed and canceled shipments only take note edits. */
export const isLocked = (s: ShipmentStatus) => s === "closed" || s === "canceled";

export interface FreightRate {
  id: string;
  origin_city: string;
  destination_city: string;
  mode: ShipmentMode;
  customer_id: string | null;
  rate_per_kg: number | null;
  rate_per_trip: number | null;
  min_charge: number;
  valid_from: string;
  valid_to: string | null;
}

export interface QuoteInput {
  origin_city: string;
  destination_city: string;
  mode: ShipmentMode;
  weight_kg: number | null;
  customer_id?: string | null;
  /** YYYY-MM-DD; defaults to today. */
  on?: string;
}

export interface Quote {
  rate_id: string;
  price: number;
  customer_specific: boolean;
}

const norm = (s: string) => s.trim().toLowerCase();
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function ratePrice(r: Pick<FreightRate, "rate_per_kg" | "rate_per_trip" | "min_charge">, weightKg: number | null): number {
  const w = Math.max(weightKg ?? 0, 0);
  return round3(Math.max(Number(r.min_charge), Number(r.rate_per_trip ?? 0) + Number(r.rate_per_kg ?? 0) * w));
}

/** Cheapest valid rate for the lane; the customer's own rates win when any match. */
export function quoteFreight(rates: FreightRate[], q: QuoteInput): Quote | null {
  const on = q.on ?? new Date().toISOString().slice(0, 10);
  const matches = rates.filter((r) =>
    norm(r.origin_city) === norm(q.origin_city) && norm(r.destination_city) === norm(q.destination_city)
    && r.mode === q.mode && r.valid_from <= on && (r.valid_to == null || r.valid_to >= on)
    && (r.customer_id == null || r.customer_id === (q.customer_id ?? null)));
  if (!matches.length) return null;
  const ranked = matches
    .map((r) => ({ r, price: ratePrice(r, q.weight_kg) }))
    .sort((a, b) =>
      Number(b.r.customer_id != null) - Number(a.r.customer_id != null)
      || a.price - b.price
      || b.r.valid_from.localeCompare(a.r.valid_from)
      || a.r.id.localeCompare(b.r.id));
  const best = ranked[0];
  return { rate_id: best.r.id, price: best.price, customer_specific: best.r.customer_id != null };
}

export interface ShipmentStatsRow {
  status: ShipmentStatus;
  total_charge: number | null;
  carrier_cost: number | null;
  delivered_at: string | null;
  delivery_window_end: string | null;
}

/** Share of delivered shipments with a window that arrived by its end; null when none qualify. */
export function onTimePct(rows: ShipmentStatsRow[]): number | null {
  const judged = rows.filter((r) => r.delivered_at && r.delivery_window_end);
  if (!judged.length) return null;
  const onTime = judged.filter((r) => Date.parse(r.delivered_at!) <= Date.parse(r.delivery_window_end!)).length;
  return Math.round((onTime / judged.length) * 100);
}

export interface MarginStats {
  revenue: number;
  cost: number;
  margin: number;
  /** Margin as a share of revenue, null without revenue. */
  marginPct: number | null;
  /** Shipments counted (not canceled, with a charge or a cost). */
  count: number;
}

/** Revenue and carrier cost over non-canceled shipments. */
export function marginStats(rows: ShipmentStatsRow[]): MarginStats {
  let revenue = 0;
  let cost = 0;
  let count = 0;
  for (const r of rows) {
    if (r.status === "canceled" || r.status === "draft") continue;
    revenue += Number(r.total_charge ?? 0);
    cost += Number(r.carrier_cost ?? 0);
    count++;
  }
  revenue = round3(revenue);
  cost = round3(cost);
  const margin = round3(revenue - cost);
  return { revenue, cost, margin, marginPct: revenue > 0 ? Math.round((margin / revenue) * 1000) / 10 : null, count };
}

/** Monday (UTC) of the week a timestamp falls in, as YYYY-MM-DD. */
export function weekStart(iso: string): string {
  const d = new Date(iso);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

/** Revenue vs carrier cost per week for the last `weeks` weeks ending at `now`, oldest first. */
export function weeklyRevenue(
  rows: (ShipmentStatsRow & { created_at: string })[], weeks: number, now = new Date(),
): { week: string; revenue: number; cost: number }[] {
  const out: { week: string; revenue: number; cost: number }[] = [];
  const end = weekStart(now.toISOString());
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(end + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - i * 7);
    out.push({ week: d.toISOString().slice(0, 10), revenue: 0, cost: 0 });
  }
  const idx = new Map(out.map((w, i) => [w.week, i]));
  for (const r of rows) {
    if (r.status === "canceled" || r.status === "draft") continue;
    const i = idx.get(weekStart(r.delivered_at ?? r.created_at));
    if (i == null) continue;
    out[i].revenue = round3(out[i].revenue + Number(r.total_charge ?? 0));
    out[i].cost = round3(out[i].cost + Number(r.carrier_cost ?? 0));
  }
  return out;
}
