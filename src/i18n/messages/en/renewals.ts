export const enRenewals = {
  "renewals.title": "Renewals",
  "renewals.description": "Registrations, insurance, permits and other expiring documents",

  // Actions
  "renewals.addRenewal": "Add renewal",
  "renewals.addDefaults": "Add country defaults",
  "renewals.editRenewal": "Edit renewal",
  "renewals.deleteRenewal": "Delete renewal",

  // Form fields
  "renewals.type": "Type",
  "renewals.selectVehicle": "Select vehicle…",
  "renewals.nameHint": "Optional custom label, e.g. insurer or permit name",
  "renewals.amountLabel": "Amount ({currency})",
  "renewals.recurEvery": "Recurs every (months)",
  "renewals.recurHint": "Leave empty for one-time",

  // Table
  "renewals.recurs": "Recurs",
  "renewals.everyMonthsShort": "Every {count} mo",
  "renewals.overdue": "Overdue",
  "renewals.dueInDays": "Due in {count} d",
  "renewals.statusPending": "Pending",
  "renewals.statusCompleted": "Completed",
  "renewals.completedOn": "Completed {date}",

  // Filters
  "renewals.allVehicles": "All vehicles",

  // Empty states
  "renewals.emptyTitle": "No renewals yet",
  "renewals.emptyDesc": "Track registrations, insurance and permits so nothing expires unnoticed.",
  "renewals.emptyFilteredTitle": "No renewals match your filters",
  "renewals.emptyFilteredDesc": "Try a different status or vehicle filter.",

  // Country defaults modal
  "renewals.standardFor": "Standard renewals for {country}",
  "renewals.everyMonthsLong": "every {count} months",
  "renewals.addedN": "Added {count} renewals",
  "renewals.allExist": "All standard renewals already exist for this vehicle.",

  // Error messages
  "renewals.saveFailed": "Save failed",
  "renewals.addDefaultsFailed": "Failed to add renewals",
  "renewals.completeFailed": "Failed to mark renewal complete",
  "renewals.deleteFailed": "Failed to delete renewal",

  // Delete confirmation (name is rendered bold between the lead and rest)
  "renewals.deleteLead": "Delete the ",
  "renewals.deleteRestVehicle": " renewal for {vehicle}? This cannot be undone.",
  "renewals.deleteRestNoVehicle": " renewal? This cannot be undone.",
} as const;
