import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { countRows, deleteRow, listRows, wrapDbError } from "../../lib/db";
import { useAuth } from "../../context/AuthContext";
import type { NotificationRow } from "./types";

/** How often an open app re-runs the due-date scanners (the server also throttles). */
const REFRESH_MS = 5 * 60_000;
const POLL_MS = 60_000;

/**
 * Runs public.refresh_notifications() when the shell mounts and every few
 * minutes after: the scanners (app.scan_due_*) only run on demand.
 */
export function useNotificationRefresh(enabled: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const run = async () => {
      const { data, error } = await supabase.rpc("refresh_notifications");
      if (cancelled) return;
      if (error) {
        console.warn("[notifications] refresh", error.message);
        return;
      }
      if (Number(data) > 0) void qc.invalidateQueries({ queryKey: ["notifications"] });
    };
    void run();
    const id = setInterval(run, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [enabled, qc]);
}

export function useUnreadCount(enabled: boolean) {
  const { profile } = useAuth();
  return useQuery({
    queryKey: ["notifications", "unread-count", profile?.id],
    queryFn: () => countRows("notifications", (q) => q.eq("recipient_id", profile!.id).is("read_at", null)),
    enabled: enabled && !!profile,
    refetchInterval: POLL_MS,
  });
}

export function useRecentNotifications(limit: number, enabled: boolean) {
  const { profile } = useAuth();
  return useQuery({
    queryKey: ["notifications", "recent", profile?.id, limit],
    queryFn: () =>
      listRows<NotificationRow>("notifications", (q) =>
        q.eq("recipient_id", profile!.id).order("created_at", { ascending: false }).limit(limit),
      ),
    enabled: enabled && !!profile,
  });
}

/** Mark ids (or, with null, every unread one) read or unread in one RPC. */
export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ids, read = true }: { ids: string[] | null; read?: boolean }) => {
      const { data, error } = await supabase.rpc("mark_notifications_read", {
        ...(ids ? { p_ids: ids } : {}),
        p_read: read,
      });
      if (error) throw wrapDbError(error);
      return Number(data ?? 0);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
}

export function useDeleteNotification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteRow("notifications", id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
}
