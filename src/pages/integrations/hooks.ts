import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../../lib/api";
import { useT, useTp } from "../../i18n";
import { useToast } from "../../components/Toast";

export interface DispatchResult {
  claimed: number;
  delivered: number;
  retrying: number;
  failed: number;
}

/**
 * Sends the tenant's due webhook deliveries (POST /api/integrations/dispatch).
 * The hub runs it quietly on open; "Deliver now" announces the result.
 */
export function useDispatch({ announce = false }: { announce?: boolean } = {}) {
  const qc = useQueryClient();
  const toast = useToast();
  const t = useT();
  const tp = useTp();
  return useMutation({
    mutationFn: () => apiFetch<DispatchResult>("/integrations/dispatch", { method: "POST" }),
    onSuccess: (r) => {
      if (r.claimed > 0) {
        void qc.invalidateQueries({ queryKey: ["webhook_deliveries"] });
        void qc.invalidateQueries({ queryKey: ["webhook_subscriptions"] });
      }
      if (announce) toast.success(r.claimed > 0 ? tp("integrations.dispatched", r.claimed) : t("integrations.nothingDue"));
    },
  });
}
