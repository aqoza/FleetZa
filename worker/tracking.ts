import { Hono } from "hono";
import { z } from "zod";
import { firstName } from "../shared/deliveries";
import { adminClient, type AppEnv } from "./lib";

/**
 * /api/track/:token — PUBLIC delivery tracking (capability link), owned by the
 * `logistics_delivery` module. Same posture as /api/verify and /api/quotes:
 * looked up by an unguessable uuid, no auth, the service role scoped to the
 * one row behind that token, and only whitelisted fields come back: status,
 * the recipient's first name, city, last update, delivered time, the doc
 * number and the company name. Address, phone, cash on delivery and proof of
 * delivery never leave the server.
 *
 * A tenant that has switched the module off reads exactly like a bad token.
 */
export const tracking = new Hono<AppEnv>();

interface DeliveryRow {
  tenant_id: string;
  doc_number: string | null;
  status: string;
  recipient_name: string;
  city: string | null;
  updated_at: string;
  delivered_at: string | null;
}

tracking.get("/:token", async (c) => {
  c.header("Cache-Control", "no-store");
  const token = c.req.param("token");
  if (!z.string().uuid().safeParse(token).success) {
    return c.json({ status: "not_found" }, 404);
  }

  const admin = adminClient(c.env);
  const { data } = await admin
    .from("deliveries")
    .select("tenant_id, doc_number, status, recipient_name, city, updated_at, delivered_at")
    .eq("tracking_token", token)
    .maybeSingle();
  const delivery = (data as unknown as DeliveryRow | null) ?? null;
  if (!delivery) return c.json({ status: "not_found" }, 404);

  const [moduleRes, tenantRes] = await Promise.all([
    admin
      .from("tenant_modules")
      .select("enabled")
      .eq("tenant_id", delivery.tenant_id)
      .eq("module_id", "logistics_delivery")
      .maybeSingle(),
    admin.from("tenants").select("name").eq("id", delivery.tenant_id).maybeSingle(),
  ]);
  if (!(moduleRes.data as { enabled: boolean } | null)?.enabled) {
    return c.json({ status: "not_found" }, 404);
  }
  const tenant = tenantRes.data as unknown as { name: string } | null;

  return c.json({
    status: delivery.status,
    docNumber: delivery.doc_number,
    recipientFirstName: firstName(delivery.recipient_name),
    city: delivery.city,
    updatedAt: delivery.updated_at,
    deliveredAt: delivery.delivered_at,
    companyName: tenant?.name ?? null,
  });
});
