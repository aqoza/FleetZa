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

## Local development

Prereqs: Node 20+, [Supabase CLI](https://supabase.com/docs/guides/cli), Docker (for local Supabase).

```bash
npm install

# 1. Start local Supabase (applies supabase/migrations automatically)
supabase start

# 2. Configure env — copy the keys `supabase start` prints
cp .env.example .env            # VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
cp .dev.vars.example .dev.vars  # SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

# 3. Generate worker types + run the app (SPA + Worker API together)
npm run cf-typegen -- --include-runtime=false
npm run dev
```

Open http://localhost:5173, create an organization on `/signup`, and you're in.

## Deployment

### 1. Supabase (database + auth)

```bash
supabase login
supabase projects create fleetmanage   # or use an existing project
supabase link --project-ref <PROJECT_REF>
supabase db push                        # applies supabase/migrations
```

Then in the Supabase dashboard → Authentication → URL Configuration, set **Site URL** to
your production URL (e.g. `https://fleetmanage.<your>.workers.dev`).

### 2. Cloudflare (worker + static assets)

```bash
npx wrangler login
npx wrangler secret put SUPABASE_URL               # https://<PROJECT_REF>.supabase.co
npx wrangler secret put SUPABASE_ANON_KEY
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY  # NEVER commit this

# Build-time public env for the SPA
echo VITE_SUPABASE_URL=https://<PROJECT_REF>.supabase.co > .env.production
echo VITE_SUPABASE_ANON_KEY=<ANON_KEY> >> .env.production

npm run deploy
```

`npm run deploy` builds the SPA + worker and runs `wrangler deploy`. Custom domains can be
attached in the Cloudflare dashboard (Workers → your worker → Domains & Routes).

### Secrets recap

| Where | Key | Sensitivity |
|---|---|---|
| `.env` / `.env.production` (built into SPA) | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | public |
| Worker secrets (`wrangler secret put`) | `SUPABASE_SERVICE_ROLE_KEY` (+ URL, anon) | **secret** |

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server with the Worker running in-process |
| `npm run build` | Typecheck (`tsc -b`) + production build (SPA + worker) |
| `npm run deploy` | Build then `wrangler deploy` |
| `npm run cf-typegen` | Regenerate `worker-configuration.d.ts` (add `-- --include-runtime=false` on Windows) |

## Project layout

```
src/            React SPA (pages, components, context, lib)
worker/         Hono API: onboarding, invitations, members
supabase/       config.toml + SQL migrations (schema, RLS, triggers)
docs/           PLAN.md (phase tracker), RESEARCH.md (market research)
```
