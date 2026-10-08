import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { wrapDbError } from "../../lib/db";
import { supabase } from "../../lib/supabase";
import { useModules } from "../../context/ModulesContext";
import { useT, useTp } from "../../i18n";
import { Button, Card, ErrorState, Field, Input, LoadingState } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { usePosture, useSecuritySettings } from "./hooks";
import type { Posture } from "./types";

type Tone = "ok" | "warn" | "info";

function CheckRow({ tone, title, detail }: { tone: Tone; title: string; detail: ReactNode }) {
  const icon =
    tone === "ok" ? (
      <CheckCircle2 className="h-5 w-5 text-good" />
    ) : tone === "warn" ? (
      <AlertTriangle className="h-5 w-5 text-warn" />
    ) : (
      <Info className="h-5 w-5 text-ink-3" />
    );
  return (
    <li className="flex items-start gap-3 py-3">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">
        <div className="text-sm font-medium text-ink">{title}</div>
        <div className="text-sm text-ink-2">{detail}</div>
      </div>
    </li>
  );
}

function PostureChecklist({ p }: { p: Posture }) {
  const t = useT();
  const tp = useTp();
  const { isEnabled } = useModules();
  return (
    <Card className="p-4 sm:p-5">
      <h2 className="text-base font-semibold text-ink">{t("security.posture")}</h2>
      <p className="text-sm text-ink-3">{t("security.postureDesc")}</p>
      <ul className="mt-2 divide-y divide-line">
        <CheckRow
          tone={p.admins > 3 ? "warn" : "ok"}
          title={`${t("security.check.admins")}: ${p.admins}`}
          detail={p.admins > 3 ? t("security.check.adminsHigh", { count: p.admins }) : t("security.check.adminsOk")}
        />
        <CheckRow
          tone={p.stale_members > 0 ? "warn" : "ok"}
          title={t("security.check.stale")}
          detail={p.stale_members > 0 ? tp("security.check.staleSome", p.stale_members) : t("security.check.staleOk")}
        />
        <CheckRow
          tone={p.unconfirmed_members > 0 ? "warn" : "ok"}
          title={t("security.check.unconfirmed")}
          detail={
            p.unconfirmed_members > 0 ? tp("security.check.unconfirmedSome", p.unconfirmed_members) : t("security.check.unconfirmedOk")
          }
        />
        {isEnabled("integrations") && (
          <>
            <CheckRow
              tone={p.api_keys_no_expiry > 0 ? "warn" : "ok"}
              title={t("security.check.keys")}
              detail={p.api_keys_no_expiry > 0 ? tp("security.check.keysSome", p.api_keys_no_expiry) : t("security.check.keysOk")}
            />
            <CheckRow
              tone={p.api_keys_unused > 0 ? "warn" : "ok"}
              title={t("security.check.unusedKeys")}
              detail={
                p.api_keys_unused > 0 ? tp("security.check.unusedKeysSome", p.api_keys_unused) : t("security.check.unusedKeysOk")
              }
            />
            {p.webhooks_failing !== null && (
              <CheckRow
                tone={p.webhooks_failing > 0 ? "warn" : "ok"}
                title={t("security.check.webhooks")}
                detail={
                  p.webhooks_failing > 0 ? tp("security.check.webhooksSome", p.webhooks_failing) : t("security.check.webhooksOk")
                }
              />
            )}
          </>
        )}
        <CheckRow
          tone={p.session_idle_minutes ? "ok" : "warn"}
          title={t("security.check.idle")}
          detail={
            p.session_idle_minutes
              ? t("security.check.idleOn", { minutes: p.session_idle_minutes })
              : t("security.check.idleOff")
          }
        />
        <CheckRow
          tone="info"
          title={t("security.check.retention")}
          detail={
            <>
              {p.audit_retention_days
                ? t("security.check.retentionOn", { days: p.audit_retention_days })
                : t("security.check.retentionOff")}{" "}
              <span className="text-ink-3">{tp("security.auditLast30", p.audit_events_30d)}</span>
            </>
          }
        />
      </ul>
    </Card>
  );
}

function SettingsForm() {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const settingsQ = useSecuritySettings();
  const [idle, setIdle] = useState("");
  const [strong, setStrong] = useState(false);
  const [retention, setRetention] = useState("");
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    const s = settingsQ.data;
    setIdle(s?.session_idle_minutes ? String(s.session_idle_minutes) : "");
    setStrong(s?.require_strong_passwords ?? false);
    setRetention(s?.audit_retention_days ? String(s.audit_retention_days) : "");
  }, [settingsQ.data]);

  const idleN = idle.trim() === "" ? null : Number(idle);
  const retentionN = retention.trim() === "" ? null : Number(retention);
  const idleOk = idleN === null || (Number.isInteger(idleN) && idleN >= 5 && idleN <= 1440);
  const retentionOk = retentionN === null || (Number.isInteger(retentionN) && retentionN >= 90 && retentionN <= 3650);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("save_security_settings", {
        p_session_idle_minutes: idleN as number,
        p_require_strong_passwords: strong,
        p_audit_retention_days: retentionN as number,
      });
      if (error) throw wrapDbError(error);
    },
    onSuccess: () => {
      setSaveError("");
      toast.success(t("security.settingsSaved"));
      void qc.invalidateQueries({ queryKey: ["security_settings"] });
      void qc.invalidateQueries({ queryKey: ["security_posture"] });
    },
    onError: (err) => setSaveError(err instanceof Error ? err.message : String(err)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (idleOk && retentionOk) save.mutate();
  };

  if (settingsQ.isLoading) return <LoadingState />;

  return (
    <Card className="p-4 sm:p-5">
      <h2 className="mb-3 text-base font-semibold text-ink">{t("security.settings")}</h2>
      <form onSubmit={submit} className="space-y-4">
        <Field label={t("security.idleMinutes")} hint={t("security.idleHint")} error={idleOk ? undefined : t("security.settingsInvalid")}>
          <Input type="number" inputMode="numeric" min={5} max={1440} value={idle} onChange={(e) => setIdle(e.target.value)} dir="ltr" />
        </Field>
        <Field
          label={t("security.retentionDays")}
          hint={t("security.retentionHint")}
          error={retentionOk ? undefined : t("security.settingsInvalid")}
        >
          <Input
            type="number"
            inputMode="numeric"
            min={90}
            max={3650}
            value={retention}
            onChange={(e) => setRetention(e.target.value)}
            dir="ltr"
          />
        </Field>
        <label className="flex items-start gap-2 text-sm text-ink-2">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-line"
            checked={strong}
            onChange={(e) => setStrong(e.target.checked)}
          />
          <span>
            {t("security.strongPasswords")}
            <span className="block text-xs text-ink-3">{t("security.strongPasswordsHint")}</span>
          </span>
        </label>
        {saveError && <ErrorState message={saveError} />}
        <div className="flex justify-end">
          <Button type="submit" loading={save.isPending}>{t("security.saveSettings")}</Button>
        </div>
      </form>
    </Card>
  );
}

export default function OverviewPage() {
  const postureQ = usePosture();
  return (
    <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
      <div>
        {postureQ.isLoading && <LoadingState />}
        {postureQ.error && <ErrorState message={(postureQ.error as Error).message} />}
        {postureQ.data && <PostureChecklist p={postureQ.data} />}
      </div>
      <div>
        <SettingsForm />
      </div>
    </div>
  );
}

