import { describe, expect, it } from "vitest";
import {
  canTransition, isLocked, marginStats, onTimePct, quoteFreight, ratePrice, SHIPMENT_TRANSITIONS, weeklyRevenue, weekStart,
  type FreightRate,
} from "./tms";

const rate = (o: Partial<FreightRate>): FreightRate => ({
  id: "r", origin_city: "Muscat", destination_city: "Sohar", mode: "road_ftl", customer_id: null,
  rate_per_kg: null, rate_per_trip: null, min_charge: 0, valid_from: "2026-01-01", valid_to: null, ...o,
});
// Same rates as docs/buildout/tests/tms_tests.sql.
const rates = [
  rate({ id: "a", rate_per_trip: 120, rate_per_kg: 0.01, min_charge: 150 }),
  rate({ id: "b", rate_per_trip: 140 }),
  rate({ id: "c", origin_city: "muscat ", destination_city: "SOHAR", customer_id: "cust", rate_per_trip: 200 }),
  rate({ id: "d", rate_per_trip: 10, valid_from: "2026-09-01", valid_to: "2026-09-30" }),
];
const on = "2026-10-08";

describe("ratePrice", () => {
  it("adds trip and weight and applies the minimum", () => {
    expect(ratePrice(rates[0], 0)).toBe(150);
    expect(ratePrice(rates[0], 10000)).toBe(220);
    expect(ratePrice(rates[0], null)).toBe(150);
    expect(ratePrice(rates[0], -50)).toBe(150);
  });
});

describe("quoteFreight", () => {
  it("picks the cheapest general rate", () => {
    expect(quoteFreight(rates, { origin_city: "Muscat", destination_city: "Sohar", mode: "road_ftl", weight_kg: 1000, on }))
      .toEqual({ rate_id: "b", price: 140, customer_specific: false });
  });
  it("prefers the customer's own rate even when dearer, ignoring case and spaces", () => {
    expect(quoteFreight(rates, { origin_city: " MUSCAT", destination_city: "sohar", mode: "road_ftl", weight_kg: 1000,
      customer_id: "cust", on })).toEqual({ rate_id: "c", price: 200, customer_specific: true });
  });
  it("skips expired rates and other modes", () => {
    expect(quoteFreight(rates, { origin_city: "Muscat", destination_city: "Sohar", mode: "courier", weight_kg: 1, on })).toBeNull();
    expect(quoteFreight(rates, { origin_city: "Muscat", destination_city: "Sohar", mode: "road_ftl", weight_kg: 0, on: "2026-09-10" })?.rate_id).toBe("d");
  });
});

describe("transitions", () => {
  it("follows the guard", () => {
    expect(canTransition("draft", "booked")).toBe(true);
    expect(canTransition("draft", "in_transit")).toBe(false);
    expect(canTransition("in_transit", "canceled")).toBe(false);
    expect(canTransition("exception", "delivered")).toBe(true);
    expect(SHIPMENT_TRANSITIONS.closed).toEqual([]);
    expect(isLocked("canceled")).toBe(true);
    expect(isLocked("delivered")).toBe(false);
  });
});

describe("stats", () => {
  const rows = [
    { status: "delivered" as const, total_charge: 300, carrier_cost: 200, delivered_at: "2026-10-05T10:00:00Z",
      delivery_window_end: "2026-10-05T12:00:00Z", created_at: "2026-10-01T08:00:00Z" },
    { status: "closed" as const, total_charge: 100, carrier_cost: null, delivered_at: "2026-10-06T14:00:00Z",
      delivery_window_end: "2026-10-06T12:00:00Z", created_at: "2026-10-02T08:00:00Z" },
    { status: "in_transit" as const, total_charge: 50, carrier_cost: 40, delivered_at: null,
      delivery_window_end: null, created_at: "2026-09-20T08:00:00Z" },
    { status: "canceled" as const, total_charge: 999, carrier_cost: 0, delivered_at: null,
      delivery_window_end: null, created_at: "2026-10-03T08:00:00Z" },
  ];
  it("on-time share counts only delivered shipments with a window", () => {
    expect(onTimePct(rows)).toBe(50);
    expect(onTimePct([])).toBeNull();
  });
  it("margin skips canceled shipments", () => {
    expect(marginStats(rows)).toEqual({ revenue: 450, cost: 240, margin: 210, marginPct: 46.7, count: 3 });
    expect(marginStats([]).marginPct).toBeNull();
  });
  it("weeks start on Monday and bucket by delivery date", () => {
    expect(weekStart("2026-10-08T10:00:00Z")).toBe("2026-10-05");
    expect(weekStart("2026-10-05T00:00:00Z")).toBe("2026-10-05");
    const w = weeklyRevenue(rows, 3, new Date("2026-10-08T12:00:00Z"));
    expect(w.map((x) => x.week)).toEqual(["2026-09-21", "2026-09-28", "2026-10-05"]);
    expect(w[2]).toEqual({ week: "2026-10-05", revenue: 400, cost: 200 });
    expect(w[0].revenue).toBe(0); // the 2026-09-20 shipment falls in the week before
  });
});
