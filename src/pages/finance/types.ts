import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { listRows, wrapDbError } from "../../lib/db";
import type { BadgeTone } from "../../components/ui";
import type { ComboboxOption } from "../../components/Combobox";
import type { AccountType, BalanceRow, EntryStatus, ExpenseStatus, SourceType } from "../../../shared/finance";

export interface GlAccount {
  id: string;
  code: string;
  name: string;
  name_ar: string | null;
  account_type: AccountType;
  parent_id: string | null;
  is_system: boolean;
  active: boolean;
  description: string | null;
}

export interface JournalLine {
  id: string;
  entry_id: string;
  account_id: string;
  sort_order: number;
  description: string | null;
  debit: number;
  credit: number;
  vehicle_id: string | null;
  customer_id: string | null;
  supplier_id: string | null;
}

export interface JournalEntry {
  id: string;
  number: number | null;
  doc_number: string | null;
  entry_date: string;
  memo: string | null;
  status: EntryStatus;
  source_type: SourceType;
  source_id: string | null;
  reversal_of: string | null;
  reversed_by: string | null;
  total: number;
  posted_at: string | null;
  created_at: string;
}

export interface Expense {
  id: string;
  number: number | null;
  doc_number: string | null;
  expense_date: string;
  category_account_id: string;
  payment_account_id: string;
  supplier_id: string | null;
  vehicle_id: string | null;
  description: string;
  reference: string | null;
  amount: number;
  tax_amount: number;
  total: number;
  status: ExpenseStatus;
  rejection_reason: string | null;
  journal_entry_id: string | null;
  approved_at: string | null;
  created_at: string;
  supplier: { name: string } | null;
  vehicle: { name: string; license_plate: string | null } | null;
}

export interface FinanceSettings {
  id: string;
  tenant_id: string;
  accounts: Record<string, string>;
  fiscal_year_start_month: number;
  lock_date: string | null;
}

export const ENTRY_SELECT =
  "id, number, doc_number, entry_date, memo, status, source_type, source_id, reversal_of, reversed_by, total, posted_at, created_at";
export const EXPENSE_SELECT =
  "id, number, doc_number, expense_date, category_account_id, payment_account_id, supplier_id, vehicle_id, description, reference, " +
  "amount, tax_amount, total, status, rejection_reason, journal_entry_id, approved_at, created_at, " +
  "supplier:suppliers(name), vehicle:vehicles(name, license_plate)";

export const entryTone: Record<EntryStatus, BadgeTone> = { draft: "slate", posted: "green", reversed: "yellow" };
export const expenseTone: Record<ExpenseStatus, BadgeTone> = { draft: "slate", approved: "blue", posted: "green", rejected: "red" };

/** The chart of accounts is small and bounded (a few hundred rows at most), so it loads whole. */
export function useAccounts() {
  return useQuery({
    queryKey: ["gl_accounts"],
    queryFn: () => listRows<GlAccount>("gl_accounts", (q) => q.select("*").order("code").limit(2000)),
  });
}

export function useFinanceSettings() {
  return useQuery({
    queryKey: ["finance_settings"],
    queryFn: async () => (await listRows<FinanceSettings>("finance_settings", (q) => q.select("*").limit(1)))[0] ?? null,
  });
}

/** Posted movement per account (the finance_balances RPC; RLS applies). */
export function useBalances(from: string | null, to: string | null, enabled = true) {
  return useQuery({
    queryKey: ["finance_balances", from, to],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("finance_balances", { p_from: from ?? undefined, p_to: to ?? undefined });
      if (error) throw wrapDbError(error);
      return (data ?? []).map((r) => ({ ...r, opening: Number(r.opening), debit: Number(r.debit), credit: Number(r.credit) })) as BalanceRow[];
    },
  });
}

export function accountName(a: { name: string; name_ar?: string | null }, lang: string): string {
  return lang === "ar" && a.name_ar ? a.name_ar : a.name;
}

export function accountOptions(accounts: GlAccount[], lang: string, filter?: (a: GlAccount) => boolean): ComboboxOption[] {
  return accounts
    .filter((a) => (filter ? filter(a) : a.active))
    .map((a) => ({ value: a.id, label: accountName(a, lang), meta: a.code }));
}

/** Where a posted entry came from, when that record has a page. */
export function sourceLink(e: Pick<JournalEntry, "source_type" | "source_id">): string | null {
  if (!e.source_id) return null;
  switch (e.source_type) {
    case "invoice":
      return `/sales/invoices/${e.source_id}`;
    case "expense":
      return `/finance/expenses?expense=${e.source_id}`;
    default:
      return null;
  }
}

/** YYYY-MM-DD of now in a time zone. */
export function todayIn(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function addMonthsIso(iso: string, months: number): string {
  const [y, m] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + months, 1));
  return d.toISOString().slice(0, 10);
}

/** Last day of the month of a YYYY-MM-DD date. */
export function monthEnd(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
