# FleetManage — working agreements for Claude

Multi-tenant fleet + speed-limiter-compliance SaaS becoming a modular enterprise
platform (Odoo-style). React 19 + Vite SPA · Hono API (worker/, served as a Cloudflare
Pages Function) · Supabase Postgres with RLS tenant isolation · typed en/ar i18n.

## Read before changing things

- **[docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md)** — tokens, primitives, chart rules.
  Every UI change follows it; no raw `bg-white`/`text-slate-*` in new code.
- **[docs/MODULES.md](docs/MODULES.md)** — the end-to-end contract for building a module
  (registry → i18n → DB/RLS → page → nav → gated route → tests).
- **[docs/ARCHITECTURE_REVIEW.md](docs/ARCHITECTURE_REVIEW.md)** — the platform plan:
  phased roadmap, DB refactoring waves, verified problem list. Check it before
  architectural decisions; Phases 1–2 are shipped.
- docs/I18N.md (RTL + translation contract) · docs/SPEED_LIMITERS.md (SL domain) ·
  docs/CICD.md (deploy).

## Hard rules

- **Data layer**: all client CRUD through `src/lib/db.ts` (`listRows`, `listPage`,
  `getRow`, `insertRow`, `updateRow`, `deleteRow`, `wrapDbError`, `sanitizeSearch`).
  Table names are compile-checked against the **generated**
  `src/lib/database.types.ts` — regenerate it (Supabase MCP
  `generate_typescript_types`) after every migration. Never send `tenant_id` from the
  client. Lists paginate (`listPage` + `<Pagination>`) with server-side filters/search;
  no unbounded `select *`.
- **Migrations**: additive-only, timestamped in `supabase/migrations/`, applied via the
  Supabase MCP `apply_migration` (project `ugfdexoaxladblafcrlc`) AND mirrored to the
  repo file, then security advisors + regenerate types. New business tables get: RLS
  loop (members read / managers write), `created_by/updated_by` via `app.stamp_actor`,
  audit trigger if master data or a document, numbering via
  `app.next_doc_number(tenant_id, doc_type)` — never `max()+1`.
- **Modules**: new features are modules — registry entry in `shared/modules.ts`
  (declare *data* dependencies in `requires`), `<ModuleGate>` routes, nav item with a
  `section`, per-module i18n namespace (en + ar in the same commit, compile-enforced).
- **i18n/RTL**: every string through `t()`; logical Tailwind utilities only; charts in
  `dir="ltr"`; icons that point get `rtl:-scale-x-100`.
- **Errors**: user-facing DB errors go through `wrapDbError` (localized `errors.*`
  keys); raised exceptions from triggers/RPCs use SCREAMING_SNAKE codes mapped there.

## Commands

`npm run dev` (SPA :5173) + `npm run dev:api` (Hono :8788, restart on worker/ edits) ·
`npm test` · `npm run build` (tsc gates) · deploy = commit → push to `main`
(Cloudflare Pages auto-deploys fleetza.pages.dev).

## Verification bar

`tsc -b` + `npm test` green, then drive the changed flow in the browser (demo tenant:
`demo@fleetmanage.test`) before commit. DB changes: run the Supabase security advisors.
The public QR endpoint `/api/verify/:certUuid` must never break — printed certificates
link to it.
