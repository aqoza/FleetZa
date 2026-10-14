import { useMemo, useState } from "react";
import { insertRow, updateRow } from "../../lib/db";
import {
  METRICS, PERIODS, SIZES, WIDGET_TYPES, coerceDimension, metricDef, suggestedType,
  type Dimension, type Period, type WidgetSize, type WidgetType,
} from "../../../shared/bi";
import { useModules } from "../../context/ModulesContext";
import { useT } from "../../i18n";
import { Field, Input, Select } from "../../components/ui";
import { FormActions, FormError, onSubmit, textOrNull, useSubmit } from "./forms";
import { useBiLabels } from "./labels";
import type { BiWidget } from "./types";

export function WidgetForm({ dashboardId, widget, nextPosition, onCancel, onDone }: {
  dashboardId: string; widget: BiWidget | null; nextPosition: number; onCancel: () => void; onDone: () => void;
}) {
  const t = useT();
  const L = useBiLabels();
  const { isEnabled } = useModules();
  // Only metrics whose module is on, plus the widget's own metric when editing.
  const metrics = useMemo(() => METRICS.filter((m) => isEnabled(m.module) || m.id === widget?.metric), [isEnabled, widget?.metric]);
  const first = metrics[0]?.id ?? "vehicles_count";
  const [metric, setMetric] = useState(widget?.metric ?? first);
  const [dimension, setDimension] = useState<Dimension>(widget?.dimension ?? coerceDimension(first, "month"));
  const [type, setType] = useState<WidgetType>(widget?.widget_type ?? suggestedType(coerceDimension(first, "month")));
  const [period, setPeriod] = useState<Period>(widget?.period ?? "last_12_months");
  const [from, setFrom] = useState(widget?.date_from ?? "");
  const [to, setTo] = useState(widget?.date_to ?? "");
  const [size, setSize] = useState<WidgetSize>(widget?.size ?? "medium");
  const [title, setTitle] = useState(widget?.title ?? "");
  const dims = metricDef(metric)?.dimensions ?? ["none"];
  // A single total can only be a KPI or a one-row table.
  const types = dimension === "none" ? WIDGET_TYPES.filter((w) => w === "kpi" || w === "table") : WIDGET_TYPES.filter((w) => w !== "kpi");

  const pickMetric = (m: string) => {
    setMetric(m);
    const d = coerceDimension(m, dimension);
    if (d !== dimension) pickDimension(d);
  };
  const pickDimension = (d: Dimension) => {
    setDimension(d);
    setType(suggestedType(d));
    if (d === "none") setSize("small");
    else if (size === "small") setSize("medium");
  };

  const { error, saving, run } = useSubmit(onDone);
  const submit = onSubmit(() => run(async () => {
    const values = {
      title: textOrNull(title), widget_type: type, metric, dimension, period,
      date_from: period === "custom" ? from || null : null, date_to: period === "custom" ? to || null : null, size,
    };
    if (widget) await updateRow("bi_widgets", widget.id, values);
    else await insertRow("bi_widgets", { ...values, dashboard_id: dashboardId, position: nextPosition });
  }));

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label={t("analytics.w.metric")} required>
        <Select value={metric} onChange={(e) => pickMetric(e.target.value)}>
          {metrics.map((m) => <option key={m.id} value={m.id}>{L.metricName(m.id)}</option>)}
        </Select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("analytics.w.dimension")} required>
          <Select value={dimension} onChange={(e) => pickDimension(e.target.value as Dimension)}>
            {dims.map((d) => <option key={d} value={d}>{L.dimensionName(d)}</option>)}
          </Select>
        </Field>
        <Field label={t("analytics.w.type")} required>
          <Select value={type} onChange={(e) => setType(e.target.value as WidgetType)}>
            {types.map((w) => <option key={w} value={w}>{t(`analytics.type.${w}`)}</option>)}
          </Select>
        </Field>
        <Field label={t("analytics.w.period")} required>
          <Select value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
            {PERIODS.map((p) => <option key={p} value={p}>{t(`analytics.period.${p}`)}</option>)}
          </Select>
        </Field>
        <Field label={t("analytics.w.size")} required>
          <Select value={size} onChange={(e) => setSize(e.target.value as WidgetSize)}>
            {SIZES.map((s) => <option key={s} value={s}>{t(`analytics.size.${s}`)}</option>)}
          </Select>
        </Field>
      </div>
      {period === "custom" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("analytics.w.from")} required>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} required />
          </Field>
          <Field label={t("analytics.w.to")} required>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} required min={from || undefined} />
          </Field>
        </div>
      )}
      <Field label={t("analytics.w.title")} hint={t("analytics.w.titleHint", { title: L.widgetTitle({ title: null, metric, dimension }) })}>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
      </Field>
      <FormError message={error} />
      <FormActions saving={saving} label={widget ? t("analytics.save") : t("analytics.w.add")} onCancel={onCancel} />
    </form>
  );
}
