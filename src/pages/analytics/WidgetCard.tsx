import { useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Download, Pencil, Trash2 } from "lucide-react";
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { supabase } from "../../lib/supabase";
import { wrapDbError } from "../../lib/db";
import {
  CURSOR_FILL, DONUT_STROKE, GRID_STROKE, TICK_STYLE, TOOLTIP_CONTENT_STYLE, TOOLTIP_ITEM_STYLE, TOOLTIP_LABEL_STYLE,
} from "../../lib/chart";
import { fillSeries, isTimeDimension, metricDef, periodRange, toCsv, totalOf, type MetricRow } from "../../../shared/bi";
import { useTenant } from "../../context/AuthContext";
import { useT } from "../../i18n";
import { Bdi, Card, ErrorState, LoadingState, Ltr } from "../../components/ui";
import { useBiLabels } from "./labels";
import { sizeClass, todayIn, type BiWidget } from "./types";

/** Single-hue ramp for donut segments (DESIGN_SYSTEM §5: no extra series hues); the last is "other". */
const RAMP = ["#193d8e", "#1d67f1", "#59aaff", "#8ec9ff", "#bcdeff", "#94a3b8"];
const PIE_SLICES = 5;

export function WidgetCard({ widget, editing, onEdit, onDelete, onMove, first, last }: {
  widget: BiWidget;
  editing?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
  onMove?: (dir: -1 | 1) => void;
  first?: boolean;
  last?: boolean;
}) {
  const t = useT();
  const tenant = useTenant();
  const L = useBiLabels();
  const def = metricDef(widget.metric);
  const range = periodRange(widget.period, todayIn(tenant.timezone), widget.date_from, widget.date_to);
  const q = useQuery({
    queryKey: ["bi_metric", widget.metric, widget.dimension, range.from, range.to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("bi_metric", {
        p_metric: widget.metric, p_dimension: widget.dimension, p_from: range.from, p_to: range.to,
      });
      if (error) throw wrapDbError(error);
      return (data ?? []).map((r) => ({ key: r.key, label: r.label, value: Number(r.value) })) as MetricRow[];
    },
  });
  const rows = useMemo(() => {
    const filled = fillSeries(q.data ?? [], widget.dimension, range.from, range.to);
    return filled.map((r) => ({ ...r, name: L.rowLabel(widget.dimension, r.key, r.label) }));
  }, [q.data, widget.dimension, range.from, range.to, L]);
  const title = L.widgetTitle(widget);
  const unit = def?.unit ?? "count";
  const fmt = (v: number) => L.formatValue(unit, v);

  const download = () => {
    const csv = toCsv([L.dimensionName(widget.dimension), L.metricName(widget.metric)], rows.map((r) => ({ label: r.name, value: r.value })));
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${widget.metric}-${widget.dimension}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  let body: ReactNode = null;
  if (q.isLoading) body = <LoadingState />;
  else if (q.error) body = <ErrorState message={(q.error as Error).message} />;
  else if (widget.widget_type === "kpi") {
    body = <Ltr className="block text-3xl font-bold text-ink tabular-nums">{fmt(totalOf(rows))}</Ltr>;
  } else if (rows.length === 0 || (rows.every((r) => r.value === 0))) {
    body = <p className="py-10 text-center text-sm text-ink-3">{t("analytics.noData")}</p>;
  } else if (widget.widget_type === "table") {
    const total = totalOf(rows);
    body = (
      <div className="max-h-72 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-ink-3">
            <tr className="border-b border-line">
              <th className="py-1.5 text-start font-medium">{L.dimensionName(widget.dimension)}</th>
              <th className="py-1.5 text-end font-medium">{L.metricName(widget.metric)}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.key || "_"}>
                <td className="py-1.5 text-ink"><Bdi>{r.name}</Bdi></td>
                <td className="py-1.5 text-end text-ink tabular-nums"><Ltr>{fmt(r.value)}</Ltr></td>
              </tr>
            ))}
          </tbody>
          {rows.length > 1 && (
            <tfoot>
              <tr className="border-t border-line font-semibold">
                <td className="py-1.5 text-ink">{t("analytics.total")}</td>
                <td className="py-1.5 text-end text-ink tabular-nums"><Ltr>{fmt(total)}</Ltr></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    );
  } else if (widget.widget_type === "pie") {
    const sorted = [...rows].filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
    const head = sorted.slice(0, PIE_SLICES);
    const rest = sorted.slice(PIE_SLICES).reduce((s, r) => s + r.value, 0);
    const slices = rest > 0 ? [...head, { key: "__other", name: t("analytics.other"), value: rest, label: "" }] : head;
    const total = totalOf(slices);
    body = (
      <div className="flex flex-wrap items-center gap-4">
        <div dir="ltr" className="relative h-44 w-44 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={slices} dataKey="value" nameKey="name" innerRadius="60%" outerRadius="100%" paddingAngle={2}
                stroke={DONUT_STROKE} strokeWidth={2} isAnimationActive={false}>
                {slices.map((s, i) => <Cell key={s.key || i} fill={s.key === "__other" ? RAMP[5] : RAMP[i]} />)}
              </Pie>
              <Tooltip contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} itemStyle={TOOLTIP_ITEM_STYLE}
                formatter={(v) => fmt(Number(v))} />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm font-semibold text-ink tabular-nums">
            {formatCenter(unit, total, fmt)}
          </div>
        </div>
        <ul className="min-w-0 flex-1 space-y-1 text-sm">
          {slices.map((s, i) => (
            <li key={s.key || i} className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.key === "__other" ? RAMP[5] : RAMP[i] }} />
              <span className="min-w-0 flex-1 truncate text-ink-2"><Bdi>{s.name}</Bdi></span>
              <Ltr className="text-ink tabular-nums">{fmt(s.value)}</Ltr>
              <Ltr className="w-10 text-end text-xs text-ink-3 tabular-nums">{`${Math.round((s.value / total) * 100)}%`}</Ltr>
            </li>
          ))}
        </ul>
      </div>
    );
  } else {
    const horizontal = widget.widget_type === "bar" && !isTimeDimension(widget.dimension);
    const height = horizontal ? Math.max(160, rows.length * 28 + 20) : 220;
    body = (
      <div dir="ltr">
        <ResponsiveContainer width="100%" height={height}>
          {widget.widget_type === "line" ? (
            <LineChart data={rows} margin={{ top: 5, right: 12, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
              <XAxis dataKey="name" tick={TICK_STYLE} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={TICK_STYLE} axisLine={false} tickLine={false} width={48} tickFormatter={(v) => L.formatTick(unit, Number(v))} />
              <Tooltip contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} itemStyle={TOOLTIP_ITEM_STYLE}
                formatter={(v) => fmt(Number(v))} />
              <Line type="monotone" dataKey="value" name={L.metricName(widget.metric)} stroke="#1d67f1" strokeWidth={2} dot={false} />
            </LineChart>
          ) : horizontal ? (
            <BarChart data={rows} layout="vertical" margin={{ top: 5, right: 16, bottom: 5, left: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} horizontal={false} />
              <XAxis type="number" tick={TICK_STYLE} axisLine={false} tickLine={false} tickFormatter={(v) => L.formatTick(unit, Number(v))} />
              <YAxis type="category" dataKey="name" width={110} tick={TICK_STYLE} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: CURSOR_FILL }} contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_STYLE}
                itemStyle={TOOLTIP_ITEM_STYLE} formatter={(v) => fmt(Number(v))} />
              <Bar dataKey="value" name={L.metricName(widget.metric)} fill="#1d67f1" radius={[0, 4, 4, 0]} />
            </BarChart>
          ) : (
            <BarChart data={rows} margin={{ top: 5, right: 12, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
              <XAxis dataKey="name" tick={TICK_STYLE} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={TICK_STYLE} axisLine={false} tickLine={false} width={48} tickFormatter={(v) => L.formatTick(unit, Number(v))} />
              <Tooltip cursor={{ fill: CURSOR_FILL }} contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_STYLE}
                itemStyle={TOOLTIP_ITEM_STYLE} formatter={(v) => fmt(Number(v))} />
              <Bar dataKey="value" name={L.metricName(widget.metric)} fill="#1d67f1" radius={[4, 4, 0, 0]} />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    );
  }

  return (
    <Card className={`flex min-w-0 flex-col p-4 ${sizeClass[widget.size]}`}>
      <div className={`mb-3 flex items-start justify-between gap-2 ${editing ? "flex-wrap" : ""}`}>
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-ink"><Bdi>{title}</Bdi></h3>
          <p className="text-xs text-ink-3">{t(`analytics.period.${widget.period}`)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5 print:hidden">
          {editing && onMove && (
            <>
              <IconButton label={t("analytics.w.moveUp")} onClick={() => onMove(-1)} disabled={first}><ArrowUp className="h-4 w-4" /></IconButton>
              <IconButton label={t("analytics.w.moveDown")} onClick={() => onMove(1)} disabled={last}><ArrowDown className="h-4 w-4" /></IconButton>
            </>
          )}
          {editing && onEdit && <IconButton label={t("analytics.w.edit")} onClick={onEdit}><Pencil className="h-4 w-4" /></IconButton>}
          {editing && onDelete && <IconButton label={t("analytics.w.delete")} onClick={onDelete}><Trash2 className="h-4 w-4" /></IconButton>}
          {!editing && widget.widget_type !== "kpi" && rows.length > 0 && (
            <IconButton label={t("analytics.w.csv")} onClick={download}><Download className="h-4 w-4" /></IconButton>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1">{body}</div>
    </Card>
  );
}

function formatCenter(unit: string, total: number, fmt: (v: number) => string) {
  return unit === "count" ? fmt(total) : <Ltr className="text-xs">{fmt(total)}</Ltr>;
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} disabled={disabled}
      className="rounded-lg p-1.5 text-ink-3 hover:bg-canvas hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent">
      {children}
    </button>
  );
}
