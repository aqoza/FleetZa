import type { BadgeTone } from "../components/ui";
import type { MessageKey } from "../i18n";
import type {
  DriverStatus,
  FuelType,
  IssueStatus,
  Priority,
  RenewalType,
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

export const renewalTypes: Record<RenewalType, MessageKey> = {
  registration: "enum.renewalType.registration",
  insurance: "enum.renewalType.insurance",
  permit: "enum.renewalType.permit",
  emission_test: "enum.renewalType.emission_test",
  roadworthiness: "enum.renewalType.roadworthiness",
  other: "enum.renewalType.other",
};
