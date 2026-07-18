# FleetManage

Multi-tenant fleet management SaaS — vehicles, drivers, maintenance, fuel, inspections,
issues, renewals, and cost reporting. Self-serve onboarding for tenants anywhere in the
world (per-tenant currency, units, and timezone).

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 19 + Vite + TypeScript + Tailwind v4 + TanStack Query + React Router |
| API | Hono running in a Cloudflare Worker (`worker/`), serves `/api/*` |
| Static hosting | Same Cloudflare Worker (assets binding, SPA fallback) |
| Database + Auth + RLS | Supabase (Postgres). Tenant isolation via RLS on `tenant_id` |

### Multi-tenancy model

- Every tenant table carries `tenant_id`; RLS policies compare it to the JWT claim
  `app_metadata.tenant_id` (user-immutable — set only by the Worker via service role).
- Roles: `owner` > `admin` > `manager` > `viewer`, stored in `app_metadata.role` and
  mirrored on `profiles.role` for display. Viewers are read-only (enforced by RLS).
- Privileged flows (tenant signup, invitation accept, role change, member removal) run in
  the Worker with `SUPABASE_SERVICE_ROLE_KEY`; the browser only ever holds the anon key.

### Country engine

`shared/countries.ts` is the single source of truth for per-country behavior, shared by
the SPA and the Worker. Each tenant's country drives:

- **Currency and locale formats** — dates, numbers, and currency rendering via the
  country's locale, including 3-decimal (KWD/BHD/OMR/JOD) and 0-decimal (IQD, YER)
  currencies.
- **Tax rules** — the standard VAT/GST rate and local labels (e.g. "TRN" in the UAE),
  applied to work-order totals (`taxBreakdown`: net lines, tax added on top).
- **Regulation-based renewal defaults** — per-country vehicle renewal types and
  intervals (registration, periodic inspection, insurance, etc.).
- **Onboarding defaults** — currency, timezone, distance/volume units, and week start.

Middle East countries carry detailed tax + regulation profiles; unknown codes resolve to
a safe generic fallback. Adding support for a new country is adding one `CountryConfig`
entry in that file.

## Modular architecture

FleetManage is modular (Zoho/Odoo-style): tenants subscribe to the modules they need
and the whole app adapts. `shared/modules.ts` is the module registry — the single
source of truth for every module (category, status, dependencies, owned routes),
shared by the SPA and the Worker. Subscriptions live in the `tenant_modules` table
(RLS: members read, admins write); new tenants start with the default set at signup.

The app adapts automatically to what's enabled:

- **Navigation** shows only enabled modules' entries.
- **Routes** are wrapped in `<ModuleGate>` — visiting a disabled module's URL shows a
  friendly "enable this module" screen (with a manage link for admins) instead of the page.
- **Dashboard** widgets render only for enabled modules.
- **Settings → Modules** is the admin catalog: browse by category, enable/disable per
  tenant. Dependencies auto-enable; disabling warns when enabled modules depend on it.

12 modules are live today (fleet core, drivers, customers, fuel, maintenance,
preventive service, inspections, issues, renewals, reports, speed limiters, speed
limiter certificates),
plus a catalog of coming-soon modules (GPS tracking, dispatch, TMS, workshop, finance,
CRM, …) that become enableable as they're implemented.

The Speed Limiter module is a full **service-provider suite**: the tenant is a company
that installs speed limiters for client organizations, with customer 360 views, device
stock tracking, a QC-gated job workflow, and compliance certificates carrying public QR
verification (`/verify`). See [docs/SPEED_LIMITERS.md](docs/SPEED_LIMITERS.md) for the
business model, entity map, job state machine, and certificate lifecycle.

See [docs/MODULES.md](docs/MODULES.md) for the end-to-end contract for building a new
module (registry entry → i18n → DB + RLS → page → nav → gated route → tests).

## Local development

Prereqs: Node 20+. Two backend options:

**Option A — hosted Supabase (no Docker):** create a free project at
[database.new](https://database.new), then apply the schema and configure env:

```bash
npm install
npx supabase login
npx supabase link --project-ref <PROJECT_REF>
npx supabase db push                       # applies supabase/migrations
cp .env.example .env                       # set VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
cp .dev.vars.example .dev.vars             # set SUPABASE_URL + ANON + SERVICE_ROLE keys
```

**Option B — local Supabase (needs Docker):** `npx supabase start`, then copy the
printed keys into `.env` / `.dev.vars` the same way.

Run the app (two terminals):

```bash
npm run dev:api      # the Hono API hosted on Node at :8788 (reads .dev.vars)
npm run dev          # Vite SPA at :5173, /api proxied to :8788
```

Open http://localhost:5173, create an organization on `/signup`, and you're in.
Optionally seed a demo tenant: `node scripts/seed-demo.mjs`.
Run unit tests with `npm test`.

## Deployment — Cloudflare Pages (full-stack)

Production runs on **Cloudflare Pages**: the SPA is served from `dist/` and the same
Hono API runs as a Pages Function (`functions/api/[[route]].ts`). The GitHub repo is
connected to the Pages project, so **every push to `main` auto-builds and deploys** to
<https://fleetza.pages.dev>. Manual deploy from a workstation: `npm run deploy`
(`wrangler pages deploy dist`). Full setup details: [docs/CICD.md](docs/CICD.md).

Supabase schema changes are applied per [docs/MODULES.md](docs/MODULES.md) conventions
(migrations live in `supabase/migrations/`). In the Supabase dashboard →
Authentication → URL Configuration, set **Site URL** to the production URL.

### Secrets recap

| Where | Key | Sensitivity |
|---|---|---|
| `.env.production` (committed; built into SPA) | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | public |
| Pages project env vars (runtime, read by `/api/*`) | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | **service-role key is secret — never commit** |

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server (SPA), proxies `/api` to :8788 |
| `npm run dev:api` | Hosts the Hono API on Node at :8788 |
| `npm run build` | Typecheck (`tsc -b`) + production build → `dist/` |
| `npm run deploy` | Build then `wrangler pages deploy dist` |

## Project layout

```
src/            React SPA (pages, components, context, lib)
worker/         Hono API: onboarding, invitations, members
shared/         country engine + module registry
supabase/       config.toml + SQL migrations (schema, RLS, triggers)
docs/           PLAN.md (phase tracker), MODULES.md (module contract), RESEARCH.md (market research)
```
