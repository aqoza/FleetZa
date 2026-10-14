import { Hono } from "hono";
import { z } from "zod";
import { adminClient, type AppEnv } from "./lib";

/**
 * /api/portal/:token — PUBLIC customer portal (capability link), owned by the
 * `customer_portal` module. Same posture as the public quote link: no auth, an
 * unguessable uuid, the service role scoped to exactly what that token
 * unlocks. The token checks (active, not expired, module on), the per-section
 * flags and the field whitelist live in the SECURITY DEFINER RPCs
 * customer_portal_view / customer_portal_request (migration 20261008000028),
 * so this file only validates input and maps outcomes to HTTP.
 *
 * A revoked, expired or unknown link is indistinguishable: 404 either way.
 * Rate limiting: none today (as for /api/quotes).
 */
export const customerPortal = new Hono<AppEnv>();

const uuid = z.string().uuid();

customerPortal.get("/:token", async (c) => {
  const token = c.req.param("token");
  if (!uuid.safeParse(token).success) return c.json({ status: "not_found" }, 404);

  const { data, error } = await adminClient(c.env).rpc("customer_portal_view", { p_token: token });
  if (error) {
    console.error("[customer-portal.view]", error.message);
    return c.json({ error: "Internal error" }, 500);
  }
  if (!data) return c.json({ status: "not_found" }, 404);
  return c.json({ status: "ok", ...(data as Record<string, unknown>) });
});

const requestSchema = z.object({
  request_type: z.enum(["service", "inspection", "installation", "renewal", "support", "other"]),
  description: z.string().trim().min(1).max(2000),
  vehicle_id: uuid.nullish(),
  preferred_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
  contact_name: z.string().trim().max(120).nullish(),
  contact_phone: z.string().trim().max(40).nullish(),
});

customerPortal.post("/:token/requests", async (c) => {
  const token = c.req.param("token");
  if (!uuid.safeParse(token).success) return c.json({ error: "Not found" }, 404);
  const body = requestSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return c.json({ error: "invalid_request" }, 400);

  const { data, error } = await adminClient(c.env).rpc("customer_portal_request", {
    p_token: token,
    p_request_type: body.data.request_type,
    p_description: body.data.description,
    p_vehicle_id: body.data.vehicle_id ?? undefined,
    p_preferred_date: body.data.preferred_date ?? undefined,
    p_contact_name: body.data.contact_name || undefined,
    p_contact_phone: body.data.contact_phone || undefined,
  });
  if (error) {
    const code = error.message.split(":")[0];
    if (code === "PORTAL_LINK_INVALID") return c.json({ error: "Not found" }, 404);
    if (code === "PORTAL_REQUESTS_DISABLED") return c.json({ error: "requests_disabled" }, 403);
    if (code === "PORTAL_REQUEST_INVALID") return c.json({ error: "invalid_request" }, 400);
    console.error("[customer-portal.request]", error.message);
    return c.json({ error: "Internal error" }, 500);
  }
  return c.json({ ok: true, request: data });
});
