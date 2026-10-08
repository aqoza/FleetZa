import type { DrivingEventType, Grade, Severity } from "../../../shared/driverScore";

export type CoachingStatus = "scheduled" | "completed" | "canceled";
export type CoachingTopic = DrivingEventType | "defensive_driving" | "fuel_economy" | "other";

export interface PersonRef {
  first_name: string;
  last_name: string;
}

export interface DrivingEvent {
  id: string;
  vehicle_id: string;
  driver_id: string | null;
  occurred_at: string;
  event_type: DrivingEventType;
  severity: Severity;
  speed_kmh: number | null;
  speed_limit_kmh: number | null;
  duration_s: number | null;
  source: "api" | "manual";
  notes: string | null;
  vehicle: { name: string; license_plate: string | null } | null;
  driver: PersonRef | null;
}

export interface CoachingSession {
  id: string;
  driver_id: string;
  coach_id: string | null;
  session_date: string;
  topics: CoachingTopic[];
  notes: string | null;
  event_ids: string[];
  follow_up_date: string | null;
  status: CoachingStatus;
  driver: PersonRef | null;
  coach: { full_name: string; email: string } | null;
}

/** One row of public.driver_scores(p_from, p_to). */
export interface ScoreRow {
  driver_id: string;
  events: number;
  high_events: number;
  penalty: number;
  distance_km: number;
  score: number;
  grade: Grade;
}

export const EVENT_SELECT =
  "id, vehicle_id, driver_id, occurred_at, event_type, severity, speed_kmh, speed_limit_kmh, duration_s, source, notes, " +
  "vehicle:vehicles!driving_events_vehicle_id_fkey(name,license_plate), " +
  "driver:drivers!driving_events_driver_id_fkey(first_name,last_name)";

export const SESSION_SELECT =
  "id, driver_id, coach_id, session_date, topics, notes, event_ids, follow_up_date, status, " +
  "driver:drivers!driver_coaching_sessions_driver_id_fkey(first_name,last_name), " +
  "coach:profiles!driver_coaching_sessions_coach_id_fkey(full_name,email)";
