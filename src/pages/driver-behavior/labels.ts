import type { BadgeTone } from "../../components/ui";
import type { MessageKey } from "../../i18n";
import { DRIVING_EVENT_TYPES, type DrivingEventType, type Grade, type Severity } from "../../../shared/driverScore";
import type { CoachingStatus, CoachingTopic, PersonRef } from "./types";

export const COACHING_TOPICS: CoachingTopic[] = [...DRIVING_EVENT_TYPES, "defensive_driving", "fuel_economy", "other"];

export const gradeTone: Record<Grade, BadgeTone> = { A: "green", B: "green", C: "yellow", D: "yellow", F: "red" };
export const severityTone: Record<Severity, BadgeTone> = { low: "slate", medium: "yellow", high: "red" };
export const statusTone: Record<CoachingStatus, BadgeTone> = { scheduled: "blue", completed: "green", canceled: "slate" };

/** Chart series 1 (docs/DESIGN_SYSTEM.md validated palette). */
export const SERIES_1 = "#1d67f1";

export const personName = (p: PersonRef | null | undefined) =>
  p ? `${p.first_name} ${p.last_name ?? ""}`.trim() : "";

export function topicKey(topic: CoachingTopic): MessageKey {
  return (DRIVING_EVENT_TYPES as readonly string[]).includes(topic)
    ? `driverBehavior.type.${topic as DrivingEventType}`
    : `driverBehavior.topic.${topic as Exclude<CoachingTopic, DrivingEventType>}`;
}

/** [from, to) ISO instants for the last `days` days ending now. */
export function lastDays(days: number, endMs = Date.now()): [string, string] {
  return [new Date(endMs - days * 86_400_000).toISOString(), new Date(endMs).toISOString()];
}

export function localNow(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export function localToday(): string {
  return localNow().slice(0, 10);
}
