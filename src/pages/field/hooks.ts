import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listRows, wrapDbError } from "../../lib/db";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../components/Toast";
import { useT } from "../../i18n";
import { getPosition } from "./geo";
import type { EmployeeRef } from "./types";

/** The signed-in member's own employee record (RLS lets them read it). */
export function useMyEmployee() {
  const { profile } = useAuth();
  const userId = profile?.id;
  return useQuery({
    queryKey: ["employees", "me", userId],
    queryFn: async () =>
      (
        await listRows<EmployeeRef>("employees", (q) =>
          q.select("id, first_name, last_name, name_ar").eq("user_id", userId!).limit(1),
        )
      )[0] ?? null,
    enabled: !!userId,
  });
}

/**
 * Check in / out with the device position when the browser shares it. A
 * refused or failed fix still saves the check-in, and says why it has no
 * location.
 */
export function useCheckin() {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: async (args: { kind: "check_in" | "check_out"; taskId?: string | null }) => {
      const pos = await getPosition();
      const { error } = await supabase.rpc("field_checkin", {
        p_kind: args.kind,
        p_task: args.taskId ?? null,
        p_lat: pos.ok ? pos.lat : null,
        p_lng: pos.ok ? pos.lng : null,
        p_accuracy: pos.ok ? pos.accuracy : null,
      });
      if (error) throw wrapDbError(error);
      return { kind: args.kind, pos };
    },
    onSuccess: ({ kind, pos }) => {
      void qc.invalidateQueries({ queryKey: ["field_checkins"] });
      if (pos.ok) toast.success(t(kind === "check_in" ? "field.checkin.savedIn" : "field.checkin.savedOut"));
      else toast.show(t("field.checkin.noLocation", { reason: t(pos.reasonKey) }), "info");
    },
    onError: (e) => toast.error(e instanceof Error ? e : String(e)),
  });
}
