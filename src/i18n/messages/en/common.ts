// Shared strings used across the whole app (nav, auth, actions, enums).
// Keys are flat dotted strings. Arabic lives in ../ar/common.ts and MUST
// stay complete (its type enforces every key here has a translation).
export const enCommon = {
  "app.name": "FleetManage",

  // Navigation
  "nav.dashboard": "Dashboard",
  "nav.vehicles": "Vehicles",
  "nav.drivers": "Drivers",
  "nav.customers": "Customers",
  "nav.maintenance": "Maintenance",
  "nav.fuel": "Fuel",
  "nav.inspections": "Inspections",
  "nav.issues": "Issues",
  "nav.renewals": "Renewals",
  "nav.speedLimiters": "Speed limiters",
  "nav.reports": "Reports",
  "nav.settings": "Settings",

  // Generic actions
  "action.save": "Save",
  "action.saveChanges": "Save changes",
  "action.cancel": "Cancel",
  "action.add": "Add",
  "action.edit": "Edit",
  "action.delete": "Delete",
  "action.remove": "Remove",
  "action.close": "Close",
  "pagination.range": "{from}–{to} of {total}",
  "pagination.prev": "Previous",
  "pagination.next": "Next",
  "action.create": "Create",
  "action.search": "Search",
  "action.confirm": "Confirm",
  "action.back": "Back",
  "action.view": "View",
  "action.export": "Export CSV",
  "action.markComplete": "Mark complete",
  "action.apply": "Apply",
  "action.copy": "Copy link",
  "action.copied": "Copied!",
  "action.signOut": "Sign out",
  "action.openMenu": "Open menu",
  "action.closeMenu": "Close menu",

  // Generic state / words
  "common.loading": "Loading…",
  "common.loadingWorkspace": "Loading your workspace…",
  "common.preparingOrg": "Preparing your organization…",
  "common.error": "Something went wrong.",
  "common.noResults": "No results",
  "common.optional": "Optional",
  "common.required": "Required",
  "common.all": "All",
  "common.none": "None",
  "common.actions": "Actions",
  "common.status": "Status",
  "common.saving": "Saving…",
  "common.deleting": "Deleting…",
  "common.dash": "—",
  "common.listSeparator": ", ",

  // Common fields
  "field.name": "Name",
  "field.email": "Email",
  "field.password": "Password",
  "field.phone": "Phone",
  "field.fullName": "Your name",
  "field.notes": "Notes",
  "field.date": "Date",
  "field.dueDate": "Due date",
  "field.amount": "Amount",
  "field.vendor": "Vendor",
  "field.priority": "Priority",
  "field.status": "Status",
  "field.vehicle": "Vehicle",
  "field.driver": "Driver",
  "field.odometer": "Odometer",
  "field.licensePlate": "License plate",
  "field.make": "Make",
  "field.model": "Model",
  "field.year": "Year",
  "field.vin": "VIN",

  // Auth
  "auth.welcomeBack": "Welcome back",
  "auth.signInSubtitle": "Sign in to manage your fleet",
  "auth.signIn": "Sign in",
  "auth.newHere": "New here?",
  "auth.createOrgLink": "Create your organization",
  "auth.createOrg": "Create your organization",
  "auth.createOrgSubtitle": "Set up your fleet workspace — you can invite your team right after.",
  "auth.haveAccount": "Already have an account?",
  "auth.companyName": "Company / fleet name",
  "auth.atLeast8": "At least 8 characters",
  "auth.country": "Country",
  "auth.currency": "Currency",
  "auth.timezone": "Timezone",
  "auth.distance": "Distance",
  "auth.volume": "Volume",
  "auth.kilometers": "Kilometers",
  "auth.miles": "Miles",
  "auth.liters": "Liters",
  "auth.gallons": "Gallons (US)",
  "auth.createOrganization": "Create organization",
  "auth.signInFailed": "Sign-in failed",
  "auth.signupFailed": "Signup failed",

  // Roles
  "role.owner": "Owner",
  "role.admin": "Admin",
  "role.manager": "Manager",
  "role.viewer": "Viewer",

  // Language switcher
  "language.label": "Language",
  "language.english": "English",
  "language.arabic": "العربية",

  // Enums — vehicle status
  "enum.vehicleStatus.active": "Active",
  "enum.vehicleStatus.in_shop": "In shop",
  "enum.vehicleStatus.out_of_service": "Out of service",
  "enum.vehicleStatus.retired": "Retired",

  // Enums — vehicle type
  "enum.vehicleType.car": "Car",
  "enum.vehicleType.van": "Van",
  "enum.vehicleType.truck": "Truck",
  "enum.vehicleType.bus": "Bus",
  "enum.vehicleType.trailer": "Trailer",
  "enum.vehicleType.equipment": "Equipment",
  "enum.vehicleType.motorcycle": "Motorcycle",
  "enum.vehicleType.other": "Other",

  // Enums — fuel type
  "enum.fuelType.gasoline": "Gasoline",
  "enum.fuelType.diesel": "Diesel",
  "enum.fuelType.electric": "Electric",
  "enum.fuelType.hybrid": "Hybrid",
  "enum.fuelType.cng": "CNG",
  "enum.fuelType.lpg": "LPG",
  "enum.fuelType.other": "Other",

  // Enums — work order status
  "enum.workOrderStatus.open": "Open",
  "enum.workOrderStatus.in_progress": "In progress",
  "enum.workOrderStatus.completed": "Completed",
  "enum.workOrderStatus.canceled": "Canceled",

  // Enums — issue status
  "enum.issueStatus.open": "Open",
  "enum.issueStatus.in_progress": "In progress",
  "enum.issueStatus.resolved": "Resolved",
  "enum.issueStatus.closed": "Closed",

  // Enums — priority
  "enum.priority.low": "Low",
  "enum.priority.normal": "Normal",
  "enum.priority.high": "High",
  "enum.priority.critical": "Critical",

  // Enums — driver status
  "enum.driverStatus.active": "Active",
  "enum.driverStatus.inactive": "Inactive",

  // Enums — renewal type
  "enum.renewalType.registration": "Registration",
  "enum.renewalType.insurance": "Insurance",
  "enum.renewalType.permit": "Permit",
  "enum.renewalType.emission_test": "Emission test",
  "enum.renewalType.roadworthiness": "Roadworthiness",
  "enum.renewalType.other": "Other",
} as const;
