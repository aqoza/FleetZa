import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { Bindings } from "./index";

export type AppEnv = {
  Bindings: Bindings;
  Variables: {
    user: User;
    tenantId: string;
    role: string;
  };
};

/** Service-role client. Bypasses RLS — every query MUST scope by tenant explicitly. */
export function adminClient(env: Bindings): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Verifies the caller's Supabase access token and loads tenant/role claims. */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return c.json({ error: "Missing bearer token" }, 401);

  const admin = adminClient(c.env);
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return c.json({ error: "Invalid or expired token" }, 401);

  const meta = (data.user.app_metadata ?? {}) as Record<string, unknown>;
  const tenantId = typeof meta.tenant_id === "string" ? meta.tenant_id : "";
  const role = typeof meta.role === "string" ? meta.role : "";
  if (!tenantId) return c.json({ error: "No tenant membership" }, 403);

  c.set("user", data.user);
  c.set("tenantId", tenantId);
  c.set("role", role);
  await next();
});

export function requireAdminRole(c: Context<AppEnv>): Response | null {
  const role = c.get("role");
  if (role !== "owner" && role !== "admin") {
    return c.json({ error: "Requires owner or admin role" }, 403) as unknown as Response;
  }
  return null;
}

export const DEFAULT_INSPECTION_ITEMS = [
  { id: "exterior", label: "Exterior / body damage", section: "Exterior" },
  { id: "tires", label: "Tires & wheels", section: "Exterior" },
  { id: "lights", label: "Lights & signals", section: "Exterior" },
  { id: "mirrors", label: "Mirrors & glass", section: "Exterior" },
  { id: "engine_oil", label: "Engine oil level", section: "Engine" },
  { id: "coolant", label: "Coolant level", section: "Engine" },
  { id: "leaks", label: "Fluid leaks", section: "Engine" },
  { id: "brakes", label: "Brakes", section: "Safety" },
  { id: "horn", label: "Horn", section: "Safety" },
  { id: "seatbelts", label: "Seat belts", section: "Safety" },
  { id: "extinguisher", label: "Fire extinguisher", section: "Safety" },
  { id: "first_aid", label: "First aid kit", section: "Safety" },
  { id: "interior", label: "Interior condition", section: "Interior" },
  { id: "dashboard", label: "Dashboard warning lights", section: "Interior" },
];
