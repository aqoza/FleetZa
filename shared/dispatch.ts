/**
 * Dispatch (module `dispatch`) — pure helpers shared by the SPA. The status
 * table mirrors app.dispatch_job_guard() in migration
 * 20261008000019_dispatch.sql. Change both together.
 */

export type JobStatus = "new" | "assigned" | "en_route" | "on_site" | "completed" | "canceled";
export type JobPriority = "low" | "normal" | "high" | "urgent";
export type JobType = "pickup" | "delivery" | "service" | "transfer" | "other";

export const JOB_TYPES: JobType[] = ["pickup", "delivery", "service", "transfer", "other"];
export const JOB_PRIORITIES: JobPriority[] = ["urgent", "high", "normal", "low"];
/** Board columns, left to right (start to end in RTL). */
export const BOARD_STATUSES: JobStatus[] = ["new", "assigned", "en_route", "on_site"];
export const OPEN_STATUSES: JobStatus[] = ["new", "assigned", "en_route", "on_site"];
/** Statuses that hold a vehicle and driver. */
export const BUSY_STATUSES: JobStatus[] = ["assigned", "en_route", "on_site"];

/** Allowed moves. new → assigned happens only through dispatch_assign(). */
export const JOB_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  new: ["assigned", "canceled"],
  assigned: ["en_route", "new", "canceled"],
  en_route: ["on_site", "canceled"],
  on_site: ["completed", "canceled"],
  completed: [],
  canceled: [],
};

export function canMove(from: JobStatus, to: JobStatus): boolean {
  return JOB_TRANSITIONS[from].includes(to);
}

/** The forward step a dispatcher takes next from the board (assignment needs the modal). */
export type ForwardStep = "en_route" | "on_site" | "completed";

export function nextStep(status: JobStatus): ForwardStep | null {
  switch (status) {
    case "assigned":
      return "en_route";
    case "en_route":
      return "on_site";
    case "on_site":
      return "completed";
    default:
      return null;
  }
}

const PRIORITY_RANK: Record<JobPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

export interface SlaJob {
  status: JobStatus;
  priority: JobPriority;
  window_start: string;
  window_end: string;
  completed_at: string | null;
}

/** Open past the end of its window. */
export function isLate(job: SlaJob, nowMs: number): boolean {
  return OPEN_STATUSES.includes(job.status) && Date.parse(job.window_end) < nowMs;
}

/** Minutes past the window end (open jobs: until now; completed: until completion). Null when on time. */
export function minutesLate(job: SlaJob, nowMs: number): number | null {
  const end = Date.parse(job.window_end);
  const ref = job.status === "completed" && job.completed_at ? Date.parse(job.completed_at) : OPEN_STATUSES.includes(job.status) ? nowMs : null;
  if (ref == null || ref <= end) return null;
  return Math.floor((ref - end) / 60_000);
}

/** Board order: urgent first, then the earliest window end. */
export function compareJobs(a: SlaJob, b: SlaJob): number {
  return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || Date.parse(a.window_end) - Date.parse(b.window_end);
}

export interface SlaStats {
  completed: number;
  onTime: number;
  /** Whole percent, null with nothing completed. */
  onTimePct: number | null;
  /** Average minutes late across the late completions, null when none. */
  avgLateMinutes: number | null;
}

export function slaStats(jobs: SlaJob[]): SlaStats {
  const done = jobs.filter((j) => j.status === "completed" && j.completed_at);
  const late = done.map((j) => minutesLate(j, 0)).filter((m): m is number => m != null);
  const onTime = done.length - late.length;
  return {
    completed: done.length,
    onTime,
    onTimePct: done.length ? Math.round((onTime / done.length) * 100) : null,
    avgLateMinutes: late.length ? Math.round(late.reduce((s, m) => s + m, 0) / late.length) : null,
  };
}

/** Half-open windows [start, end) overlap. */
export function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return Date.parse(aStart) < Date.parse(bEnd) && Date.parse(bStart) < Date.parse(aEnd);
}

/**
 * A bar on a day timeline: start offset and width as percentages of the day
 * [dayStartMs, dayStartMs + 24 h), clipped to the day. Null when outside it.
 */
export function timelineBar(startIso: string, endIso: string, dayStartMs: number): { left: number; width: number } | null {
  const DAY = 86_400_000;
  const s = Math.max(Date.parse(startIso), dayStartMs);
  const e = Math.min(Date.parse(endIso), dayStartMs + DAY);
  if (e <= s) return null;
  const left = ((s - dayStartMs) / DAY) * 100;
  const width = Math.max(((e - s) / DAY) * 100, 0.5);
  return { left: Math.round(left * 100) / 100, width: Math.round(width * 100) / 100 };
}
