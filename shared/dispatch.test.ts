import { describe, expect, it } from "vitest";
import { canMove, compareJobs, isLate, minutesLate, nextStep, overlaps, slaStats, timelineBar, type SlaJob } from "./dispatch";

const job = (o: Partial<SlaJob>): SlaJob => ({
  status: "new", priority: "normal", window_start: "2026-10-08T08:00:00Z", window_end: "2026-10-08T10:00:00Z", completed_at: null, ...o,
});
const at = (iso: string) => Date.parse(iso);

describe("transitions", () => {
  it("follows the documented table", () => {
    expect(canMove("assigned", "new")).toBe(true);
    expect(canMove("new", "en_route")).toBe(false);
    expect(canMove("on_site", "canceled")).toBe(true);
    expect(canMove("completed", "canceled")).toBe(false);
  });
  it("offers the next forward step", () => {
    expect(nextStep("new")).toBeNull();
    expect(nextStep("assigned")).toBe("en_route");
    expect(nextStep("on_site")).toBe("completed");
    expect(nextStep("completed")).toBeNull();
  });
});

describe("lateness", () => {
  it("open jobs past the window end are late", () => {
    expect(isLate(job({}), at("2026-10-08T10:01:00Z"))).toBe(true);
    expect(isLate(job({}), at("2026-10-08T09:59:00Z"))).toBe(false);
    expect(isLate(job({ status: "completed", completed_at: "2026-10-08T12:00:00Z" }), at("2026-10-09T00:00:00Z"))).toBe(false);
    expect(isLate(job({ status: "canceled" }), at("2026-10-09T00:00:00Z"))).toBe(false);
  });
  it("counts minutes late until now or until completion", () => {
    expect(minutesLate(job({}), at("2026-10-08T10:45:30Z"))).toBe(45);
    expect(minutesLate(job({ status: "completed", completed_at: "2026-10-08T10:20:00Z" }), at("2026-10-09T00:00:00Z"))).toBe(20);
    expect(minutesLate(job({ status: "completed", completed_at: "2026-10-08T09:00:00Z" }), 0)).toBeNull();
  });
});

describe("slaStats", () => {
  it("computes on-time share and average lateness", () => {
    const s = slaStats([
      job({ status: "completed", completed_at: "2026-10-08T09:00:00Z" }),
      job({ status: "completed", completed_at: "2026-10-08T10:30:00Z" }),
      job({ status: "completed", completed_at: "2026-10-08T11:30:00Z" }),
      job({ status: "completed", completed_at: "2026-10-08T10:00:00Z" }),
      job({ status: "new" }),
    ]);
    expect(s).toEqual({ completed: 4, onTime: 2, onTimePct: 50, avgLateMinutes: 60 });
  });
  it("is empty without completions", () => {
    expect(slaStats([job({})])).toEqual({ completed: 0, onTime: 0, onTimePct: null, avgLateMinutes: null });
  });
});

describe("ordering, overlap, timeline", () => {
  it("puts urgent first, then earliest deadline", () => {
    const a = job({ priority: "normal", window_end: "2026-10-08T09:00:00Z" });
    const b = job({ priority: "urgent", window_end: "2026-10-08T12:00:00Z" });
    const c = job({ priority: "normal", window_end: "2026-10-08T08:30:00Z" });
    expect([a, b, c].sort(compareJobs)).toEqual([b, c, a]);
  });
  it("treats windows as half-open", () => {
    expect(overlaps("2026-10-08T08:00:00Z", "2026-10-08T10:00:00Z", "2026-10-08T10:00:00Z", "2026-10-08T11:00:00Z")).toBe(false);
    expect(overlaps("2026-10-08T08:00:00Z", "2026-10-08T10:00:00Z", "2026-10-08T09:59:00Z", "2026-10-08T11:00:00Z")).toBe(true);
  });
  it("places and clips bars on a day", () => {
    const day = at("2026-10-08T00:00:00Z");
    expect(timelineBar("2026-10-08T06:00:00Z", "2026-10-08T12:00:00Z", day)).toEqual({ left: 25, width: 25 });
    expect(timelineBar("2026-10-07T22:00:00Z", "2026-10-08T03:00:00Z", day)).toEqual({ left: 0, width: 12.5 });
    expect(timelineBar("2026-10-09T01:00:00Z", "2026-10-09T03:00:00Z", day)).toBeNull();
  });
});
