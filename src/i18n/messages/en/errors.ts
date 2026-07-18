// Friendly messages for database errors surfaced by src/lib/db.ts — the raw
// PostgREST/Postgres text stays in the console, users see these instead.
// Arabic lives in ../ar/errors.ts and MUST stay complete.
export const enErrors = {
  "errors.duplicate": "This record conflicts with one that already exists (duplicate value).",
  "errors.referenced": "This record is referenced by other records and cannot be changed this way.",
  "errors.forbidden": "You don't have permission to do this.",
  "errors.vehicleHasCertificates":
    "This vehicle has issued certificates and cannot be deleted. Retire it instead.",
  "errors.vehicleHasCompletedJobs":
    "This vehicle has completed jobs on record and cannot be deleted. Retire it instead.",
  "errors.vehicleHasCompletedWorkOrders":
    "This vehicle has completed work orders on record and cannot be deleted. Retire it instead.",
  "errors.customerHasCertificates":
    "This customer has issued certificates and cannot be deleted. Mark them inactive instead.",
  "errors.customerHasCompletedJobs":
    "This customer has completed jobs on record and cannot be deleted. Mark them inactive instead.",
  "errors.illegalJobTransition": "That status change isn't allowed from the job's current state.",
  "errors.jobNotCertifiable":
    "A certificate can only be issued for a completed installation, replacement or inspection job.",
  "errors.jobNotFound": "Job not found.",
  "errors.certAlreadyIssued": "A valid certificate has already been issued for this job.",
} as const;
