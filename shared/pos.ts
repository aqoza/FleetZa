/**
 * Point of sale (module `pos`): cart arithmetic shared by the register screen
 * and tests. It mirrors pos_checkout in migration 20261008000030_pos.sql (the
 * same rounding as sales documents), so the total the cashier sees is the
 * total the server books. No I/O.
 */

export const ORDER_STATUSES = ["completed", "refunded", "voided"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export interface CartLine {
  productId: string;
  name: string;
  unitPrice: number;
  taxRate: number;
  quantity: number;
  discountPercent: number;
}

export interface LineAmounts {
  gross: number;
  discount: number;
  net: number;
  tax: number;
  total: number;
}

/** Rounds half away from zero, like Postgres numeric round(). */
export function roundTo(n: number, decimals: number): number {
  const f = 10 ** decimals;
  const v = Math.abs(n) * f;
  // Nudge past binary representation error (1.005 * 100 = 100.49999...).
  const r = Math.round(v + 1e-9 * Math.max(1, v)) / f;
  return n < 0 ? -r : r;
}

export function lineAmounts(line: Pick<CartLine, "unitPrice" | "taxRate" | "quantity" | "discountPercent">, decimals: number): LineAmounts {
  const qty = roundTo(line.quantity, 3);
  const price = roundTo(line.unitPrice, 4);
  const gross = roundTo(qty * price, decimals);
  const discount = roundTo((gross * clampPercent(line.discountPercent)) / 100, decimals);
  const net = roundTo(gross - discount, decimals);
  const tax = roundTo((net * (line.taxRate || 0)) / 100, decimals);
  return { gross, discount, net, tax, total: roundTo(net + tax, decimals) };
}

export function clampPercent(p: number): number {
  return Number.isFinite(p) ? Math.min(100, Math.max(0, p)) : 0;
}

export interface CartTotals {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  items: number;
}

export function cartTotals(lines: CartLine[], decimals: number): CartTotals {
  let subtotal = 0;
  let discount = 0;
  let tax = 0;
  let items = 0;
  for (const l of lines) {
    const a = lineAmounts(l, decimals);
    subtotal += a.gross;
    discount += a.discount;
    tax += a.tax;
    items += l.quantity;
  }
  subtotal = roundTo(subtotal, decimals);
  discount = roundTo(discount, decimals);
  tax = roundTo(tax, decimals);
  return { subtotal, discount, tax, total: roundTo(subtotal - discount + tax, decimals), items: roundTo(items, 3) };
}

export interface Tender {
  cash: number;
  card: number;
  other: number;
}

export type TenderProblem = "underpaid" | "change_from_card" | "negative" | null;

/** What pos_checkout would say about this tender: the change due, or why it is refused. */
export function checkTender(total: number, tender: Tender, decimals: number): { change: number; due: number; problem: TenderProblem } {
  const cash = roundTo(tender.cash || 0, decimals);
  const card = roundTo(tender.card || 0, decimals);
  const other = roundTo(tender.other || 0, decimals);
  if (cash < 0 || card < 0 || other < 0) return { change: 0, due: total, problem: "negative" };
  const paid = roundTo(cash + card + other, decimals);
  if (paid < total) return { change: 0, due: roundTo(total - paid, decimals), problem: "underpaid" };
  const change = roundTo(paid - total, decimals);
  if (change > cash) return { change, due: 0, problem: "change_from_card" };
  return { change, due: 0, problem: null };
}

/** Adds a product to the cart, or bumps its quantity when it is already there. */
export function addToCart(lines: CartLine[], p: { id: string; name: string; unit_price: number; tax_rate: number }, qty = 1): CartLine[] {
  const i = lines.findIndex((l) => l.productId === p.id);
  if (i >= 0) return lines.map((l, j) => (j === i ? { ...l, quantity: roundTo(l.quantity + qty, 3) } : l));
  return [...lines, {
    productId: p.id, name: p.name, unitPrice: Number(p.unit_price), taxRate: Number(p.tax_rate), quantity: qty, discountPercent: 0,
  }];
}

/** Quick cash amounts to offer: the exact total, then the next round notes above it. */
export function quickCash(total: number, notes = [5, 10, 20, 50, 100, 200, 500]): number[] {
  if (total <= 0) return [];
  const out = new Set<number>([total]);
  for (const n of notes) {
    const v = Math.ceil(total / n) * n;
    if (v > total) out.add(v);
    if (out.size >= 4) break;
  }
  return [...out].sort((a, b) => a - b);
}

/** The payload pos_checkout takes. */
export function checkoutLines(lines: CartLine[]) {
  return lines.map((l) => ({ product_id: l.productId, quantity: l.quantity, discount_percent: l.discountPercent, unit_price: l.unitPrice }));
}
