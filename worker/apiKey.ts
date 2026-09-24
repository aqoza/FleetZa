import { createMiddleware } from "hono/factory";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminClient } from "./lib";
import type { Bindings } from "./index";

/**
 * API-key authentication for the public REST API (`/api/v1/*`).
 *
 * Keys are minted by `public.create_api_key` (integrations module): the
 * plaintext is shown once, only its SHA-256 is stored. A request presents the
 * key as `Authorization: Bearer fm_…` (or `X-API-Key`); we hash it, look the
 * row up with the service role, and pin the tenant from the key — never from
 * the request. The service role has no JWT tenant, so every write downstream
 * MUST set `tenant_id` explicitly to `c.get("tenantId")`.
 */

export type ApiScope =
  | "telematics:write"
  | "iot:write"
  | "driver_events:write"
  | "vehicles:read"
  | "deliveries:write";

export type ApiEnv = {
  Bindings: Bindings;
  Variables: {
    tenantId: string;
    apiKeyId: string;
    admin: SupabaseClient;
  };
};

interface ApiKeyRow {
  id: string;
  tenant_id: string;
  scopes: string[] | null;
  active: boolean;
  expires_at: string | null;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function presentedKey(authorization: string | undefined, header: string | undefined): string {
  if (header) return header.trim();
  if (authorization?.startsWith("Bearer ")) return authorization.slice(7).trim();
  return "";
}

/** Tenant-scoped check that the integrations module is on for the key's tenant. */
async function integrationsEnabled(admin: SupabaseClient, tenantId: string): Promise<boolean> {
  const { data } = await admin
    .from("tenant_modules")
    .select("enabled")
    .eq("tenant_id", tenantId)
    .eq("module_id", "integrations")
    .maybeSingle();
  return Boolean((data as { enabled: boolean } | null)?.enabled);
}

/**
 * Require a valid, active, unexpired key carrying `scope`, for a tenant that
 * has the integrations module enabled (a disabled module must not keep
 * accepting data). Failures are deliberately uniform: 401 for anything wrong
 * with the key, 403 only for a valid key that lacks the scope.
 */
export function requireApiKey(scope: ApiScope) {
  return createMiddleware<ApiEnv>(async (c, next) => {
    const key = presentedKey(c.req.header("Authorization"), c.req.header("X-API-Key"));
    if (!key.startsWith("fm_") || key.length < 20 || key.length > 200) {
      return c.json({ error: "invalid_api_key" }, 401);
    }

    const admin = adminClient(c.env);
    const hash = await sha256Hex(key);
    const { data } = await admin
      .from("api_keys")
      .select("id, tenant_id, scopes, active, expires_at")
      .eq("key_hash", hash)
      .maybeSingle();
    const row = data as ApiKeyRow | null;

    const expired = row?.expires_at ? new Date(row.expires_at).getTime() <= Date.now() : false;
    if (!row || !row.active || expired || !(await integrationsEnabled(admin, row.tenant_id))) {
      return c.json({ error: "invalid_api_key" }, 401);
    }
    if (!(row.scopes ?? []).includes(scope)) {
      return c.json({ error: "insufficient_scope", required: scope }, 403);
    }

    // Best-effort usage stamp; never fail the request over it. Awaited because
    // a Pages Function may be torn down once the response is returned.
    try {
      await admin.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", row.id);
    } catch {
      /* usage stamp is informational */
    }

    c.set("tenantId", row.tenant_id);
    c.set("apiKeyId", row.id);
    c.set("admin", admin);
    await next();
  });
}
