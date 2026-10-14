import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { getCountry } from "../../../shared/countries";
import { wrapDbError } from "../../lib/db";
import { supabase } from "../../lib/supabase";
import { weekendFromWeekStart } from "../../lib/hr";
import { useTenant } from "../../context/AuthContext";
import { useT } from "../../i18n";
import { Button, ErrorState } from "../../components/ui";
import { useToast } from "../../components/Toast";

/**
 * First use: seeds the six standard leave types and the weekend implied by the
 * tenant's country (hr_seed keeps an existing settings row).
 */
export function SetupHr() {
  const t = useT();
  const tenant = useTenant();
  const qc = useQueryClient();
  const toast = useToast();
  const seed = useMutation({
    mutationFn: async () => {
      const weekStart = getCountry(tenant.country).weekStart;
      const { error } = await supabase.rpc("hr_seed", { p_weekend_days: weekendFromWeekStart(weekStart) });
      if (error) throw wrapDbError(error);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["leave_types"] });
      void qc.invalidateQueries({ queryKey: ["hr_settings"] });
      toast.success(t("hr.setupDone"));
    },
  });
  return (
    <div className="rounded-xl border border-dashed border-line p-4 text-center">
      <p className="text-sm font-medium text-ink">{t("hr.setupTitle")}</p>
      <p className="mt-1 text-sm text-ink-3">{t("hr.setupDesc")}</p>
      {seed.error && (
        <div className="mt-3">
          <ErrorState message={(seed.error as Error).message} />
        </div>
      )}
      <Button className="mt-3" onClick={() => seed.mutate()} loading={seed.isPending}>
        <Sparkles className="h-4 w-4" /> {t("hr.setupAction")}
      </Button>
    </div>
  );
}
