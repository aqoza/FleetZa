// Customers module — global master data: client organizations + contacts,
// consumed by every module that deals with customers (speed limiters today;
// CRM/sales/billing as they land). Arabic lives in ../ar/customers.ts and
// MUST stay complete (its type enforces every key here has a translation).
export const enCustomers = {
  // Page
  "customers.title": "Customers",
  "customers.subtitle": "The client organizations you do business with — contacts, vehicles and history",
  "customers.newCustomer": "New customer",
  "customers.editCustomer": "Edit customer",
  "customers.deleteCustomer": "Delete customer",
  "customers.searchPlaceholder": "Search by name, CR number, phone or email…",
  "customers.allStatuses": "All statuses",

  // Status
  "customers.status.active": "Active",
  "customers.status.inactive": "Inactive",

  // List table
  "customers.company": "Company",
  "customers.cityCountry": "City / Country",
  "customers.contact": "Contact",
  "customers.billingTerms": "Billing terms",
  "customers.creditLimit": "Credit limit",

  // Form fields
  "customers.name": "Company name",
  "customers.crNumber": "CR number",
  "customers.taxNumber": "Tax number",
  "customers.website": "Website",
  "customers.address": "Address",
  "customers.city": "City",
  "customers.country": "Country",
  "customers.creditLimitUnit": "Credit limit ({currency})",

  // Delete
  "customers.deleteConfirm":
    "Delete customer {name}? Their vehicles will be unlinked (not deleted) and their contacts will be removed. This cannot be undone.",

  // Empty states
  "customers.emptyTitle": "No customers yet",
  "customers.emptyDesc":
    "Add the client organizations you work with to track their contacts, vehicles and related records.",
  "customers.emptyFilteredTitle": "No customers match your filters",
  "customers.emptyFilteredDesc": "Try a different search or status filter.",

  // Errors
  "customers.saveFailed": "Save failed",
  "customers.deleteFailed": "Delete failed",
  "customers.notFound": "Customer not found.",

  // Detail — KPIs
  "customers.vehicles": "Vehicles",
  "customers.kpiActiveLimiters": "Active limiters",
  "customers.kpiJobsCompleted": "Jobs completed",
  "customers.kpiJobsPending": "Pending jobs",
  "customers.kpiCertsIssued": "Certificates issued",
  "customers.kpiCertsExpiring": "Expiring within 60 days",
  "customers.kpiCertsExpired": "Expired",
  "customers.kpiCompliance": "Compliance",
  "customers.complianceHint": "Vehicles holding a valid certificate",

  // Detail — contacts card
  "customers.contacts": "Contacts",
  "customers.addContact": "Add contact",
  "customers.editContact": "Edit contact",
  "customers.deleteContact": "Delete contact",
  "customers.deleteContactConfirm": "Remove contact {name}? This cannot be undone.",
  "customers.contactTitle": "Job title",
  "customers.department": "Department",
  "customers.whatsapp": "WhatsApp",
  "customers.primaryContact": "Primary contact",
  "customers.noContacts": "No contacts yet.",

  // Detail — vehicles card
  "customers.attachVehicle": "Attach vehicle",
  "customers.detachVehicle": "Detach vehicle",
  "customers.detachConfirm": "Detach {vehicle} from {customer}? The vehicle stays in your fleet.",
  "customers.fleetNumber": "Fleet number",
  "customers.chassisNumber": "Chassis number",
  "customers.noVehicles": "No vehicles attached yet.",
  "customers.selectVehicle": "Select a vehicle…",
  "customers.noUnassignedVehicles": "No unassigned vehicles available.",
  "customers.attach": "Attach",
  "customers.attachExistingLabel": "Existing unassigned vehicle",
  "customers.createVehicleHint":
    "Need a brand-new vehicle? Create it on the Vehicles page first, then attach it here.",
  "customers.goToVehicles": "Go to vehicles",

  // Detail — jobs card
  "customers.jobs": "Jobs",
  "customers.noJobs": "No jobs yet.",
  "customers.jobNumber": "Job #",
  "customers.type": "Type",
  "customers.scheduled": "Scheduled",
  "customers.viewAllJobs": "View all jobs",

  // Detail — certificates card
  "customers.certificates": "Certificates",
  "customers.noCertificates": "No certificates yet.",
  "customers.certificateNumber": "Certificate #",
  "customers.expires": "Expires",
  "customers.viewAllCertificates": "View all certificates",
} as const;
