# FleetManage Design System

The single visual contract for every page. Tokens live in [`src/index.css`](../src/index.css)
(`@theme`); primitives live in [`src/components/ui.tsx`](../src/components/ui.tsx) and
[`src/components/DataTable.tsx`](../src/components/DataTable.tsx).
**New code never hardcodes raw palette classes for surfaces, text, or borders — it uses
tokens (via their generated utilities) and the shared primitives.**

## 0. Themes (light + dark)

Both themes are first-class. Dark is a **designed palette** under
`[data-theme="dark"]` in `index.css` — surfaces, ink, sidebar, soft tints, on-tint text
steps, and elevation each get hand-picked values (never a filter/invert). The theme is
applied as `<html data-theme>` by `ThemeProvider` ([`src/lib/theme.tsx`](../src/lib/theme.tsx));
initial = stored preference or the OS `prefers-color-scheme`; the header toggle persists it.
Rules:

- Components style through tokens only, so they theme for free. If a new soft tint or
  text step is introduced, add its dark counterpart to the `[data-theme="dark"]` block
  in the same commit.
- **Chart series/status colors are identical in both themes** — the deep palette is
  validated (CVD + ≥3:1 contrast) against light *and* dark surfaces, so identity never
  shifts. Chart *chrome* (grid, ticks, donut stroke, tooltips) uses CSS variables from
  [`src/lib/chart.ts`](../src/lib/chart.ts) and themes automatically. Never hardcode
  chart chrome hex in a page.

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

- **Sidebar** is a dual-rail:
  - *Icon rail* (56px, `bg-sidebar` dark): brand mark on top, then icon-only shortcuts
    for every enabled nav item (active = `bg-sidebar-2 text-brand-400`).
  - *Main panel* (208px, `bg-surface`, `border-e border-line`): wordmark + tenant name,
    nav grouped by **module-registry category** with uppercase eyebrows
    (`nav.section.*` keys, `rtl:tracking-normal`; groups render only when a module in
    them is enabled — generated from `NAV_SECTIONS` × `NAV_ITEMS` in
    [`src/modules/nav.ts`](../src/modules/nav.ts), never hand-grouped), active item =
    soft pill `bg-brand-50 text-brand-700`, then the user card (initials avatar in
    `bg-brand-50 text-brand-700`, name + role, sign out).
  In RTL the whole composite flips to the inline-start (right) automatically — flex
  order and logical borders only, no positional overrides.
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
| `DataTable` | **The list-page table**: tokenized shell, sort on loaded rows (aria-sort), per-user column chooser persisted per `tableId`, CSV export, responsive column priorities (`minBreakpoint`), optional row selection + bulk-action slot. Pair with `Pagination` (as `footer`) + `listPage`. `Table` remains only for small embedded lists. |
| `Table` | Small embedded lists inside cards/detail pages only. |
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

## 5b. Workspace shell (large displays) & wayfinding

- **Command palette** (`GlobalSearch`, Ctrl/⌘+K): recently viewed → navigation
  commands → entity results, fully keyboard-driven (listbox semantics). Entity detail
  pages call `recordRecent()` ([`src/lib/recent.ts`](../src/lib/recent.ts)) so the
  palette and context panel stay useful.
- **Context panel** (`ContextPanel`, 2xl+ ≈1536px): quick actions, due-soon, recently
  viewed, admin activity — collapsible, real data only, module-gated. Content max-width
  is 1600px; the panel is how ≥27" displays earn their space.
- **Insights** (`InsightsStrip` on dashboards): deterministic, rule-based checks over
  data the page already fetched — never generated/fabricated content. New rules ship
  with en+ar keys and a link to the surface that resolves them.

## 5c. Motion

One entry animation (`animate-pop-in`, 140ms spring-ish cubic-bezier) for modals,
palettes, and dropdown surfaces; `transition-colors` on interactive rows/controls.
Everything sits behind `prefers-reduced-motion: no-preference`. No scroll-jacking, no
parallax, no attention-seeking loops.

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
