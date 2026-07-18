# FleetManage â€” Build Plan (source of truth across loop iterations)

Multi-tenant fleet management SaaS. Global self-serve tenant onboarding.
Stack: **Vite + React 18 + TS + Tailwind v4 + React Router + TanStack Query** (SPA) Â·
**Hono API in Cloudflare Worker** (same deployment, `/api/*`) Â·
**Supabase**: Postgres + RLS multi-tenancy, Auth (JWT `app_metadata.tenant_id` + `app_metadata.role`), Storage.

## Positioning (from research)
Fleetio-style operations & maintenance platform (no hardware dependency):
vehicles, drivers, assignments, service reminders, work orders, fuel, inspections,
issues, renewals/expiry alerts, dashboard/reports. Global-ready: per-tenant currency,
units (km/mi, L/gal), timezone.

## Multi-tenancy model
- Shared schema, `tenant_id uuid` on every tenant table + RLS policy `tenant_id = (auth.jwt()->'app_metadata'->>'tenant_id')::uuid`.
- Roles in `app_metadata.role`: owner | admin | manager | viewer. Writes gated by role.
- Privileged ops (create tenant at signup, invite/accept, role changes) go through the
  Worker API using `SUPABASE_SERVICE_ROLE_KEY` (never shipped to client).
- JWT staleness handled by forcing session refresh after membership changes.

## Phases
- [x] Phase 0 â€” Research + this plan
- [x] Phase 1 â€” Scaffold: npm project, Vite + React + Tailwind + Cloudflare plugin, Hono worker, tsconfig, wrangler.jsonc, builds green
- [x] Phase 2 â€” Supabase: config, full schema migration, RLS + helper fns, indexes (seed deferred to Phase 8)
- [x] Phase 3 â€” Auth + onboarding: worker API (signup/invite/members), auth context, login/signup/accept-invite pages, protected routes + app shell
- [x] Phase 4 â€” Core CRUD: vehicles (list/detail/form/assignment), drivers (license expiry badges)
- [x] Phase 5 â€” Ops modules: maintenance (reminders + work orders), WO detail w/ line items, fuel (efficiency), inspections (+new w/ checklist â†’ auto-issues), issues (â†’ WO conversion), renewals â€” 17 review findings fixed
- [x] Phase 6 â€” Dashboard (KPIs, 6-mo spend chart, status donut, due-soon lists), reports (cost/vehicle + fuel efficiency + CSV export), settings (org/members/invitations) â€” 7 review findings fixed (incl. invitations tenant_id default)
- [x] Phase 7 â€” Polish: code-split heavy pages (recharts lazy chunk)
- [x] Phase 8 â€” Deployment: wrangler config, README (deploy + no-docker dev path), seed script, unit tests (16 passing), build green
- [x] Phase 9 â€” Verification & launch: COMPLETE 2026-07-18
  - [x] Build + typecheck green; 16 unit tests pass; workerd-free dev mode added (workerd broken on this host)
  - [x] Schema + security-hardening migrations applied to hosted Supabase (project ugfdexoaxladblafcrlc "Fleetz"); all security advisors remediated
  - [x] Full browser E2E vs hosted Supabase: login, dashboard, vehicles (odometer trigger), drivers, maintenance (WO totals/numbering), fuel (efficiency), inspectionâ†’auto-issueâ†’WO chain, issues, renewals, reports, settings + invitation create
  - [x] Worker flows w/ service key: self-serve signup (global tenant), invitation lookup + accept, all verified
  - [x] DEPLOYED: https://fleetmanage.aqozatechnologies.workers.dev (worker + SPA assets, 3 secrets set)
  - [x] Production E2E: fresh tenant signup on the live URL; RLS tenant isolation confirmed in prod; test tenants cleaned up
  - Demo login: demo@fleetmanage.test / Demo1234! (tenant "Acme Logistics", + manager teammate@acme.test / Teammate1234!)

## Conventions
- Money stored as numeric cents-free `numeric(12,2)` + tenant currency code; distances stored in km, volumes in liters (canonical), converted for display by tenant units.
- All timestamps `timestamptz`, display in tenant TZ.
- IDs: `uuid default gen_random_uuid()`.
- Worker API routes under `/api/*`, JSON, bearer = Supabase access token (verified via `auth.getUser`).

## Deployment blockers needing user credentials (surface at end)
- `supabase login` / project creation + `supabase db push`
- `wrangler login` + secrets (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`)

## Iteration 2 â€” Middle East country engine (2026-07-18)

First-class Middle East support: per-country tax (VAT/GST/KDV), locale-correct
formatting (incl. 3-decimal dinars/rials), and regulation-driven renewal defaults.
Backward-compatible with existing live tenants (DB stays km + liters canonical;
all schema changes additive).

- [x] Country engine `shared/countries.ts` â€” `CountryConfig` (currency/locale/timezone/units/weekStart, tax profile, regulation renewal defaults), `getCountry` safe fallback, `isSupportedCountry`, grouped `middleEastCountries()`/`otherCountries()`, `taxBreakdown`
- [x] DB columns â€” additive migration: tenant country code + tax registration number, work-order tax fields
- [x] Worker onboarding â€” validate country code, derive currency/timezone/units defaults from the engine
- [x] Locale formatting â€” dates/numbers/currency via tenant country locale in `src/lib/format.ts`
- [x] Onboarding UI â€” grouped country select (Middle East first, then other countries)
- [ ] Settings â€” country profile card + tax registration number field
- [ ] Work orders â€” net subtotal + country tax breakdown + total
- [ ] Renewals â€” country regulation-based renewal type/interval defaults
- [x] Tests â€” `shared/countries.test.ts` engine unit tests; vitest include extended to `shared/**/*.test.ts`

