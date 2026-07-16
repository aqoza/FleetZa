import type { BadgeTone } from "../components/ui";
import type {
  FuelType,
  IssueStatus,
  Priority,
  RenewalType,
  VehicleStatus,
  VehicleType,
  WorkOrderStatus,
} from "./types";

export const vehicleStatus: Record<VehicleStatus, { label: string; tone: BadgeTone }> = {
  active: { label: "Active", tone: "green" },
  in_shop: { label: "In shop", tone: "yellow" },
  out_of_service: { label: "Out of service", tone: "red" },
  retired: { label: "Retired", tone: "slate" },
};

export const vehicleTypes: Record<VehicleType, string> = {
  car: "Car",
  van: "Van",
  truck: "Truck",
  bus: "Bus",
  trailer: "Trailer",
  equipment: "Equipment",
  motorcycle: "Motorcycle",
  other: "Other",
};

export const fuelTypes: Record<FuelType, string> = {
  gasoline: "Gasoline",
  diesel: "Diesel",
  electric: "Electric",
  hybrid: "Hybrid",
  cng: "CNG",
  lpg: "LPG",
  other: "Other",
};

export const workOrderStatus: Record<WorkOrderStatus, { label: string; tone: BadgeTone }> = {
  open: { label: "Open", tone: "blue" },
  in_progress: { label: "In progress", tone: "yellow" },
  completed: { label: "Completed", tone: "green" },
  canceled: { label: "Canceled", tone: "slate" },
};

export const issueStatus: Record<IssueStatus, { label: string; tone: BadgeTone }> = {
  open: { label: "Open", tone: "red" },
  in_progress: { label: "In progress", tone: "yellow" },
  resolved: { label: "Resolved", tone: "green" },
  closed: { label: "Closed", tone: "slate" },
};

export const priority: Record<Priority, { label: string; tone: BadgeTone }> = {
  low: { label: "Low", tone: "slate" },
  normal: { label: "Normal", tone: "blue" },
  high: { label: "High", tone: "yellow" },
  critical: { label: "Critical", tone: "red" },
};

export const renewalTypes: Record<RenewalType, string> = {
  registration: "Registration",
  insurance: "Insurance",
  permit: "Permit",
  emission_test: "Emission test",
  roadworthiness: "Roadworthiness",
  other: "Other",
};
