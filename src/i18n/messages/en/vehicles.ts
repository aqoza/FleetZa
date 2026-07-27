export const enVehicles = {
  // Page
  "vehicles.title": "Vehicles",
  "vehicles.countInFleet": "{count} vehicles in your fleet",
  "vehicles.add": "Add vehicle",

  // Ownership (company fleet vs customer-owned)
  "vehicles.owner": "Owner",
  "vehicles.ownerCompany": "Company fleet",
  "vehicles.ownerCustomer": "Customer",
  "vehicles.selectCustomer": "Select a customer…",
  "vehicles.allOwners": "All owners",
  "vehicles.speedLimiterPanel": "Speed limiter",
  "vehicles.noSpeedLimiter": "No speed limiter installed.",
  "vehicles.chassisNumber": "Chassis number",
  "vehicles.engineNumber": "Engine number",
  "vehicles.fleetNumber": "Fleet number",
  "vehicles.searchPlaceholder": "Search name, plate, VIN…",
  "vehicles.allStatuses": "All statuses",

  // Empty states
  "vehicles.noMatch": "No vehicles match your filters",
  "vehicles.empty": "No vehicles yet",
  "vehicles.noMatchHint": "Try a different search, status or owner filter.",
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

  // Speed limiter certificate (detail card + header action). "Current" is the
  // certificate the vehicle legally carries — the head of its supersession
  // chain — not merely the most recently issued row.
  "vehicles.currentCertificate": "Current certificate",
  "vehicles.certificateHistory": "Earlier certificates",
  "vehicles.renewCertificate": "Renew certificate",
  "vehicles.noCertificate": "No certificate has been issued for this vehicle yet.",
  "vehicles.noCertificateHint":
    "A certificate is issued from a speed limiter job once QC approves the work.",
  "vehicles.noValidCertificate": "This vehicle holds no valid certificate.",
  "vehicles.noValidCertificateHint":
    "Its last certificate was revoked. A replacement is issued from a new speed limiter job.",
  "vehicles.createSlJob": "Create a speed limiter job",
  // Read failure, kept distinct from "none issued": an unknown certificate
  // state must never be reported as an absent one.
  "vehicles.certificatesError":
    "Certificates could not be loaded, so this vehicle's certificate status is unknown. Reload before issuing a new certificate.",

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
