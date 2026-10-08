// Notifications module (notifications). Arabic lives in ../ar/notifications.ts and must stay complete.
export const enNotifications = {
  "notifications.title": "Notifications",
  "notifications.subtitle": "Alerts and reminders across your modules.",

  // Tabs
  "notifications.tab.inbox": "Inbox",
  "notifications.tab.preferences": "Preferences",

  // Bell
  "notifications.bell": "Notifications",
  "notifications.bellUnread": { one: "{count} unread notification", other: "{count} unread notifications" },
  "notifications.viewAll": "View all",
  "notifications.markAllRead": "Mark all as read",
  "notifications.allCaughtUp": "You're all caught up.",

  // Inbox
  "notifications.filterUnread": "Unread",
  "notifications.filterAll": "All",
  "notifications.allSeverities": "Any severity",
  "notifications.severity.info": "Info",
  "notifications.severity.warning": "Warning",
  "notifications.severity.critical": "Critical",
  "notifications.markRead": "Mark as read",
  "notifications.markUnread": "Mark as unread",
  "notifications.delete": "Delete",
  "notifications.open": "Open",
  "notifications.emptyTitle": "No notifications",
  "notifications.emptyDesc": "Reminders and alerts from your modules will show up here.",
  "notifications.emptyUnreadTitle": "Nothing unread",
  "notifications.emptyUnreadDesc": "Switch to All to see earlier notifications.",
  "notifications.unreadCount": { one: "{count} unread", other: "{count} unread" },
  "notifications.actionFailed": "Could not update the notifications.",

  // Preferences
  "notifications.prefsHint": "Mute the kinds of notification you do not want. Muting applies to you only.",
  "notifications.prefsEmpty": "None of your enabled modules sends notifications yet.",
  "notifications.receive": "Receive",
  "notifications.muted": "Muted",
  "notifications.prefSaved": "Preference saved",

  // Kinds: labels (preferences) and messages (inbox)
  "notifications.kind.inventory.low_stock": "Low stock",
  "notifications.kind.inventory.low_stock.desc": "An item drops to or below its reorder point.",
  "notifications.kind.employees.document_expiring": "Employee documents expiring",
  "notifications.kind.employees.document_expiring.desc":
    "A passport, residence permit or work permit expires in 60, 30 or 7 days, or has expired.",
  "notifications.kind.documents.expiring": "Documents expiring",
  "notifications.kind.documents.expiring.desc": "A stored document expires in 30 or 7 days, or has expired.",

  "notifications.msg.lowStock.title": "Low stock: {name}",
  "notifications.msg.lowStock.body": "On hand {qty}, at or below the reorder point of {point}.",
  "notifications.msg.employeeDoc.expired": "{employee}: {document} expired",
  "notifications.msg.employeeDoc.today": "{employee}: {document} expires today",
  "notifications.msg.employeeDoc.expiresIn": {
    one: "{employee}: {document} expires tomorrow",
    other: "{employee}: {document} expires in {count} days",
  },
  "notifications.msg.document.expired": "{document} expired",
  "notifications.msg.document.today": "{document} expires today",
  "notifications.msg.document.expiresIn": {
    one: "{document} expires tomorrow",
    other: "{document} expires in {count} days",
  },
  "notifications.msg.expiryDate": "Expiry date: {date}",
  "notifications.doc.passport": "passport",
  "notifications.doc.residence_permit": "residence permit",
  "notifications.doc.work_permit": "work permit",
} as const;
