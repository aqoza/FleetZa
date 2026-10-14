import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { listRows, wrapDbError } from "../../lib/db";
import type { BadgeTone } from "../../components/ui";
import type { OrderStatus } from "../../../shared/pos";

export interface PosRegister {
  id: string;
  name: string;
  warehouse_id: string | null;
  active: boolean;
  notes: string | null;
  warehouse?: { name: string } | null;
}

export interface PosSession {
  id: string;
  doc_number: string | null;
  register_id: string;
  status: "open" | "closed";
  opened_at: string;
  opening_cash: number;
  closed_at: string | null;
  closing_cash_counted: number | null;
  expected_cash: number | null;
  cash_difference: number | null;
  notes: string | null;
  register?: { name: string } | null;
}

export interface PosOrder {
  id: string;
  doc_number: string | null;
  session_id: string;
  register_id: string;
  customer_id: string | null;
  status: OrderStatus;
  currency: string;
  currency_decimals: number;
  subtotal: number;
  discount_total: number;
  tax_total: number;
  total: number;
  paid_cash: number;
  paid_card: number;
  paid_other: number;
  change_due: number;
  completed_at: string;
  refund_of: string | null;
  notes: string | null;
  register?: { name: string } | null;
  customer?: { name: string } | null;
  session?: { doc_number: string | null } | null;
}

export interface PosOrderLine {
  id: string;
  sort_order: number;
  product_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  discount_percent: number;
  tax_rate: number;
  line_discount: number;
  line_total: number;
}

export interface PosProduct {
  id: string;
  name: string;
  sku: string | null;
  kind: string;
  unit_price: number;
  tax_rate: number;
}

export interface SessionSummary {
  sales_count: number;
  refund_count: number;
  gross_sales: number;
  refunds: number;
  net_sales: number;
  tax: number;
  discounts: number;
  cash: number;
  card: number;
  other: number;
  expected_cash: number;
}

export const REGISTER_SELECT = "id, name, warehouse_id, active, notes, warehouse:warehouses(name)";
export const SESSION_SELECT =
  "id, doc_number, register_id, status, opened_at, opening_cash, closed_at, closing_cash_counted, expected_cash, cash_difference, notes, register:pos_registers(name)";
export const ORDER_SELECT =
  "id, doc_number, session_id, register_id, customer_id, status, currency, currency_decimals, subtotal, discount_total, tax_total, total, paid_cash, paid_card, paid_other, change_due, completed_at, refund_of, notes, register:pos_registers(name), customer:customers(name), session:pos_sessions(doc_number)";

export const orderTone: Record<OrderStatus, BadgeTone> = { completed: "green", refunded: "yellow", voided: "slate" };

/** The currency's minor-unit digits (OMR 3, USD 2), as the server snapshots them. */
export function currencyDecimals(currency: string): number {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

export function todayIn(timeZone: string, offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export const n = (v: unknown) => Number(v ?? 0);

export function useRegisters(activeOnly = false) {
  return useQuery({
    queryKey: ["pos_registers", { activeOnly }],
    queryFn: () =>
      listRows<PosRegister>("pos_registers", (q) => {
        let f = q.select(REGISTER_SELECT);
        if (activeOnly) f = f.eq("active", true);
        return f.order("name").limit(200);
      }),
  });
}

export function useOpenSession(registerId: string) {
  return useQuery({
    queryKey: ["pos_sessions", "open", registerId],
    enabled: !!registerId,
    queryFn: async () =>
      (await listRows<PosSession>("pos_sessions", (q) =>
        q.select(SESSION_SELECT).eq("register_id", registerId).eq("status", "open").limit(1)))[0] ?? null,
  });
}

export function useSessionSummary(sessionId: string | null | undefined) {
  return useQuery({
    queryKey: ["pos_orders", "summary", sessionId],
    enabled: !!sessionId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("pos_session_summary", { p_session_id: sessionId ?? "" });
      if (error) throw wrapDbError(error);
      return data as unknown as SessionSummary;
    },
  });
}

/** Query keys every POS write touches. */
export const POS_KEYS = ["pos_sessions", "pos_orders", "pos_daily_sales", "pos_registers", "stock_levels", "stock_moves", "inventory_summary"];
