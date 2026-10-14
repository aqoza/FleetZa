import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { insertRow, updateRow } from "../../lib/db";
import { DEVICE_TYPES, METRIC_RE, RULE_OPS, TYPE_DEFAULTS, type DeviceType, type RuleOp } from "../../lib/iot";
import { useT } from "../../i18n";
import { Button, ErrorState, Field, Input, Modal, Select, Textarea } from "../../components/ui";
import { Combobox } from "../../components/Combobox";
import { useToast } from "../../components/Toast";
import { useIotDevicePicker } from "./picker";
import type { AlertRule, AlertSeverity } from "./types";

type Scope = "device" | "type" | "all";
const SEVERITIES: AlertSeverity[] = ["info", "warning", "critical"];
const METRIC_SUGGESTIONS = [...new Set(Object.values(TYPE_DEFAULTS).map((d) => d.metric))];

export function RuleForm({
  rule,
  device,
  onClose,
}: {
  rule: AlertRule | null;
  /** Preselects "this device" (device page). */
  device?: { id: string; device_type: DeviceType };
  onClose: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState(() => ({
    name: rule?.name ?? "",
    scope: (rule ? (rule.device_id ? "device" : rule.device_type ? "type" : "all") : device ? "device" : "type") as Scope,
    deviceId: rule?.device_id ?? device?.id ?? "",
    deviceType: (rule?.device_type ?? device?.device_type ?? "temperature") as DeviceType,
    metric: rule?.metric ?? TYPE_DEFAULTS[device?.device_type ?? "temperature"].metric,
    op: (rule?.op ?? "gt") as RuleOp,
    threshold: rule ? String(rule.threshold) : "",
    severity: (rule?.severity ?? "warning") as AlertSeverity,
    cooldown: String(rule?.cooldown_minutes ?? 30),
    notify: rule?.notify ?? true,
    active: rule?.active ?? true,
    notes: rule?.notes ?? "",
  }));
  const [error, setError] = useState("");
  const picker = useIotDevicePicker(form.deviceId);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const metricOk = METRIC_RE.test(form.metric);

  const m = useMutation({
    mutationFn: () => {
      const values = {
        name: form.name.trim(),
        device_id: form.scope === "device" ? form.deviceId : null,
        device_type: form.scope === "type" ? form.deviceType : null,
        metric: form.metric,
        op: form.op,
        threshold: Number(form.threshold),
        severity: form.severity,
        cooldown_minutes: Number(form.cooldown),
        notify: form.notify,
        active: form.active,
        notes: form.notes.trim() || null,
      };
      return rule ? updateRow("iot_alert_rules", rule.id, values) : insertRow("iot_alert_rules", values);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["iot_alert_rules"] });
      toast.success(t("iot.ruleSaved"));
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("common.error")),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError("");
    m.mutate();
  };

  const ready =
    form.name.trim() && metricOk && form.threshold !== "" && (form.scope !== "device" || form.deviceId);

  return (
    <Modal title={t(rule ? "iot.editRule" : "iot.addRule")} open onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {error && <ErrorState message={error} />}
        <Field label={t("iot.f.ruleName")} required>
          <Input maxLength={120} value={form.name} onChange={(e) => set("name", e.target.value)} required />
        </Field>
        <Field label={t("iot.f.appliesTo")} required>
          <Select value={form.scope} onChange={(e) => set("scope", e.target.value as Scope)}>
            {(["device", "type", "all"] as const).map((s) => (
              <option key={s} value={s}>{t(`iot.scope.${s}`)}</option>
            ))}
          </Select>
        </Field>
        {form.scope === "device" && (
          <Field label={t("iot.f.device")} required>
            <Combobox {...picker} value={form.deviceId} onChange={(v) => set("deviceId", v)} />
          </Field>
        )}
        {form.scope === "type" && (
          <Field label={t("iot.f.deviceType")} required>
            <Select value={form.deviceType} onChange={(e) => set("deviceType", e.target.value as DeviceType)}>
              {DEVICE_TYPES.map((ty) => (
                <option key={ty} value={ty}>{t(`iot.type.${ty}`)}</option>
              ))}
            </Select>
          </Field>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label={t("iot.f.metric")} required error={form.metric && !metricOk ? t("iot.f.metricHint") : undefined}>
            <Input
              dir="ltr"
              list="iot-metrics"
              maxLength={50}
              value={form.metric}
              onChange={(e) => set("metric", e.target.value.trim().toLowerCase())}
              required
            />
            <datalist id="iot-metrics">
              {METRIC_SUGGESTIONS.map((mtr) => (
                <option key={mtr} value={mtr} />
              ))}
            </datalist>
          </Field>
          <Field label={t("iot.f.op")} required>
            <Select value={form.op} onChange={(e) => set("op", e.target.value as RuleOp)}>
              {RULE_OPS.map((op) => (
                <option key={op} value={op}>{t(`iot.op.${op}`)}</option>
              ))}
            </Select>
          </Field>
          <Field label={t("iot.f.threshold")} required>
            <Input type="number" dir="ltr" step="any" value={form.threshold} onChange={(e) => set("threshold", e.target.value)} required />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t("iot.f.severity")} required>
            <Select value={form.severity} onChange={(e) => set("severity", e.target.value as AlertSeverity)}>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>{t(`iot.severity.${s}`)}</option>
              ))}
            </Select>
          </Field>
          <Field label={t("iot.f.cooldown")} hint={t("iot.f.cooldownHint")} required>
            <Input type="number" dir="ltr" min={0} max={10080} step={1} value={form.cooldown} onChange={(e) => set("cooldown", e.target.value)} required />
          </Field>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <label className="flex items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" className="h-4 w-4 rounded border-line" checked={form.notify} onChange={(e) => set("notify", e.target.checked)} />
            {t("iot.f.notify")}
          </label>
          <label className="flex items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" className="h-4 w-4 rounded border-line" checked={form.active} onChange={(e) => set("active", e.target.checked)} />
            {t("iot.f.active")}
          </label>
        </div>
        <Field label={t("iot.f.notes")}>
          <Textarea rows={2} maxLength={2000} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>{t("action.cancel")}</Button>
          <Button type="submit" loading={m.isPending} disabled={!ready}>{t("action.save")}</Button>
        </div>
      </form>
    </Modal>
  );
}
