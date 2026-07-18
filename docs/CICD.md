# CI/CD — auto-deploy to Cloudflare

`.github/workflows/deploy.yml` runs on every push/PR to `main`:

- **Pull request → `main`:** install → `npm test` → `npm run build` (a required check; no deploy).
- **Merge into `main` (push):** the same, then `npx wrangler deploy`.

## Required GitHub Actions secrets

Add these in **GitHub → your repo → Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value | Sensitive? |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | *Create one — see below* | **Yes — secret** |
| `CLOUDFLARE_ACCOUNT_ID` | `e1ef5fefa821e2e7d57568291f632a1d` | No (identifier) |
| `VITE_SUPABASE_URL` | `https://ugfdexoaxladblafcrlc.supabase.co` | No (public) |
| `VITE_SUPABASE_ANON_KEY` | *your Supabase anon key* (the `eyJ…` value in `.env`) | No (public, shipped to browser) |

Only `CLOUDFLARE_API_TOKEN` is truly secret; the other three are non-sensitive but
live here so they stay out of the repo and in one place.

### Creating `CLOUDFLARE_API_TOKEN`

1. Go to <https://dash.cloudflare.com/profile/api-tokens> → **Create Token**.
2. Use the **"Edit Cloudflare Workers"** template.
3. Account Resources → your account; Zone Resources → All zones (or none for `*.workers.dev`).
4. **Create token**, copy it, and paste it as the `CLOUDFLARE_API_TOKEN` secret.

## What you do NOT need to add

The Worker runtime secrets — `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY` — are already stored on Cloudflare (`wrangler secret put`)
and **persist across deploys**. `wrangler deploy` never wipes them, so they do not go
into GitHub and are not re-set on each run. (If you ever rotate the service-role key,
update it once with `wrangler secret put SUPABASE_SERVICE_ROLE_KEY`.)

## Recommended: protect `main`

Settings → Branches → add a rule for `main`: require the **Deploy** check to pass and
require a PR before merging — so nothing reaches production without green tests.
