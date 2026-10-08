import { describe, expect, it } from "vitest";
import {
  billBalance, billDueIn, billPayable, poBillable, poDeletable, poMoves, poReceivable, receivedShare, remainingQty,
} from "./purchasing";

describe("purchase order rules", () => {
  it("offers the manual moves the database accepts", () => {
    expect(poMoves("draft")).toEqual(["sent", "confirmed", "canceled"]);
    expect(poMoves("sent")).toEqual(["confirmed", "draft", "canceled"]);
    expect(poMoves("confirmed")).toEqual(["canceled"]);
    expect(poMoves("partially_received")).toEqual(["closed"]);
    expect(poMoves("closed")).toEqual([]);
  });
  it("knows when to receive, bill and delete", () => {
    expect(poReceivable("sent")).toBe(false);
    expect(poReceivable("partially_received")).toBe(true);
    expect(poBillable("draft")).toBe(false);
    expect(poBillable("closed")).toBe(true);
    expect(poDeletable("canceled")).toBe(true);
    expect(poDeletable("received")).toBe(false);
  });
  it("computes what is left to receive", () => {
    expect(remainingQty({ quantity: 10, received_qty: 6.5 })).toBe(3.5);
    expect(remainingQty({ quantity: 1, received_qty: 2 })).toBe(0);
    expect(receivedShare([{ quantity: 10, received_qty: 5 }, { quantity: 10, received_qty: 10 }])).toBe(0.75);
    expect(receivedShare([])).toBe(0);
  });
});

describe("vendor bill rules", () => {
  it("pays only approved bills", () => {
    expect(billPayable("draft")).toBe(false);
    expect(billPayable("partially_paid")).toBe(true);
    expect(billPayable("paid")).toBe(false);
  });
  it("rounds the balance to the currency", () => {
    expect(billBalance({ total: 17.175, amount_paid: 10 }, 3)).toBe(7.175);
    expect(billBalance({ total: 5, amount_paid: 5 }, 2)).toBe(0);
  });
  it("counts days to due", () => {
    expect(billDueIn({ status: "open", due_date: "2026-10-10" }, "2026-10-08")).toBe(2);
    expect(billDueIn({ status: "open", due_date: "2026-10-01" }, "2026-10-08")).toBe(-7);
    expect(billDueIn({ status: "paid", due_date: "2026-10-01" }, "2026-10-08")).toBeNull();
  });
});
