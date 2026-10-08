import { describe, expect, it } from "vitest";
import { EVENT_CATALOG, eventSpec, normalizeCondition, templateFields, validateRule } from "./automation";

describe("automation helpers", () => {
  it("has a sample with a vehicle for every vehicle event", () => {
    for (const e of EVENT_CATALOG) {
      expect(e.event).toMatch(/^[a-z][a-z_]*\.[a-z][a-z_]*$/);
      if (e.hasVehicle && e.event !== "invoice.issued") expect(e.sample.vehicle_id).toBeTruthy();
    }
    expect(eventSpec("issue.created")?.module).toBe("issues");
  });

  it("validates like the server", () => {
    const ok = validateRule({
      name: "Alert", event: "issue.created",
      conditions: [{ field: "priority", op: "in", value: ["high"] }],
      actions: [{ type: "notify", audience: "managers", severity: "warning", message: "{title}" }],
    });
    expect(ok).toEqual([]);
    const bad = validateRule({
      name: " ", event: "nope.event",
      conditions: [{ field: "x", op: "eq", value: "" }, { field: "y", op: "exists" }],
      actions: [],
    });
    expect(bad.map((p) => p.kind)).toEqual(["name", "event", "noActions", "condition"]);
  });

  it("refuses create_issue on an event without a vehicle", () => {
    const p = validateRule({
      name: "x", event: "payment.received", conditions: [],
      actions: [{ type: "create_issue", title: "Check", priority: "normal" }],
    });
    expect(p).toEqual([{ kind: "issueNeedsVehicle", index: 0 }]);
  });

  it("normalizes condition values", () => {
    expect(normalizeCondition({ field: " total ", op: "gt", value: "100" })).toEqual({ field: "total", op: "gt", value: 100 });
    expect(normalizeCondition({ field: "p", op: "in", value: "high, critical," })).toEqual({ field: "p", op: "in", value: ["high", "critical"] });
    expect(normalizeCondition({ field: "a", op: "exists", value: "x" })).toEqual({ field: "a", op: "exists" });
    expect(normalizeCondition({ field: "plate", op: "eq", value: "007" })).toEqual({ field: "plate", op: "eq", value: "007" });
    expect(normalizeCondition({ field: "year", op: "eq", value: "2021" }, { name: "year", kind: "number" })).toEqual({ field: "year", op: "eq", value: 2021 });
  });

  it("finds template fields", () => {
    expect(templateFields("{name} on {vehicle.plate}!")).toEqual(["name", "vehicle.plate"]);
  });
});
