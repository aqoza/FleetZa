import { describe, expect, it } from "vitest";
import { compare, downsample, formatReading, freshness, latestValues, METRIC_RE } from "./iot";

describe("compare", () => {
  it("mirrors app.iot_compare", () => {
    expect(compare(5, "gt", 4)).toBe(true);
    expect(compare(4, "gt", 4)).toBe(false);
    expect(compare(4, "gte", 4)).toBe(true);
    expect(compare(3, "lt", 4)).toBe(true);
    expect(compare(4, "lte", 4)).toBe(true);
    expect(compare(4, "eq", 4)).toBe(true);
    expect(compare(4.1, "eq", 4)).toBe(false);
  });
});

describe("latestValues", () => {
  it("parses last_reading newest first and skips junk", () => {
    const out = latestValues({
      temperature: { value: 4.2, unit: "C", at: "2026-10-08T10:00:00Z" },
      battery: { value: "12.6", unit: "V", at: "2026-10-08T11:00:00Z" },
      door_open: { value: 0, unit: null, at: "2026-10-08T11:00:00Z" },
      broken: { value: "x", at: "2026-10-08T11:00:00Z" },
      nope: 3,
    });
    expect(out.map((v) => v.metric)).toEqual(["battery", "door_open", "temperature"]);
    expect(out[0].value).toBe(12.6);
    expect(out[1].unit).toBeNull();
  });
  it("handles empty and non-objects", () => {
    expect(latestValues(null)).toEqual([]);
    expect(latestValues([])).toEqual([]);
    expect(latestValues({})).toEqual([]);
  });
});

describe("formatReading", () => {
  it("rounds to two decimals and appends the unit", () => {
    expect(formatReading(4.256, "°C", "en")).toBe("4.26 °C");
    expect(formatReading(1, null, "en")).toBe("1");
  });
});

describe("freshness", () => {
  const now = Date.parse("2026-10-08T12:00:00Z");
  it("buckets by age", () => {
    expect(freshness(null, now)).toBe("never");
    expect(freshness("2026-10-08T11:50:00Z", now)).toBe("live");
    expect(freshness("2026-10-08T02:00:00Z", now)).toBe("recent");
    expect(freshness("2026-10-06T12:00:00Z", now)).toBe("silent");
  });
});

describe("downsample", () => {
  it("keeps short series and averages long ones", () => {
    const pts = Array.from({ length: 10 }, (_, i) => ({ t: i, v: i }));
    expect(downsample(pts, 20)).toHaveLength(10);
    const ds = downsample(pts, 5);
    expect(ds).toHaveLength(5);
    expect(ds[0].v).toBe(0.5);
    expect(ds[4].v).toBe(8.5);
  });
});

describe("METRIC_RE", () => {
  it("matches the database check", () => {
    expect(METRIC_RE.test("tire_pressure_fl")).toBe(true);
    expect(METRIC_RE.test("Temp C")).toBe(false);
    expect(METRIC_RE.test("1temp")).toBe(false);
  });
});
