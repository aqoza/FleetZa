import { Hono } from "hono";
import { z } from "zod";
import { requireApiKey, type ApiEnv } from "../apiKey";
import { moduleEnabled, resolveVehicles } from "./shared";

/**
 * POST /api/v1/positions — batch GPS fixes (scope telematics:write), owned by
 * the `gps_tracking` module (migration 20261008000014).
 *
 * Body: an array (≤ 500) of { vehicle, recorded_at, lat, lng, speed_kmh?,
 * heading?, altitude_m?, odometer_km?, ignition? }. `vehicle` is the vehicle's
 * id, plate, VIN or fleet number, resolved inside the key's tenant only.
 * A fix already stored for that vehicle and time is skipped (idempotent
 * retries). Unknown vehicles and invalid items are rejected per item; the
 * rest are stored. The database triggers then refresh the live map, raise the
 * odometer and record geofence crossings.
 *
 * 200 { accepted, duplicates, rejected: [{ index, reason }] }
 */
export const positionsApi = new Hono<ApiEnv>();

const MAX_BATCH = 500;

const fixSchema = z.object({
  vehicle: z.string().trim().min(1).max(100),
  recorded_at: z.string().datetime({ offset: true }),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  speed_kmh: z.number().min(0).max(400).nullish(),
  heading: z.number().int().min(0).max(359).nullish(),
  altitude_m: z.number().min(-500).max(9000).nullish(),
  odometer_km: z.number().min(0).max(99_999_999).nullish(),
  ignition: z.boolean().nullish(),
});

type Rejection = { index: number; reason: "invalid" | "unknown_vehicle" | "time_out_of_range" };

positionsApi.post("/", requireApiKey("telematics:write"), async (c) => {
  const tenantId = c.get("tenantId");
  const admin = c.get("admin");
  if (!(await moduleEnabled(admin, tenantId, "gps_tracking"))) {
    return c.json({ error: "module_disabled", module: "gps_tracking" }, 403);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  if (!Array.isArray(body)) return c.json({ error: "expected_array" }, 400);
  if (body.length === 0) return c.json({ accepted: 0, duplicates: 0, rejected: [] });
  if (body.length > MAX_BATCH) return c.json({ error: "batch_too_large", max: MAX_BATCH }, 413);

  const rejected: Rejection[] = [];
  const valid: Array<{ index: number; fix: z.infer<typeof fixSchema> }> = [];
  const latest = Date.now() + 10 * 60_000;
  body.forEach((item, index) => {
    const parsed = fixSchema.safeParse(item);
    if (!parsed.success) return rejected.push({ index, reason: "invalid" });
    const t = Date.parse(parsed.data.recorded_at);
    if (t > latest || t < Date.parse("2000-01-01T00:00:00Z")) return rejected.push({ index, reason: "time_out_of_range" });
    valid.push({ index, fix: parsed.data });
  });

  const vehicles = await resolveVehicles(admin, tenantId, valid.map((v) => v.fix.vehicle));
  if (vehicles === null) return c.json({ error: "Internal error" }, 500);

  const rows = [];
  for (const { index, fix } of valid) {
    const vehicleId = vehicles.get(fix.vehicle);
    if (!vehicleId) {
      rejected.push({ index, reason: "unknown_vehicle" });
      continue;
    }
    rows.push({
      tenant_id: tenantId,
      vehicle_id: vehicleId,
      recorded_at: new Date(fix.recorded_at).toISOString(),
      lat: fix.lat,
      lng: fix.lng,
      speed_kmh: fix.speed_kmh ?? null,
      heading: fix.heading ?? null,
      altitude_m: fix.altitude_m ?? null,
      odometer_km: fix.odometer_km ?? null,
      ignition: fix.ignition ?? null,
      source: "api",
    });
  }

  let accepted = 0;
  if (rows.length > 0) {
    const { data, error } = await admin
      .from("gps_positions")
      .upsert(rows, { onConflict: "vehicle_id,recorded_at", ignoreDuplicates: true })
      .select("id");
    if (error) {
      console.error("[v1.positions]", error.message);
      return c.json({ error: "Internal error" }, 500);
    }
    accepted = (data ?? []).length;
  }

  rejected.sort((a, b) => a.index - b.index);
  return c.json({ accepted, duplicates: rows.length - accepted, rejected });
});
