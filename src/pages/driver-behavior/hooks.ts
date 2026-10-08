import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { listRows, wrapDbError } from "../../lib/db";
import { lastDays } from "./labels";
import type { PersonRef, ScoreRow } from "./types";

const WEEK_MS = 7 * 86_400_000;
export const TREND_WEEKS = 6;

async function fetchScores(from: string, to: string): Promise<ScoreRow[]> {
  const { data, error } = await supabase.rpc("driver_scores", { p_from: from, p_to: to });
  if (error) throw wrapDbError(error);
  return ((data ?? []) as ScoreRow[]).map((r) => ({
    ...r,
    distance_km: Number(r.distance_km),
    score: Number(r.score),
  }));
}

/** Scores for the last `days` days (server-computed, one row per scored driver). */
export function useScores(days: number) {
  return useQuery({
    queryKey: ["driver_scores", days],
    queryFn: () => fetchScores(...lastDays(days)),
  });
}

/** Weekly scores, oldest week first: driver id → score per week (null = not scored that week). */
export function useScoreTrend() {
  return useQuery({
    queryKey: ["driver_scores", "trend", TREND_WEEKS],
    queryFn: async () => {
      const now = Date.now();
      const weeks = await Promise.all(
        Array.from({ length: TREND_WEEKS }, (_, i) => {
          const end = now - (TREND_WEEKS - 1 - i) * WEEK_MS;
          return fetchScores(new Date(end - WEEK_MS).toISOString(), new Date(end).toISOString());
        }),
      );
      const trend = new Map<string, Array<number | null>>();
      weeks.forEach((rows, i) => {
        for (const r of rows) {
          if (!trend.has(r.driver_id)) trend.set(r.driver_id, Array(TREND_WEEKS).fill(null));
          trend.get(r.driver_id)![i] = r.score;
        }
      });
      return trend;
    },
  });
}

/** Names for a bounded set of driver ids (one page of a table). */
export function useDriverNames(ids: string[]) {
  const key = [...ids].sort();
  return useQuery({
    queryKey: ["drivers", "names", key],
    enabled: key.length > 0,
    queryFn: async () => {
      const rows = await listRows<PersonRef & { id: string }>("drivers", (q) =>
        q.select("id, first_name, last_name").in("id", key).limit(key.length),
      );
      return new Map(rows.map((r) => [r.id, r]));
    },
  });
}
