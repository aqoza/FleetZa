import { Hono } from "hono";
import { z } from "zod";
import { adminClient, type AppEnv } from "./lib";

/**
 * /api/vendor-portal/:token — PUBLIC vendor portal (capability link), owned by
 * the `vendor_portal` module. Same posture as the public quote link: no auth,
 * an unguessable uuid, the service role scoped to exactly what that token
 * unlocks. The token checks (active, not expired, module on) and the field
 * whitelist live in the SECURITY DEFINER RPCs vendor_portal_view /
 * vendor_portal_acknowledge (migration 20261008000012), so this file only
 * validates input and maps outcomes to HTTP.
 *
 * A revoked, expired or unknown link is indistinguishable: 404 either way.
 * Rate limiting: none today (as for /api/quotes).
 */
export const vendorPortal = new Hono<AppEnv>();

const uuid = z.string().uuid();

vendorPortal.get("/:token", async (c) => {
  const token = c.req.param("token");
  if (!uuid.safeParse(token).success) return c.json({ status: "not_found" }, 404);

  const { data, error } = await adminClient(c.env).rpc("vendor_portal_view", { p_token: token });
  if (error) {
    console.error("[vendor-portal.view]", error.message);
    return c.json({ error: "Internal error" }, 500);
  }
  if (!data) return c.json({ status: "not_found" }, 404);
  return c.json({ status: "ok", ...(data as Record<string, unknown>) });
});

const ackSchema = z.object({
  expected_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
  note: z.string().trim().max(2000).nullish(),
});

vendorPortal.post("/:token/po/:poId/acknowledge", async (c) => {
  const token = c.req.param("token");
  const poId = c.req.param("poId");
  if (!uuid.safeParse(token).success || !uuid.safeParse(poId).success) {
    return c.json({ error: "Not found" }, 404);
  }
  const body = ackSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return c.json({ error: "Invalid input" }, 400);

  const { data, error } = await adminClient(c.env).rpc("vendor_portal_acknowledge", {
    p_token: token,
    p_po: poId,
    p_expected_date: body.data.expected_date ?? null,
    p_note: body.data.note || null,
  });
  if (error) {
    const code = error.message.split(":")[0];
    if (code === "VENDOR_LINK_INVALID" || code === "PO_NOT_FOUND") return c.json({ error: "Not found" }, 404);
    if (code === "PO_NOT_ACKNOWLEDGEABLE") return c.json({ error: "already_acknowledged" }, 409);
    if (code === "INVALID_EXPECTED_DATE") return c.json({ error: "invalid_expected_date" }, 400);
    console.error("[vendor-portal.acknowledge]", error.message);
    return c.json({ error: "Internal error" }, 500);
  }
  return c.json({ ok: true, order: data });
});
