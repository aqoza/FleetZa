# FleetManage — Build Plan (source of truth across loop iterations)

Multi-tenant fleet management SaaS. Global self-serve tenant onboarding.
Stack: **Vite + React 18 + TS + Tailwind v4 + React Router + TanStack Query** (SPA) ·
**Hono API in Cloudflare Worker** (same deployment, `/api/*`) ·
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
- [x] Phase 0 — Research + this plan
- [ ] Phase 1 — Scaffold: npm project, Vite + React + Tailwind + Cloudflare plugin, Hono worker, tsconfig, wrangler.jsonc, builds green
- [ ] Phase 2 — Supabase: config, full schema migration (tenants, profiles, invitations, vehicles, drivers, assignments, service_reminders, work_orders, fuel_logs, inspections + templates, issues, renewals, comments/attachments meta), RLS + helper fns, indexes, seed script
- [ ] Phase 3 — Auth + onboarding: signup→create tenant (Worker), login, invite flow (create/accept), auth context, protected routes, org switcher not needed (1 tenant/user v1)
- [ ] Phase 4 — Core CRUD: vehicles (list/detail/form, status, odometer), drivers (license expiry), assignments
- [ ] Phase 5 — Ops modules: service reminders, work orders (+line items), fuel logs (efficiency calc), inspections (template + submit), issues
- [ ] Phase 6 — Dashboard (KPIs, charts, upcoming reminders/renewals), reports (cost per vehicle, fuel efficiency), renewals & alert surfacing
- [ ] Phase 7 — Settings: tenant profile (currency/units/timezone), members & roles UI, invitations UI; role-based UI gating; polish (empty states, loading, errors, responsive)
- [ ] Phase 8 — Deployment: wrangler config finalized, env docs, README with Supabase+Cloudflare deploy steps, seed demo tenant, typecheck+build+tests green
- [ ] Phase 9 — Final E2E verify in browser against local dev, fix gaps, stop loop

## Conventions
- Money stored as numeric cents-free `numeric(12,2)` + tenant currency code; distances stored in km, volumes in liters (canonical), converted for display by tenant units.
- All timestamps `timestamptz`, display in tenant TZ.
- IDs: `uuid default gen_random_uuid()`.
- Worker API routes under `/api/*`, JSON, bearer = Supabase access token (verified via `auth.getUser`).

## Deployment blockers needing user credentials (surface at end)
- `supabase login` / project creation + `supabase db push`
- `wrangler login` + secrets (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`)
