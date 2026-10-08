import { useQuery } from "@tanstack/react-query";
import { listRows, wrapDbError } from "../../lib/db";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../context/AuthContext";
import type { HrSettings, LeaveBalance, LeaveType } from "./types";

export function useHrSettings() {
  return useQuery({
    queryKey: ["hr_settings"],
    queryFn: async () => (await listRows<HrSettings>("hr_settings", (q) => q.limit(1)))[0] ?? null,
  });
}

/** Weekend days with the server's default when settings were never saved. */
export function useWeekend(): number[] {
  const q = useHrSettings();
  return q.data?.weekend_days ?? [5, 6];
}

export function useLeaveTypes(activeOnly = false) {
  return useQuery({
    queryKey: ["leave_types", { activeOnly }],
    queryFn: () =>
      listRows<LeaveType>("leave_types", (q) => {
        let f = q.order("sort_order").order("name");
        if (activeOnly) f = f.eq("active", true);
        return f.limit(200);
      }),
  });
}

/** The signed-in member's own employee record (RLS lets them read it). */
export function useMyEmployee() {
  const { profile } = useAuth();
  const userId = profile?.id;
  return useQuery({
    queryKey: ["employees", "me", userId],
    queryFn: async () =>
      (
        await listRows<{ id: string; first_name: string; last_name: string | null; name_ar: string | null }>(
          "employees",
          (q) => q.select("id, first_name, last_name, name_ar").eq("user_id", userId!).limit(1),
        )
      )[0] ?? null,
    enabled: !!userId,
  });
}

export function useLeaveBalances(year: number, employeeId: string | null) {
  return useQuery({
    queryKey: ["leave_balances", year, employeeId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("leave_balances", {
        p_year: year,
        ...(employeeId ? { p_employee: employeeId } : {}),
      });
      if (error) throw wrapDbError(error);
      return (data ?? []) as LeaveBalance[];
    },
    enabled: employeeId !== null,
  });
}
