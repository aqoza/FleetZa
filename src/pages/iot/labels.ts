import type { BadgeTone } from "../../components/ui";
import type { Freshness } from "../../lib/iot";
import type { AlertSeverity, AlertStatus, DeviceStatus } from "./types";

export const statusTone: Record<DeviceStatus, BadgeTone> = { active: "green", inactive: "slate", faulty: "red" };
export const severityTone: Record<AlertSeverity, BadgeTone> = { info: "blue", warning: "yellow", critical: "red" };
export const alertStatusTone: Record<AlertStatus, BadgeTone> = { open: "red", acknowledged: "yellow", resolved: "green" };

/** Freshness dot colors: status palette CSS variables (both themes). */
export const freshColor: Record<Freshness, string> = {
  live: "var(--color-good)",
  recent: "var(--color-warn)",
  silent: "var(--color-serious)",
  never: "var(--color-ink-3)",
};

/** Chart series 1 and the threshold line color (validated palette). */
export const SERIES_1 = "#1d67f1";
export const THRESHOLD_COLOR = "#dc2626";

export function localNow(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}
