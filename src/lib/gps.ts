/**
 * GPS math for module `gps_tracking` — pure, unit-tested. The SQL side
 * (app.geo_distance_m / app.point_in_polygon in 20261008000014) mirrors
 * haversineM and pointInPolygon, so the map and the geofence events agree.
 */

export interface Fix {
  lat: number;
  lng: number;
  /** ISO timestamp. */
  recorded_at: string;
  speed_kmh?: number | null;
}

const EARTH_RADIUS_M = 6371008.8;
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in metres. */
export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Total length of a track in kilometres (fixes in time order). */
export function pathDistanceKm(fixes: Array<Pick<Fix, "lat" | "lng">>): number {
  let m = 0;
  for (let i = 1; i < fixes.length; i++) m += haversineM(fixes[i - 1].lat, fixes[i - 1].lng, fixes[i].lat, fixes[i].lng);
  return m / 1000;
}

/** Ray casting over [[lat, lng], ...]. */
export function pointInPolygon(lat: number, lng: number, polygon: Array<[number, number]>): boolean {
  const n = polygon.length;
  if (n < 3) return false;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [yi, xi] = polygon[i];
    const [yj, xj] = polygon[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export interface Stop {
  lat: number;
  lng: number;
  from: string;
  to: string;
  minutes: number;
}

/**
 * Stops: runs of consecutive fixes slower than `maxSpeedKmh` (speed when
 * reported, else derived from the distance to the next fix) lasting at least
 * `minMinutes`. The stop sits at the run's first fix.
 */
export function detectStops(fixes: Fix[], opts: { maxSpeedKmh?: number; minMinutes?: number } = {}): Stop[] {
  const maxSpeed = opts.maxSpeedKmh ?? 3;
  const minMinutes = opts.minMinutes ?? 5;
  const t = (f: Fix) => new Date(f.recorded_at).getTime();
  const slow = (i: number): boolean => {
    const f = fixes[i];
    if (f.speed_kmh != null) return f.speed_kmh < maxSpeed;
    const next = fixes[i + 1] ?? fixes[i - 1];
    if (!next) return true;
    const hours = Math.abs(t(next) - t(f)) / 3_600_000;
    if (hours === 0) return true;
    return haversineM(f.lat, f.lng, next.lat, next.lng) / 1000 / hours < maxSpeed;
  };
  const stops: Stop[] = [];
  let start = -1;
  const close = (end: number) => {
    if (start < 0) return;
    const minutes = (t(fixes[end]) - t(fixes[start])) / 60_000;
    if (minutes >= minMinutes) {
      stops.push({ lat: fixes[start].lat, lng: fixes[start].lng, from: fixes[start].recorded_at, to: fixes[end].recorded_at, minutes: Math.round(minutes) });
    }
    start = -1;
  };
  for (let i = 0; i < fixes.length; i++) {
    if (slow(i)) {
      if (start < 0) start = i;
    } else {
      // The first moving fix ends the stop: the vehicle stood still until then.
      close(i);
    }
  }
  close(fixes.length - 1);
  return stops;
}

export type Recency = "moving" | "idle" | "stale" | "none";

/** Live-map bucket: a fresh fix (≤ 15 min) is moving or idle by speed; older is stale. */
export function recencyBucket(
  fix: { recorded_at: string; speed_kmh: number | null } | null | undefined,
  now: number = Date.now(),
): Recency {
  if (!fix) return "none";
  const ageMin = (now - new Date(fix.recorded_at).getTime()) / 60_000;
  if (ageMin > 15) return "stale";
  return (fix.speed_kmh ?? 0) >= 3 ? "moving" : "idle";
}

export interface CsvPosition {
  line: number;
  plate: string;
  lat: number;
  lng: number;
  recorded_at: string;
  speed_kmh: number | null;
}

export interface CsvResult {
  rows: CsvPosition[];
  errors: Array<{ line: number; reason: "columns" | "lat" | "lng" | "time" | "plate" }>;
}

/**
 * CSV import: header row with lat, lng, recorded_at, plate (any order, case
 * insensitive) and optional speed_kmh. Times must parse as dates.
 */
export function parsePositionsCsv(text: string): CsvResult {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const out: CsvResult = { rows: [], errors: [] };
  const headerAt = lines.findIndex((l) => l !== "");
  if (headerAt < 0) return out;
  const head = lines[headerAt].split(",").map((h) => h.trim().toLowerCase());
  const col = (name: string) => head.indexOf(name);
  const [iLat, iLng, iAt, iPlate, iSpeed] = [col("lat"), col("lng"), col("recorded_at"), col("plate"), col("speed_kmh")];
  if (iLat < 0 || iLng < 0 || iAt < 0 || iPlate < 0) {
    out.errors.push({ line: headerAt + 1, reason: "columns" });
    return out;
  }
  for (let i = headerAt + 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const cells = lines[i].split(",").map((c) => c.trim());
    const line = i + 1;
    const lat = Number(cells[iLat]);
    const lng = Number(cells[iLng]);
    const at = new Date(cells[iAt] ?? "");
    const plate = cells[iPlate] ?? "";
    if (!plate) out.errors.push({ line, reason: "plate" });
    else if (cells[iLat] === "" || !Number.isFinite(lat) || lat < -90 || lat > 90) out.errors.push({ line, reason: "lat" });
    else if (cells[iLng] === "" || !Number.isFinite(lng) || lng < -180 || lng > 180) out.errors.push({ line, reason: "lng" });
    else if (!cells[iAt] || Number.isNaN(at.getTime())) out.errors.push({ line, reason: "time" });
    else {
      const speed = iSpeed >= 0 && cells[iSpeed] ? Number(cells[iSpeed]) : null;
      out.rows.push({ line, plate, lat, lng, recorded_at: at.toISOString(), speed_kmh: speed != null && Number.isFinite(speed) ? speed : null });
    }
  }
  return out;
}

/** Normalize a plate for matching ("dxb 12-345" → "DXB12345"). */
export function plateKey(plate: string): string {
  return plate.toUpperCase().replace(/[^A-Z0-9؀-ۿ]/g, "");
}
