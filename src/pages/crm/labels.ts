import { CalendarClock, Mail, MessageCircle, Phone, StickyNote, Users, type LucideIcon } from "lucide-react";
import type { BadgeTone } from "../../components/ui";
import type { ActivityState, ActivityType, LeadStatus, Stage } from "../../../shared/crm";
import type { Person } from "./types";

export const leadTone: Record<LeadStatus, BadgeTone> = {
  new: "blue",
  contacted: "purple",
  qualified: "yellow",
  converted: "green",
  unqualified: "slate",
};

export const stageTone: Record<Stage, BadgeTone> = {
  prospecting: "slate",
  qualification: "blue",
  proposal: "purple",
  negotiation: "yellow",
  won: "green",
  lost: "red",
};

export const activityTone: Record<ActivityState, BadgeTone> = {
  overdue: "red",
  today: "yellow",
  upcoming: "blue",
  unscheduled: "slate",
  done: "green",
};

export const activityIcon: Record<ActivityType, LucideIcon> = {
  call: Phone,
  email: Mail,
  meeting: Users,
  task: CalendarClock,
  note: StickyNote,
  whatsapp: MessageCircle,
};

export function personName(p: Person | null): string {
  return p ? p.full_name || p.email : "";
}

/** YYYY-MM-DD of an instant in a time zone. */
export function dayIn(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
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
