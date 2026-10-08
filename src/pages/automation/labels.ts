import type { MessageKey } from "../../i18n";
import type { BadgeTone } from "../../components/ui";
import type { RunStatus } from "./types";

export const eventKey = (event: string) => `automation.ev.${event}` as MessageKey;
export const opKey = (op: string) => `automation.op.${op}` as MessageKey;
export const actionKey = (type: string) => `automation.action.${type}` as MessageKey;
export const statusKey = (s: RunStatus) => `automation.status.${s}` as MessageKey;

export const STATUS_TONE: Record<RunStatus, BadgeTone> = {
  success: "green",
  skipped: "slate",
  failed: "red",
};
