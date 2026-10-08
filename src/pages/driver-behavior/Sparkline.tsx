import { SERIES_1 } from "./labels";

/** Tiny score trend (0–100 scale). Gaps are weeks without a score. Always LTR: time runs left to right. */
export function Sparkline({ values, label }: { values: Array<number | null>; label: string }) {
  const w = 72;
  const h = 20;
  const step = values.length > 1 ? w / (values.length - 1) : 0;
  const y = (v: number) => h - 2 - (Math.max(0, Math.min(100, v)) / 100) * (h - 4);
  const segments: string[][] = [];
  let current: string[] = [];
  values.forEach((v, i) => {
    if (v == null) {
      if (current.length) segments.push(current);
      current = [];
    } else current.push(`${(i * step).toFixed(1)},${y(v).toFixed(1)}`);
  });
  if (current.length) segments.push(current);
  const lastIdx = values.map((v, i) => (v == null ? -1 : i)).reduce((a, b) => Math.max(a, b), -1);

  return (
    <span dir="ltr" className="inline-block align-middle" role="img" aria-label={label} title={label}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible">
        {segments.map((pts, i) =>
          pts.length > 1 ? (
            <polyline key={i} points={pts.join(" ")} fill="none" stroke={SERIES_1} strokeWidth={1.5} strokeLinejoin="round" />
          ) : null,
        )}
        {lastIdx >= 0 && <circle cx={lastIdx * step} cy={y(values[lastIdx]!)} r={2} fill={SERIES_1} />}
      </svg>
    </span>
  );
}
