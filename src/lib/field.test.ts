import { describe, expect, it } from "vitest";
import {
  canTick, checklistProgress, cleanChecklist, fieldMoves, fromLocalInput, isOverdue, isToday, mapsUrl,
  parseChecklist, parseCoord, toLocalInput,
} from "./field";

describe("fieldMoves", () => {
  it("walks the assignee forward", () => {
    const me = { isManager: false, isAssignee: true };
    expect(fieldMoves("assigned", me)).toEqual(["accepted"]);
    expect(fieldMoves("accepted", me)).toEqual(["in_progress"]);
    expect(fieldMoves("in_progress", me)).toEqual(["completed"]);
    expect(fieldMoves("completed", me)).toEqual([]);
  });
  it("lets managers cancel open tasks only", () => {
    const mgr = { isManager: true, isAssignee: false };
    expect(fieldMoves("assigned", mgr)).toEqual(["accepted", "canceled"]);
    expect(fieldMoves("canceled", mgr)).toEqual([]);
  });
  it("gives strangers nothing", () => {
    expect(fieldMoves("assigned", { isManager: false, isAssignee: false })).toEqual([]);
  });
});

describe("checklists", () => {
  it("parses tolerantly", () => {
    expect(parseChecklist([{ label: "A", done: true }, { label: "" }, null, "x", { label: "B" }])).toEqual([
      { label: "A", done: true },
      { label: "B", done: false },
    ]);
    expect(parseChecklist(null)).toEqual([]);
  });
  it("cleans and caps", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ label: ` s${i} `, done: false }));
    const out = cleanChecklist([{ label: "  ", done: false }, ...many]);
    expect(out).toHaveLength(50);
    expect(out[0].label).toBe("s0");
  });
  it("counts progress", () => {
    expect(checklistProgress([{ label: "a", done: true }, { label: "b", done: false }])).toEqual({ done: 1, total: 2 });
  });
  it("ticks only while worked", () => {
    expect(canTick("assigned")).toBe(false);
    expect(canTick("in_progress")).toBe(true);
    expect(canTick("completed")).toBe(false);
  });
});

describe("dates and places", () => {
  it("flags overdue open tasks", () => {
    const now = Date.parse("2026-10-08T12:00:00Z");
    expect(isOverdue({ status: "accepted", due_at: "2026-10-08T11:00:00Z" }, now)).toBe(true);
    expect(isOverdue({ status: "completed", due_at: "2026-10-08T11:00:00Z" }, now)).toBe(false);
    expect(isOverdue({ status: "assigned", due_at: null }, now)).toBe(false);
  });
  it("round-trips datetime-local", () => {
    const iso = fromLocalInput("2026-10-08T09:30");
    expect(iso).not.toBeNull();
    expect(toLocalInput(iso)).toBe("2026-10-08T09:30");
    expect(fromLocalInput("")).toBeNull();
    expect(toLocalInput(null)).toBe("");
  });
  it("builds maps links", () => {
    expect(mapsUrl(23.588, "58.3829")).toBe("https://maps.google.com/?q=23.588,58.3829");
    expect(mapsUrl(null, 1)).toBeNull();
  });
  it("parses coordinates", () => {
    expect(parseCoord(" ", 90)).toBeNull();
    expect(parseCoord("23.5", 90)).toBe(23.5);
    expect(parseCoord("95", 90)).toBeNaN();
    expect(parseCoord("abc", 180)).toBeNaN();
  });
  it("knows today", () => {
    const now = new Date(2026, 9, 8, 15, 0);
    expect(isToday(new Date(2026, 9, 8, 1, 0).toISOString(), now)).toBe(true);
    expect(isToday(new Date(2026, 9, 7, 23, 0).toISOString(), now)).toBe(false);
  });
});
