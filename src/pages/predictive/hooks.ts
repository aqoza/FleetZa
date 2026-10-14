import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { wrapDbError } from "../../lib/db";
import type { HealthRow } from "./types";

/** Live scores for every vehicle that isn't retired (server-computed). */
export function useHealth() {
  return useQuery({
    queryKey: ["predictive_vehicle_health"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("predictive_vehicle_health");
      if (error) throw wrapDbError(error);
      return ((data ?? []) as unknown as HealthRow[]).map((r) => ({
        ...r,
        odometer: Number(r.odometer),
        avg_daily_km: r.avg_daily_km == null ? null : Number(r.avg_daily_km),
        issue_rate: Number(r.issue_rate),
        cost_90d: Number(r.cost_90d),
        cost_prev_90d: Number(r.cost_prev_90d),
      }));
    },
  });
}
