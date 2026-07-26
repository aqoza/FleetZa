import type { BadgeTone } from "../components/ui";
import type { MessageKey } from "../i18n";
import type {
  DriverStatus,
  FuelType,
  InvoiceStatus,
  IssueStatus,
  PaymentMethod,
  Priority,
  ProductKind,
  QuoteStatus,
  RenewalType,
  SalesOrderStatus,
  VehicleStatus,
  VehicleType,
  WorkOrderStatus,
} from "./types";

// Display text lives in the i18n dictionaries; these maps carry the
// translation key + badge tone. Render with `t(map[value].labelKey)`.

export const vehicleStatus: Record<VehicleStatus, { labelKey: MessageKey; tone: BadgeTone }> = {
  active: { labelKey: "enum.vehicleStatus.active", tone: "green" },
  in_shop: { labelKey: "enum.vehicleStatus.in_shop", tone: "yellow" },
  out_of_service: { labelKey: "enum.vehicleStatus.out_of_service", tone: "red" },
  retired: { labelKey: "enum.vehicleStatus.retired", tone: "slate" },
};

export const vehicleTypes: Record<VehicleType, MessageKey> = {
  car: "enum.vehicleType.car",
  van: "enum.vehicleType.van",
  truck: "enum.vehicleType.truck",
  bus: "enum.vehicleType.bus",
  trailer: "enum.vehicleType.trailer",
  equipment: "enum.vehicleType.equipment",
  motorcycle: "enum.vehicleType.motorcycle",
  other: "enum.vehicleType.other",
};

export const fuelTypes: Record<FuelType, MessageKey> = {
  gasoline: "enum.fuelType.gasoline",
  diesel: "enum.fuelType.diesel",
  electric: "enum.fuelType.electric",
  hybrid: "enum.fuelType.hybrid",
  cng: "enum.fuelType.cng",
  lpg: "enum.fuelType.lpg",
  other: "enum.fuelType.other",
};

export const workOrderStatus: Record<WorkOrderStatus, { labelKey: MessageKey; tone: BadgeTone }> = {
  open: { labelKey: "enum.workOrderStatus.open", tone: "blue" },
  in_progress: { labelKey: "enum.workOrderStatus.in_progress", tone: "yellow" },
  completed: { labelKey: "enum.workOrderStatus.completed", tone: "green" },
  canceled: { labelKey: "enum.workOrderStatus.canceled", tone: "slate" },
};

export const issueStatus: Record<IssueStatus, { labelKey: MessageKey; tone: BadgeTone }> = {
  open: { labelKey: "enum.issueStatus.open", tone: "red" },
  in_progress: { labelKey: "enum.issueStatus.in_progress", tone: "yellow" },
  resolved: { labelKey: "enum.issueStatus.resolved", tone: "green" },
  closed: { labelKey: "enum.issueStatus.closed", tone: "slate" },
};

export const priority: Record<Priority, { labelKey: MessageKey; tone: BadgeTone }> = {
  low: { labelKey: "enum.priority.low", tone: "slate" },
  normal: { labelKey: "enum.priority.normal", tone: "blue" },
  high: { labelKey: "enum.priority.high", tone: "yellow" },
  critical: { labelKey: "enum.priority.critical", tone: "red" },
};

export const driverStatus: Record<DriverStatus, { labelKey: MessageKey; tone: BadgeTone }> = {
  active: { labelKey: "enum.driverStatus.active", tone: "green" },
  inactive: { labelKey: "enum.driverStatus.inactive", tone: "slate" },
};

// --- Sales & billing ---
// "expired" / "overdue" are *derived* states (valid_until, due_date) — see
// src/lib/sales.ts. They get their own tones here so every surface agrees.

export const quoteStatus: Record<QuoteStatus, { labelKey: MessageKey; tone: BadgeTone }> = {
  draft: { labelKey: "enum.quoteStatus.draft", tone: "slate" },
  sent: { labelKey: "enum.quoteStatus.sent", tone: "blue" },
  accepted: { labelKey: "enum.quoteStatus.accepted", tone: "green" },
  declined: { labelKey: "enum.quoteStatus.declined", tone: "red" },
  expired: { labelKey: "enum.quoteStatus.expired", tone: "yellow" },
  canceled: { labelKey: "enum.quoteStatus.canceled", tone: "slate" },
};

export const salesOrderStatus: Record<
  SalesOrderStatus,
  { labelKey: MessageKey; tone: BadgeTone }
> = {
  draft: { labelKey: "enum.salesOrderStatus.draft", tone: "slate" },
  confirmed: { labelKey: "enum.salesOrderStatus.confirmed", tone: "blue" },
  fulfilled: { labelKey: "enum.salesOrderStatus.fulfilled", tone: "purple" },
  closed: { labelKey: "enum.salesOrderStatus.closed", tone: "green" },
  canceled: { labelKey: "enum.salesOrderStatus.canceled", tone: "red" },
};

export const invoiceStatus: Record<InvoiceStatus, { labelKey: MessageKey; tone: BadgeTone }> = {
  draft: { labelKey: "enum.invoiceStatus.draft", tone: "slate" },
  issued: { labelKey: "enum.invoiceStatus.issued", tone: "blue" },
  partially_paid: { labelKey: "enum.invoiceStatus.partially_paid", tone: "yellow" },
  paid: { labelKey: "enum.invoiceStatus.paid", tone: "green" },
  void: { labelKey: "enum.invoiceStatus.void", tone: "slate" },
};

export const productKinds: Record<ProductKind, MessageKey> = {
  service: "enum.productKind.service",
  part: "enum.productKind.part",
  fee: "enum.productKind.fee",
  other: "enum.productKind.other",
};

export const paymentMethods: Record<PaymentMethod, MessageKey> = {
  cash: "enum.paymentMethod.cash",
  bank_transfer: "enum.paymentMethod.bank_transfer",
  card: "enum.paymentMethod.card",
  cheque: "enum.paymentMethod.cheque",
  online: "enum.paymentMethod.online",
  other: "enum.paymentMethod.other",
};

export const renewalTypes: Record<RenewalType, MessageKey> = {
  registration: "enum.renewalType.registration",
  insurance: "enum.renewalType.insurance",
  permit: "enum.renewalType.permit",
  emission_test: "enum.renewalType.emission_test",
  roadworthiness: "enum.renewalType.roadworthiness",
  other: "enum.renewalType.other",
};
