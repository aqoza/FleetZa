/**
 * Trip planning (module `trip_planning`) — pure helpers shared by the SPA.
 * The fuel-rate rule is mirrored in SQL by app.trip_fuel_rate() (migration
 * 20261008000018_trip_planning.sql). Change both together.
 */

export type TripStatus = "planned" | "dispatched" | "in_progress" | "completed" | "canceled";
export type StopStatus = "pending" | "arrived" | "departed" | "skipped";

/** Allowed status moves; the DB trigger enforces the same table (ILLEGAL_TRIP_TRANSITION). */
export const TRIP_TRANSITIONS: Record<TripStatus, TripStatus[]> = {
  planned: ["dispatched", "canceled"],
  dispatched: ["in_progress", "canceled"],
  in_progress: ["completed"],
  completed: [],
  canceled: [],
};

export const STOP_TRANSITIONS: Record<StopStatus, StopStatus[]> = {
  pending: ["arrived", "skipped"],
  arrived: ["departed"],
  departed: [],
  skipped: [],
};

/** Trips that still hold their vehicle and driver for the planned window. */
export const ACTIVE_TRIP_STATUSES: TripStatus[] = ["planned", "dispatched", "in_progress"];

export function canMove(from: TripStatus, to: TripStatus): boolean {
  return TRIP_TRANSITIONS[from].includes(to);
}

const EARTH_KM = 6371.0088;
const rad = (d: number) => (d * Math.PI) / 180;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Great-circle distance in km. */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

export interface GeoStop {
  lat: number | null;
  lng: number | null;
}

/**
 * Straight-line distance along the stops in order, skipping stops without
 * coordinates. Null when fewer than two stops have coordinates.
 */
export function straightLineKm(stops: GeoStop[]): number | null {
  const pts = stops.filter((s): s is { lat: number; lng: number } => s.lat != null && s.lng != null);
  if (pts.length < 2) return null;
  let km = 0;
  for (let i = 1; i < pts.length; i++) km += haversineKm(pts[i - 1].lat, pts[i - 1].lng, pts[i].lat, pts[i].lng);
  return round1(km);
}

export interface FuelLog {
  odometer: number | null;
  volume: number;
  total_cost: number;
}

export interface FuelRate {
  /** Liters per 100 km, null when the logs can't support it. */
  l_per_100km: number | null;
  /** Average price per liter, null without priced fills. */
  price_per_l: number | null;
}

/** Minimum odometer span the consumption rate needs. */
export const MIN_FUEL_SPAN_KM = 100;

/**
 * Consumption from a vehicle's recent fills: liters of every fill after the
 * lowest-odometer one, over the odometer span. Price: total cost / total liters.
 */
export function fuelRate(logs: FuelLog[]): FuelRate {
  const priced = logs.filter((l) => l.volume > 0);
  const liters = priced.reduce((s, l) => s + l.volume, 0);
  const cost = priced.reduce((s, l) => s + l.total_cost, 0);
  const price = liters > 0 && cost > 0 ? Math.round((cost / liters) * 1000) / 1000 : null;

  const withOdo = priced.filter((l) => l.odometer != null && l.odometer > 0).sort((a, b) => a.odometer! - b.odometer!);
  if (withOdo.length < 2) return { l_per_100km: null, price_per_l: price };
  const span = withOdo[withOdo.length - 1].odometer! - withOdo[0].odometer!;
  if (span < MIN_FUEL_SPAN_KM) return { l_per_100km: null, price_per_l: price };
  const used = withOdo.slice(1).reduce((s, l) => s + l.volume, 0);
  return { l_per_100km: round1((used / span) * 100), price_per_l: price };
}

/** Estimated liters and cost for a distance. */
export function fuelEstimate(distanceKm: number | null, rate: FuelRate): { liters: number | null; cost: number | null } {
  if (distanceKm == null || rate.l_per_100km == null) return { liters: null, cost: null };
  const liters = round1((distanceKm * rate.l_per_100km) / 100);
  return { liters, cost: rate.price_per_l == null ? null : Math.round(liters * rate.price_per_l * 100) / 100 };
}

/** Half-open windows [start, end) overlap. ISO strings or epoch ms. */
export function overlaps(aStart: string | number, aEnd: string | number, bStart: string | number, bEnd: string | number): boolean {
  const t = (v: string | number) => (typeof v === "number" ? v : Date.parse(v));
  return t(aStart) < t(bEnd) && t(bStart) < t(aEnd);
}

export interface TripTimes {
  planned_start: string;
  planned_end: string;
  actual_start: string | null;
  actual_end: string | null;
  planned_distance_km: number | null;
  start_odometer: number | null;
  end_odometer: number | null;
}

export interface PlanVsActual {
  planned_minutes: number;
  actual_minutes: number | null;
  /** Actual start minus planned start, minutes (positive = late). */
  start_delay_minutes: number | null;
  actual_km: number | null;
  /** Actual minus planned distance, km. */
  distance_delta_km: number | null;
}

export function planVsActual(trip: TripTimes): PlanVsActual {
  const mins = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 60_000);
  const actualKm =
    trip.start_odometer != null && trip.end_odometer != null ? round1(trip.end_odometer - trip.start_odometer) : null;
  return {
    planned_minutes: mins(trip.planned_start, trip.planned_end),
    actual_minutes: trip.actual_start && trip.actual_end ? mins(trip.actual_start, trip.actual_end) : null,
    start_delay_minutes: trip.actual_start ? mins(trip.planned_start, trip.actual_start) : null,
    actual_km: actualKm,
    distance_delta_km: actualKm != null && trip.planned_distance_km != null ? round1(actualKm - trip.planned_distance_km) : null,
  };
}

/** The 7 local dates (YYYY-MM-DD) of the week containing `date`, starting on `weekStartsOn` (0 = Sunday). */
export function weekDates(date: string, weekStartsOn = 0): string[] {
  const d = new Date(`${date}T00:00:00Z`);
  const back = (d.getUTCDay() - weekStartsOn + 7) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(d);
    x.setUTCDate(d.getUTCDate() + i);
    return x.toISOString().slice(0, 10);
  });
}

/** Shift a YYYY-MM-DD date by whole days. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
