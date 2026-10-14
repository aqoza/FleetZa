import { describe, expect, it } from "vitest";
import { addToCart, cartTotals, checkTender, lineAmounts, quickCash, roundTo, type CartLine } from "./pos";

const oil: CartLine = { productId: "oil", name: "Oil", unitPrice: 12.5, taxRate: 5, quantity: 2, discountPercent: 10 };
const wash: CartLine = { productId: "wash", name: "Wash", unitPrice: 999, taxRate: 0, quantity: 1, discountPercent: 0 };

describe("pos arithmetic (mirrors pos_checkout)", () => {
  it("rounds half away from zero like Postgres", () => {
    expect(roundTo(1.125, 2)).toBe(1.13);
    expect(roundTo(1.005, 2)).toBe(1.01);
    expect(roundTo(-1.125, 2)).toBe(-1.13);
    expect(roundTo(2.5, 0)).toBe(3);
  });
  it("prices a line", () => {
    expect(lineAmounts(oil, 2)).toEqual({ gross: 25, discount: 2.5, net: 22.5, tax: 1.13, total: 23.63 });
    expect(lineAmounts({ ...oil, discountPercent: 150 }, 2).discount).toBe(25);
  });
  it("totals the cart like the database test", () => {
    expect(cartTotals([oil, wash], 2)).toEqual({ subtotal: 1024, discount: 2.5, tax: 1.13, total: 1022.63, items: 3 });
    expect(cartTotals([{ ...oil, quantity: 1, discountPercent: 0 }], 3).total).toBe(13.125);
  });
});

describe("tender", () => {
  it("gives change from cash only", () => {
    expect(checkTender(1022.63, { cash: 1000, card: 30, other: 0 }, 2)).toEqual({ change: 7.37, due: 0, problem: null });
    expect(checkTender(4, { cash: 0, card: 10, other: 0 }, 2).problem).toBe("change_from_card");
    expect(checkTender(8, { cash: 7.99, card: 0, other: 0 }, 2)).toEqual({ change: 0, due: 0.01, problem: "underpaid" });
    expect(checkTender(8, { cash: -1, card: 9, other: 0 }, 2).problem).toBe("negative");
  });
  it("suggests quick cash amounts", () => {
    expect(quickCash(12)).toEqual([12, 15, 20, 50]);
    expect(quickCash(20)).toEqual([20, 50, 100, 200]);
    expect(quickCash(0)).toEqual([]);
  });
});

describe("cart", () => {
  it("adds or bumps", () => {
    const p = { id: "oil", name: "Oil", unit_price: 12.5, tax_rate: 5 };
    const once = addToCart([], p);
    expect(once).toHaveLength(1);
    expect(addToCart(once, p)[0].quantity).toBe(2);
  });
});
