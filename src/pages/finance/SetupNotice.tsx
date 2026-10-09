import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BookOpen } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { wrapDbError } from "../../lib/db";
import { useAuth } from "../../context/AuthContext";
import { useT, useTp } from "../../i18n";
import { Button, Card } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { useAccounts } from "./types";

/** Shown until the tenant has a chart of accounts; a manager seeds it in one click. */
export function SetupNotice() {
  const t = useT();
  const tp = useTp();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const accountsQ = useAccounts();
  const setup = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("finance_setup");
      if (error) throw wrapDbError(error);
      return Number(data ?? 0);
    },
    onSuccess: (n) => {
      void qc.invalidateQueries({ queryKey: ["gl_accounts"] });
      void qc.invalidateQueries({ queryKey: ["finance_settings"] });
      toast.success(tp("finance.setup.done", n));
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("common.error")),
  });

  if (!accountsQ.data || accountsQ.data.length > 0) return null;
  return (
    <Card className="mb-4 flex flex-wrap items-center gap-4 p-4">
      <BookOpen className="h-8 w-8 shrink-0 text-brand-600" />
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold text-ink">{t("finance.setup.title")}</h2>
        <p className="text-sm text-ink-2">{isManager ? t("finance.setup.hint") : t("finance.setup.askManager")}</p>
      </div>
      {isManager && (
        <Button loading={setup.isPending} onClick={() => setup.mutate()}>
          {t("finance.setup.button")}
        </Button>
      )}
    </Card>
  );
}
