import { useCallback } from "react";
import { formatCompact, formatDistance, formatMoney, formatVolume, kmToDisplay, litersToDisplay } from "../../lib/format";
import { metricDef, type Dimension, type MetricUnit } from "../../../shared/bi";
import { useTenant } from "../../context/AuthContext";
import { useI18n, useT } from "../../i18n";
import type { BiWidget } from "./types";

/** Category and status values the metrics can return, translated under analytics.key.*. */
const KNOWN_KEYS = [
  "open", "in_progress", "completed", "canceled", "resolved", "closed", "pass", "fail", "active", "in_shop", "out_of_service",
  "retired", "draft", "issued", "partially_paid", "paid", "void", "sent", "accepted", "declined", "expired", "valid", "revoked",
  "reported", "investigating", "awaiting_repair", "low", "normal", "high", "critical", "labor", "part", "fee", "other", "car",
  "van", "truck", "bus", "trailer", "equipment", "motorcycle", "cash", "bank_transfer", "card", "cheque", "online", "collision",
  "theft", "vandalism", "injury", "near_miss", "breakdown", "fire", "weather",
] as const;
type KnownKey = (typeof KNOWN_KEYS)[number];
const isKnown = (k: string): k is KnownKey => (KNOWN_KEYS as readonly string[]).includes(k);

export function useBiLabels() {
  const t = useT();
  const { language } = useI18n();
  const tenant = useTenant();

  const metricName = useCallback((id: string) => (metricDef(id) ? t(`analytics.metric.${id}` as `analytics.metric.fuel_cost`) : id), [t]);
  const dimensionName = useCallback((d: Dimension) => t(`analytics.dim.${d}`), [t]);

  const widgetTitle = useCallback((w: Pick<BiWidget, "title" | "metric" | "dimension">) => {
    if (w.title) return w.title;
    const m = metricName(w.metric);
    return w.dimension === "none" ? m : t("analytics.titleBy", { metric: m, dimension: dimensionName(w.dimension) });
  }, [t, metricName, dimensionName]);

  /** The label a row shows: localized month/week, translated status, or the entity's name. */
  const rowLabel = useCallback((dimension: Dimension, key: string, label: string) => {
    if (dimension === "month") {
      const d = new Date(`${key}-01T00:00:00Z`);
      return Number.isNaN(d.getTime()) ? key : new Intl.DateTimeFormat(language, { month: "short", year: "2-digit", timeZone: "UTC" }).format(d);
    }
    if (dimension === "week") {
      const d = new Date(`${key}T00:00:00Z`);
      return Number.isNaN(d.getTime()) ? key : new Intl.DateTimeFormat(language, { day: "numeric", month: "short", timeZone: "UTC" }).format(d);
    }
    if (dimension === "none") return t("analytics.total");
    if (!key) return dimension === "vehicle" || dimension === "driver" || dimension === "customer" ? t("analytics.unassigned") : t("analytics.notSet");
    if ((dimension === "category" || dimension === "status") && isKnown(key)) return t(`analytics.key.${key}`);
    return label || key;
  }, [t, language]);

  const formatValue = useCallback((unit: MetricUnit, v: number) => {
    switch (unit) {
      case "money": return formatMoney(v, tenant.currency);
      case "km": return formatDistance(v, tenant.distance_unit);
      case "liters": return formatVolume(v, tenant.volume_unit);
      default: return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(v);
    }
  }, [tenant]);

  /** Short axis ticks, in display units. */
  const formatTick = useCallback((unit: MetricUnit, v: number) => {
    const shown = unit === "km" ? kmToDisplay(v, tenant.distance_unit) : unit === "liters" ? litersToDisplay(v, tenant.volume_unit) : v;
    return formatCompact(shown);
  }, [tenant]);

  return { metricName, dimensionName, widgetTitle, rowLabel, formatValue, formatTick };
}
