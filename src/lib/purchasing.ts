/**
 * Purchasing (module `purchasing`) — pure helpers mirroring the rules in
 * migration 20261008000011, so screens only offer what the database accepts.
 */

export type PoStatus = "draft" | "sent" | "confirmed" | "partially_received" | "received" | "closed" | "canceled";
export type BillStatus = "draft" | "open" | "partially_paid" | "paid" | "void";

export const PO_STATUSES: PoStatus[] = ["draft", "sent", "confirmed", "partially_received", "received", "closed", "canceled"];
export const BILL_STATUSES: BillStatus[] = ["draft", "open", "partially_paid", "paid", "void"];

/** Status changes a manager makes by hand; receiving statuses come from a goods receipt. */
export type PoMove = "sent" | "confirmed" | "draft" | "closed" | "canceled";

export function poMoves(status: PoStatus): PoMove[] {
  switch (status) {
    case "draft":
      return ["sent", "confirmed", "canceled"];
    case "sent":
      return ["confirmed", "draft", "canceled"];
    case "confirmed":
      return ["canceled"];
    case "partially_received":
    case "received":
      return ["closed"];
    default:
      return [];
  }
}

export function poEditable(status: PoStatus): boolean {
  return status === "draft";
}

export function poReceivable(status: PoStatus): boolean {
  return status === "confirmed" || status === "partially_received";
}

export function poBillable(status: PoStatus): boolean {
  return status === "confirmed" || status === "partially_received" || status === "received" || status === "closed";
}

export function poDeletable(status: PoStatus): boolean {
  return status === "draft" || status === "canceled";
}

/** What is still to come on a line, never negative. */
export function remainingQty(line: { quantity: number; received_qty: number }): number {
  return Math.max(0, Math.round((Number(line.quantity) - Number(line.received_qty)) * 1000) / 1000);
}

/** Share of the ordered quantity received so far, 0..1. */
export function receivedShare(lines: Array<{ quantity: number; received_qty: number }>): number {
  const ordered = lines.reduce((s, l) => s + Number(l.quantity), 0);
  if (ordered <= 0) return 0;
  return Math.min(1, lines.reduce((s, l) => s + Number(l.received_qty), 0) / ordered);
}

export function billPayable(status: BillStatus): boolean {
  return status === "open" || status === "partially_paid";
}

export function billBalance(bill: { total: number; amount_paid: number }, decimals: number): number {
  const f = 10 ** decimals;
  return Math.max(0, Math.round((Number(bill.total) - Number(bill.amount_paid)) * f) / f);
}

/** Days until due (negative = overdue) for an unpaid bill, else null. */
export function billDueIn(bill: { status: BillStatus; due_date: string | null }, today: string): number | null {
  if (!billPayable(bill.status) || !bill.due_date) return null;
  return Math.round((Date.parse(`${bill.due_date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
}
