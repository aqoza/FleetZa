import type { BadgeTone } from "../../components/ui";
import type { IncidentStatus, Severity } from "../../../shared/incidents";

export const statusTone: Record<IncidentStatus, BadgeTone> = {
  reported: "blue",
  investigating: "purple",
  awaiting_repair: "yellow",
  resolved: "green",
  closed: "slate",
};

export const severityTone: Record<Severity, BadgeTone> = {
  minor: "slate",
  moderate: "yellow",
  major: "red",
  critical: "red",
};

export function driverName(d: { first_name: string; last_name: string } | null): string {
  return d ? `${d.first_name} ${d.last_name}`.trim() : "";
}

/** `datetime-local` value in the browser's zone ⇄ ISO instant. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(v: string): string | null {
  return v ? new Date(v).toISOString() : null;
}
