import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { listRows, wrapDbError } from "../../lib/db";
import { useEntityPicker, type Picker } from "../../lib/pickers";
import type { Branch, BranchStats, Company } from "./types";

/** A tenant has a handful of legal entities: one small, cached list. */
export function useCompanies() {
  return useQuery({
    queryKey: ["companies", "all"],
    queryFn: () =>
      listRows<Company>("companies", (q) => q.order("is_default", { ascending: false }).order("legal_name").limit(500)),
    staleTime: 60_000,
  });
}

/** Vehicle / driver / employee counts per branch, computed in SQL (branch_stats). */
export function useBranchStats(enabled = true) {
  return useQuery({
    queryKey: ["branches", "stats"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("branch_stats");
      if (error) throw wrapDbError(error);
      return new Map(((data ?? []) as BranchStats[]).map((s) => [s.branch_id, s]));
    },
  });
}

/** Active branches, for any form that assigns a record to one. */
export function useBranchPicker(selectedId: string, enabled: boolean): Picker {
  return useEntityPicker<Branch>({
    table: "branches",
    selectedId,
    searchColumns: ["name", "name_ar", "code", "city"],
    orderBy: "name",
    toOption: (b) => ({ value: b.id, label: b.name, meta: b.code ?? b.city ?? undefined }),
    filter: (q) => q.eq("active", true),
    scope: ["branches", "active"],
    enabled,
  });
}
