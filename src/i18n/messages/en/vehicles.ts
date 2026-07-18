export const enVehicles = {
  // Page
  "vehicles.title": "Vehicles",
  "vehicles.countInFleet": "{count} vehicles in your fleet",
  "vehicles.add": "Add vehicle",
  "vehicles.searchPlaceholder": "Search name, plate, VIN…",
  "vehicles.allStatuses": "All statuses",

  // Empty states
  "vehicles.noMatch": "No vehicles match your filters",
  "vehicles.empty": "No vehicles yet",
  "vehicles.noMatchHint": "Try a different search or status filter.",
  "vehicles.emptyHint": "Add your first vehicle to start tracking maintenance, fuel and costs.",

  // Detail
  "vehicles.notFound": "Vehicle not found.",
  "vehicles.details": "Details",
  "vehicles.type": "Type",
  "vehicles.fuel": "Fuel",
  "vehicles.purchased": "Purchased",
  "vehicles.purchasePrice": "Purchase price",
  "vehicles.assignedDriver": "Assigned driver",
  "vehicles.change": "Change",
  "vehicles.assign": "Assign",
  "vehicles.since": "since {date}",
  "vehicles.noDriver": "No driver assigned.",
  "vehicles.openIssues": "Open issues",
  "vehicles.noOpenIssues": "No open issues.",
  "vehicles.recentWorkOrders": "Recent work orders",
  "vehicles.noWorkOrders": "No work orders yet.",
  "vehicles.recentFuel": "Recent fuel",
  "vehicles.noFuelLogs": "No fuel logs yet.",

  // Modals
  "vehicles.edit": "Edit vehicle",
  "vehicles.assignDriver": "Assign driver",
  "vehicles.unassignHint": "Leave empty to unassign",
  "vehicles.unassigned": "— Unassigned —",
  "vehicles.delete": "Delete vehicle",
  "vehicles.deleteConfirmPrefix": "Delete",
  "vehicles.deleteConfirmSuffix":
    "and all of its history (fuel, work orders, inspections)? This cannot be undone.",

  // Form
  "vehicles.saveFailed": "Save failed",
  "vehicles.nameLabel": "Name / unit number",
  "vehicles.fuelType": "Fuel type",
  "vehicles.odometerUnit": "Odometer ({unit})",
  "vehicles.purchaseDate": "Purchase date",
  "vehicles.purchasePriceUnit": "Purchase price ({currency})",
} as const;
