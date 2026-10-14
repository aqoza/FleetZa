import { formatReading, freshness, latestValues } from "../../lib/iot";
import { getCountry } from "../../../shared/countries";
import { useTenant } from "../../context/AuthContext";
import { useT } from "../../i18n";
import { freshColor } from "./labels";

/** Reading formatter in the tenant's number locale (same source as src/lib/format.ts). */
export function useFormatReading() {
  const tenant = useTenant();
  const locale = getCountry(tenant.country).locale;
  return (value: number, unit: string | null) => formatReading(value, unit, locale);
}

/** Colored dot + freshness label for a device's last_seen_at. */
export function FreshDot({ lastSeenAt, withLabel = false }: { lastSeenAt: string | null; withLabel?: boolean }) {
  const t = useT();
  const f = freshness(lastSeenAt);
  return (
    <span className="inline-flex items-center gap-1.5" title={t(`iot.fresh.${f}`)}>
      <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: freshColor[f] }} aria-hidden />
      {withLabel && <span className="text-ink-2">{t(`iot.fresh.${f}`)}</span>}
    </span>
  );
}

/** Compact "metric value" chips from last_reading. */
export function LatestChips({ lastReading, max = 3 }: { lastReading: unknown; max?: number }) {
  const fmt = useFormatReading();
  const values = latestValues(lastReading);
  if (values.length === 0) return <span className="text-ink-3">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {values.slice(0, max).map((v) => (
        <span key={v.metric} dir="ltr" className="whitespace-nowrap rounded-md bg-canvas px-1.5 py-0.5 text-xs text-ink-2">
          <span className="text-ink-3">{v.metric}</span> <span className="font-medium tabular-nums text-ink">{fmt(v.value, v.unit)}</span>
        </span>
      ))}
      {values.length > max && <span className="text-xs text-ink-3">+{values.length - max}</span>}
    </span>
  );
}
