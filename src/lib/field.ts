/**
 * Field workforce (module `mobile_workforce`) — pure helpers. The server
 * (migration 20261008000010) owns the rules; these mirror them so the UI only
 * offers moves the RPC will accept.
 */

export type FieldTaskStatus = "assigned" | "accepted" | "in_progress" | "completed" | "canceled";
export type FieldPriority = "low" | "medium" | "high" | "urgent";

export const FIELD_STATUSES: FieldTaskStatus[] = ["assigned", "accepted", "in_progress", "completed", "canceled"];
export const FIELD_PRIORITIES: FieldPriority[] = ["low", "medium", "high", "urgent"];
export const OPEN_STATUSES: FieldTaskStatus[] = ["assigned", "accepted", "in_progress"];

export interface ChecklistItem {
  label: string;
  done: boolean;
}

/** The server caps a checklist at 50 steps of 1..200 characters. */
export const CHECKLIST_MAX = 50;
export const CHECKLIST_LABEL_MAX = 200;

export function isTerminal(status: FieldTaskStatus): boolean {
  return status === "completed" || status === "canceled";
}

/**
 * The status changes a user may make: the assignee walks the task forward
 * (accept, start, complete); a manager can do the same and cancel any open task.
 */
export function fieldMoves(
  status: FieldTaskStatus,
  who: { isManager: boolean; isAssignee: boolean },
): FieldTaskStatus[] {
  if (isTerminal(status) || !(who.isManager || who.isAssignee)) return [];
  const next: Record<"assigned" | "accepted" | "in_progress", FieldTaskStatus> = {
    assigned: "accepted",
    accepted: "in_progress",
    in_progress: "completed",
  };
  const moves: FieldTaskStatus[] = [next[status as keyof typeof next]];
  if (who.isManager) moves.push("canceled");
  return moves;
}

/** Checklist steps can be ticked while the task is being worked. */
export function canTick(status: FieldTaskStatus): boolean {
  return status === "accepted" || status === "in_progress";
}

/** A checklist from the jsonb column, tolerating anything malformed. */
export function parseChecklist(value: unknown): ChecklistItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((i): i is { label: unknown; done?: unknown } => !!i && typeof i === "object" && "label" in i)
    .map((i) => ({ label: String(i.label ?? ""), done: i.done === true }))
    .filter((i) => i.label.trim() !== "");
}

/** Trimmed, empty steps dropped, capped to what the server accepts. */
export function cleanChecklist(items: ChecklistItem[]): ChecklistItem[] {
  return items
    .map((i) => ({ label: i.label.trim().slice(0, CHECKLIST_LABEL_MAX), done: i.done }))
    .filter((i) => i.label !== "")
    .slice(0, CHECKLIST_MAX);
}

export function checklistProgress(items: ChecklistItem[]): { done: number; total: number } {
  return { done: items.filter((i) => i.done).length, total: items.length };
}

export function isOverdue(task: { status: FieldTaskStatus; due_at: string | null }, nowMs: number): boolean {
  return !isTerminal(task.status) && !!task.due_at && new Date(task.due_at).getTime() < nowMs;
}

/** A maps link for a point; works on phones (opens the maps app) and desktops. */
export function mapsUrl(lat: number | string | null, lng: number | string | null): string | null {
  if (lat == null || lng == null || lat === "" || lng === "") return null;
  const a = Number(lat);
  const b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return `https://maps.google.com/?q=${a},${b}`;
}

/**
 * A coordinate typed into a form: null when blank, NaN when not a number in
 * range (the form shows an error), otherwise the number.
 */
export function parseCoord(input: string, limit: 90 | 180): number | null {
  const s = input.trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : NaN;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** An ISO timestamp as a `datetime-local` value in the device's time zone. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A `datetime-local` value (device time zone) as an ISO timestamp, or null. */
export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Whether an ISO timestamp falls on the device's current calendar day. */
export function isToday(iso: string, now: Date = new Date()): boolean {
  const d = new Date(iso);
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}
