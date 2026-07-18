// Speed limiter device registry (enterprise module). Shared enum labels
// (speedLimiters.deviceStatus.*, speedLimiters.jobType.*, speedLimiters.jobStatus.*)
// live in the speedLimiters namespace — do not redefine them here.
export const enSlDevices = {
  "slDevices.title": "Devices",
  "slDevices.description": "Speed limiter device registry — stock, installations, and warranty.",

  // Toolbar
  "slDevices.searchPlaceholder": "Search serial, manufacturer, model, or IMEI…",

  // Actions
  "slDevices.addDevice": "Add device",
  "slDevices.editDevice": "Edit device",
  "slDevices.deleteDevice": "Delete device",
  "slDevices.history": "History",

  // Table
  "slDevices.serial": "Serial",
  "slDevices.firmware": "Firmware",
  "slDevices.imei": "IMEI",
  "slDevices.warranty": "Warranty",
  "slDevices.outOfWarranty": "Out of warranty",
  "slDevices.warrantyDaysLeft": "{count} d left",

  // Form
  "slDevices.serialNumber": "Serial number",
  "slDevices.manufacturer": "Manufacturer",
  "slDevices.model": "Model",
  "slDevices.firmwareVersion": "Firmware version",
  "slDevices.purchaseDate": "Purchase date",
  "slDevices.purchasePrice": "Purchase price ({currency})",
  "slDevices.supplier": "Supplier",
  "slDevices.warrantyUntil": "Warranty until",
  "slDevices.duplicateSerial": "A device with this serial number already exists.",

  // Delete
  "slDevices.deleteConfirm": "Delete device {serial}? This cannot be undone.",
  "slDevices.deleteInstalledWarning":
    "This device is currently installed on a vehicle. Consider recording a removal job before deleting it.",

  // History modal
  "slDevices.historyTitle": "Device history — {serial}",
  "slDevices.jobNumber": "Job #{number}",
  "slDevices.historyEmptyTitle": "No jobs yet",
  "slDevices.historyEmptyDesc": "This device has not been used in any job.",

  // Empty states
  "slDevices.emptyTitle": "No devices yet",
  "slDevices.emptyDesc":
    "Register your speed limiter devices to track stock, installations, and warranties.",
  "slDevices.emptyFilteredTitle": "No matching devices",
  "slDevices.emptyFilteredDesc": "Try a different search or status filter.",

  // Errors
  "slDevices.saveFailed": "Save failed",
  "slDevices.deleteFailed": "Delete failed",
} as const;
