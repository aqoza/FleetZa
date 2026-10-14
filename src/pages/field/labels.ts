import type { BadgeTone } from "../../components/ui";
import type { MessageKey } from "../../i18n";
import type { FieldPriority, FieldTaskStatus } from "../../lib/field";

export const taskStatus: Record<FieldTaskStatus, { labelKey: MessageKey; tone: BadgeTone }> = {
  assigned: { labelKey: "field.status.assigned", tone: "slate" },
  accepted: { labelKey: "field.status.accepted", tone: "blue" },
  in_progress: { labelKey: "field.status.in_progress", tone: "yellow" },
  completed: { labelKey: "field.status.completed", tone: "green" },
  canceled: { labelKey: "field.status.canceled", tone: "slate" },
};

export const taskPriority: Record<FieldPriority, { labelKey: MessageKey; tone: BadgeTone }> = {
  low: { labelKey: "field.prio.low", tone: "slate" },
  medium: { labelKey: "field.prio.medium", tone: "blue" },
  high: { labelKey: "field.prio.high", tone: "yellow" },
  urgent: { labelKey: "field.prio.urgent", tone: "red" },
};

export const moveLabel: Record<Exclude<FieldTaskStatus, "assigned">, MessageKey> = {
  accepted: "field.move.accepted",
  in_progress: "field.move.in_progress",
  completed: "field.move.completed",
  canceled: "field.move.canceled",
};

export const moveDone: Record<Exclude<FieldTaskStatus, "assigned">, MessageKey> = {
  accepted: "field.done.accepted",
  in_progress: "field.done.in_progress",
  completed: "field.done.completed",
  canceled: "field.done.canceled",
};
