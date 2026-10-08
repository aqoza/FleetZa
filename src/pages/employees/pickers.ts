import { useEntityPicker, type Picker } from "../../lib/pickers";
import { employeeName } from "../../lib/employees";
import type { Employee } from "./types";

/**
 * Employees by name, number, national id or phone. Readable by managers only
 * (RLS), which matches every place an employee is picked.
 */
export function useEmployeePicker(
  selectedId: string,
  opts: { activeOnly?: boolean; excludeId?: string; enabled?: boolean } = {},
): Picker {
  const { activeOnly = false, excludeId, enabled } = opts;
  return useEntityPicker<Employee>({
    table: "employees",
    selectedId,
    searchColumns: ["first_name", "last_name", "name_ar", "doc_number", "national_id", "phone"],
    orderBy: "first_name",
    toOption: (e) => ({
      value: e.id,
      label: employeeName(e),
      meta: e.job_title ?? e.doc_number ?? undefined,
      metaDir: "auto",
    }),
    filter: (q) => {
      let b = q;
      if (activeOnly) b = b.neq("status", "terminated");
      if (excludeId) b = b.neq("id", excludeId);
      return b;
    },
    scope: ["employees", activeOnly, excludeId],
    enabled,
  });
}
