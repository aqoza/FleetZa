/**
 * Driver safety score (module `driver_behavior`) — pure, shared by the SPA
 * and mirrored in SQL by public.driver_scores (migration
 * 20261008000015_driver_behavior.sql). Change both together.
 *
 *   penalty = Σ weight(event type) × multiplier(severity)
 *   score   = max(0, 100 − penalty × 100 / max(km, 100))
 *
 * i.e. penalty points per 100 km driven, where any distance below 100 km
 * counts as 100 km so a short period with one event is not a zero. Rounded
 * to one decimal. Grades: A ≥ 90, B ≥ 80, C ≥ 70, D ≥ 60, F below.
 */

export const DRIVING_EVENT_TYPES = [
  "harsh_braking",
  "harsh_acceleration",
  "harsh_cornering",
  "speeding",
  "idling",
  "seatbelt",
  "phone_use",
  "fatigue",
  "collision_warning",
] as const;
export type DrivingEventType = (typeof DRIVING_EVENT_TYPES)[number];

export const SEVERITIES = ["low", "medium", "high"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const EVENT_WEIGHTS: Record<DrivingEventType, number> = {
  harsh_braking: 3,
  harsh_acceleration: 2,
  harsh_cornering: 2,
  speeding: 4,
  idling: 1,
  seatbelt: 5,
  phone_use: 6,
  fatigue: 6,
  collision_warning: 8,
};

export const SEVERITY_MULTIPLIER: Record<Severity, number> = { low: 1, medium: 2, high: 3 };

/** Distance below this counts as this much, so tiny distances don't explode the rate. */
export const MIN_DISTANCE_KM = 100;

export type Grade = "A" | "B" | "C" | "D" | "F";

export function eventPenalty(type: DrivingEventType, severity: Severity): number {
  return EVENT_WEIGHTS[type] * SEVERITY_MULTIPLIER[severity];
}

export function totalPenalty(events: Array<{ event_type: DrivingEventType; severity: Severity }>): number {
  return events.reduce((s, e) => s + eventPenalty(e.event_type, e.severity), 0);
}

export function driverScore(penalty: number, distanceKm: number): number {
  const basis = Math.max(distanceKm || 0, MIN_DISTANCE_KM);
  const raw = 100 - (penalty * 100) / basis;
  return Math.max(0, Math.round(raw * 10) / 10);
}

export function scoreGrade(score: number): Grade {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

/** Events that page managers at once. */
export function isCriticalEvent(type: DrivingEventType, severity: Severity): boolean {
  return severity === "high" && (type === "collision_warning" || type === "fatigue");
}
