// Built-in base fixtures: the demo tenant, its owner profile, every module
// enabled, and a little master data. Extra fixtures (--fixtures) merge over
// these per table key.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const TENANT_ID = "170d2d86-5c22-4bcb-9d74-420c879419b2";
export const USER_ID = "129bbbae-fdfc-4d21-8a86-8949fec2403b";
export const USER_EMAIL = "demo@fleetmanage.test";

/** Every module registered in shared/modules.ts via m("<id>", "<category>", "<status>", …). */
export function moduleDefs(repoRoot) {
  const src = readFileSync(join(repoRoot, "shared/modules.ts"), "utf8");
  const seen = new Map();
  for (const x of src.matchAll(/\bm\(\s*["']([a-z0-9_]+)["']\s*,\s*["']([a-z0-9_]+)["']\s*,\s*["']([a-z_]+)["']/g)) {
    if (!seen.has(x[1])) seen.set(x[1], { id: x[1], category: x[2], status: x[3] });
  }
  return [...seen.values()];
}

/** --modules all (default) | available | comma list of ids. */
export function moduleIds(repoRoot, which = "all") {
  const defs = moduleDefs(repoRoot);
  if (which === "all") return defs.map((d) => d.id);
  if (which === "available") return defs.filter((d) => d.status === "available").map((d) => d.id);
  const want = which.split(",").map((s) => s.trim()).filter(Boolean);
  const unknown = want.filter((w) => !defs.some((d) => d.id === w));
  if (unknown.length) throw new Error(`--modules: unknown module id(s) ${unknown.join(", ")}`);
  return want;
}

const CUST_1 = "c1a0e5f2-3b4d-4e6f-8a9b-0c1d2e3f4a51";
const CUST_2 = "c1a0e5f2-3b4d-4e6f-8a9b-0c1d2e3f4a52";
const VEH_1 = "a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d01";
const VEH_2 = "a7e1c0de-0002-4b2c-9d3e-4f5a6b7c8d02";
const VEH_3 = "a7e1c0de-0003-4b2c-9d3e-4f5a6b7c8d03";
const DRV_1 = "d0c0ffee-0001-4a1b-8c2d-3e4f5a6b7c01";
const DRV_2 = "d0c0ffee-0002-4a1b-8c2d-3e4f5a6b7c02";

export const IDS = { CUST_1, CUST_2, VEH_1, VEH_2, VEH_3, DRV_1, DRV_2 };

export function baseFixtures({ repoRoot, role = "owner", language = "en", modules = "all" }) {
  const created = "2026-03-02T09:15:00.000Z";
  const updated = "2026-09-20T14:30:00.000Z";
  const actor = { created_by: USER_ID, updated_by: USER_ID };

  const tenant = {
    id: TENANT_ID,
    name: "Acme Logistics",
    name_ar: "أكمي للخدمات اللوجستية",
    archetype: "service_provider",
    country: "US",
    currency: "USD",
    currency_decimals: 2,
    distance_unit: "km",
    volume_unit: "L",
    timezone: "UTC",
    tax_registration_number: "US-TRN-100200300",
    address: "1200 Harbor Blvd, Suite 4",
    city: "Oakland",
    city_ar: "أوكلاند",
    postal_code: "94607",
    po_box: null,
    phone: "+1 510 555 0142",
    phone_secondary: null,
    email: "ops@acme-logistics.test",
    website: "acme-logistics.test",
    cr_number: "CR-4471902",
    services_line: "Speed limiter installation · Fleet compliance",
    services_line_ar: "تركيب محددات السرعة · امتثال الأساطيل",
    applicable_standard: "GSO-1026/2002",
    signatory_name: "Demo Owner",
    signatory_name_ar: null,
    signature_url: null,
    stamp_url: null,
    stamp_scale: 100,
    created_at: created,
    updated_at: updated,
  };

  const profile = {
    id: USER_ID,
    tenant_id: TENANT_ID,
    email: USER_EMAIL,
    full_name: "Demo Owner",
    phone: "+1 510 555 0100",
    role,
    language,
    created_at: created,
    updated_at: updated,
  };

  const tenant_modules = moduleIds(repoRoot, modules).map((module_id) => ({
    tenant_id: TENANT_ID,
    module_id,
    enabled: true,
    enabled_at: created,
    enabled_by: USER_ID,
  }));

  const customers = [
    {
      id: CUST_1, tenant_id: TENANT_ID, name: "Gulf Freight Co.", status: "active",
      email: "fleet@gulffreight.test", phone: "+1 415 555 0181", website: "gulffreight.test",
      address: "88 Dockside Ave", city: "San Francisco", country: "US",
      cr_number: "CR-2231180", tax_number: "94-1234567", billing_terms: "Net 30",
      credit_limit: 25000, notes: "Key account — quarterly compliance audits.",
      created_at: created, updated_at: updated, ...actor,
    },
    {
      id: CUST_2, tenant_id: TENANT_ID, name: "Desert Transport LLC", status: "active",
      email: "admin@deserttransport.test", phone: "+1 702 555 0133", website: null,
      address: "4100 Industrial Rd", city: "Las Vegas", country: "US",
      cr_number: "CR-5520917", tax_number: null, billing_terms: "Due on receipt",
      credit_limit: null, notes: null,
      created_at: "2026-05-11T11:00:00.000Z", updated_at: updated, ...actor,
    },
  ];

  const vehicles = [
    {
      id: VEH_1, tenant_id: TENANT_ID, name: "Truck 12", ownership: "company", customer_id: null,
      make: "Volvo", model: "FH16", year: 2022, vehicle_type: "truck", status: "active",
      fuel_type: "diesel", license_plate: "8KLM392", vin: "YV2RT40A8NB123456",
      chassis_number: "YV2RT40A8NB123456", engine_number: "D16K-778812", fleet_number: "FL-012",
      odometer: 184250, odometer_updated_at: "2026-09-18T07:40:00.000Z",
      purchase_date: "2022-04-12", purchase_price: 142000, notes: null,
      created_at: created, updated_at: updated, ...actor,
    },
    {
      id: VEH_2, tenant_id: TENANT_ID, name: "Van 04", ownership: "company", customer_id: null,
      make: "Ford", model: "Transit 350", year: 2023, vehicle_type: "van", status: "in_shop",
      fuel_type: "gasoline", license_plate: "7ABC219", vin: "1FTBW3XM5PKA98765",
      chassis_number: null, engine_number: null, fleet_number: "FL-004",
      odometer: 42310, odometer_updated_at: "2026-09-10T16:05:00.000Z",
      purchase_date: "2023-01-20", purchase_price: 48500, notes: "Brake pads on order.",
      created_at: created, updated_at: updated, ...actor,
    },
    {
      id: VEH_3, tenant_id: TENANT_ID, name: "GF Tractor 7", ownership: "customer", customer_id: CUST_1,
      make: "Kenworth", model: "T680", year: 2021, vehicle_type: "truck", status: "active",
      fuel_type: "diesel", license_plate: "4TRK771", vin: "1XKYD49X0MJ445566",
      chassis_number: "1XKYD49X0MJ445566", engine_number: "X15-551203", fleet_number: null,
      odometer: 301120, odometer_updated_at: "2026-08-29T10:00:00.000Z",
      purchase_date: null, purchase_price: null, notes: null,
      created_at: "2026-06-01T08:00:00.000Z", updated_at: updated, ...actor,
    },
  ];

  const drivers = [
    {
      id: DRV_1, tenant_id: TENANT_ID, first_name: "Maria", last_name: "Lopez", status: "active",
      email: "maria.lopez@acme-logistics.test", phone: "+1 510 555 0177",
      license_number: "D1234567", license_class: "CDL-A", license_expiry: "2027-11-30",
      hire_date: "2021-08-16", notes: null, created_at: created, updated_at: updated, ...actor,
    },
    {
      id: DRV_2, tenant_id: TENANT_ID, first_name: "Omar", last_name: "Haddad", status: "active",
      email: null, phone: "+1 510 555 0164",
      license_number: "D7654321", license_class: "CDL-B", license_expiry: "2026-10-15",
      hire_date: "2024-02-05", notes: "License renewal due next month.",
      created_at: created, updated_at: updated, ...actor,
    },
  ];

  return {
    tables: {
      tenants: [tenant],
      profiles: [profile],
      tenant_modules,
      customers,
      vehicles,
      drivers,
    },
    rpc: {
      // One aggregate row (sales/OverviewPage renders nothing when this is empty).
      sales_summary: [
        {
          open_quotes: 3, open_quote_value: 18450, accepted_quotes_90d: 5, decided_quotes_90d: 8,
          open_orders: 2, open_order_value: 9200, unbilled_order_value: 4100,
          outstanding_amount: 12780, overdue_amount: 2350, overdue_invoices: 1,
          collected_30d: 15600, unbilled_certificates: 4,
        },
      ],
      fuel_summary: [{ fill_count: 0, total_cost: 0, total_liters: 0 }],
    },
    api: {},
  };
}

/** Merge extra fixtures over base: tables/rpc/api replaced per key. */
export function mergeFixtures(base, extra) {
  if (!extra) return base;
  return {
    tables: { ...base.tables, ...(extra.tables ?? {}) },
    rpc: { ...base.rpc, ...(extra.rpc ?? {}) },
    api: { ...base.api, ...(extra.api ?? {}) },
  };
}
