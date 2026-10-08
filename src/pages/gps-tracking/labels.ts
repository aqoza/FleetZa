import type { Recency } from "../../lib/gps";
import type { GeofenceColor } from "./types";

/**
 * Map colors. Recency uses the status palette and geofences the validated
 * series palette (docs/DESIGN_SYSTEM.md): CSS variables / literal hexes that
 * read on both themes, so map identity never shifts with the theme.
 */
export const recencyMeta: Record<Recency, { labelKey: `gpsTracking.bucket.${Recency}`; color: string }> = {
  moving: { labelKey: "gpsTracking.bucket.moving", color: "var(--color-good)" },
  idle: { labelKey: "gpsTracking.bucket.idle", color: "var(--color-warn)" },
  stale: { labelKey: "gpsTracking.bucket.stale", color: "var(--color-ink-3)" },
  none: { labelKey: "gpsTracking.bucket.none", color: "var(--color-line)" },
};

export const geofenceColors: Record<GeofenceColor, { labelKey: `gpsTracking.color.${GeofenceColor}`; hex: string }> = {
  blue: { labelKey: "gpsTracking.color.blue", hex: "#1d67f1" },
  teal: { labelKey: "gpsTracking.color.teal", hex: "#0d9488" },
  amber: { labelKey: "gpsTracking.color.amber", hex: "#d97706" },
  red: { labelKey: "gpsTracking.color.red", hex: "#dc2626" },
};

/** Route line color: chart series 1. */
export const TRACK_COLOR = "#1d67f1";

/** Local YYYY-MM-DD. */
export function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local day [start, end) as ISO instants. */
export function dayRange(day: string): [string, string] {
  const start = new Date(`${day}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return [start.toISOString(), end.toISOString()];
}

export const fmtCoord = (v: number) => Number(v).toFixed(5);
