export const enMaintenance = {
  // Page
  "maintenance.title": "Maintenance",
  "maintenance.subtitle": "Service reminders and work orders for your fleet",
  "maintenance.tabReminders": "Service reminders",
  "maintenance.tabWorkOrders": "Work orders",

  // Service reminders
  "maintenance.addReminder": "Add reminder",
  "maintenance.editReminder": "Edit reminder",
  "maintenance.deleteReminder": "Delete reminder",
  "maintenance.allReminders": "All reminders",
  "maintenance.noRemindersMatch": "No reminders match your filter",
  "maintenance.noRemindersYet": "No service reminders yet",
  "maintenance.tryDifferentFilter": "Try a different filter.",
  "maintenance.remindersEmptyDesc":
    "Create reminders to keep vehicles on schedule for routine service.",
  "maintenance.deleteReminderConfirm": "Delete {task} for {vehicle}? This cannot be undone.",

  // Reminder form
  "maintenance.selectVehicle": "Select vehicle…",
  "maintenance.task": "Task",
  "maintenance.taskPlaceholder": "e.g. Oil change",
  "maintenance.intervalMonths": "Interval (months)",
  "maintenance.intervalMonthsHint": "Recurs every N months",
  "maintenance.intervalDistance": "Interval ({unit})",
  "maintenance.intervalDistanceHint": "Recurs every N {unit}",
  "maintenance.dueOdometer": "Due odometer ({unit})",

  // Reminder table
  "maintenance.due": "Due",
  "maintenance.lastDone": "Last done",
  "maintenance.markDone": "Mark done",
  "maintenance.markDoneAria": "Mark {task} done",
  "maintenance.editAria": "Edit {name}",
  "maintenance.deleteAria": "Delete {name}",

  // Reminder status
  "maintenance.reminderStatus.overdue": "Overdue",
  "maintenance.reminderStatus.dueSoon": "Due soon",
  "maintenance.reminderStatus.ok": "OK",
  "maintenance.reminderStatus.inactive": "Inactive",

  // Work orders — list & form
  "maintenance.newWorkOrder": "New work order",
  "maintenance.createWorkOrder": "Create work order",
  "maintenance.allStatuses": "All statuses",
  "maintenance.noWorkOrdersMatch": "No work orders match your filter",
  "maintenance.noWorkOrdersYet": "No work orders yet",
  "maintenance.tryDifferentStatusFilter": "Try a different status filter.",
  "maintenance.workOrdersEmptyDesc":
    "Create work orders to track repairs and scheduled maintenance.",
  "maintenance.woTitle": "Title",
  "maintenance.woTitlePlaceholder": "e.g. Replace front brake pads",
  "maintenance.description": "Description",
  "maintenance.scheduledDate": "Scheduled date",
  "maintenance.scheduled": "Scheduled",
  "maintenance.odometerUnit": "Odometer ({unit})",
  "maintenance.inclTax": "incl. {label} {rate}%",

  // Work order detail
  "maintenance.workOrderNumber": "Work order #{number}",
  "maintenance.workOrderNotFound": "Work order not found.",
  "maintenance.startWork": "Start work",
  "maintenance.complete": "Complete",
  "maintenance.reopen": "Reopen",
  "maintenance.details": "Details",
  "maintenance.completed": "Completed",
  "maintenance.vehicleCurrentlyAt": "Vehicle currently at {distance}",
  "maintenance.statusUpdateFailed": "Could not update status",

  // Line items
  "maintenance.lineItems": "Line items",
  "maintenance.category": "Category",
  "maintenance.qty": "Qty",
  "maintenance.unitCost": "Unit cost",
  "maintenance.lineTotal": "Line total",
  "maintenance.noLineItems": "No line items yet.",
  "maintenance.subtotal": "Subtotal",
  "maintenance.taxLine": "{label} ({rate}%)",
  "maintenance.total": "Total",
  "maintenance.linePlaceholder": "e.g. Brake pads",
  "maintenance.unitCostCurrency": "Unit cost ({currency})",
  "maintenance.lineAddFailed": "Could not add line",
  "maintenance.lineDeleteFailed": "Could not delete line",

  // Line categories
  "maintenance.lineCategory.labor": "Labor",
  "maintenance.lineCategory.part": "Part",
  "maintenance.lineCategory.fee": "Fee",
  "maintenance.lineCategory.other": "Other",

  // Work order modals
  "maintenance.editWorkOrder": "Edit work order",
  "maintenance.deleteWorkOrder": "Delete work order",
  "maintenance.deleteWorkOrderConfirm":
    "Delete work order #{number} and all of its line items? This cannot be undone.",
  "maintenance.deleteLineItem": "Delete line item",
  "maintenance.deleteLineConfirm": "Delete {description}? This cannot be undone.",

  // Error fallbacks
  "maintenance.saveFailed": "Save failed",
  "maintenance.updateFailed": "Update failed",
  "maintenance.deleteFailed": "Delete failed",
} as const;
