import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { insertRow, listRows, updateRow } from "../../lib/db";
import { useDriverPicker } from "../../lib/pickers";
import { formatDateTime } from "../../lib/format";
import type { Profile } from "../../lib/types";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useT } from "../../i18n";
import { Button, ErrorState, Field, Input, Modal, Select, Textarea } from "../../components/ui";
import { Combobox } from "../../components/Combobox";
import { useToast } from "../../components/Toast";
import { COACHING_TOPICS, lastDays, localToday, topicKey } from "./labels";
import type { CoachingSession, CoachingStatus, CoachingTopic } from "./types";

const STATUSES: CoachingStatus[] = ["scheduled", "completed", "canceled"];

interface RecentEvent {
  id: string;
  occurred_at: string;
  event_type: CoachingTopic;
  severity: string;
}

export function useCoachOptions() {
  return useQuery({
    queryKey: ["profiles", "coaches"],
    queryFn: () =>
      listRows<Pick<Profile, "id" | "full_name" | "email">>("profiles", (q) =>
        q.select("id, full_name, email").order("full_name").limit(500),
      ),
  });
}

export function CoachingForm({
  open,
  session,
  driverId,
  onClose,
}: {
  open: boolean;
  session: CoachingSession | null;
  /** Preselects the driver (driver detail page). */
  driverId?: string;
  onClose: () => void;
}) {
  const t = useT();
  const tenant = useTenant();
  const { profile } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState(() => ({
    driver: session?.driver_id ?? driverId ?? "",
    coach: session ? (session.coach_id ?? "") : (profile?.id ?? ""),
    date: session?.session_date ?? localToday(),
    status: session?.status ?? ("scheduled" as CoachingStatus),
    topics: new Set<CoachingTopic>(session?.topics ?? []),
    events: new Set<string>(session?.event_ids ?? []),
    followUp: session?.follow_up_date ?? "",
    notes: session?.notes ?? "",
  }));
  const [error, setError] = useState("");
  const driverPicker = useDriverPicker(form.driver);
  const coachesQ = useCoachOptions();
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const toggle = <V,>(k: "topics" | "events", v: V) =>
    setForm((f) => {
      const next = new Set(f[k] as Set<V>);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return { ...f, [k]: next };
    });

  const eventsQ = useQuery({
    queryKey: ["driving_events", "recent-for-coaching", form.driver],
    enabled: !!form.driver,
    queryFn: () =>
      listRows<RecentEvent>("driving_events", (q) =>
        q
          .select("id, occurred_at, event_type, severity")
          .eq("driver_id", form.driver)
          .gte("occurred_at", lastDays(90)[0])
          .order("occurred_at", { ascending: false })
          .limit(50),
      ),
  });

  const m = useMutation({
    mutationFn: () => {
      const values = {
        coach_id: form.coach || null,
        session_date: form.date,
        status: form.status,
        topics: [...form.topics],
        event_ids: [...form.events],
        follow_up_date: form.followUp || null,
        notes: form.notes.trim() || null,
      };
      return session
        ? updateRow("driver_coaching_sessions", session.id, values)
        : insertRow("driver_coaching_sessions", { ...values, driver_id: form.driver });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["driver_coaching_sessions"] });
      toast.success(t("driverBehavior.sessionSaved"));
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("common.error")),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError("");
    m.mutate();
  };

  const chip = (active: boolean) =>
    `rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
      active ? "border-brand-500 bg-brand-50 text-brand-700" : "border-line bg-surface text-ink-2 hover:bg-canvas"
    }`;

  return (
    <Modal title={t(session ? "driverBehavior.editSession" : "driverBehavior.addSession")} open={open} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {error && <ErrorState message={error} />}
        <Field label={t("driverBehavior.f.driver")} required>
          <Combobox
            {...driverPicker}
            value={form.driver}
            onChange={(v) => setForm((f) => ({ ...f, driver: v, events: new Set() }))}
            disabled={!!session || !!driverId}
          />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t("driverBehavior.f.coach")}>
            <Select value={form.coach} onChange={(e) => set("coach", e.target.value)}>
              <option value="">—</option>
              {(coachesQ.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>{p.full_name || p.email}</option>
              ))}
            </Select>
          </Field>
          <Field label={t("driverBehavior.f.status")} required>
            <Select value={form.status} onChange={(e) => set("status", e.target.value as CoachingStatus)}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{t(`driverBehavior.status.${s}`)}</option>
              ))}
            </Select>
          </Field>
          <Field label={t("driverBehavior.f.date")} required>
            <Input type="date" dir="ltr" value={form.date} onChange={(e) => set("date", e.target.value)} required />
          </Field>
          <Field label={t("driverBehavior.f.followUp")}>
            <Input type="date" dir="ltr" min={form.date} value={form.followUp} onChange={(e) => set("followUp", e.target.value)} />
          </Field>
        </div>
        <fieldset>
          <legend className="mb-1 block text-sm font-medium text-ink-2">{t("driverBehavior.f.topics")}</legend>
          <div className="flex flex-wrap gap-1.5">
            {COACHING_TOPICS.map((topic) => (
              <button
                key={topic}
                type="button"
                aria-pressed={form.topics.has(topic)}
                className={chip(form.topics.has(topic))}
                onClick={() => toggle("topics", topic)}
              >
                {t(topicKey(topic))}
              </button>
            ))}
          </div>
        </fieldset>
        {form.driver && (
          <fieldset>
            <legend className="mb-1 block text-sm font-medium text-ink-2">{t("driverBehavior.f.events")}</legend>
            <p className="mb-1.5 text-xs text-ink-3">{t("driverBehavior.f.eventsHint")}</p>
            {eventsQ.data && eventsQ.data.length === 0 && (
              <p className="text-sm text-ink-3">{t("driverBehavior.f.noRecentEvents")}</p>
            )}
            <div className="max-h-40 space-y-1 overflow-y-auto">
              {(eventsQ.data ?? []).map((e) => (
                <label key={e.id} className="flex items-center gap-2 text-sm text-ink-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-line"
                    checked={form.events.has(e.id)}
                    onChange={() => toggle("events", e.id)}
                  />
                  <span>{t(topicKey(e.event_type))}</span>
                  <span className="text-xs text-ink-3">{formatDateTime(e.occurred_at, tenant.timezone)}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <Field label={t("driverBehavior.f.notes")}>
          <Textarea rows={3} maxLength={4000} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>{t("action.cancel")}</Button>
          <Button type="submit" loading={m.isPending} disabled={!form.driver}>{t("action.save")}</Button>
        </div>
      </form>
    </Modal>
  );
}
