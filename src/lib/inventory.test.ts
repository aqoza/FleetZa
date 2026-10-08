import { describe, expect, it } from "vitest";
import { formatQty, stockState, sumOf, totalsByItem, valueByWarehouse } from "./inventory";

describe("stockState", () => {
  it("matches the server's low-stock rule", () => {
    expect(stockState(12, 10, true)).toBe("ok");
    expect(stockState(10, 10, true)).toBe("low");
    expect(stockState(3, 10, true)).toBe("low");
    expect(stockState(0, 10, true)).toBe("out");
    expect(stockState(-2, null, true)).toBe("out");
    expect(stockState(5, null, true)).toBe("ok");
    expect(stockState(0, 10, false)).toBe("untracked");
  });
});

describe("formatQty", () => {
  it("drops trailing zeros but keeps real decimals", () => {
    expect(formatQty(12)).toBe("12");
    expect(formatQty(2.5)).toBe("2.5");
    expect(formatQty(0.125)).toBe("0.125");
    expect(formatQty(1234.5)).toBe("1,234.5");
    expect(formatQty(null)).toBe("—");
  });
});

describe("valueByWarehouse", () => {
  it("rolls categories up per warehouse, highest value first", () => {
    const rows = [
      { warehouse_id: "a", warehouse_name: "Main", category: "Filters", item_count: 1, on_hand: 9, stock_value: 27 },
      { warehouse_id: "b", warehouse_name: "Van", category: "Filters", item_count: 1, on_hand: 4, stock_value: 12 },
      { warehouse_id: "a", warehouse_name: "Main", category: "Tyres", item_count: 1, on_hand: 6, stock_value: 600 },
    ];
    expect(valueByWarehouse(rows)).toEqual([
      { id: "a", name: "Main", value: 627 },
      { id: "b", name: "Van", value: 12 },
    ]);
  });
});

describe("sums", () => {
  it("accepts numeric strings", () => {
    expect(sumOf([{ v: "1.5" }, { v: 2 }, { v: null }], (r) => r.v)).toBe(3.5);
    expect(totalsByItem([
      { item_id: "x", on_hand: "2" }, { item_id: "x", on_hand: 3 }, { item_id: "y", on_hand: 1 },
    ])).toEqual(new Map([["x", 5], ["y", 1]]));
  });
});
