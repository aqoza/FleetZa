/**
 * Deliveries (module `logistics_delivery`) — pure helpers shared by the SPA and
 * the public tracking endpoint. The status tables mirror app.delivery_guard()
 * and app.delivery_route_guard() in migration 20261008000020_deliveries.sql.
 * Change both together.
 */

export type DeliveryStatus = "pending" | "assigned" | "out_for_delivery" | "delivered" | "failed" | "returned";
export type RouteStatus = "planned" | "out_for_delivery" | "completed" | "canceled";
export type FailureReason = "not_home" | "refused" | "wrong_address" | "damaged" | "other";

export const DELIVERY_STATUSES: DeliveryStatus[] = ["pending", "assigned", "out_for_delivery", "delivered", "failed", "returned"];
export const ROUTE_STATUSES: RouteStatus[] = ["planned", "out_for_delivery", "completed", "canceled"];
export const FAILURE_REASONS: FailureReason[] = ["not_home", "refused", "wrong_address", "damaged", "other"];
/** Deliveries still waiting on a result. */
export const OPEN_DELIVERY_STATUSES: DeliveryStatus[] = ["pending", "assigned", "out_for_delivery", "failed"];

export const DELIVERY_TRANSITIONS: Record<DeliveryStatus, DeliveryStatus[]> = {
  pending: ["assigned"],
  assigned: ["pending", "out_for_delivery"],
  out_for_delivery: ["delivered", "failed"],
  delivered: [],
  failed: ["out_for_delivery", "returned", "pending"],
  returned: [],
};

export const ROUTE_TRANSITIONS: Record<RouteStatus, RouteStatus[]> = {
  planned: ["out_for_delivery", "canceled"],
  out_for_delivery: ["completed"],
  completed: [],
  canceled: [],
};

export interface LatLng {
  lat: number;
  lng: number;
}

/** Great-circle distance in km. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface Stop {
  id: string;
  lat: number | null;
  lng: number | null;
}

const hasCoords = (s: Stop): s is Stop & LatLng => s.lat != null && s.lng != null;

/**
 * Greedy nearest-neighbour order from the depot (or, without one, from the
 * first stop that has coordinates). Stops without coordinates keep their
 * relative order at the end. Ties go to the earlier stop, so the result is
 * deterministic.
 */
export function nearestNeighborOrder(start: LatLng | null, stops: Stop[]): string[] {
  const located = stops.filter(hasCoords);
  const rest = stops.filter((s) => !hasCoords(s)).map((s) => s.id);
  const order: string[] = [];
  const left = [...located];
  let here: LatLng | null = start;
  if (!here && left.length) {
    const first = left.shift()!;
    order.push(first.id);
    here = first;
  }
  while (left.length && here) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < left.length; i++) {
      const d = haversineKm(here, left[i]);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    const [next] = left.splice(best, 1);
    order.push(next.id);
    here = next;
  }
  return [...order, ...rest];
}

/** Straight-line length of a route: depot (if any) then each located stop in order. Km, 1 decimal. */
export function routeDistanceKm(start: LatLng | null, stops: Stop[]): number {
  const pts: LatLng[] = [...(start ? [start] : []), ...stops.filter(hasCoords)];
  let km = 0;
  for (let i = 1; i < pts.length; i++) km += haversineKm(pts[i - 1], pts[i]);
  return Math.round(km * 10) / 10;
}

/** RFC 4180 CSV: quoted fields, doubled quotes, CRLF or LF, optional BOM. Blank lines are dropped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

export interface ImportRow {
  recipient_name: string;
  recipient_phone: string | null;
  address: string;
  city: string | null;
  lat: number | null;
  lng: number | null;
  parcels: number;
  weight_kg: number | null;
  cod_amount: number;
  reference: string | null;
  instructions: string | null;
}

export type ImportField = keyof ImportRow;
export type ImportProblem = "missing" | "number" | "coords";

/** Accepted header spellings (lower-cased, spaces and dashes as underscores). */
const HEADER_ALIASES: Record<string, ImportField> = {
  recipient_name: "recipient_name", recipient: "recipient_name", name: "recipient_name", customer: "recipient_name",
  recipient_phone: "recipient_phone", phone: "recipient_phone", mobile: "recipient_phone",
  address: "address", street: "address",
  city: "city", town: "city",
  lat: "lat", latitude: "lat",
  lng: "lng", lon: "lng", long: "lng", longitude: "lng",
  parcels: "parcels", pieces: "parcels", packages: "parcels",
  weight_kg: "weight_kg", weight: "weight_kg",
  cod_amount: "cod_amount", cod: "cod_amount", cash_on_delivery: "cod_amount",
  reference: "reference", ref: "reference", order: "reference", order_number: "reference",
  instructions: "instructions", notes: "instructions",
};

export const IMPORT_MAX_ROWS = 500;

/** Map parsed CSV rows (first row = headers) to import rows; problems carry the 1-based CSV line. */
export function mapImportRows(table: string[][]): {
  rows: ImportRow[];
  problems: Array<{ line: number; field: ImportField; problem: ImportProblem }>;
  unknownHeaders: string[];
} {
  const [header = [], ...body] = table;
  const cols = header.map((h) => HEADER_ALIASES[h.trim().toLowerCase().replace(/[\s-]+/g, "_")] ?? null);
  const unknownHeaders = header.filter((_, i) => cols[i] == null).map((h) => h.trim()).filter(Boolean);
  const rows: ImportRow[] = [];
  const problems: Array<{ line: number; field: ImportField; problem: ImportProblem }> = [];
  body.forEach((cells, idx) => {
    const line = idx + 2;
    const get = (f: ImportField) => {
      const i = cols.indexOf(f);
      return i >= 0 ? (cells[i] ?? "").trim() : "";
    };
    const num = (f: ImportField): number | null | undefined => {
      const v = get(f).replace(/,/g, "");
      if (v === "") return null;
      const n = Number(v);
      if (!Number.isFinite(n) || (n < 0 && f !== "lat" && f !== "lng")) {
        problems.push({ line, field: f, problem: "number" });
        return undefined;
      }
      return n;
    };
    const name = get("recipient_name");
    const address = get("address");
    if (!name) problems.push({ line, field: "recipient_name", problem: "missing" });
    if (!address) problems.push({ line, field: "address", problem: "missing" });
    const lat = num("lat");
    const lng = num("lng");
    const parcels = num("parcels");
    const weight = num("weight_kg");
    const cod = num("cod_amount");
    const badCoords = (lat == null) !== (lng == null) || (lat != null && Math.abs(lat) > 90) || (lng != null && Math.abs(lng) > 180);
    if (lat !== undefined && lng !== undefined && badCoords) problems.push({ line, field: "lat", problem: "coords" });
    if (parcels != null && (!Number.isInteger(parcels) || parcels < 1)) problems.push({ line, field: "parcels", problem: "number" });
    rows.push({
      recipient_name: name,
      recipient_phone: get("recipient_phone") || null,
      address,
      city: get("city") || null,
      lat: lat ?? null,
      lng: lng ?? null,
      parcels: parcels && Number.isInteger(parcels) && parcels >= 1 ? parcels : 1,
      weight_kg: weight ?? null,
      cod_amount: cod ?? 0,
      reference: get("reference") || null,
      instructions: get("instructions") || null,
    });
  });
  return { rows, problems, unknownHeaders };
}

export interface KpiDelivery {
  status: DeliveryStatus;
  attempts: number;
  cod_amount: number;
  cod_collected: number | null;
}

export interface DeliveryKpis {
  finished: number;
  delivered: number;
  firstAttempt: number;
  /** Whole percent of finished deliveries (delivered + returned) delivered on the first attempt; null when none. */
  firstAttemptPct: number | null;
  /** COD still to collect on open deliveries. */
  codOutstanding: number;
  /** Delivered with less cash than expected: count and total shortfall. */
  codShortCount: number;
  codShortfall: number;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function deliveryKpis(rows: KpiDelivery[]): DeliveryKpis {
  let finished = 0, delivered = 0, firstAttempt = 0, codOutstanding = 0, codShortCount = 0, codShortfall = 0;
  for (const r of rows) {
    if (r.status === "delivered" || r.status === "returned") finished++;
    if (r.status === "delivered") {
      delivered++;
      if (r.attempts === 1) firstAttempt++;
      const short = Number(r.cod_amount) - Number(r.cod_collected ?? 0);
      if (short > 0.0005) {
        codShortCount++;
        codShortfall += short;
      }
    }
    if (OPEN_DELIVERY_STATUSES.includes(r.status)) codOutstanding += Number(r.cod_amount);
  }
  return {
    finished, delivered, firstAttempt,
    firstAttemptPct: finished ? Math.round((firstAttempt / finished) * 100) : null,
    codOutstanding: round3(codOutstanding), codShortCount, codShortfall: round3(codShortfall),
  };
}

/** What the public tracking page may show of a recipient's name. */
export function firstName(name: string | null | undefined): string | null {
  const first = (name ?? "").trim().split(/\s+/)[0];
  return first ? first : null;
}
