import { Hono } from "hono";
import { z } from "zod";
import { requireApiKey, type ApiEnv } from "../apiKey";
import { DRIVING_EVENT_TYPES, SEVERITIES } from "../../shared/driverScore";
import { moduleEnabled, resolveVehicles } from "./shared";

/**
 * POST /api/v1/driving-events — safety events (scope driver_events:write),
 * owned by the `driver_behavior` module (migration 20261008000015).
 *
 * Body: one event or an array (≤ 500) of { vehicle | vehicle_id, occurred_at,
 * event_type, severity?, speed_kmh?, speed_limit_kmh?, duration_s?, lat?,
 * lng?, driver_id?, notes? }. The vehicle is its id, plate, VIN or fleet
 * number inside the key's tenant; without driver_id the database takes the
 * vehicle's assigned driver at that moment. Invalid items and unknown
 * vehicles or drivers are rejected per item; the rest are stored.
 *
 * 200 { accepted, rejected: [{ index, reason }] }
 */
export const drivingEventsApi = new Hono<ApiEnv>();

const MAX_BATCH = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const eventSchema = z
  .object({
    vehicle: z.string().trim().min(1).max(100).optional(),
    vehicle_id: z.string().trim().min(1).max(100).optional(),
    driver_id: z.string().regex(UUID).nullish(),
    occurred_at: z.string().datetime({ offset: true }),
    event_type: z.enum(DRIVING_EVENT_TYPES),
    severity: z.enum(SEVERITIES).default("medium"),
    speed_kmh: z.number().min(0).max(400).nullish(),
    speed_limit_kmh: z.number().min(0).max(400).nullish(),
    duration_s: z.number().int().min(0).max(86_400).nullish(),
    lat: z.number().min(-90).max(90).nullish(),
    lng: z.number().min(-180).max(180).nullish(),
    notes: z.string().trim().max(2000).nullish(),
  })
  .refine((v) => !!(v.vehicle ?? v.vehicle_id), { message: "vehicle required" });

type Rejection = { index: number; reason: "invalid" | "unknown_vehicle" | "unknown_driver" | "time_out_of_range" };

drivingEventsApi.post("/", requireApiKey("driver_events:write"), async (c) => {
  const tenantId = c.get("tenantId");
  const admin = c.get("admin");
  if (!(await moduleEnabled(admin, tenantId, "driver_behavior"))) {
    return c.json({ error: "module_disabled", module: "driver_behavior" }, 403);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  const items = Array.isArray(body) ? body : [body];
  if (items.length === 0) return c.json({ accepted: 0, rejected: [] });
  if (items.length > MAX_BATCH) return c.json({ error: "batch_too_large", max: MAX_BATCH }, 413);

  const rejected: Rejection[] = [];
  const valid: Array<{ index: number; ev: z.infer<typeof eventSchema>; vehicle: string }> = [];
  const latest = Date.now() + 10 * 60_000;
  items.forEach((item, index) => {
    const parsed = eventSchema.safeParse(item);
    if (!parsed.success) return rejected.push({ index, reason: "invalid" });
    const t = Date.parse(parsed.data.occurred_at);
    if (t > latest || t < Date.parse("2000-01-01T00:00:00Z")) return rejected.push({ index, reason: "time_out_of_range" });
    valid.push({ index, ev: parsed.data, vehicle: (parsed.data.vehicle ?? parsed.data.vehicle_id)! });
  });

  const vehicles = await resolveVehicles(admin, tenantId, valid.map((v) => v.vehicle));
  if (vehicles === null) return c.json({ error: "Internal error" }, 500);

  // Drivers named explicitly must belong to the key's tenant.
  const driverIds = [...new Set(valid.map((v) => v.ev.driver_id).filter((d): d is string => !!d))];
  let knownDrivers = new Set<string>();
  if (driverIds.length) {
    const { data, error } = await admin.from("drivers").select("id").eq("tenant_id", tenantId).in("id", driverIds);
    if (error) {
      console.error("[v1.driving-events.drivers]", error.message);
      return c.json({ error: "Internal error" }, 500);
    }
    knownDrivers = new Set((data ?? []).map((d: { id: string }) => d.id));
  }

  const rows = [];
  for (const { index, ev, vehicle } of valid) {
    const vehicleId = vehicles.get(vehicle);
    if (!vehicleId) {
      rejected.push({ index, reason: "unknown_vehicle" });
      continue;
    }
    if (ev.driver_id && !knownDrivers.has(ev.driver_id)) {
      rejected.push({ index, reason: "unknown_driver" });
      continue;
    }
    rows.push({
      tenant_id: tenantId,
      vehicle_id: vehicleId,
      driver_id: ev.driver_id ?? null,
      occurred_at: new Date(ev.occurred_at).toISOString(),
      event_type: ev.event_type,
      severity: ev.severity,
      speed_kmh: ev.speed_kmh ?? null,
      speed_limit_kmh: ev.speed_limit_kmh ?? null,
      duration_s: ev.duration_s ?? null,
      lat: ev.lat ?? null,
      lng: ev.lng ?? null,
      notes: ev.notes ?? null,
      source: "api",
    });
  }

  let accepted = 0;
  if (rows.length > 0) {
    const { data, error } = await admin.from("driving_events").insert(rows).select("id");
    if (error) {
      console.error("[v1.driving-events]", error.message);
      return c.json({ error: "Internal error" }, 500);
    }
    accepted = (data ?? []).length;
  }
  rejected.sort((a, b) => a.index - b.index);
  return c.json({ accepted, rejected });
});
