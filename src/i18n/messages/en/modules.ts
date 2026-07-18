/**
 * Module catalog strings: a name + one-sentence description for every module
 * in shared/modules.ts, plus the <ModuleGate> screen strings.
 */
export const enModules = {
  // --- Fleet operations ---
  "modules.fleet.name": "Fleet Management",
  "modules.fleet.description": "Track your vehicles, their status, documents, and complete history in one place.",
  "modules.drivers.name": "Driver Management",
  "modules.drivers.description": "Manage driver profiles, licenses, and vehicle assignments.",
  "modules.fuel.name": "Fuel Management",
  "modules.fuel.description": "Log fill-ups, track consumption, and control fuel costs across your fleet.",
  "modules.gps_tracking.name": "GPS Tracking & Telematics",
  "modules.gps_tracking.description": "See live vehicle locations, routes, and telematics data in real time.",
  "modules.driver_behavior.name": "Driver Behavior & Scoring",
  "modules.driver_behavior.description": "Monitor speeding, harsh braking, and other events to score and coach drivers.",
  "modules.trip_planning.name": "Trip & Route Planning",
  "modules.trip_planning.description": "Plan trips and optimize routes to save time and fuel.",
  "modules.dispatch.name": "Dispatch Management",
  "modules.dispatch.description": "Assign jobs to drivers and vehicles and follow their progress in real time.",

  // --- Maintenance & workshop ---
  "modules.maintenance.name": "Vehicle Maintenance",
  "modules.maintenance.description": "Record service and repair work and keep a full maintenance history for every vehicle.",
  "modules.preventive.name": "Preventive Maintenance",
  "modules.preventive.description": "Schedule recurring service by date or distance to fix problems before they happen.",
  "modules.inspections.name": "Vehicle Inspections",
  "modules.inspections.description": "Run digital vehicle checklists and catch defects early.",
  "modules.issues.name": "Issue Tracking",
  "modules.issues.description": "Report vehicle problems and track them from discovery to resolution.",
  "modules.workshop.name": "Workshop Management",
  "modules.workshop.description": "Manage work orders, mechanics, and repair jobs in your own workshop.",
  "modules.predictive_ai.name": "AI Assistant & Predictive Maintenance",
  "modules.predictive_ai.description": "Let AI predict failures and suggest maintenance before breakdowns occur.",

  // --- Compliance & certification ---
  "modules.renewals.name": "Renewals & Documents Expiry",
  "modules.renewals.description": "Track registration, insurance, and permit expiry dates with timely reminders.",
  "modules.customers.name": "Customers",
  "modules.customers.description": "Shared customer organizations and contacts, used by every module that deals with clients.",
  "modules.speed_limiters.name": "Speed Limiter Supply & Installation",
  "modules.speed_limiters.description": "Manage speed limiter devices, installations, and their status across your vehicles.",
  "modules.sl_certificates.name": "Speed Limiter Certificates",
  "modules.sl_certificates.description": "Issue and track speed limiter certificates and their renewal dates.",
  "modules.insurance_mgmt.name": "Insurance Management",
  "modules.insurance_mgmt.description": "Manage insurance policies, coverage, and claims for your fleet.",
  "modules.incidents.name": "Accident & Incident Management",
  "modules.incidents.description": "Record accidents and incidents, and follow up on repairs and claims.",
  "modules.regulatory.name": "Compliance & Regulatory",
  "modules.regulatory.description": "Stay compliant with transport regulations and authority requirements.",

  // --- Logistics & transport ---
  "modules.tms.name": "Transport Management (TMS)",
  "modules.tms.description": "Plan and manage freight orders, loads, and transport operations end to end.",
  "modules.logistics_delivery.name": "Logistics & Delivery",
  "modules.logistics_delivery.description": "Manage deliveries, proof of delivery, and last-mile operations.",
  "modules.assets.name": "Asset Management",
  "modules.assets.description": "Track equipment and assets beyond vehicles, with assignments and value history.",
  "modules.inventory.name": "Inventory & Warehouse",
  "modules.inventory.description": "Manage spare parts, stock levels, and warehouse operations.",

  // --- Commerce ---
  "modules.purchasing.name": "Purchasing",
  "modules.purchasing.description": "Create purchase orders and manage suppliers and procurement.",
  "modules.sales.name": "Sales",
  "modules.sales.description": "Manage quotations, sales orders, and customers.",
  "modules.pos.name": "Point of Sale (POS)",
  "modules.pos.description": "Sell products and services over the counter with a fast point-of-sale screen.",
  "modules.crm.name": "CRM",
  "modules.crm.description": "Track leads, opportunities, and customer relationships through your sales pipeline.",

  // --- Finance ---
  "modules.finance.name": "Finance & Accounting",
  "modules.finance.description": "Manage accounts, journals, and financial statements for your company.",
  "modules.billing.name": "Billing & Invoicing",
  "modules.billing.description": "Create invoices, track payments, and manage customer billing.",
  "modules.contracts.name": "Contract Management",
  "modules.contracts.description": "Create and track contracts, their terms, and renewal dates.",

  // --- People ---
  "modules.payroll_hr.name": "Payroll & HR",
  "modules.payroll_hr.description": "Manage employee records, attendance, and payroll.",
  "modules.mobile_workforce.name": "Mobile Workforce",
  "modules.mobile_workforce.description": "Give field staff mobile access to their tasks, forms, and updates.",

  // --- Customer & partners ---
  "modules.customer_portal.name": "Customer Portal",
  "modules.customer_portal.description": "Give customers a self-service portal to view their orders, invoices, and documents.",
  "modules.vendor_portal.name": "Vendor Portal",
  "modules.vendor_portal.description": "Let suppliers view orders and submit invoices through a self-service portal.",

  // --- Analytics ---
  "modules.reports.name": "Reports",
  "modules.reports.description": "Ready-made reports on vehicles, costs, and operations, exportable anytime.",
  "modules.bi_analytics.name": "Business Intelligence & Analytics",
  "modules.bi_analytics.description": "Build dashboards and analyze trends across all your data.",

  // --- Platform ---
  "modules.documents.name": "Document Management",
  "modules.documents.description": "Store, organize, and share company documents securely.",
  "modules.workflow_automation.name": "Workflow Automation",
  "modules.workflow_automation.description": "Automate approvals, notifications, and repetitive tasks with custom rules.",
  "modules.integrations.name": "API & Integrations",
  "modules.integrations.description": "Connect other systems through APIs and ready-made integrations.",
  "modules.iot_devices.name": "IoT Device Management",
  "modules.iot_devices.description": "Manage connected sensors and devices reporting from your fleet.",
  "modules.notifications.name": "Notifications & Communication",
  "modules.notifications.description": "Send alerts and reminders by email, SMS, and in-app messages.",
  "modules.audit_security.name": "Audit Logs & Security",
  "modules.audit_security.description": "Track every change with audit logs and advanced security controls.",
  "modules.multi_company.name": "Multi-Company Management",
  "modules.multi_company.description": "Run multiple companies or branches from one account.",

  // --- ModuleGate screen ---
  "modules.gate.title": "This module isn't enabled",
  "modules.gate.adminHint": "Enable it in Settings → Modules to use this feature.",
  "modules.gate.memberHint": "Ask an administrator to enable this module for your organization.",
  "modules.gate.manage": "Manage modules",
} as const;
