import type { BadgeTone } from "../../components/ui";
import type { MessageKey } from "../../i18n";
import type { LeaveStatus, PayrollStatus } from "../../lib/hr";
import type { AttendanceStatus, LeaveType } from "./types";

export const leaveStatus: Record<LeaveStatus, { labelKey: MessageKey; tone: BadgeTone }> = {
  pending: { labelKey: "hr.leaveStatus.pending", tone: "yellow" },
  approved: { labelKey: "hr.leaveStatus.approved", tone: "green" },
  rejected: { labelKey: "hr.leaveStatus.rejected", tone: "red" },
  canceled: { labelKey: "hr.leaveStatus.canceled", tone: "slate" },
};

export const payrollStatus: Record<PayrollStatus, { labelKey: MessageKey; tone: BadgeTone }> = {
  draft: { labelKey: "hr.runStatus.draft", tone: "slate" },
  calculated: { labelKey: "hr.runStatus.calculated", tone: "blue" },
  approved: { labelKey: "hr.runStatus.approved", tone: "purple" },
  paid: { labelKey: "hr.runStatus.paid", tone: "green" },
  canceled: { labelKey: "hr.runStatus.canceled", tone: "slate" },
};

export const attendanceStatus: Record<AttendanceStatus, { labelKey: MessageKey; tone: BadgeTone }> = {
  present: { labelKey: "hr.att.present", tone: "green" },
  late: { labelKey: "hr.att.late", tone: "yellow" },
  half_day: { labelKey: "hr.att.half_day", tone: "blue" },
  absent: { labelKey: "hr.att.absent", tone: "red" },
  on_leave: { labelKey: "hr.att.on_leave", tone: "purple" },
  holiday: { labelKey: "hr.att.holiday", tone: "slate" },
};

/** Sunday-first, matching the 0..6 numbering stored in hr_settings. */
export const WEEKDAY_KEYS: MessageKey[] = [
  "hr.day.0", "hr.day.1", "hr.day.2", "hr.day.3", "hr.day.4", "hr.day.5", "hr.day.6",
];

/** Seeded types have translated names; custom ones use what the manager typed. */
export function leaveTypeName(
  lt: Pick<LeaveType, "code" | "name" | "name_ar"> | null | undefined,
  language: "en" | "ar",
): string {
  if (!lt) return "";
  if (language === "ar" && lt.name_ar) return lt.name_ar;
  return lt.name;
}
