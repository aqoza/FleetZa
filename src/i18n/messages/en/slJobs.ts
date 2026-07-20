// Speed limiter jobs module. Shared enum labels (job type/status, device
// status, kmhValue) live in the speedLimiters namespace — do not duplicate
// them here. Arabic lives in ../ar/slJobs.ts and MUST stay complete.
export const enSlJobs = {
  "slJobs.title": "Jobs",
  "slJobs.description": "Schedule, execute, and track speed limiter service jobs",
  "slJobs.newJob": "New job",
  "slJobs.technicians": "Technicians",

  // Filters
  "slJobs.allTypes": "All types",
  "slJobs.allStatuses": "All statuses",
  "slJobs.allTechnicians": "All technicians",
  "slJobs.allCustomers": "All customers",

  // Table
  "slJobs.number": "#",
  "slJobs.type": "Type",
  "slJobs.customer": "Customer",
  "slJobs.technician": "Technician",
  "slJobs.scheduled": "Scheduled",
  "slJobs.jobNumber": "Job #{number}",

  // Empty states
  "slJobs.emptyTitle": "No jobs yet",
  "slJobs.emptyDesc": "Create a job to schedule an installation, inspection, or other service.",
  "slJobs.emptyFilteredTitle": "No jobs match your filters",
  "slJobs.emptyFilteredDesc": "Try adjusting or clearing the filters above.",

  // New job form
  "slJobs.jobType": "Job type",
  "slJobs.noCustomer": "No customer",
  "slJobs.selectVehicle": "Select vehicle…",
  "slJobs.vehicleFilterHint": "Showing this customer's vehicles and unassigned vehicles",
  "slJobs.device": "Device",
  "slJobs.noDevice": "No device",
  "slJobs.deviceInStockHint": "Installation and replacement jobs list in-stock devices only",
  "slJobs.unassigned": "Unassigned",
  "slJobs.scheduledDate": "Scheduled date",
  "slJobs.setSpeedKmh": "Set speed (km/h)",
  "slJobs.tamperSealNumber": "Tamper seal no.",
  "slJobs.location": "Location",
  "slJobs.createJob": "Create job",
  "slJobs.saveFailed": "Save failed",

  // Technicians manager
  "slJobs.addTechnician": "Add technician",
  "slJobs.editTechnician": "Edit technician",
  "slJobs.noTechniciansYet": "No technicians yet. Add your first technician to assign jobs.",
  "slJobs.active": "Active",
  "slJobs.inactive": "Inactive",
  "slJobs.deactivate": "Deactivate",
  "slJobs.reactivate": "Reactivate",

  // Detail page
  "slJobs.backToJobs": "Jobs",
  "slJobs.jobNotFound": "Job not found",
  "slJobs.details": "Details",
  "slJobs.setSpeed": "Set speed",
  "slJobs.startedAt": "Started",
  "slJobs.completedAt": "Completed",
  "slJobs.duration": "Duration",
  "slJobs.durationValue": "{minutes} min",
  "slJobs.qcApprovedInfo": "QC approved",
  "slJobs.customerSignature": "Customer signature",
  "slJobs.technicianSignature": "Technician signature",
  "slJobs.signed": "Signed",
  "slJobs.notSigned": "Not signed",

  // Workflow
  "slJobs.workflow": "Workflow",
  "slJobs.startJob": "Start job",
  "slJobs.cancelJob": "Cancel job",
  "slJobs.checklist": "Checklist",
  "slJobs.checklistProgress": "{done} of {total} done",
  "slJobs.customerSigned": "Customer signature received",
  "slJobs.technicianSigned": "Technician signature confirmed",
  "slJobs.completeJob": "Complete job",
  "slJobs.statusUpdateFailed": "Status update failed",

  // Complete modal
  "slJobs.durationMinutes": "Duration (minutes)",
  "slJobs.checklistIncomplete": "{count} checklist item(s) not done — an override note is required.",
  "slJobs.overrideNote": "Override note",
  "slJobs.overrideNoteHint": "Explain why the job is being completed with unfinished checklist items",
  "slJobs.completeFailed": "Completing the job failed",
  "slJobs.notInProgress": "This job is no longer in progress.",

  // QC & close
  "slJobs.qcApprove": "QC approve",
  "slJobs.closeJob": "Close job",

  // Issue certificate
  "slJobs.issueCertificate": "Issue certificate",
  "slJobs.issuingAuthority": "Issuing authority",
  "slJobs.expiresAt": "Expiry date",
  "slJobs.issueFailed": "Issuing the certificate failed",
  "slJobs.certIssued": "Certificate {number} issued.",
  "slJobs.goToCertificates": "Go to certificates",

  // Checklist item labels (UI translation of stored item ids)
  "slJobs.checklist.mounting": "Mounting & wiring secure",
  "slJobs.checklist.calibration": "Set speed calibrated",
  "slJobs.checklist.seal": "Tamper seal applied",
  "slJobs.checklist.function_test": "Function/road test passed",
  "slJobs.checklist.cabin_sticker": "Cabin sticker applied",
  "slJobs.checklist.docs": "Photos & documents captured",
} as const;
