/**
 * Finance (module `finance`): pure helpers shared by the pages and tests.
 * Balances come from the finance_balances RPC (posted movement per account);
 * everything here is aggregation and presentation logic, no I/O.
 */

export const ACCOUNT_TYPES = ["asset", "liability", "equity", "income", "expense"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const ENTRY_STATUSES = ["draft", "posted", "reversed"] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

export const SOURCE_TYPES = [
  "manual",
  "invoice",
  "payment",
  "vendor_bill",
  "vendor_payment",
  "expense",
  "payroll",
  "pos",
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const EXPENSE_STATUSES = ["draft", "approved", "posted", "rejected"] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];

/** Keys of finance_settings.accounts, in the order the settings page lists them. */
export const ACCOUNT_MAPPING_KEYS = [
  "cash",
  "bank",
  "receivable",
  "inventory",
  "vat_input",
  "payable",
  "vat_output",
  "payroll_liabilities",
  "equity",
  "retained_earnings",
  "revenue",
  "purchases",
  "salaries",
] as const;
export type AccountMappingKey = (typeof ACCOUNT_MAPPING_KEYS)[number];

/** Which account types each mapping key accepts. */
export const MAPPING_ACCOUNT_TYPES: Record<AccountMappingKey, AccountType[]> = {
  cash: ["asset"],
  bank: ["asset"],
  receivable: ["asset"],
  inventory: ["asset"],
  vat_input: ["asset", "liability"],
  payable: ["liability"],
  vat_output: ["liability", "asset"],
  payroll_liabilities: ["liability"],
  equity: ["equity"],
  retained_earnings: ["equity"],
  revenue: ["income"],
  purchases: ["expense"],
  salaries: ["expense"],
};

/** Status moves a person can make on an expense (posting is its own action). */
export function nextExpenseStatuses(status: ExpenseStatus): ExpenseStatus[] {
  switch (status) {
    case "draft":
      return ["approved", "rejected"];
    case "approved":
      return ["draft", "rejected"];
    default:
      return [];
  }
}

/** Assets and expenses grow with debits; the rest with credits. */
export function isDebitNormal(type: AccountType): boolean {
  return type === "asset" || type === "expense";
}

/** Balance in the account's natural sign (positive = normal balance). */
export function naturalBalance(type: AccountType, debit: number, credit: number): number {
  return round(isDebitNormal(type) ? debit - credit : credit - debit);
}

export function round(n: number, decimals = 3): number {
  const f = 10 ** decimals;
  return Math.round((n + Number.EPSILON) * f) / f;
}

export interface Account {
  id: string;
  code: string;
  name: string;
  name_ar?: string | null;
  account_type: string;
  parent_id: string | null;
  active?: boolean;
  is_system?: boolean;
}

export interface BalanceRow {
  account_id: string;
  opening: number;
  debit: number;
  credit: number;
}

export interface AccountBalance {
  account: Account;
  /** Movement before the period. */
  opening: number;
  debit: number;
  credit: number;
  /** opening + debit - credit (debit positive). */
  closing: number;
  /** closing in the account's natural sign. */
  natural: number;
}

function asType(t: string): AccountType {
  return (ACCOUNT_TYPES as readonly string[]).includes(t) ? (t as AccountType) : "asset";
}

/** Joins accounts with their balance rows (accounts without movement get zeros), ordered by code. */
export function accountBalances(accounts: Account[], rows: BalanceRow[]): AccountBalance[] {
  const byId = new Map(rows.map((r) => [r.account_id, r]));
  return [...accounts]
    .sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }))
    .map((account) => {
      const r = byId.get(account.id);
      const opening = Number(r?.opening ?? 0);
      const debit = Number(r?.debit ?? 0);
      const credit = Number(r?.credit ?? 0);
      const closing = round(opening + debit - credit);
      const natural = isDebitNormal(asType(account.account_type)) ? closing : round(-closing);
      return { account, opening, debit, credit, closing, natural };
    });
}

export interface TrialBalanceRow {
  account: Account;
  debit: number;
  credit: number;
}

/** Trial balance: each account's closing balance on its debit or credit side. */
export function trialBalance(balances: AccountBalance[]): {
  rows: TrialBalanceRow[];
  debit: number;
  credit: number;
  balanced: boolean;
} {
  const rows = balances
    .filter((b) => b.closing !== 0)
    .map((b) => ({
      account: b.account,
      debit: b.closing > 0 ? b.closing : 0,
      credit: b.closing < 0 ? round(-b.closing) : 0,
    }));
  const debit = round(rows.reduce((s, r) => s + r.debit, 0));
  const credit = round(rows.reduce((s, r) => s + r.credit, 0));
  return { rows, debit, credit, balanced: debit === credit };
}

export interface StatementLine {
  account: Account;
  amount: number;
}

/** Profit and loss over the balances' period (period movement only, no opening). */
export function profitAndLoss(balances: AccountBalance[]): {
  income: StatementLine[];
  expense: StatementLine[];
  totalIncome: number;
  totalExpense: number;
  net: number;
} {
  const period = (b: AccountBalance) => naturalBalance(asType(b.account.account_type), b.debit, b.credit);
  const income = balances
    .filter((b) => b.account.account_type === "income" && period(b) !== 0)
    .map((b) => ({ account: b.account, amount: period(b) }));
  const expense = balances
    .filter((b) => b.account.account_type === "expense" && period(b) !== 0)
    .map((b) => ({ account: b.account, amount: period(b) }));
  const totalIncome = round(income.reduce((s, l) => s + l.amount, 0));
  const totalExpense = round(expense.reduce((s, l) => s + l.amount, 0));
  return { income, expense, totalIncome, totalExpense, net: round(totalIncome - totalExpense) };
}

/**
 * Balance sheet as of the balances' end date (balances fetched without a start
 * date, so closing = everything to date). Income and expense not yet closed to
 * retained earnings show as current earnings under equity.
 */
export function balanceSheet(balances: AccountBalance[]): {
  assets: StatementLine[];
  liabilities: StatementLine[];
  equity: StatementLine[];
  totalAssets: number;
  totalLiabilities: number;
  currentEarnings: number;
  totalEquity: number;
  balanced: boolean;
} {
  const pick = (type: AccountType) =>
    balances
      .filter((b) => b.account.account_type === type && b.natural !== 0)
      .map((b) => ({ account: b.account, amount: b.natural }));
  const assets = pick("asset");
  const liabilities = pick("liability");
  const equity = pick("equity");
  const sum = (ls: StatementLine[]) => round(ls.reduce((s, l) => s + l.amount, 0));
  const income = sum(pick("income"));
  const expense = sum(pick("expense"));
  const currentEarnings = round(income - expense);
  const totalAssets = sum(assets);
  const totalLiabilities = sum(liabilities);
  const totalEquity = round(sum(equity) + currentEarnings);
  return {
    assets,
    liabilities,
    equity,
    totalAssets,
    totalLiabilities,
    currentEarnings,
    totalEquity,
    balanced: totalAssets === round(totalLiabilities + totalEquity),
  };
}

export interface DraftLine {
  debit: number | string | null | undefined;
  credit: number | string | null | undefined;
}

/** Totals of a journal line editor; an entry posts only when balanced. */
export function lineTotals(lines: DraftLine[]): { debit: number; credit: number; difference: number; balanced: boolean } {
  const num = (v: DraftLine["debit"]) => {
    const n = typeof v === "string" ? Number(v) : (v ?? 0);
    return Number.isFinite(n) ? n : 0;
  };
  const debit = round(lines.reduce((s, l) => s + num(l.debit), 0));
  const credit = round(lines.reduce((s, l) => s + num(l.credit), 0));
  const difference = round(debit - credit);
  const filled = lines.filter((l) => num(l.debit) > 0 || num(l.credit) > 0).length;
  return { debit, credit, difference, balanced: difference === 0 && debit > 0 && filled >= 2 };
}

export interface TreeAccount<A extends Account = Account> {
  account: A;
  depth: number;
}

/** Depth-first chart of accounts (children under their parent, each level by code). */
export function accountTree<A extends Account>(accounts: A[]): TreeAccount<A>[] {
  const ids = new Set(accounts.map((a) => a.id));
  const children = new Map<string | null, A[]>();
  for (const a of accounts) {
    const parent = a.parent_id && ids.has(a.parent_id) && a.parent_id !== a.id ? a.parent_id : null;
    const list = children.get(parent) ?? [];
    list.push(a);
    children.set(parent, list);
  }
  for (const list of children.values()) list.sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }));
  const out: TreeAccount<A>[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const a of children.get(parent) ?? []) {
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      out.push({ account: a, depth });
      walk(a.id, depth + 1);
    }
  };
  walk(null, 0);
  // Anything left is in a parent cycle; list it at the top level.
  for (const a of accounts) if (!seen.has(a.id)) out.push({ account: a, depth: 0 });
  return out;
}

/** "YYYY-MM" keys from the month of `from` through the month of `to`. */
export function monthKeys(from: string, to: string): string[] {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  const out: string[] = [];
  let y = fy;
  let m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    if (out.length > 240) break;
  }
  return out;
}

export interface MonthlyRow {
  month: string;
  account_type: string;
  amount: number;
}

/** Fills the finance_monthly rows into one point per month (missing months are zero). */
export function monthlySeries(rows: MonthlyRow[], months: string[]): { month: string; income: number; expense: number; net: number }[] {
  return months.map((month) => {
    const income = round(rows.filter((r) => r.month === month && r.account_type === "income").reduce((s, r) => s + Number(r.amount), 0));
    const expense = round(rows.filter((r) => r.month === month && r.account_type === "expense").reduce((s, r) => s + Number(r.amount), 0));
    return { month, income, expense, net: round(income - expense) };
  });
}

/** First day of the fiscal year containing `date` (YYYY-MM-DD), given the start month (1-12). */
export function fiscalYearStart(date: string, startMonth: number): string {
  const [y, m] = date.split("-").map(Number);
  const sm = Math.min(12, Math.max(1, Math.trunc(startMonth) || 1));
  const year = m >= sm ? y : y - 1;
  return `${year}-${String(sm).padStart(2, "0")}-01`;
}
