/**
 * Node host for the Cloudflare Worker API (workerd-free local dev).
 * Loads bindings from .dev.vars and serves the same Hono app on :8788.
 * Run: npm run dev:api  (pair with: npm run dev:node)
 */
import { readFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import app from "../worker/index";

function loadDevVars(): Record<string, string> {
  const env: Record<string, string> = {};
  try {
    for (const line of readFileSync(".dev.vars", "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !line.trim().startsWith("#")) env[m[1]] = m[2];
    }
  } catch {
    console.warn("No .dev.vars found — API will run without Supabase credentials.");
  }
  return env;
}

const bindings = loadDevVars();

serve(
  {
    fetch: (req) => app.fetch(req, bindings),
    port: 8788,
  },
  (info) => console.log(`FleetManage API (Node host) on http://127.0.0.1:${info.port}/api/health`),
);
