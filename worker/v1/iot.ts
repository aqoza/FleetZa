import { Hono } from "hono";
import { z } from "zod";
import { requireApiKey, type ApiEnv } from "../apiKey";
import { moduleEnabled } from "./shared";

/**
 * POST /api/v1/iot/readings — batch sensor readings (scope iot:write), owned by
 * the `iot_devices` module (migration 20261008000016).
 *
 * Body: one reading or an array (≤ 500) of { device, recorded_at?, metric,
 * value, unit? }. `device` is the device's serial (or id), resolved inside the
 * key's tenant only; `recorded_at` defaults to now; `metric` is lowercase
 * snake case (temperature, fuel_level, tire_pressure_fl…). A reading already
 * stored for that device, metric and time is skipped (idempotent retries).
 * Unknown devices and invalid items are rejected per item; the rest are
 * stored, and the database checks them against the alert rules.
 *
 * 200 { accepted, duplicates, rejected: [{ index, reason }] }
 */
export const iotApi = new Hono<ApiEnv>();

const MAX_BATCH = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const readingSchema = z.object({
  device: z.string().trim().min(1).max(100),
  recorded_at: z.string().datetime({ offset: true }).optional(),
  metric: z.string().regex(/^[a-z][a-z0-9_]{0,49}$/),
  value: z.number().finite().min(-1e12).max(1e12),
  unit: z.string().trim().max(20).nullish(),
});

type Rejection = { index: number; reason: "invalid" | "unknown_device" | "time_out_of_range" };

iotApi.post("/readings", requireApiKey("iot:write"), async (c) => {
  const tenantId = c.get("tenantId");
  const admin = c.get("admin");
  if (!(await moduleEnabled(admin, tenantId, "iot_devices"))) {
    return c.json({ error: "module_disabled", module: "iot_devices" }, 403);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  const items = Array.isArray(body) ? body : [body];
  if (items.length === 0) return c.json({ accepted: 0, duplicates: 0, rejected: [] });
  if (items.length > MAX_BATCH) return c.json({ error: "batch_too_large", max: MAX_BATCH }, 413);

  const rejected: Rejection[] = [];
  const valid: Array<{ index: number; r: z.infer<typeof readingSchema>; at: string }> = [];
  const now = Date.now();
  items.forEach((item, index) => {
    const parsed = readingSchema.safeParse(item);
    if (!parsed.success) return rejected.push({ index, reason: "invalid" });
    const t = parsed.data.recorded_at ? Date.parse(parsed.data.recorded_at) : now;
    if (t > now + 10 * 60_000 || t < Date.parse("2000-01-01T00:00:00Z")) {
      return rejected.push({ index, reason: "time_out_of_range" });
    }
    valid.push({ index, r: parsed.data, at: new Date(t).toISOString() });
  });

  // Resolve devices by serial (exact) or id, inside this tenant only.
  const keys = [...new Set(valid.map((v) => v.r.device))];
  const ids = keys.filter((k) => UUID.test(k));
  const devices = new Map<string, string>();
  const queries = [
    keys.length ? admin.from("iot_devices").select("id, serial").eq("tenant_id", tenantId).in("serial", keys) : null,
    ids.length ? admin.from("iot_devices").select("id, serial").eq("tenant_id", tenantId).in("id", ids) : null,
  ].filter((q) => q !== null);
  for (const res of await Promise.all(queries)) {
    if (res.error) {
      console.error("[v1.iot]", res.error.message);
      return c.json({ error: "Internal error" }, 500);
    }
    for (const d of (res.data ?? []) as Array<{ id: string; serial: string }>) {
      devices.set(d.serial, d.id);
      devices.set(d.id, d.id);
    }
  }

  const rows = [];
  for (const { index, r, at } of valid) {
    const deviceId = devices.get(r.device);
    if (!deviceId) {
      rejected.push({ index, reason: "unknown_device" });
      continue;
    }
    rows.push({
      tenant_id: tenantId,
      device_id: deviceId,
      recorded_at: at,
      metric: r.metric,
      value: r.value,
      unit: r.unit || null,
      source: "api",
    });
  }
  // Oldest first, so the newest reading per metric is the one checked against the rules last.
  rows.sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));

  let accepted = 0;
  if (rows.length > 0) {
    const { data, error } = await admin
      .from("iot_readings")
      .upsert(rows, { onConflict: "device_id,metric,recorded_at", ignoreDuplicates: true })
      .select("id");
    if (error) {
      console.error("[v1.iot]", error.message);
      return c.json({ error: "Internal error" }, 500);
    }
    accepted = (data ?? []).length;
  }

  rejected.sort((a, b) => a.index - b.index);
  return c.json({ accepted, duplicates: rows.length - accepted, rejected });
});
