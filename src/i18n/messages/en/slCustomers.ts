// Speed limiter module — customer (client organization) management.
// Arabic lives in ../ar/slCustomers.ts and MUST stay complete (its type
// enforces every key here has a translation).
export const enSlCustomers = {
  // Page
  "slCustomers.title": "Customers",
  "slCustomers.subtitle": "The client organizations you install and certify speed limiters for",
  "slCustomers.newCustomer": "New customer",
  "slCustomers.editCustomer": "Edit customer",
  "slCustomers.deleteCustomer": "Delete customer",
  "slCustomers.searchPlaceholder": "Search by name, CR number, phone or email…",
  "slCustomers.allStatuses": "All statuses",

  // Status
  "slCustomers.status.active": "Active",
  "slCustomers.status.inactive": "Inactive",

  // List table
  "slCustomers.company": "Company",
  "slCustomers.cityCountry": "City / Country",
  "slCustomers.contact": "Contact",
  "slCustomers.billingTerms": "Billing terms",
  "slCustomers.creditLimit": "Credit limit",

  // Form fields
  "slCustomers.name": "Company name",
  "slCustomers.crNumber": "CR number",
  "slCustomers.taxNumber": "Tax number",
  "slCustomers.website": "Website",
  "slCustomers.address": "Address",
  "slCustomers.city": "City",
  "slCustomers.country": "Country",
  "slCustomers.creditLimitUnit": "Credit limit ({currency})",

  // Delete
  "slCustomers.deleteConfirm":
    "Delete customer {name}? Their vehicles will be unlinked (not deleted) and their contacts will be removed. This cannot be undone.",

  // Empty states
  "slCustomers.emptyTitle": "No customers yet",
  "slCustomers.emptyDesc":
    "Add the client organizations you install speed limiters for to track their fleets, jobs and certificates.",
  "slCustomers.emptyFilteredTitle": "No customers match your filters",
  "slCustomers.emptyFilteredDesc": "Try a different search or status filter.",

  // Errors
  "slCustomers.saveFailed": "Save failed",
  "slCustomers.deleteFailed": "Delete failed",
  "slCustomers.notFound": "Customer not found.",

  // Detail — KPIs
  "slCustomers.vehicles": "Vehicles",
  "slCustomers.kpiActiveLimiters": "Active limiters",
  "slCustomers.kpiJobsCompleted": "Jobs completed",
  "slCustomers.kpiJobsPending": "Pending jobs",
  "slCustomers.kpiCertsIssued": "Certificates issued",
  "slCustomers.kpiCertsExpiring": "Expiring within 60 days",
  "slCustomers.kpiCertsExpired": "Expired",
  "slCustomers.kpiCompliance": "Compliance",
  "slCustomers.complianceHint": "Vehicles holding a valid certificate",

  // Detail — contacts card
  "slCustomers.contacts": "Contacts",
  "slCustomers.addContact": "Add contact",
  "slCustomers.editContact": "Edit contact",
  "slCustomers.deleteContact": "Delete contact",
  "slCustomers.deleteContactConfirm": "Remove contact {name}? This cannot be undone.",
  "slCustomers.contactTitle": "Job title",
  "slCustomers.department": "Department",
  "slCustomers.whatsapp": "WhatsApp",
  "slCustomers.primaryContact": "Primary contact",
  "slCustomers.noContacts": "No contacts yet.",

  // Detail — vehicles card
  "slCustomers.attachVehicle": "Attach vehicle",
  "slCustomers.detachVehicle": "Detach vehicle",
  "slCustomers.detachConfirm": "Detach {vehicle} from {customer}? The vehicle stays in your fleet.",
  "slCustomers.fleetNumber": "Fleet number",
  "slCustomers.chassisNumber": "Chassis number",
  "slCustomers.noVehicles": "No vehicles attached yet.",
  "slCustomers.selectVehicle": "Select a vehicle…",
  "slCustomers.noUnassignedVehicles": "No unassigned vehicles available.",
  "slCustomers.attach": "Attach",
  "slCustomers.attachExistingLabel": "Existing unassigned vehicle",
  "slCustomers.createVehicleHint":
    "Need a brand-new vehicle? Create it on the Vehicles page first, then attach it here.",
  "slCustomers.goToVehicles": "Go to vehicles",

  // Detail — jobs card
  "slCustomers.jobs": "Jobs",
  "slCustomers.noJobs": "No jobs yet.",
  "slCustomers.jobNumber": "Job #",
  "slCustomers.type": "Type",
  "slCustomers.scheduled": "Scheduled",
  "slCustomers.viewAllJobs": "View all jobs",

  // Detail — certificates card
  "slCustomers.certificates": "Certificates",
  "slCustomers.noCertificates": "No certificates yet.",
  "slCustomers.certificateNumber": "Certificate #",
  "slCustomers.expires": "Expires",
  "slCustomers.viewAllCertificates": "View all certificates",

  // Vehicle form additions (vehicles dict is owned elsewhere)
  "slCustomers.vehicleCustomer": "Customer",
  "slCustomers.vehicleCustomerOwnFleet": "— Own fleet —",
  "slCustomers.vehicleChassisNumber": "Chassis number",
  "slCustomers.vehicleFleetNumber": "Fleet number",
} as const;
