import { describe, expect, it } from "vitest";
import {
  DELIVERY_TRANSITIONS, deliveryKpis, firstName, haversineKm, mapImportRows, nearestNeighborOrder, parseCsv, routeDistanceKm,
} from "./deliveries";

const depot = { lat: 23.588, lng: 58.383 }; // Ghala
const stops = [
  { id: "far", lat: 24.347, lng: 56.709 }, // Sohar
  { id: "none", lat: null, lng: null },
  { id: "near", lat: 23.596, lng: 58.417 }, // Al Khuwair
  { id: "mid", lat: 23.679, lng: 57.886 }, // Barka
];

describe("haversineKm", () => {
  it("is zero for the same point and symmetric", () => {
    expect(haversineKm(depot, depot)).toBe(0);
    expect(haversineKm(depot, stops[0] as never)).toBeCloseTo(haversineKm(stops[0] as never, depot), 6);
  });
  it("Muscat to Sohar is about 190 km in a straight line", () => {
    const d = haversineKm(depot, { lat: 24.347, lng: 56.709 });
    expect(d).toBeGreaterThan(185);
    expect(d).toBeLessThan(195);
  });
});

describe("nearestNeighborOrder", () => {
  it("visits the nearest stop first and keeps unlocated stops last", () => {
    expect(nearestNeighborOrder(depot, stops)).toEqual(["near", "mid", "far", "none"]);
  });
  it("starts from the first located stop without a depot", () => {
    expect(nearestNeighborOrder(null, stops)).toEqual(["far", "mid", "near", "none"]);
  });
  it("handles empty and coordinate-free lists", () => {
    expect(nearestNeighborOrder(depot, [])).toEqual([]);
    expect(nearestNeighborOrder(null, [{ id: "a", lat: null, lng: null }])).toEqual(["a"]);
  });
});

describe("routeDistanceKm", () => {
  it("sums legs from the depot and skips unlocated stops", () => {
    const ordered = [stops[2], stops[1], stops[3]];
    const expected = haversineKm(depot, stops[2] as never) + haversineKm(stops[2] as never, stops[3] as never);
    expect(routeDistanceKm(depot, ordered)).toBeCloseTo(Math.round(expected * 10) / 10, 6);
    expect(routeDistanceKm(null, [])).toBe(0);
  });
});

describe("parseCsv", () => {
  it("reads quotes, doubled quotes, CRLF and a BOM", () => {
    const csv = '﻿name,address\r\n"Al Balushi, Aisha","Way ""3021"""\r\n\r\nKhalid,Ruwi\n';
    expect(parseCsv(csv)).toEqual([["name", "address"], ["Al Balushi, Aisha", 'Way "3021"'], ["Khalid", "Ruwi"]]);
  });
  it("keeps newlines inside quotes", () => {
    expect(parseCsv('a,b\n"line1\nline2",x')).toEqual([["a", "b"], ["line1\nline2", "x"]]);
  });
});

describe("mapImportRows", () => {
  it("maps header aliases and parses numbers", () => {
    const { rows, problems, unknownHeaders } = mapImportRows(parseCsv(
      "Recipient,Phone,Address,City,Latitude,Longitude,Pieces,Weight,COD,Order,Notes,Colour\n" +
      'Aisha,+968 9123,"Way 3021",Muscat,23.59,58.41,2,"1,250.5",12.500,SO-1,Call first,red',
    ));
    expect(problems).toEqual([]);
    expect(unknownHeaders).toEqual(["Colour"]);
    expect(rows[0]).toEqual({
      recipient_name: "Aisha", recipient_phone: "+968 9123", address: "Way 3021", city: "Muscat", lat: 23.59, lng: 58.41,
      parcels: 2, weight_kg: 1250.5, cod_amount: 12.5, reference: "SO-1", instructions: "Call first",
    });
  });
  it("reports missing fields, bad numbers and half coordinates with CSV line numbers", () => {
    const { problems } = mapImportRows(parseCsv("name,address,cod,lat,lng,parcels\n,Ruwi,abc,23.5,,0\nKhalid,,1,,,1"));
    expect(problems).toEqual([
      { line: 2, field: "recipient_name", problem: "missing" },
      { line: 2, field: "cod_amount", problem: "number" },
      { line: 2, field: "lat", problem: "coords" },
      { line: 2, field: "parcels", problem: "number" },
      { line: 3, field: "address", problem: "missing" },
    ]);
  });
});

describe("deliveryKpis", () => {
  it("computes first-attempt rate and COD figures", () => {
    const k = deliveryKpis([
      { status: "delivered", attempts: 1, cod_amount: 10, cod_collected: 10 },
      { status: "delivered", attempts: 2, cod_amount: 5, cod_collected: 3.5 },
      { status: "returned", attempts: 2, cod_amount: 7, cod_collected: null },
      { status: "pending", attempts: 0, cod_amount: 4.25, cod_collected: null },
      { status: "failed", attempts: 1, cod_amount: 1, cod_collected: null },
    ]);
    expect(k).toEqual({
      finished: 3, delivered: 2, firstAttempt: 1, firstAttemptPct: 33, codOutstanding: 5.25, codShortCount: 1, codShortfall: 1.5,
    });
  });
  it("has no rate without finished deliveries", () => {
    expect(deliveryKpis([]).firstAttemptPct).toBeNull();
  });
});

describe("transitions and names", () => {
  it("final states have no way out", () => {
    expect(DELIVERY_TRANSITIONS.delivered).toEqual([]);
    expect(DELIVERY_TRANSITIONS.returned).toEqual([]);
    expect(DELIVERY_TRANSITIONS.failed).toContain("out_for_delivery");
  });
  it("firstName keeps only the first word", () => {
    expect(firstName("  Aisha Al Balushi ")).toBe("Aisha");
    expect(firstName("")).toBeNull();
    expect(firstName(null)).toBeNull();
  });
});
