import type { Tables } from "../../lib/database.types";

export type EmploymentType = "full_time" | "part_time" | "contract" | "temporary" | "intern";
export type EmployeeStatus = "active" | "on_leave" | "suspended" | "terminated";
export type Gender = "male" | "female";

export type Employee = Omit<Tables<"employees">, "employment_type" | "status" | "gender"> & {
  employment_type: EmploymentType;
  status: EmployeeStatus;
  gender: Gender | null;
};
export type Department = Tables<"departments">;

/** Directory row: the employee plus the embeds the list renders. */
export type EmployeeRow = Employee & {
  department: Pick<Department, "id" | "name" | "name_ar"> | null;
};

/**
 * PostgREST embed for the department. employees↔departments has two FKs
 * (department_id and departments.manager_employee_id), so the FK is named.
 */
export const EMPLOYEE_SELECT =
  "*, department:departments!employees_department_id_fkey(id, name, name_ar)";
