# CI/CD — Cloudflare Git integration (no GitHub Actions)

Deploy by connecting the GitHub repo directly to Cloudflare, so every push to `main`
auto-builds and deploys. No `.github/workflows` YAML is used.

## Important: this app is a Worker, not a static site

FleetManage is a **Cloudflare Worker with static assets** — the Hono API at `/api/*`
(`worker/index.ts`) and the SPA are served by the same Worker. So use **Workers Builds**
(Cloudflare's Git integration *for Workers*), NOT the classic **Pages** product.

- ✅ **Workers Builds** keeps the API working and deploys the exact same artifact as
  `wrangler deploy` (same worker `fleetmanage`, same URL).
- ⚠️ **Classic Cloudflare Pages** serves only static output; the `/api/*` routes would
  stop working unless the Hono API is rewritten as Pages Functions. Don't use it as-is.
  (If you specifically want Pages, that conversion is a separate task — ask for it.)

## Set it up (Cloudflare dashboard, ~2 minutes)

1. **Dashboard → Workers & Pages → the `fleetmanage` Worker → Settings → Build →
   Connect** (or **Import a repository**). Authorize GitHub and pick **`aqoza/FleetZa`**,
   production branch **`main`**.
2. **Build command:** `npm run build`
3. **Deploy command:** `npx wrangler deploy`  *(usually the default)*
4. **Build variables** (needed at build time — baked into the browser bundle):

   | Variable | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | `https://ugfdexoaxladblafcrlc.supabase.co` |
   | `VITE_SUPABASE_ANON_KEY` | your Supabase anon key (`eyJ…`, the value in `.env`) |

5. Save. Cloudflare now builds + deploys on every push to `main` (and gives preview
   builds for other branches / PRs).

## What you do NOT need (unlike the GitHub Actions route)

- **No `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`** — Cloudflare is deploying inside
  your own account, already authenticated.
- **No Worker runtime secrets in Git or the build** — `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY` are already stored on the Worker (`wrangler secret put`) and
  persist across deploys. `wrangler deploy` never wipes them. (Rotate the service-role key
  with `wrangler secret put SUPABASE_SERVICE_ROLE_KEY` if ever needed.)

## Prerequisite

The repo must contain the code first — finish the initial `git push` to
`https://github.com/aqoza/FleetZa` (complete the GitHub sign-in), then connect it in the
Cloudflare dashboard.
