/**
 * Workflow automation — the event catalog and rule shape the SPA builds.
 * The engine (app.run_automation_rules) evaluates the same shape in SQL, and
 * app.validate_automation_rule enforces it on save; validateRule mirrors that
 * check so the builder can explain a problem before the server refuses it.
 */

export type ConditionOp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "contains" | "in" | "exists";
export const CONDITION_OPS: ConditionOp[] = ["eq", "neq", "gt", "gte", "lt", "lte", "contains", "in", "exists"];

export interface Condition {
  field: string;
  op: ConditionOp;
  value?: string | number | string[];
}

export type Audience = "managers" | "admins" | "all";
export type Severity = "info" | "warning" | "critical";
export type IssuePriority = "low" | "normal" | "high" | "critical";

export type Action =
  | { type: "notify"; audience: Audience; severity: Severity; message: string }
  | { type: "create_issue"; title: string; priority: IssuePriority }
  | { type: "webhook"; subscription_id: string };

export type ActionType = Action["type"];

export interface EventField {
  name: string;
  kind: "text" | "number" | "date" | "id";
  /** Allowed values, when the column is an enum. */
  options?: string[];
}

export interface EventSpec {
  event: string;
  /** Module whose data raises it; the builder lists only enabled ones. */
  module: string;
  /** Whether the payload carries vehicle_id (create_issue needs one). */
  hasVehicle: boolean;
  fields: EventField[];
  sample: Record<string, unknown>;
}

const PRIORITY = ["low", "normal", "high", "critical"];

/** Every event the server raises (migration 20261008000006 + the foundation's stock alert). */
export const EVENT_CATALOG: EventSpec[] = [
  {
    event: "vehicle.created", module: "fleet", hasVehicle: true,
    fields: [
      { name: "name", kind: "text" }, { name: "license_plate", kind: "text" },
      { name: "vehicle_type", kind: "text", options: ["car", "truck", "van", "bus", "motorcycle", "trailer", "equipment", "other"] },
      { name: "status", kind: "text" }, { name: "make", kind: "text" }, { name: "model", kind: "text" },
      { name: "year", kind: "number" }, { name: "ownership", kind: "text", options: ["company", "customer"] },
    ],
    sample: { vehicle_id: "00000000-0000-4000-8000-000000000001", name: "Truck 7", license_plate: "4TRK771",
      vehicle_type: "truck", status: "active", make: "Kenworth", model: "T680", year: 2021, ownership: "company" },
  },
  {
    event: "customer.created", module: "customers", hasVehicle: false,
    fields: [{ name: "name", kind: "text" }, { name: "status", kind: "text" }, { name: "city", kind: "text" }, { name: "country", kind: "text" }],
    sample: { customer_id: "00000000-0000-4000-8000-000000000002", name: "Gulf Freight Co.", status: "active", city: "Muscat", country: "OM" },
  },
  {
    event: "issue.created", module: "issues", hasVehicle: true,
    fields: [
      { name: "title", kind: "text" }, { name: "priority", kind: "text", options: PRIORITY },
      { name: "status", kind: "text" }, { name: "source", kind: "text", options: ["manual", "inspection"] },
    ],
    sample: { issue_id: "00000000-0000-4000-8000-000000000003", vehicle_id: "00000000-0000-4000-8000-000000000001",
      title: "Brake noise", priority: "high", status: "open", source: "manual" },
  },
  {
    event: "issue.resolved", module: "issues", hasVehicle: true,
    fields: [{ name: "title", kind: "text" }, { name: "priority", kind: "text", options: PRIORITY }, { name: "status", kind: "text" }],
    sample: { issue_id: "00000000-0000-4000-8000-000000000003", vehicle_id: "00000000-0000-4000-8000-000000000001",
      title: "Brake noise", priority: "high", status: "resolved" },
  },
  {
    event: "work_order.completed", module: "maintenance", hasVehicle: true,
    fields: [{ name: "number", kind: "number" }, { name: "title", kind: "text" },
      { name: "priority", kind: "text", options: PRIORITY }, { name: "odometer", kind: "number" }],
    sample: { work_order_id: "00000000-0000-4000-8000-000000000004", vehicle_id: "00000000-0000-4000-8000-000000000001",
      number: 1042, title: "60k service", priority: "normal", odometer: 60210 },
  },
  {
    event: "inspection.failed", module: "inspections", hasVehicle: true,
    fields: [{ name: "odometer", kind: "number" }],
    sample: { inspection_id: "00000000-0000-4000-8000-000000000005", vehicle_id: "00000000-0000-4000-8000-000000000001", odometer: 60100 },
  },
  {
    event: "renewal.completed", module: "renewals", hasVehicle: true,
    fields: [{ name: "name", kind: "text" }, { name: "renewal_type", kind: "text" },
      { name: "due_date", kind: "date" }, { name: "amount", kind: "number" }],
    sample: { renewal_id: "00000000-0000-4000-8000-000000000006", vehicle_id: "00000000-0000-4000-8000-000000000001",
      name: "Registration", renewal_type: "registration", due_date: "2026-11-01", amount: 120 },
  },
  {
    event: "invoice.issued", module: "billing", hasVehicle: true,
    fields: [{ name: "doc_number", kind: "text" }, { name: "total", kind: "number" },
      { name: "currency", kind: "text" }, { name: "due_date", kind: "date" }],
    sample: { invoice_id: "00000000-0000-4000-8000-000000000007", doc_number: "INV-2026-0042", total: 1250,
      currency: "OMR", due_date: "2026-11-07", vehicle_id: null },
  },
  {
    event: "payment.received", module: "billing", hasVehicle: false,
    fields: [{ name: "amount", kind: "number" }, { name: "method", kind: "text" }, { name: "paid_at", kind: "date" }],
    sample: { payment_id: "00000000-0000-4000-8000-000000000008", invoice_id: "00000000-0000-4000-8000-000000000007",
      amount: 500, method: "bank_transfer", paid_at: "2026-10-08" },
  },
  {
    event: "certificate.issued", module: "sl_certificates", hasVehicle: true,
    fields: [{ name: "certificate_number", kind: "text" }, { name: "expires_at", kind: "date" }, { name: "status", kind: "text" }],
    sample: { certificate_id: "00000000-0000-4000-8000-000000000009", certificate_number: "GOM-2026-0101",
      vehicle_id: "00000000-0000-4000-8000-000000000001", expires_at: "2027-10-08", status: "active" },
  },
  {
    event: "stock.below_reorder", module: "inventory", hasVehicle: false,
    fields: [{ name: "name", kind: "text" }, { name: "sku", kind: "text" }, { name: "on_hand", kind: "number" },
      { name: "reorder_point", kind: "number" }, { name: "reorder_qty", kind: "number" }],
    sample: { item_id: "00000000-0000-4000-8000-000000000010", name: "Brake pads (set)", sku: "BP-220",
      on_hand: 3, reorder_point: 4, reorder_qty: 10 },
  },
  {
    event: "geofence.entered", module: "gps_tracking", hasVehicle: true,
    fields: [{ name: "geofence", kind: "text" }, { name: "vehicle", kind: "text" }],
    sample: { geofence_id: "00000000-0000-4000-8000-000000000011", geofence: "Main yard",
      vehicle_id: "00000000-0000-4000-8000-000000000001", vehicle: "Truck 7", lat: 23.588, lng: 58.3829, at: "2026-10-08T09:30:00Z" },
  },
  {
    event: "geofence.exited", module: "gps_tracking", hasVehicle: true,
    fields: [{ name: "geofence", kind: "text" }, { name: "vehicle", kind: "text" }],
    sample: { geofence_id: "00000000-0000-4000-8000-000000000011", geofence: "Main yard",
      vehicle_id: "00000000-0000-4000-8000-000000000001", vehicle: "Truck 7", lat: 23.61, lng: 58.41, at: "2026-10-08T11:05:00Z" },
  },
  {
    event: "driving_event.created", module: "driver_behavior", hasVehicle: true,
    fields: [
      { name: "event_type", kind: "text", options: ["harsh_braking", "harsh_acceleration", "harsh_cornering", "speeding", "idling", "seatbelt", "phone_use", "fatigue", "collision_warning"] },
      { name: "severity", kind: "text", options: ["low", "medium", "high"] },
      { name: "speed_kmh", kind: "number" }, { name: "speed_limit_kmh", kind: "number" },
      { name: "driver", kind: "text" }, { name: "vehicle", kind: "text" },
    ],
    sample: { driving_event_id: "00000000-0000-4000-8000-000000000012", event_type: "speeding", severity: "high",
      vehicle_id: "00000000-0000-4000-8000-000000000001", vehicle: "Truck 7", driver_id: null, driver: "Omar Said",
      speed_kmh: 118, speed_limit_kmh: 80, occurred_at: "2026-10-08T09:31:12Z" },
  },
];

export function eventSpec(event: string): EventSpec | undefined {
  return EVENT_CATALOG.find((e) => e.event === event);
}

export type RuleProblem =
  | { kind: "name" }
  | { kind: "event" }
  | { kind: "noActions" }
  | { kind: "tooMany" }
  | { kind: "condition"; index: number }
  | { kind: "action"; index: number }
  | { kind: "issueNeedsVehicle"; index: number };

/** The same rules the server enforces, plus "create_issue needs a vehicle". */
export function validateRule(rule: { name: string; event: string; conditions: Condition[]; actions: Action[] }): RuleProblem[] {
  const problems: RuleProblem[] = [];
  if (!rule.name.trim()) problems.push({ kind: "name" });
  const spec = eventSpec(rule.event);
  if (!spec) problems.push({ kind: "event" });
  if (rule.actions.length === 0) problems.push({ kind: "noActions" });
  if (rule.actions.length > 10 || rule.conditions.length > 20) problems.push({ kind: "tooMany" });
  rule.conditions.forEach((c, index) => {
    const needsValue = c.op !== "exists";
    const emptyValue =
      c.value == null || (Array.isArray(c.value) ? c.value.length === 0 : String(c.value).trim() === "");
    if (!c.field.trim() || !CONDITION_OPS.includes(c.op) || (needsValue && emptyValue)) {
      problems.push({ kind: "condition", index });
    }
  });
  rule.actions.forEach((a, index) => {
    if (a.type === "notify" && !a.message.trim()) problems.push({ kind: "action", index });
    if (a.type === "create_issue") {
      if (!a.title.trim()) problems.push({ kind: "action", index });
      else if (spec && !spec.hasVehicle) problems.push({ kind: "issueNeedsVehicle", index });
    }
    if (a.type === "webhook" && !/^[0-9a-f-]{36}$/.test(a.subscription_id)) problems.push({ kind: "action", index });
  });
  return problems;
}

/**
 * What the builder stores: numbers as numbers (so "gt 100" compares
 * numerically), "in" as a list, "exists" with no value.
 */
export function normalizeCondition(c: Condition, field?: EventField): Condition {
  if (c.op === "exists") return { field: c.field.trim(), op: c.op };
  if (c.op === "in") {
    const list = Array.isArray(c.value) ? c.value : String(c.value ?? "").split(",");
    return { field: c.field.trim(), op: c.op, value: list.map((v) => v.trim()).filter(Boolean) };
  }
  const raw = Array.isArray(c.value) ? c.value.join(",") : String(c.value ?? "").trim();
  const numeric = field?.kind === "number" || ["gt", "gte", "lt", "lte"].includes(c.op);
  return { field: c.field.trim(), op: c.op, value: numeric && /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw };
}

/** "{name} is down" → the fields a template uses, for the "available fields" hint. */
export function templateFields(template: string): string[] {
  return [...template.matchAll(/\{([a-zA-Z0-9_.]+)\}/g)].map((m) => m[1]);
}
