# FleetManage Design System

The single visual contract for every page. Tokens live in [`src/index.css`](../src/index.css)
(`@theme`); primitives live in [`src/components/ui.tsx`](../src/components/ui.tsx).
**New code never hardcodes raw palette classes for surfaces, text, or borders — it uses
tokens (via their generated utilities) and the shared primitives.**

## 1. Tokens

### Surfaces & structure

| Token | Utility | Value | Use |
|---|---|---|---|
| `--color-canvas` | `bg-canvas` | `#f5f6fa` | App background, table header fill, input resting fill |
| `--color-surface` | `bg-surface` | `#ffffff` | Cards, tables, modals, popovers |
| `--color-line` | `border-line` | `#e6e9f0` | All borders and dividers |
| `--shadow-card` | `shadow-card` | soft 2-layer | Every card/table |
| `--shadow-pop` | `shadow-pop` | deeper | Modals, dropdowns, popovers |

Card shape is always `rounded-2xl`; controls (buttons, inputs) are `rounded-lg`/`rounded-xl`.

### Ink (text)

| Token | Utility | Use |
|---|---|---|
| `--color-ink` | `text-ink` | Primary text, values, titles |
| `--color-ink-2` | `text-ink-2` | Secondary text, card labels |
| `--color-ink-3` | `text-ink-3` | Muted text, table headers, timestamps, placeholders |

### Sidebar (dark shell)

`--color-sidebar` `#0b1220` · `--color-sidebar-2` `#131c2e` (hover/raised) ·
`--color-sidebar-line` `#1e293b`. Sidebar text uses slate-200/400/500; the active nav
item is a `bg-brand-600 text-white` pill.

### Brand & status

- **Brand** — the blue ramp (`brand-50…950`). `brand-600` is the accent: primary buttons,
  active nav, links (`text-brand-700` on light surfaces).
- **Status** (reserved for *state*, never for chart-series identity):
  `good #059669` / `warn #d97706` / `serious #dc2626`, each with a `-soft` background.
  Status is never conveyed by color alone — pair with a label (Badge) or icon.

### Chart series

`--color-chart-1 #1d67f1` and `--color-chart-2 #0d9488` — a CVD-validated pair
(protan/deutan ΔE ≥ 70 against a white surface). See §5 before adding any series color.

## 2. Typography

System stack (`--font-sans`); no webfont (Arabic glyph coverage comes from the OS).

| Role | Classes |
|---|---|
| Page title | `text-2xl font-semibold tracking-tight text-ink` (via `PageHeader`) |
| Card title | `text-sm font-semibold text-ink` |
| Section eyebrow / table header | `text-[11px] font-semibold uppercase tracking-wider text-ink-3` |
| KPI value | `text-[28px] font-bold leading-none tracking-tight tabular-nums` (via `StatCard`) |
| Body | `text-sm text-ink-2` |
| Meta / timestamps | `text-xs text-ink-3` |

**All columnar or comparative digits get `tabular-nums`.**

## 3. Shell anatomy

- **Sidebar** (240px, `bg-sidebar`): brand block → nav grouped by **module-registry
  category** with uppercase eyebrows (`nav.section.*` keys; groups render only when a
  module in them is enabled — the sidebar is generated from `NAV_SECTIONS` × `NAV_ITEMS`
  in [`src/modules/nav.ts`](../src/modules/nav.ts), never hand-grouped) → user card with
  initials avatar + sign out.
- **Header** (`bg-surface border-b border-line`): mobile menu button · `GlobalSearch`
  (Ctrl/⌘+K) · language switcher.
- **Main**: `max-w-7xl` centered, `px-4/6/8 py-6`, vertical rhythm `space-y-5`.

## 4. Components (always from `ui.tsx`)

| Primitive | Contract |
|---|---|
| `Card` | The only card. Never hand-roll `rounded… border… bg-white`. |
| `StatCard` | KPI anatomy: label, big value, optional sub (`subTone` good/warn/serious/muted), `IconChip`. |
| `IconChip` | Tinted square icon holder; tones blue/green/amber/violet/red/slate. One tone per concept, consistent across pages (vehicles=blue, customers=green, issues=amber, maintenance=violet, alerts=red). |
| `PageHeader` | Every page starts with it. |
| `Badge` | Enum/status labels; tone from the enum's `labels.ts` map. |
| `Table` | Lists; pair with `Pagination` + `listPage` (never unbounded fetches). |
| `Modal` | Create/quick-edit only; entities with detail routes navigate instead. |
| `EmptyState / LoadingState / ErrorState` | Every list renders all three paths. |

## 5. Charts (the dataviz contract)

1. **Series colors come from the validated set** (`chart-1`, `chart-2`). Adding a series
   color requires re-validating the whole set for CVD separation and contrast — same-hue
   light/dark pairs are forbidden (they failed validation: ΔE 1.6 under protan).
2. **Status charts use the status palette** (donut segments by state) — those hues are
   then off-limits for identity series in the same view.
3. Grid `#e6e9f0` dashed, no vertical lines; ticks `#94a3b8` 12px; no axis lines.
4. Donuts: `paddingAngle ≥ 2` + 2px white stroke (segment separation without color),
   center total in `tabular-nums`, side legend with counts **and** percentages (the
   legend is the required relief for sub-3:1 segment colors).
5. Legends for ≥2 series, none for one. Tooltips always. Values formatted with
   `format.ts` helpers (money/compact), never raw.
6. Charts are wrapped in `dir="ltr"` (RTL pages keep numeric axes readable).
7. One y-axis per chart, ever.

## 6. RTL & i18n (unchanged, now part of this contract)

- Logical utilities only (`ps-/pe-/ms-/me-/text-start/start-/end-`); `rtl:-scale-x-100`
  on direction-bearing icons; every string through `t()` (see `docs/I18N.md`).
- New keys ship en + ar in the same commit (compile-enforced).

## 7. Page checklist

Before a page ships: uses `PageHeader` · cards/tables from primitives · tokens only (no
raw `bg-white`/`text-slate-*`/`border-slate-*` in new code) · lists use
`listPage` + `Pagination` + server-side filters · loading/empty/error paths ·
role-gated actions · en+ar · RTL-safe · charts per §5 · numbers `tabular-nums`.

> Migration note: pages written before this system still carry raw slate classes; they
> render coherently (tokens are slate-derived) and are converted opportunistically —
> any touched page should leave fully tokenized.
