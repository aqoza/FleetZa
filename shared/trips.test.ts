import { describe, expect, it } from "vitest";
import {
  addDays, canMove, fuelEstimate, fuelRate, haversineKm, overlaps, planVsActual, straightLineKm, weekDates,
} from "./trips";

describe("haversineKm", () => {
  it("is zero for the same point", () => {
    expect(haversineKm(23.588, 58.3829, 23.588, 58.3829)).toBe(0);
  });
  it("matches Muscat to Sohar (~190 km straight line)", () => {
    const km = haversineKm(23.588, 58.3829, 24.3474, 56.7094);
    expect(km).toBeGreaterThan(185);
    expect(km).toBeLessThan(195);
  });
  it("is symmetric", () => {
    expect(haversineKm(25.2, 55.27, 24.45, 54.38)).toBeCloseTo(haversineKm(24.45, 54.38, 25.2, 55.27), 9);
  });
});

describe("straightLineKm", () => {
  it("sums legs in order and skips stops without coordinates", () => {
    const a = { lat: 23.588, lng: 58.3829 };
    const b = { lat: 24.3474, lng: 56.7094 };
    const total = straightLineKm([a, { lat: null, lng: null }, b, a]);
    expect(total).toBeCloseTo(Math.round(haversineKm(a.lat, a.lng, b.lat, b.lng) * 2 * 10) / 10, 1);
  });
  it("needs two located stops", () => {
    expect(straightLineKm([{ lat: 1, lng: 1 }, { lat: null, lng: 2 }])).toBeNull();
  });
});

describe("fuelRate", () => {
  it("uses fills after the first over the odometer span", () => {
    const r = fuelRate([
      { odometer: 10000, volume: 50, total_cost: 12 },
      { odometer: 10500, volume: 40, total_cost: 9.6 },
      { odometer: 11000, volume: 60, total_cost: 14.4 },
    ]);
    expect(r.l_per_100km).toBe(10);
    expect(r.price_per_l).toBe(0.24);
  });
  it("needs 100 km of span", () => {
    expect(fuelRate([{ odometer: 100, volume: 10, total_cost: 0 }, { odometer: 150, volume: 10, total_cost: 0 }]))
      .toEqual({ l_per_100km: null, price_per_l: null });
  });
  it("ignores fills without an odometer for the rate but keeps them for price", () => {
    const r = fuelRate([{ odometer: null, volume: 10, total_cost: 5 }]);
    expect(r).toEqual({ l_per_100km: null, price_per_l: 0.5 });
  });
});

describe("fuelEstimate", () => {
  it("scales the rate", () => {
    expect(fuelEstimate(250, { l_per_100km: 30, price_per_l: 0.2 })).toEqual({ liters: 75, cost: 15 });
  });
  it("is empty without distance or rate", () => {
    expect(fuelEstimate(null, { l_per_100km: 30, price_per_l: 1 })).toEqual({ liters: null, cost: null });
    expect(fuelEstimate(100, { l_per_100km: null, price_per_l: 1 })).toEqual({ liters: null, cost: null });
  });
});

describe("overlaps", () => {
  it("treats windows as half-open", () => {
    expect(overlaps("2026-10-08T08:00:00Z", "2026-10-08T10:00:00Z", "2026-10-08T10:00:00Z", "2026-10-08T12:00:00Z")).toBe(false);
    expect(overlaps("2026-10-08T08:00:00Z", "2026-10-08T10:01:00Z", "2026-10-08T10:00:00Z", "2026-10-08T12:00:00Z")).toBe(true);
  });
});

describe("planVsActual", () => {
  it("compares duration, delay and distance", () => {
    expect(planVsActual({
      planned_start: "2026-10-08T08:00:00Z", planned_end: "2026-10-08T12:00:00Z",
      actual_start: "2026-10-08T08:15:00Z", actual_end: "2026-10-08T12:45:00Z",
      planned_distance_km: 200, start_odometer: 1000, end_odometer: 1212.5,
    })).toEqual({ planned_minutes: 240, actual_minutes: 270, start_delay_minutes: 15, actual_km: 212.5, distance_delta_km: 12.5 });
  });
});

describe("transitions and dates", () => {
  it("allows only the documented moves", () => {
    expect(canMove("planned", "dispatched")).toBe(true);
    expect(canMove("planned", "in_progress")).toBe(false);
    expect(canMove("in_progress", "canceled")).toBe(false);
  });
  it("builds a week from the given first day", () => {
    expect(weekDates("2026-10-08", 0)).toEqual(["2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10"]);
    expect(weekDates("2026-10-08", 6)[0]).toBe("2026-10-03");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});
