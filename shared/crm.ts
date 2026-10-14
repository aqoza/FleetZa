/**
 * CRM rules shared by the SPA and tests. The database (migration
 * 20261008000026_crm.sql) enforces the lead and pipeline lifecycles; this
 * mirrors them for the UI and derives the pipeline figures.
 */

export const LEAD_SOURCES = [
  "website", "referral", "walk_in", "phone", "email", "social", "event", "partner", "other",
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const LEAD_STATUSES = ["new", "contacted", "qualified", "converted", "unqualified"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const OPEN_STAGES = ["prospecting", "qualification", "proposal", "negotiation"] as const;
export const STAGES = [...OPEN_STAGES, "won", "lost"] as const;
export type Stage = (typeof STAGES)[number];

export const ACTIVITY_TYPES = ["call", "email", "meeting", "task", "note", "whatsapp"] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

/** Status changes a person can make; 'converted' only comes from crm_convert_lead. */
const LEAD_MOVES: Record<LeadStatus, readonly LeadStatus[]> = {
  new: ["contacted", "qualified", "unqualified"],
  contacted: ["qualified", "unqualified"],
  qualified: ["contacted", "unqualified"],
  unqualified: ["new"],
  converted: [],
};

export function leadMoves(status: LeadStatus): readonly LeadStatus[] {
  return LEAD_MOVES[status] ?? [];
}

export function canConvertLead(status: LeadStatus): boolean {
  return status === "new" || status === "contacted" || status === "qualified";
}

export function isOpenStage(stage: Stage): boolean {
  return (OPEN_STAGES as readonly string[]).includes(stage);
}

/** Stages an opportunity may move to: open ones move freely, closed ones reopen. */
export function stageMoves(stage: Stage): readonly Stage[] {
  return isOpenStage(stage) ? STAGES.filter((s) => s !== stage) : OPEN_STAGES;
}

/** The probability app.crm_stage_probability gives a stage. */
export function stageProbability(stage: Stage): number {
  switch (stage) {
    case "prospecting": return 10;
    case "qualification": return 25;
    case "proposal": return 50;
    case "negotiation": return 75;
    case "won": return 100;
    default: return 0;
  }
}

export interface PipelineRow {
  stage: Stage;
  amount: number | string | null;
  probability: number;
  expected_close_date: string | null;
}

const num = (v: number | string | null | undefined) => (v == null || v === "" ? 0 : Number(v) || 0);

export function weighted(o: Pick<PipelineRow, "amount" | "probability">): number {
  return (num(o.amount) * o.probability) / 100;
}

export interface PipelineTotals {
  open: number;
  openAmount: number;
  weightedAmount: number;
  won: number;
  wonAmount: number;
  lost: number;
  /** Won / (won + lost), or null before anything closed. */
  winRate: number | null;
}

export function pipelineTotals(rows: readonly PipelineRow[]): PipelineTotals {
  const t: PipelineTotals = { open: 0, openAmount: 0, weightedAmount: 0, won: 0, wonAmount: 0, lost: 0, winRate: null };
  for (const r of rows) {
    if (r.stage === "won") {
      t.won += 1;
      t.wonAmount += num(r.amount);
    } else if (r.stage === "lost") {
      t.lost += 1;
    } else {
      t.open += 1;
      t.openAmount += num(r.amount);
      t.weightedAmount += weighted(r);
    }
  }
  t.winRate = t.won + t.lost > 0 ? t.won / (t.won + t.lost) : null;
  return t;
}

export interface StageColumn<T> {
  stage: Stage;
  rows: T[];
  amount: number;
  weightedAmount: number;
}

/** Open opportunities grouped into the kanban columns, in stage order. */
export function byStage<T extends PipelineRow>(rows: readonly T[]): StageColumn<T>[] {
  return OPEN_STAGES.map((stage) => {
    const list = rows.filter((r) => r.stage === stage);
    return {
      stage,
      rows: list,
      amount: list.reduce((s, r) => s + num(r.amount), 0),
      weightedAmount: list.reduce((s, r) => s + weighted(r), 0),
    };
  });
}

export interface ForecastMonth {
  month: string; // YYYY-MM
  weighted: number;
  best: number;
}

/**
 * Open pipeline by expected close month, from `fromMonth` for `months` months.
 * Weighted = amount × probability; best case = the full amount. Deals past
 * their close date land in the first month; undated ones are left out.
 */
export function forecast(rows: readonly PipelineRow[], fromMonth: string, months = 6): ForecastMonth[] {
  const out: ForecastMonth[] = [];
  let y = Number(fromMonth.slice(0, 4));
  let m = Number(fromMonth.slice(5, 7));
  for (let i = 0; i < months; i++) {
    out.push({ month: `${y}-${String(m).padStart(2, "0")}`, weighted: 0, best: 0 });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  for (const r of rows) {
    if (!isOpenStage(r.stage) || !r.expected_close_date) continue;
    const key = r.expected_close_date.slice(0, 7);
    const slot = key < out[0].month ? out[0] : out.find((o) => o.month === key);
    if (!slot) continue;
    slot.weighted += weighted(r);
    slot.best += num(r.amount);
  }
  return out;
}

export type ActivityState = "done" | "overdue" | "today" | "upcoming" | "unscheduled";

/** Where an activity stands at `now`; `today` is the local date (YYYY-MM-DD) of now. */
export function activityState(a: { due_at: string | null; done_at: string | null }, now: Date, todayKey: (iso: string) => string): ActivityState {
  if (a.done_at) return "done";
  if (!a.due_at) return "unscheduled";
  if (Date.parse(a.due_at) < now.getTime()) return "overdue";
  return todayKey(a.due_at) === todayKey(now.toISOString()) ? "today" : "upcoming";
}
