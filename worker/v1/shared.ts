import type { SupabaseClient } from "@supabase/supabase-js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The module that owns an endpoint must be on for the key's tenant too. */
export async function moduleEnabled(admin: SupabaseClient, tenantId: string, moduleId: string): Promise<boolean> {
  const { data } = await admin
    .from("tenant_modules")
    .select("enabled")
    .eq("tenant_id", tenantId)
    .eq("module_id", moduleId)
    .maybeSingle();
  return Boolean((data as { enabled: boolean } | null)?.enabled);
}

interface VehicleKeys {
  id: string;
  license_plate: string | null;
  vin: string | null;
  fleet_number: string | null;
}

/**
 * Map each identifier (vehicle id, plate, VIN or fleet number) to a vehicle
 * id inside `tenantId`. Plates and fleet numbers match exactly or upper-cased;
 * an identifier that matches more than one vehicle is left unresolved rather
 * than guessed. Returns null on a query error.
 */
export async function resolveVehicles(
  admin: SupabaseClient,
  tenantId: string,
  identifiers: string[],
): Promise<Map<string, string> | null> {
  const unique = [...new Set(identifiers)];
  const out = new Map<string, string>();
  if (unique.length === 0) return out;
  const ids = unique.filter((v) => UUID.test(v));
  const codes = [...new Set(unique.filter((v) => !UUID.test(v)).flatMap((v) => [v, v.toUpperCase()]))];

  const found: VehicleKeys[] = [];
  const cols = "id, license_plate, vin, fleet_number";
  const queries = [
    ids.length ? admin.from("vehicles").select(cols).eq("tenant_id", tenantId).in("id", ids) : null,
    ...(codes.length
      ? (["license_plate", "vin", "fleet_number"] as const).map((col) =>
          admin.from("vehicles").select(cols).eq("tenant_id", tenantId).in(col, codes).limit(2000),
        )
      : []),
  ].filter((q) => q !== null);
  for (const res of await Promise.all(queries)) {
    if (res.error) {
      console.error("[v1.resolveVehicles]", res.error.message);
      return null;
    }
    found.push(...((res.data ?? []) as VehicleKeys[]));
  }

  const byKey = new Map<string, Set<string>>();
  const add = (key: string | null, id: string) => {
    if (!key) return;
    const set = byKey.get(key) ?? new Set<string>();
    set.add(id);
    byKey.set(key, set);
  };
  for (const v of found) {
    add(v.id, v.id);
    for (const k of [v.license_plate, v.vin, v.fleet_number]) {
      add(k, v.id);
      add(k?.toUpperCase() ?? null, v.id);
    }
  }
  for (const ident of unique) {
    const hits = byKey.get(ident) ?? byKey.get(ident.toUpperCase());
    if (hits && hits.size === 1) out.set(ident, [...hits][0]);
  }
  return out;
}
