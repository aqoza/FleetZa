import type { BadgeTone } from "../../components/ui";
import type { Factor, RiskBand } from "../../../shared/predictive";
import type { MessageKey, PluralKey, TranslateVars } from "../../i18n";
import type { PredictionStatus } from "./types";

export const bandTone: Record<RiskBand, BadgeTone> = { high: "red", medium: "yellow", low: "green" };
export const statusTone: Record<PredictionStatus, BadgeTone> = { open: "blue", actioned: "green", dismissed: "slate" };

/** Validated palette: series 1, series 3 (amber) for the service point. */
export const SERIES_1 = "#1d67f1";
export const SERIES_SERVICE = "#d97706";

type T = (key: MessageKey, vars?: TranslateVars) => string;
type Tp = (key: PluralKey, count: number, vars?: TranslateVars) => string;

/** The number behind a factor, in words ("12 days", "3 issues", "4× the previous 90 days"). */
export function factorValue(f: Factor, t: T, tp: Tp): string | null {
  const v = f.value;
  switch (f.code) {
    case "service_overdue":
      return v == null ? null : v < 0 ? tp("predictive.overdueBy", -v) : null;
    case "service_due_14d":
    case "service_due_30d":
      return v == null ? null : v === 0 ? t("predictive.today") : tp("predictive.inDays", v);
    case "open_critical_issue":
    case "open_high_issue":
    case "repeat_failure":
      return v == null ? null : tp("predictive.fv.issues", v);
    case "issue_rate_high":
    case "issue_rate":
      return v == null ? null : t("predictive.fv.rate", { rate: Number(v).toFixed(1) });
    case "cost_rising":
      return v == null ? null : t("predictive.fv.ratio", { ratio: Number(v).toFixed(1) });
    case "age_10y":
    case "age_6y":
      return v == null ? null : tp("predictive.fv.years", v);
    case "inspection_overdue":
      return v == null ? t("predictive.fv.neverInspected") : tp("predictive.s.inspectionAgo", v);
    default:
      return null;
  }
}

export function serviceText(days: number | null, overdue: boolean, t: T, tp: Tp): string {
  if (days == null) return overdue ? t("predictive.overdue") : t("predictive.noService");
  if (days < 0) return tp("predictive.overdueBy", -days);
  if (overdue) return t("predictive.overdue");
  if (days === 0) return t("predictive.today");
  return tp("predictive.inDays", days);
}
