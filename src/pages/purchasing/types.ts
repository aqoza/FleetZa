import type { Tables } from "../../lib/database.types";
import type { BillStatus, PoStatus } from "../../lib/purchasing";
import type { PaymentMethod } from "../../lib/types";

type SupplierRef = { id: string; name: string; name_ar: string | null };

export type PurchaseOrder = Omit<Tables<"purchase_orders">, "status"> & {
  status: PoStatus;
  supplier: SupplierRef | null;
  warehouse: { id: string; name: string } | null;
};
export const PO_SELECT = "*, supplier:suppliers(id, name, name_ar), warehouse:warehouses(id, name)";

export type PurchaseLine = Tables<"purchase_order_lines"> & { item: { id: string; name: string; sku: string | null } | null };
export type BillLine = Tables<"vendor_bill_lines"> & { item: { id: string; name: string; sku: string | null } | null };
export const LINE_SELECT = "*, item:inventory_items(id, name, sku)";

export type PurchaseReceipt = Tables<"purchase_receipts"> & {
  supplier: SupplierRef | null;
  warehouse: { id: string; name: string } | null;
  order: { id: string; doc_number: string | null } | null;
  lines: Array<{ id: string; quantity: number }>;
};
export const RECEIPT_SELECT =
  "*, supplier:suppliers(id, name, name_ar), warehouse:warehouses(id, name), order:purchase_orders(id, doc_number), lines:purchase_receipt_lines(id, quantity)";

export type VendorBill = Omit<Tables<"vendor_bills">, "status"> & {
  status: BillStatus;
  supplier: SupplierRef | null;
  order: { id: string; doc_number: string | null } | null;
};
export const BILL_SELECT = "*, supplier:suppliers(id, name, name_ar), order:purchase_orders(id, doc_number)";

export type VendorPayment = Omit<Tables<"vendor_payments">, "method"> & { method: PaymentMethod };
