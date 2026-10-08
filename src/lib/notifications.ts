/**
 * Notifications — pure helpers. Rows are written server-side by app.notify
 * (kind + params + English fallback title/body); the SPA localizes the kinds
 * it knows and falls back to the stored text for the rest.
 */

export type Severity = "info" | "warning" | "critical";

/**
 * Every kind the server emits, with the module whose scanner or trigger
 * emits it. Drives the preferences list (only kinds of enabled modules show).
 */
export const NOTIFICATION_KINDS = [
  { kind: "inventory.low_stock", module: "inventory" },
  { kind: "employees.document_expiring", module: "employees" },
  { kind: "documents.expiring", module: "documents" },
  { kind: "automation.rule", module: "workflow_automation" },
  { kind: "integrations.webhook_failed", module: "integrations" },
] as const;

export type KnownKind = (typeof NOTIFICATION_KINDS)[number]["kind"];

export function isKnownKind(kind: string): kind is KnownKind {
  return NOTIFICATION_KINDS.some((k) => k.kind === kind);
}

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

/** "5 minutes ago" / "yesterday" in the UI language, via Intl. */
export function relativeTime(iso: string, nowMs: number, language: string): string {
  const diffSec = Math.round((new Date(iso).getTime() - nowMs) / 1000);
  const fmt = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
  const abs = Math.abs(diffSec);
  for (const [unit, sec] of UNITS) {
    if (abs >= sec) return fmt.format(Math.trunc(diffSec / sec), unit);
  }
  return fmt.format(0, "minute");
}

/** Badge text for an unread count; the bell never grows past two digits. */
export function unreadBadge(count: number): string | null {
  if (count <= 0) return null;
  return count > 99 ? "99+" : String(count);
}

/** Read a param as a number, tolerating the strings numeric columns come back as. */
export function numParam(params: unknown, key: string): number | null {
  if (!params || typeof params !== "object") return null;
  const v = (params as Record<string, unknown>)[key];
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function strParam(params: unknown, key: string): string {
  if (!params || typeof params !== "object") return "";
  const v = (params as Record<string, unknown>)[key];
  return v == null ? "" : String(v);
}
