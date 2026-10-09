import { describe, expect, it } from "vitest";
import {
  accountBalances,
  accountTree,
  balanceSheet,
  fiscalYearStart,
  lineTotals,
  monthKeys,
  monthlySeries,
  naturalBalance,
  nextExpenseStatuses,
  profitAndLoss,
  trialBalance,
  type Account,
} from "./finance";

const acc = (id: string, code: string, account_type: string, parent_id: string | null = null): Account => ({
  id,
  code,
  name: id,
  account_type,
  parent_id,
});
const accounts = [
  acc("cash", "1000", "asset"),
  acc("ar", "1100", "asset"),
  acc("ap", "2000", "liability"),
  acc("eq", "3000", "equity"),
  acc("rev", "4000", "income"),
  acc("fuel", "6000", "expense"),
  acc("idle", "6900", "expense"),
];
// Owner puts in 1000 cash; invoices 500 (AR); spends 120 on fuel on credit; collects 200.
const rows = [
  { account_id: "cash", opening: 0, debit: 1200, credit: 0 },
  { account_id: "ar", opening: 0, debit: 500, credit: 200 },
  { account_id: "ap", opening: 0, debit: 0, credit: 120 },
  { account_id: "eq", opening: 0, debit: 0, credit: 1000 },
  { account_id: "rev", opening: 0, debit: 0, credit: 500 },
  { account_id: "fuel", opening: 0, debit: 120, credit: 0 },
];

describe("balances", () => {
  it("joins rows, orders by code and fills zeros", () => {
    const b = accountBalances([...accounts].reverse(), rows);
    expect(b.map((x) => x.account.code)).toEqual(["1000", "1100", "2000", "3000", "4000", "6000", "6900"]);
    expect(b.find((x) => x.account.id === "idle")).toMatchObject({ closing: 0, natural: 0 });
    expect(b.find((x) => x.account.id === "rev")).toMatchObject({ closing: -500, natural: 500 });
  });
  it("uses the natural sign", () => {
    expect(naturalBalance("asset", 10, 3)).toBe(7);
    expect(naturalBalance("liability", 10, 3)).toBe(-7);
    expect(naturalBalance("income", 0, 0.1 + 0.2)).toBe(0.3);
  });
});

describe("statements", () => {
  const b = accountBalances(accounts, rows);
  it("trial balance balances and drops zero accounts", () => {
    const tb = trialBalance(b);
    expect(tb.balanced).toBe(true);
    expect(tb.debit).toBe(1620);
    expect(tb.rows.some((r) => r.account.id === "idle")).toBe(false);
    expect(tb.rows.find((r) => r.account.id === "ap")).toMatchObject({ debit: 0, credit: 120 });
  });
  it("profit and loss uses period movement", () => {
    const pl = profitAndLoss(accountBalances(accounts, [...rows, { account_id: "rev", opening: -999, debit: 0, credit: 0 }].slice(1)));
    expect(pl.totalIncome).toBe(0);
    const full = profitAndLoss(b);
    expect(full).toMatchObject({ totalIncome: 500, totalExpense: 120, net: 380 });
  });
  it("balance sheet balances with current earnings", () => {
    const bs = balanceSheet(b);
    expect(bs).toMatchObject({ totalAssets: 1500, totalLiabilities: 120, currentEarnings: 380, totalEquity: 1380, balanced: true });
  });
});

describe("journal editor", () => {
  it("needs two filled, equal sides", () => {
    expect(lineTotals([{ debit: "100", credit: "" }, { debit: null, credit: 100 }]).balanced).toBe(true);
    expect(lineTotals([{ debit: 100, credit: 0 }])).toMatchObject({ balanced: false, difference: 100 });
    expect(lineTotals([{ debit: 0.1, credit: 0 }, { debit: 0.2, credit: 0 }, { debit: 0, credit: 0.3 }]).balanced).toBe(true);
    expect(lineTotals([{ debit: "abc", credit: 0 }, { debit: 0, credit: 0 }]).balanced).toBe(false);
  });
});

describe("helpers", () => {
  it("builds the account tree and survives cycles", () => {
    const t = accountTree([acc("b", "6010", "expense", "a"), acc("a", "6000", "expense"), acc("c", "1000", "asset"),
      acc("x", "9", "asset", "y"), acc("y", "8", "asset", "x")]);
    expect(t.slice(0, 3).map((n) => [n.account.id, n.depth])).toEqual([["c", 0], ["a", 0], ["b", 1]]);
    expect(t).toHaveLength(5);
  });
  it("expense moves", () => {
    expect(nextExpenseStatuses("draft")).toEqual(["approved", "rejected"]);
    expect(nextExpenseStatuses("posted")).toEqual([]);
  });
  it("months and fiscal years", () => {
    expect(monthKeys("2025-11-15", "2026-02-01")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(monthlySeries([{ month: "2026-01", account_type: "income", amount: 10 }, { month: "2026-01", account_type: "expense", amount: 4 }],
      ["2025-12", "2026-01"])).toEqual([
      { month: "2025-12", income: 0, expense: 0, net: 0 },
      { month: "2026-01", income: 10, expense: 4, net: 6 },
    ]);
    expect(fiscalYearStart("2026-03-10", 4)).toBe("2025-04-01");
    expect(fiscalYearStart("2026-04-01", 4)).toBe("2026-04-01");
    expect(fiscalYearStart("2026-04-01", 1)).toBe("2026-01-01");
  });
});
