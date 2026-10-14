import { describe, expect, it } from "vitest";
import { driverScore, eventPenalty, isCriticalEvent, scoreGrade, totalPenalty } from "./driverScore";

describe("driverScore", () => {
  it("weights by type and severity", () => {
    expect(eventPenalty("harsh_braking", "low")).toBe(3);
    expect(eventPenalty("collision_warning", "high")).toBe(24);
    expect(totalPenalty([{ event_type: "speeding", severity: "medium" }, { event_type: "idling", severity: "low" }])).toBe(9);
  });

  it("is penalty points per 100 km, with a 100 km floor", () => {
    expect(driverScore(0, 0)).toBe(100);
    expect(driverScore(9, 0)).toBe(91);
    expect(driverScore(9, 50)).toBe(91);
    expect(driverScore(9, 300)).toBe(97);
    expect(driverScore(10, 300)).toBe(96.7);
    expect(driverScore(500, 100)).toBe(0);
  });

  it("grades", () => {
    expect([95, 90, 89.9, 80, 75, 60, 59.9, 0].map(scoreGrade)).toEqual(["A", "A", "B", "B", "C", "D", "F", "F"]);
  });

  it("flags critical events", () => {
    expect(isCriticalEvent("fatigue", "high")).toBe(true);
    expect(isCriticalEvent("collision_warning", "medium")).toBe(false);
    expect(isCriticalEvent("speeding", "high")).toBe(false);
  });
});
