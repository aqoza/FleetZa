# FleetManage smoke harness

> **Local setup:** `cd docs/buildout/smoke && npm install`. playwright-core needs a
> Chromium build: set `PLAYWRIGHT_BROWSERS_PATH` to a directory containing a
> `chromium-<rev>` build (the cloud container ships one at `/opt/pw-browsers`), or run
> `npx playwright-core install chromium`. On a machine that can reach Supabase you can
> also simply drive the real app — this harness exists for containers that cannot.


Renders SPA routes in headless Chromium against a **fully faked Supabase
backend** (Playwright request interception; the container cannot reach
Supabase), screenshots them, and reports problems. Nothing here touches the repo.

```bash
SMOKE=docs/buildout/smoke
node $SMOKE/run.mjs --routes "/,/vehicles,/customers" --langs en,ar --themes light,dark --viewport both
node $SMOKE/run.mjs --routes "/gps" --fixtures ./my-module.json --out /tmp/shots   # then Read the PNGs
node $SMOKE/run.mjs --stop-server                                                   # kill the shared Vite
```

| option | default | notes |
|---|---|---|
| `--routes "/a,/b?x=1"` | required | any SPA path, incl. detail pages (`/vehicles/<id>`) |
| `--langs en,ar` | `en` | sets `fm.lang` **and** the profile's `language` |
| `--themes light,dark` | `light` | sets `fm.theme` + `prefers-color-scheme` |
| `--viewport desktop\|mobile\|both` | `desktop` | 1440×900 / 390×844 (mobile = touch + isMobile) |
| `--fixtures file.json\|file.mjs` | – | merged over the base fixtures (below) |
| `--role owner\|admin\|manager\|viewer` | `owner` | profile role (drives `isAdmin`/`isManager`) |
| `--modules all\|available\|id,id` | `all` | which `tenant_modules` rows are enabled |
| `--out dir` | `smoke/out/<timestamp>-<pid>` | PNGs + `report.json` |
| `--port 5199` | `5199` | Vite dev server port |
| `--wait 1500` | `1500` | extra settle ms after network idle |
| `--concurrency 4` / `--timeout 45000` | | parallel pages / navigation timeout |
| `--shot full\|viewport` | `full` | `full` grows the viewport to the `<main>` scroll height so the whole page is captured |
| `--repo path` | `$FLEETZA_REPO` or the repo root | serve a worktree instead (use its own `--port`; it needs `node_modules`) |
| `--strict` | off | warnings (gate, redirect, blank, vertical overflow, failed requests…) also fail |
| `--no-fill` | off | don't auto-fill columns missing from fixture rows |

Screenshots: `<out>/<route-slug>-<lang>-<theme>-<viewport>.png` (`/` → `home`,
`/sales/quotes` → `sales-quotes`). Exit code: `0` all OK, `1` a page had
pageerrors / console errors / raw i18n keys / horizontal overflow, `2` harness error.

**Dev server.** Reuses whatever serves the SPA on `--port`; otherwise starts one
detached Vite (`vite --port N --strictPort --host 127.0.0.1`, env from
`.env.production`) under a lock file so concurrent runs start only one, and leaves
it running (`vite.pid`, `vite-<port>.json`, log in `vite.log`). Vite HMR picks up
your edits; no restart needed. A server started for a different `--repo` is refused.

## report.json

Per page: `ok`, `failures[]`, `warnings[]`, `finalUrl/finalPath/redirected`,
`gated` (ModuleGate "not enabled" screen visible), `blank`, `stuckLoading`,
`errorBoundary`, `dir`/`htmlLang`/`htmlTheme`, `overflow {scrollWidth, innerWidth,
offenders[], docHeight, innerHeight}`, `rawKeys[]`, `pageErrors[]`,
`consoleErrors[]`, `consoleWarnings[]`, `failedRequests[]`, `badResponses[]`,
`noise[]` (filtered console lines + why), and `backend`: `tableCalls`,
`rpcCalls`, **`emptyTables`** (tables the page read that had no rows — add
fixtures for these), **`rpcWithoutFixture`**, **`apiWithoutFixture`**,
`unknownSupabasePaths`, `mockErrors`.

Filtered as noise (documented, not app bugs): `Failed to load resource` for
responses the mock returned non-2xx on purpose (PGRST116 406s, `__status`
fixtures); favicon; React DevTools / `[vite]` chatter; and `requestfailed
net::ERR_ABORTED` on intercepted **HEAD** requests (Chromium reports every fulfilled
HEAD as aborted even though `fetch` resolved — `countRows` still gets its count).
Raw keys = visible text/placeholder/title/aria-label matching
`/^[a-z][A-Za-z]+(\.[A-Za-z0-9_]+)+$/` whose first segment is a real i18n
namespace (so `acme.test` domains don't trip it).

## Fixtures

```json
{
  "tables": { "<table>": [ { "id": "…", "col": "…" } ] },
  "rpc":    { "<fn>": <json returned by /rest/v1/rpc/<fn>> },
  "api":    { "GET /api/x": <json>, "POST /api/y/*": { "__status": 400, "__body": { "error": "…" } } }
}
```

- Merged over the base **per key** (a `tables.vehicles` you pass replaces the base vehicles).
- **Base**: `tenants` (Acme Logistics, id `170d2d86-…`, service_provider, US/USD/km/L/UTC,
  every column), `profiles` (demo owner `129bbbae-…`), `tenant_modules` (one enabled row per
  `m("<id>", …)` in `shared/modules.ts`, read at run time), 3 `vehicles`, 2 `drivers`,
  2 `customers`, and `rpc.sales_summary` / `rpc.fuel_summary`. See `lib/fixtures.mjs` (`IDS`).
- Rows are **auto-filled** with every column from `database.types.ts` you leave out
  (`tenant_id` → demo tenant, `id` → uuid, non-null `*_at` → now, nullable → `null`,
  string → `""`, number → `0`, boolean → `false`). Give the columns the UI shows real values.
- **Embeds** (`select=*,vehicles(name)`, `cust:customers(name)`, one-to-many
  `work_order_lines(*)`) resolve automatically from other fixture tables via the FK
  metadata in `database.types.ts`; or put the embedded object on the row yourself.
- `rpc` default is `[]`. For a `.single()` RPC give a one-element array or an object.
  Scalar RPCs: give the scalar (`"next_certificate_number": "RSL-2026-00042"`).
- `api` keys are `"METHOD /path"`, matched exact → with query → trailing-`*` prefix;
  unmatched `/api/**` returns `200 {}`. Edge functions use `"POST /functions/v1/<name>"`.
- A `.mjs` fixture (`export default {…}`) may use functions:
  `rpc: { fn: (args, { tables }) => … }`, `api: { "POST /api/x": ({ body, tables }) => … }`.
- Writes (POST/PATCH/DELETE) mutate a per-page in-memory copy, so create → list flows
  inside one page see their own rows. Each page starts from the fixtures again.

### Adding fixtures for a new module

1. Run your route once with no fixtures: `report.json → backend.emptyTables /
   rpcWithoutFixture / apiWithoutFixture` lists exactly what the page asked for.
2. Write `my-module.json` with rows for those tables, copying the `Row` shape from
   `src/lib/database.types.ts` (regenerated after your migration — the harness reads it
   live, as it does `shared/modules.ts`, so the new module is enabled automatically).
   Link to base data by id (`IDS.VEH_1` = `a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d01`,
   `IDS.CUST_1` = `c1a0e5f2-3b4d-4e6f-8a9b-0c1d2e3f4a51`, …).
3. Use values from the module's real enums (status keys drive `t()` lookups; a wrong one
   shows up as a raw key or a crash). Run list + detail routes in both languages/themes and
   both viewports, then Read a couple of PNGs to confirm real data rendered.

See `fixtures/example.json` (quotes + lines + audit event + rpc/api overrides):
`node run.mjs --routes "/sales/quotes,/sales/quotes/9e0a1b2c-0001-4d5e-8f90-a1b2c3d4e501" --fixtures fixtures/example.json`.

## PostgREST emulation limits

Filters: `eq neq gt gte lt lte like ilike match imatch is in cs cd ov isdistinct`,
`not.<op>`, `or=(…)`/`and=(…)` (nested). Numeric compare when both sides look numeric,
otherwise string compare (ISO dates work). **Not emulated** (match everything): full-text
(`fts`…), range ops, JSON-path (`col->>x`) filters, filters/order/limit on embedded
resources (`vehicles.name=…`), `!inner` join filtering. `select=` column lists are not
projected (extra columns come back). `order` supports multiple columns + nulls
first/last. Counts via `Prefer: count=*` → `Content-Range`. Upserts merge on
`on_conflict`. RLS/tenant scoping is not modelled: every row in a fixture table is
visible (the app's unfiltered `tenants.maybeSingle()` therefore needs exactly one tenant
row). Triggers/defaults (doc numbers, totals, audit rows) do not run on writes.
