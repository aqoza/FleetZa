import { describe, expect, it } from "vitest";
import { detectStops, haversineM, parsePositionsCsv, pathDistanceKm, plateKey, pointInPolygon, recencyBucket, type Fix } from "./gps";

const at = (min: number) => new Date(Date.UTC(2026, 9, 8, 6, 0) + min * 60_000).toISOString();

describe("gps", () => {
  it("haversine matches the SQL mirror", () => {
    expect(haversineM(23, 58, 24, 58)).toBeCloseTo(111195.08, 1);
    expect(haversineM(25.2, 55.27, 25.2, 55.27)).toBe(0);
  });

  it("sums a track", () => {
    expect(pathDistanceKm([{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }, { lat: 0, lng: 2 }])).toBeCloseTo(222.39, 1);
    expect(pathDistanceKm([{ lat: 0, lng: 0 }])).toBe(0);
  });

  it("point in polygon", () => {
    const sq: Array<[number, number]> = [[0, 0], [0, 1], [1, 1], [1, 0]];
    expect(pointInPolygon(0.5, 0.5, sq)).toBe(true);
    expect(pointInPolygon(1.5, 0.5, sq)).toBe(false);
    expect(pointInPolygon(0.5, 0.5, sq.slice(0, 2))).toBe(false);
  });

  it("detects stops of 5+ minutes below 3 km/h", () => {
    const fixes: Fix[] = [
      { lat: 0, lng: 0, recorded_at: at(0), speed_kmh: 50 },
      { lat: 0, lng: 0.01, recorded_at: at(2), speed_kmh: 0 },
      { lat: 0, lng: 0.01, recorded_at: at(6), speed_kmh: 1 },
      { lat: 0, lng: 0.01, recorded_at: at(10), speed_kmh: 40 },
      { lat: 0, lng: 0.02, recorded_at: at(12), speed_kmh: 0 },
      { lat: 0, lng: 0.02, recorded_at: at(14), speed_kmh: 30 },
    ];
    const stops = detectStops(fixes);
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({ lng: 0.01, from: at(2), to: at(10), minutes: 8 });
  });

  it("derives speed from distance when the fix has none, and closes a trailing stop", () => {
    const fixes: Fix[] = [
      { lat: 0, lng: 0, recorded_at: at(0) },
      { lat: 0, lng: 0.1, recorded_at: at(5) }, // ~11 km in 5 min
      { lat: 0, lng: 0.1, recorded_at: at(20) },
      { lat: 0, lng: 0.1, recorded_at: at(40) },
    ];
    const stops = detectStops(fixes);
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({ from: at(5), to: at(40), minutes: 35 });
  });

  it("buckets recency", () => {
    const now = Date.parse(at(30));
    expect(recencyBucket(null, now)).toBe("none");
    expect(recencyBucket({ recorded_at: at(25), speed_kmh: 60 }, now)).toBe("moving");
    expect(recencyBucket({ recorded_at: at(25), speed_kmh: 0 }, now)).toBe("idle");
    expect(recencyBucket({ recorded_at: at(0), speed_kmh: 60 }, now)).toBe("stale");
  });

  it("parses CSV with any column order and reports bad lines", () => {
    const r = parsePositionsCsv(
      "Plate,recorded_at,LAT,lng,speed_kmh\n" +
        "DXB 1,2026-10-08T06:00:00Z,25.2,55.3,40\n" +
        "DXB 1,not a date,25.2,55.3,\n" +
        "DXB 1,2026-10-08T06:05:00Z,95,55.3,\n" +
        ",2026-10-08T06:05:00Z,25,55,\n\n" +
        "DXB 2,2026-10-08T06:10:00Z,25.1,55.1,\n",
    );
    expect(r.rows.map((x) => [x.line, x.plate, x.speed_kmh])).toEqual([[2, "DXB 1", 40], [7, "DXB 2", null]]);
    expect(r.errors).toEqual([{ line: 3, reason: "time" }, { line: 4, reason: "lat" }, { line: 5, reason: "plate" }]);
    expect(parsePositionsCsv("a,b\n1,2").errors).toEqual([{ line: 1, reason: "columns" }]);
  });

  it("normalizes plates", () => {
    expect(plateKey("dxb 12-345")).toBe("DXB12345");
  });
});
