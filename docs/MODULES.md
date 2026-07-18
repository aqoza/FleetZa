# Building a module

FleetManage is modular (Zoho/Odoo-style): tenants subscribe to modules and the
whole app — navigation, routes, dashboard, settings catalog — adapts to what is
enabled. This doc is the contract for shipping a new module end-to-end.

## The moving parts

| Piece | Where | What it does |
|---|---|---|
| Registry | `shared/modules.ts` | Single source of truth: every module's id, category, status, dependencies, owned routes. Shared by SPA and Worker (no React imports). |
| Subscriptions | `tenant_modules` table | One row per (tenant, module). RLS: members read, admins write. New tenants get `DEFAULT_MODULES` at signup (`worker/onboarding.ts`). |
| State | `src/context/ModulesContext.tsx` | `useModules()` → `{ enabled, loading, isEnabled(id), setModuleEnabled(id, next) }`. |
| Gating | `src/components/ModuleGate.tsx` | `<ModuleGate module="x">` renders children only when enabled; otherwise a friendly screen linking admins to `/settings/modules`. |
| Catalog UI | `/settings/modules` | Admins browse the catalog by category and toggle modules per tenant. |

## Enable / disable semantics

`setModuleEnabled(id, next)` in `ModulesContext` enforces the dependency rules —
callers never have to walk the graph themselves:

- **Enabling** a module first auto-enables all of its **transitive requirements**
  (`requirementsOf(id)`), then the module itself. Enabling `sl_certificates`
  enables `speed_limiters` and `fleet` too (if not already on).
- **Disabling** a module with enabled dependents **throws**
  `Error("DEPENDENTS:<id,id,...>")` — catch it, parse the ids after the colon,
  and show the user which modules must be disabled first.
- **`alwaysOn` modules** (only `fleet`) cannot be disabled — attempting throws.
- **`coming_soon` modules** cannot be enabled — attempting throws.

## The `coming_soon` lifecycle

Catalog placeholders ship with `status: "coming_soon"`: they appear in the
settings catalog (greyed out, not enableable) so tenants can see the roadmap.
When you implement one, follow the checklist below and **flip its `status` to
`"available"`** in the registry — that single change makes it enableable
everywhere. If it should be on for every tenant by default, also add it to
`DEFAULT_MODULES` and backfill existing tenants in the migration.

## End-to-end checklist

Use the speed limiter modules (`speed_limiters`, `sl_certificates`) as the
reference implementation throughout.

### 1. Registry entry — `shared/modules.ts`

Add the module to `MODULES` (order within a category = display order):

```ts
m("my_module", "compliance", "available", { requires: ["fleet"], routes: ["/my-module"] }),
```

- `id`: snake_case, permanent (it is stored in `tenant_modules.module_id`).
- `requires`: direct dependencies only — transitivity is computed.
- `routes`: route **path prefixes** the module owns, each starting with `/`
  (`moduleForPath` uses longest-prefix matching for gating and deep links).
- Never remove or rename a shipped id; tenants' subscription rows reference it.

### 2. Catalog i18n names — `src/i18n/messages/{en,ar}/modules.ts`

Every module needs a name and description in the catalog namespace, English
**and** Arabic (Arabic completeness is compile-enforced):

```ts
// en/modules.ts
"modules.my_module.name": "My Module",
"modules.my_module.description": "One sentence on what it does.",
```

Use the glossary in `docs/I18N.md` (module = وحدة/تطبيق, certificate = شهادة,
device = جهاز, …) for consistent MSA Arabic.

### 3. DB tables — tenant defaults + RLS

Every tenant table follows the same pattern:

- `tenant_id uuid not null default app.tenant_id()` referencing `tenants(id)` —
  the default comes from the JWT, so client inserts **NEVER send `tenant_id`**.
- `id uuid primary key default gen_random_uuid()`, `created_at` / `updated_at`
  `timestamptz` with the `app.set_updated_at()` trigger.
- Canonical units: distances km, volumes liters, money `numeric(12,2)`
  (converted for display by `src/lib/format.ts`).
- RLS enabled with tenant isolation + role gating. Copy this DO-loop from
  `supabase/migrations/20260718000003_modules_speed_limiters.sql` (members
  read, managers write — swap `app.is_manager()` for `app.is_admin()` where
  writes are admin-only):

```sql
do $$
declare t text;
begin
  foreach t in array array['my_module_things', 'my_module_other'] loop
    execute format(
      'create trigger %I_updated_at before update on public.%I
         for each row execute function app.set_updated_at()', t, t);
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I_select on public.%I for select to authenticated
         using (tenant_id = (select app.tenant_id()))', t, t);
    execute format(
      'create policy %I_insert on public.%I for insert to authenticated
         with check (tenant_id = (select app.tenant_id()) and (select app.is_manager()))', t, t);
    execute format(
      'create policy %I_update on public.%I for update to authenticated
         using (tenant_id = (select app.tenant_id()) and (select app.is_manager()))
         with check (tenant_id = (select app.tenant_id()) and (select app.is_manager()))', t, t);
    execute format(
      'create policy %I_delete on public.%I for delete to authenticated
         using (tenant_id = (select app.tenant_id()) and (select app.is_manager()))', t, t);
  end loop;
end;
$$;
```

Add row types to `src/lib/types.ts` (see `SpeedLimiterInstallation` /
`SpeedLimiterCertificate`).

### 4. Page — `src/pages/<module>/`

One directory per module (e.g. `src/pages/speed-limiters/SpeedLimitersPage.tsx`).
Follow an existing page such as `src/pages/renewals/RenewalsPage.tsx` exactly:

- Data via `listRows` / `insertRow` / `updateRow` / `deleteRow` from `src/lib/db`
  with TanStack Query; **never include `tenant_id` in inserts** (DB default).
- Role gating: `isManager` / `isAdmin` from `useAuth()` hides write actions.
- Money/dates/distances via `src/lib/format.ts` helpers.
- UI kit from `src/components/ui`; every string through `t()`; logical Tailwind
  utilities only (`ps-`/`pe-`, `text-start`, …) and `rtl:-scale-x-100` on
  direction-bearing icons; charts wrapped in `<div dir="ltr">` (`docs/I18N.md`).

### 5. Nav entry — `src/modules/nav.ts`

Add the module's nav item (icon, i18n label key, path, `moduleId`). The sidebar
renders only entries whose `moduleId` is enabled — no per-component checks.

### 6. Route + gate — `src/App.tsx`

Wrap every route the module owns in `<ModuleGate>` (lazy-load heavy pages):

```tsx
<Route
  path="/my-module"
  element={<ModuleGate module="my_module"><MyModulePage /></ModuleGate>}
/>
```

Disabled modules then show the friendly gate screen (with a manage link for
admins) instead of a broken page — deep links and bookmarks stay safe.

### 7. Optional dashboard widget

Gate any dashboard KPI/widget on the module:

```tsx
const { isEnabled } = useModules();
{isEnabled("my_module") && <MyModuleWidget />}
```

Also gate the widget's queries (`enabled: isEnabled("my_module")`) so disabled
modules cost zero requests.

### 8. Per-module i18n namespace

Create `src/i18n/messages/en/<module>.ts` and `ar/<module>.ts` (typed
`Record<keyof typeof en<Module>, string>` so missing Arabic fails the build),
register both in `src/i18n/index.tsx`, and prefix every key with the module
name. Full recipe in `docs/I18N.md`.

### 9. Migration — `supabase/migrations` + MCP apply

Ship schema as a new timestamped file `supabase/migrations/<YYYYMMDDHHMMSS>_<name>.sql`
(additive only — live tenants exist). Apply it to the hosted project with the
Supabase MCP `apply_migration` tool (or `npx supabase db push`), then run the
security advisors to confirm no RLS regressions.

### 10. Tests

- Registry invariants live in `shared/modules.test.ts` — they run against the
  whole catalog, so your new entry is covered automatically (unique id, deps
  exist, no cycles, route shapes, category order).
- Add pure-logic unit tests for any module-specific calculations under
  `src/**/*.test.ts` or `shared/**/*.test.ts` (vitest, node environment).
- `npm test` + `npm run build` (typecheck) must be green.
