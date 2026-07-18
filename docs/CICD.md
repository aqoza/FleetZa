# Deployment — Cloudflare Pages (full-stack)

The app is a Cloudflare **Pages** project: the Vite SPA is served as static assets and
the Hono API runs as a **Pages Function** at `/api/*`.

- `dist/` — the built SPA (`index.html`, `assets/`, `_redirects` for SPA routing).
- `functions/api/[[route]].ts` — a thin adapter (`handle(app)`) over `worker/index.ts`,
  so the entire API is one Pages Function. Cloudflare bundles `functions/` automatically.
- `wrangler.jsonc` — Pages config (`pages_build_output_dir: "dist"`, `nodejs_compat`).

Connecting the GitHub repo (`aqoza/FleetZa`) means every push to `main` auto-builds and
deploys — no GitHub Actions YAML.

## Create the Pages project (dashboard)

**Workers & Pages → Create → Pages → Connect to Git →** pick `aqoza/FleetZa`, branch `main`.

| Setting | Value |
|---|---|
| Framework preset | React (Vite) |
| Build command | `npm run build` |
| Build output directory | `dist` |

## Environment variables & secrets (Pages → Settings → Variables and Secrets)

Set for **Production** (and Preview if you want branch previews):

**Build-time** (baked into the browser bundle) — type *Plaintext*:
| Name | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://ugfdexoaxladblafcrlc.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | your Supabase anon key (`eyJ…`) |

**Runtime** (read by the `/api/*` Function) — type *Secret*:
| Name | Value |
|---|---|
| `SUPABASE_URL` | `https://ugfdexoaxladblafcrlc.supabase.co` |
| `SUPABASE_ANON_KEY` | your Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | your Supabase **service-role** key (keep secret) |

> Unlike the old Worker, these runtime secrets live on the **Pages** project now, so they
> must be added here (they were not carried over from the Worker deployment).

`nodejs_compat` is already set in `wrangler.jsonc`; if the dashboard asks, ensure the
Functions compatibility flags include `nodejs_compat`.

## After first deploy

- New URL: **`fleetza.pages.dev`** (attach a custom domain under the project's Domains tab).
- In **Supabase → Authentication → URL Configuration**, set **Site URL** to the Pages URL.
- The old Worker at `fleetmanage.aqozatechnologies.workers.dev` is now superseded — you can
  delete it once the Pages URL is verified.

## Local development (unchanged)

Two terminals: `npm run dev:api` (Node-hosts the same Hono app on :8788) and
`npm run dev` (Vite SPA on :5173, proxies `/api` → :8788).

Manual deploy from your machine: `npm run deploy` (`wrangler pages deploy dist`).
