/**
 * Chart chrome shared app-wide (docs/DESIGN_SYSTEM.md §5). Values are CSS
 * variables so both themes are covered automatically — SVG presentation
 * attributes resolve var() like any CSS. Series/status colors are literal hex
 * by design: the deep palette is validated for BOTH light and dark surfaces,
 * so identity never shifts between themes.
 */
export const GRID_STROKE = "var(--color-line)";
export const TICK_STYLE = { fill: "var(--color-ink-3)", fontSize: 12 };
export const DONUT_STROKE = "var(--color-surface)";
export const CURSOR_FILL = "rgba(148, 163, 184, 0.08)";

/** Pass to recharts <Tooltip contentStyle/labelStyle/itemStyle>. */
export const TOOLTIP_CONTENT_STYLE = {
  backgroundColor: "var(--color-surface)",
  border: "1px solid var(--color-line)",
  borderRadius: "0.75rem",
  boxShadow: "var(--shadow-pop)",
  color: "var(--color-ink)",
} as const;
export const TOOLTIP_LABEL_STYLE = { color: "var(--color-ink)" } as const;
export const TOOLTIP_ITEM_STYLE = { color: "var(--color-ink-2)" } as const;
