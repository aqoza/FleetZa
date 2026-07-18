// Cloudflare Pages Function: serves the whole `/api/*` surface.
// Pages routes every /api/* request here; the Hono app (basePath "/api")
// matches on the full path, so this stays a thin adapter over the existing
// worker. Runtime bindings (SUPABASE_*) come from the Pages project's
// environment variables / secrets.
import { handle } from "hono/cloudflare-pages";
import app from "../../worker/index";

export const onRequest = handle(app);
