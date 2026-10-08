import { Hono } from "hono";
import { requireApiKey, type ApiEnv } from "../apiKey";
import { moduleEnabled } from "./shared";

/**
 * GET /api/v1/vehicles — the key's tenant's vehicles (scope vehicles:read),
 * owned by the `gps_tracking` module, so an integration can map its own
 * device ids to ours. Paged: ?page=0.. (500 per page), ordered by name.
 *
 * 200 { data: [{ id, name, license_plate, vin, fleet_number, status }], page, has_more }
 */
export const vehiclesApi = new Hono<ApiEnv>();

const PAGE_SIZE = 500;

vehiclesApi.get("/", requireApiKey("vehicles:read"), async (c) => {
  const tenantId = c.get("tenantId");
  const admin = c.get("admin");
  if (!(await moduleEnabled(admin, tenantId, "gps_tracking"))) {
    return c.json({ error: "module_disabled", module: "gps_tracking" }, 403);
  }
  const page = Math.max(0, Math.min(10_000, Number.parseInt(c.req.query("page") ?? "0", 10) || 0));
  const from = page * PAGE_SIZE;
  const { data, error } = await admin
    .from("vehicles")
    .select("id, name, license_plate, vin, fleet_number, status")
    .eq("tenant_id", tenantId)
    .order("name")
    .order("id")
    .range(from, from + PAGE_SIZE); // one extra row tells us whether another page exists
  if (error) {
    console.error("[v1.vehicles]", error.message);
    return c.json({ error: "Internal error" }, 500);
  }
  const rows = data ?? [];
  return c.json({ data: rows.slice(0, PAGE_SIZE), page, has_more: rows.length > PAGE_SIZE });
});
