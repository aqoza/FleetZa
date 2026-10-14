import type { MessageKey } from "../i18n";

/** Shared, compile-checked labels for activity feeds across all modules. */
const AUDIT_TABLE_KEYS: Record<string, MessageKey> = {
  vehicles: "security.table.vehicles",
  drivers: "security.table.drivers",
  customers: "security.table.customers",
  contacts: "security.table.contacts",
  work_orders: "security.table.work_orders",
  renewals: "security.table.renewals",
  sl_devices: "security.table.sl_devices",
  sl_technicians: "security.table.sl_technicians",
  sl_jobs: "security.table.sl_jobs",
  speed_limiter_installations: "security.table.speed_limiter_installations",
  speed_limiter_certificates: "security.table.speed_limiter_certificates",
  products: "security.table.products",
  quotes: "security.table.quotes",
  sales_orders: "security.table.sales_orders",
  invoices: "security.table.invoices",
  payments: "security.table.payments",
  companies: "security.table.companies",
  branches: "security.table.branches",
  departments: "security.table.departments",
  employees: "security.table.employees",
  suppliers: "security.table.suppliers",
  supplier_contacts: "security.table.supplier_contacts",
  warehouses: "security.table.warehouses",
  inventory_items: "security.table.inventory_items",
  documents: "security.table.documents",
  api_keys: "security.table.api_keys",
  automation_rules: "security.table.automation_rules",
  webhook_subscriptions: "security.table.webhook_subscriptions",
  security_settings: "security.table.security_settings",
  auth_sessions: "security.table.auth_sessions",
};

export function auditTableLabel(t: (key: MessageKey) => string, table: string): string {
  return t(AUDIT_TABLE_KEYS[table] ?? "security.record");
}
