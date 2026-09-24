/**
 * Module registry — the platform's single source of truth for subscribable
 * modules (Zoho/Odoo-style). Shared by SPA and Worker (no React imports here).
 *
 * Each tenant subscribes to modules via the `tenant_modules` table; the app
 * (nav, routes, dashboard widgets, settings catalog) adapts automatically.
 *
 * Adding a module end-to-end (see docs/MODULES.md):
 *  1. Add its entry below (id, category, status, requires, routes).
 *  2. Add `modules.<id>.name` / `modules.<id>.description` to the i18n dicts.
 *  3. When implementing it: pages + nav entry + icon + optional dashboard
 *     widget, all gated by `isEnabled("<id>")` / <ModuleGate>.
 */

export type ModuleStatus = "available" | "coming_soon";

export type ModuleCategory =
  | "fleet_ops"
  | "maintenance"
  | "compliance"
  | "logistics"
  | "commerce"
  | "finance"
  | "people"
  | "customer"
  | "analytics"
  | "platform";

export interface ModuleDef {
  id: string;
  category: ModuleCategory;
  status: ModuleStatus;
  /** Modules that must be enabled first (transitively auto-enabled). */
  requires?: string[];
  /** Route path prefixes this module owns (SPA gates them). */
  routes?: string[];
  /** Base module: always enabled, cannot be disabled. */
  alwaysOn?: boolean;
}

const m = (
  id: string,
  category: ModuleCategory,
  status: ModuleStatus,
  extra: Partial<ModuleDef> = {},
): ModuleDef => ({ id, category, status, ...extra });

/**
 * The catalog. Order within a category = display order.
 * "available" modules are implemented today; "coming_soon" are catalog
 * placeholders that become enableable once implemented.
 */
export const MODULES: ModuleDef[] = [
  // --- Fleet operations ---
  m("fleet", "fleet_ops", "available", { alwaysOn: true, routes: ["/vehicles"] }),
  m("drivers", "fleet_ops", "available", { requires: ["fleet"], routes: ["/drivers"] }),
  m("fuel", "fleet_ops", "available", { requires: ["fleet"], routes: ["/fuel"] }),
  m("gps_tracking", "fleet_ops", "available", { requires: ["fleet"], routes: ["/gps"] }),
  m("driver_behavior", "fleet_ops", "available", {
    requires: ["drivers"],
    routes: ["/driver-behavior"],
  }),
  m("trip_planning", "fleet_ops", "available", { requires: ["fleet"], routes: ["/trips"] }),
  m("dispatch", "fleet_ops", "available", { requires: ["fleet", "drivers"], routes: ["/dispatch"] }),

  // --- Maintenance & workshop ---
  m("maintenance", "maintenance", "available", { requires: ["fleet"], routes: ["/maintenance"] }),
  m("preventive", "maintenance", "available", { requires: ["fleet", "maintenance"] }),
  m("inspections", "maintenance", "available", { requires: ["fleet"], routes: ["/inspections"] }),
  m("issues", "maintenance", "available", { requires: ["fleet"], routes: ["/issues"] }),
  // Bays, bookings, technician time and parts issued from stock. Technicians
  // are employees, so the people master data is a data dependency.
  m("workshop", "maintenance", "available", {
    requires: ["maintenance", "employees"],
    routes: ["/workshop"],
  }),
  // Deterministic, explainable risk scoring over odometer, issue and cost
  // history — the id predates the name and is permanent.
  m("predictive_ai", "maintenance", "available", {
    requires: ["maintenance"],
    routes: ["/predictive"],
  }),

  // --- Compliance & certification ---
  m("renewals", "compliance", "available", { requires: ["fleet"], routes: ["/renewals"] }),
  m("speed_limiters", "compliance", "available", {
    requires: ["fleet", "customers"],
    routes: ["/speed-limiters"],
  }),
  m("sl_certificates", "compliance", "available", { requires: ["speed_limiters"] }),
  m("insurance_mgmt", "compliance", "available", { requires: ["fleet"], routes: ["/insurance"] }),
  m("incidents", "compliance", "available", { requires: ["fleet"], routes: ["/incidents"] }),
  m("regulatory", "compliance", "available", { requires: ["fleet"], routes: ["/regulatory"] }),

  // --- Logistics & transport ---
  m("tms", "logistics", "available", { requires: ["fleet", "customers"], routes: ["/tms"] }),
  m("logistics_delivery", "logistics", "available", {
    requires: ["fleet", "drivers"],
    routes: ["/deliveries"],
  }),
  m("assets", "logistics", "available", { routes: ["/assets"] }),
  m("inventory", "logistics", "available", { routes: ["/inventory"] }),

  // --- Commerce ---
  // Purchase orders, goods receipts and vendor bills. Every document FKs a
  // supplier, so the supplier master data is a data dependency.
  m("purchasing", "commerce", "available", { requires: ["suppliers"], routes: ["/purchasing"] }),
  // Quotes + sales orders + the product catalog. Customers is a *data*
  // dependency, not just a UI one: every document FKs a customer.
  m("sales", "commerce", "available", { requires: ["customers"], routes: ["/sales"] }),
  // Sells catalog products, so it rides on the sales catalog.
  m("pos", "commerce", "available", { requires: ["sales"], routes: ["/pos"] }),
  m("crm", "commerce", "available", { requires: ["customers"], routes: ["/crm"] }),

  // --- Finance ---
  // General ledger, expenses and statements. Expenses and payables name a
  // supplier, hence the dependency.
  m("finance", "finance", "available", { requires: ["suppliers"], routes: ["/finance"] }),
  // Invoices + payments. Rides on the sales hub (its own tab there), the way
  // sl_certificates rides on speed_limiters.
  m("billing", "finance", "available", { requires: ["sales"] }),
  m("contracts", "finance", "available", { requires: ["customers"], routes: ["/contracts"] }),

  // --- People ---
  // Global master data: the people who work for the tenant. Consumed by
  // HR, field workforce and the workshop.
  m("employees", "people", "available", { routes: ["/employees"] }),
  m("payroll_hr", "people", "available", { requires: ["employees"], routes: ["/hr"] }),
  m("mobile_workforce", "people", "available", { requires: ["employees"], routes: ["/field"] }),

  // --- Customer & partners ---
  // Global master data: client organizations + their contacts. Consumed by
  // speed_limiters today and by CRM/sales/billing/portal as they land.
  m("customers", "customer", "available", { routes: ["/customers"] }),
  // Global master data: the tenant's vendors, carriers and insurers.
  m("suppliers", "customer", "available", { routes: ["/suppliers"] }),
  // Admin side at /customer-portal; customers use a public /portal/:token link.
  m("customer_portal", "customer", "available", {
    requires: ["customers"],
    routes: ["/customer-portal"],
  }),
  // Admin side at /vendor-portal; suppliers use a public /vendor/:token link.
  m("vendor_portal", "customer", "available", {
    requires: ["purchasing"],
    routes: ["/vendor-portal"],
  }),

  // --- Analytics ---
  m("reports", "analytics", "available", { requires: ["fleet"], routes: ["/reports"] }),
  m("bi_analytics", "analytics", "available", { requires: ["reports"], routes: ["/analytics"] }),

  // --- Platform ---
  m("documents", "platform", "available", { routes: ["/documents"] }),
  m("workflow_automation", "platform", "available", { routes: ["/automation"] }),
  m("integrations", "platform", "available", { routes: ["/integrations"] }),
  m("iot_devices", "platform", "available", { requires: ["fleet"], routes: ["/iot"] }),
  m("notifications", "platform", "available", { routes: ["/notifications"] }),
  m("audit_security", "platform", "available", { routes: ["/security"] }),
  m("multi_company", "platform", "available", { routes: ["/companies"] }),
];

export type ModuleId = string;

export const MODULE_MAP: Record<string, ModuleDef> = Object.fromEntries(
  MODULES.map((mod) => [mod.id, mod]),
);

export const CATEGORY_ORDER: ModuleCategory[] = [
  "fleet_ops",
  "maintenance",
  "compliance",
  "logistics",
  "commerce",
  "finance",
  "people",
  "customer",
  "analytics",
  "platform",
];

/** Modules enabled for every new tenant at signup (and backfilled for existing). */
export const DEFAULT_MODULES: string[] = [
  "fleet",
  "drivers",
  "fuel",
  "maintenance",
  "preventive",
  "inspections",
  "issues",
  "renewals",
  "reports",
];

export function getModule(id: string): ModuleDef | undefined {
  return MODULE_MAP[id];
}

/** All transitive requirements of a module (excluding itself), deduped. */
export function requirementsOf(id: string): string[] {
  const out = new Set<string>();
  const walk = (cur: string) => {
    for (const dep of MODULE_MAP[cur]?.requires ?? []) {
      if (!out.has(dep)) {
        out.add(dep);
        walk(dep);
      }
    }
  };
  walk(id);
  return [...out];
}

/** Enabled modules that (transitively) depend on `id`. */
export function dependentsOf(id: string, enabled: Iterable<string>): string[] {
  return [...enabled].filter((other) => other !== id && requirementsOf(other).includes(id));
}

/** The module owning a route path, if any (longest-prefix match). */
export function moduleForPath(pathname: string): ModuleDef | undefined {
  let best: ModuleDef | undefined;
  let bestLen = -1;
  for (const mod of MODULES) {
    for (const prefix of mod.routes ?? []) {
      if ((pathname === prefix || pathname.startsWith(prefix + "/")) && prefix.length > bestLen) {
        best = mod;
        bestLen = prefix.length;
      }
    }
  }
  return best;
}
