import type { Database } from "../../lib/database.types";
import type { LeaveStatus, PayrollStatus } from "../../lib/hr";

type Tables = Database["public"]["Tables"];

export type HrSettings = Tables["hr_settings"]["Row"];
export type LeaveType = Tables["leave_types"]["Row"];
export type AttendanceStatus = "present" | "absent" | "late" | "half_day" | "on_leave" | "holiday";
export type AttendanceRecord = Omit<Tables["attendance_records"]["Row"], "status"> & { status: AttendanceStatus };
export type PayrollRun = Omit<Tables["payroll_runs"]["Row"], "status"> & { status: PayrollStatus };
export type Payslip = Tables["payslips"]["Row"];

/** Embedded names for list rows (employees RLS: managers + the linked user). */
export interface EmployeeRef {
  id: string;
  first_name: string;
  last_name: string | null;
  name_ar: string | null;
  doc_number: string | null;
}

export type LeaveRequest = Omit<Tables["leave_requests"]["Row"], "status"> & {
  status: LeaveStatus;
  employee: EmployeeRef | null;
  leave_type: Pick<LeaveType, "id" | "code" | "name" | "name_ar" | "paid"> | null;
};

export const LEAVE_SELECT =
  "*, employee:employees!leave_requests_employee_id_fkey(id, first_name, last_name, name_ar, doc_number), " +
  "leave_type:leave_types!leave_requests_leave_type_id_fkey(id, code, name, name_ar, paid)";

export interface LeaveBalance {
  employee_id: string;
  leave_type_id: string;
  entitled: number;
  taken: number;
  pending: number;
  remaining: number;
}
