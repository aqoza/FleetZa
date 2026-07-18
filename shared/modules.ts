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
  m("gps_tracking", "fleet_ops", "coming_soon", { requires: ["fleet"] }),
  m("driver_behavior", "fleet_ops", "coming_soon", { requires: ["drivers"] }),
  m("trip_planning", "fleet_ops", "coming_soon", { requires: ["fleet"] }),
  m("dispatch", "fleet_ops", "coming_soon", { requires: ["fleet", "drivers"] }),

  // --- Maintenance & workshop ---
  m("maintenance", "maintenance", "available", { requires: ["fleet"], routes: ["/maintenance"] }),
  m("preventive", "maintenance", "available", { requires: ["fleet", "maintenance"] }),
  m("inspections", "maintenance", "available", { requires: ["fleet"], routes: ["/inspections"] }),
  m("issues", "maintenance", "available", { requires: ["fleet"], routes: ["/issues"] }),
  m("workshop", "maintenance", "coming_soon", { requires: ["maintenance"] }),
  m("predictive_ai", "maintenance", "coming_soon", { requires: ["maintenance"] }),

  // --- Compliance & certification ---
  m("renewals", "compliance", "available", { requires: ["fleet"], routes: ["/renewals"] }),
  m("speed_limiters", "compliance", "available", { requires: ["fleet"], routes: ["/speed-limiters"] }),
  m("sl_certificates", "compliance", "available", { requires: ["speed_limiters"] }),
  m("insurance_mgmt", "compliance", "coming_soon", { requires: ["fleet"] }),
  m("incidents", "compliance", "coming_soon", { requires: ["fleet"] }),
  m("regulatory", "compliance", "coming_soon"),

  // --- Logistics & transport ---
  m("tms", "logistics", "coming_soon", { requires: ["fleet"] }),
  m("logistics_delivery", "logistics", "coming_soon", { requires: ["fleet"] }),
  m("assets", "logistics", "coming_soon"),
  m("inventory", "logistics", "coming_soon"),

  // --- Commerce ---
  m("purchasing", "commerce", "coming_soon"),
  m("sales", "commerce", "coming_soon"),
  m("pos", "commerce", "coming_soon", { requires: ["sales"] }),
  m("crm", "commerce", "coming_soon"),

  // --- Finance ---
  m("finance", "finance", "coming_soon"),
  m("billing", "finance", "coming_soon"),
  m("contracts", "finance", "coming_soon"),

  // --- People ---
  m("payroll_hr", "people", "coming_soon"),
  m("mobile_workforce", "people", "coming_soon"),

  // --- Customer & partners ---
  m("customer_portal", "customer", "coming_soon"),
  m("vendor_portal", "customer", "coming_soon"),

  // --- Analytics ---
  m("reports", "analytics", "available", { requires: ["fleet"], routes: ["/reports"] }),
  m("bi_analytics", "analytics", "coming_soon", { requires: ["reports"] }),

  // --- Platform ---
  m("documents", "platform", "coming_soon"),
  m("workflow_automation", "platform", "coming_soon"),
  m("integrations", "platform", "coming_soon"),
  m("iot_devices", "platform", "coming_soon"),
  m("notifications", "platform", "coming_soon"),
  m("audit_security", "platform", "coming_soon"),
  m("multi_company", "platform", "coming_soon"),
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
