import type { Action, Condition } from "../../lib/automation";

export interface AutomationRule {
  id: string;
  name: string;
  description: string | null;
  event: string;
  conditions: Condition[];
  actions: Action[];
  active: boolean;
  run_count: number;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
}

export type RunStatus = "success" | "skipped" | "failed";

export interface AutomationRun {
  id: string;
  rule_id: string;
  event_id: number | null;
  event: string;
  status: RunStatus;
  actions_run: number;
  detail: string | null;
  created_at: string;
}

export interface ConditionResult {
  field: string;
  op: string;
  actual: unknown;
  matched: boolean;
}

export interface TestResult {
  matched: boolean;
  conditions: ConditionResult[];
}
