import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { deleteRow, insertRow, listRows } from "../../lib/db";
import { NOTIFICATION_KINDS } from "../../lib/notifications";
import { useAuth } from "../../context/AuthContext";
import { useModules } from "../../context/ModulesContext";
import { useT, type MessageKey } from "../../i18n";
import { Card, EmptyState, ErrorState, LoadingState } from "../../components/ui";
import { useToast } from "../../components/Toast";
import type { NotificationPreference } from "./types";

/**
 * Per-user mutes. A notification_preferences row means "muted" (app.notify
 * skips the user); unmuting deletes it. Rows are the user's own (RLS).
 */
export default function PreferencesPage() {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const { profile } = useAuth();
  const { isEnabled } = useModules();
  const kinds = NOTIFICATION_KINDS.filter((k) => isEnabled(k.module));

  const prefsQ = useQuery({
    queryKey: ["notifications", "preferences", profile?.id],
    enabled: !!profile,
    queryFn: () =>
      listRows<NotificationPreference>("notification_preferences", (q) => q.eq("user_id", profile!.id).limit(200)),
  });
  const muted = new Map((prefsQ.data ?? []).filter((p) => p.muted).map((p) => [p.kind, p.id]));

  const toggle = useMutation({
    mutationFn: async ({ kind, receive }: { kind: string; receive: boolean }) => {
      const id = muted.get(kind);
      if (receive && id) await deleteRow("notification_preferences", id);
      else if (!receive && !id) await insertRow("notification_preferences", { kind, muted: true });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["notifications", "preferences"] });
      toast.success(t("notifications.prefSaved"));
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("notifications.actionFailed")),
  });

  if (prefsQ.isLoading) return <LoadingState />;
  if (prefsQ.error) return <ErrorState message={(prefsQ.error as Error).message} />;
  if (kinds.length === 0) return <EmptyState title={t("notifications.prefsEmpty")} />;

  return (
    <>
      <p className="mb-4 text-sm text-ink-3">{t("notifications.prefsHint")}</p>
      <Card>
        <ul className="divide-y divide-line">
          {kinds.map(({ kind }) => {
            const receive = !muted.has(kind);
            const labelKey = `notifications.kind.${kind}` as MessageKey;
            const descKey = `notifications.kind.${kind}.desc` as MessageKey;
            return (
              <li key={kind} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink">{t(labelKey)}</div>
                  <div className="text-xs text-ink-3">{t(descKey)}</div>
                </div>
                <label className="flex shrink-0 cursor-pointer items-center gap-2 text-sm text-ink-2">
                  <span>{receive ? t("notifications.receive") : t("notifications.muted")}</span>
                  <input
                    type="checkbox"
                    role="switch"
                    className="h-4 w-4 rounded border-line"
                    checked={receive}
                    disabled={toggle.isPending}
                    onChange={(e) => toggle.mutate({ kind, receive: e.target.checked })}
                  />
                </label>
              </li>
            );
          })}
        </ul>
      </Card>
    </>
  );
}
