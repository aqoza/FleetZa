export const enSpeedLimiters = {
  // Hub
  "speedLimiters.title": "Speed limiters",
  "speedLimiters.subtitle":
    "Devices, jobs and compliance certificates for your speed limiter operation",
  "speedLimiters.tab.overview": "Overview",
  "speedLimiters.tab.devices": "Devices",
  "speedLimiters.tab.jobs": "Jobs",
  "speedLimiters.tab.certificates": "Certificates",

  // --- Shared enum labels (contract: referenced by every speed limiter page) ---
  "speedLimiters.jobType.installation": "Installation",
  "speedLimiters.jobType.inspection": "Inspection",
  "speedLimiters.jobType.maintenance": "Maintenance",
  "speedLimiters.jobType.removal": "Removal",
  "speedLimiters.jobType.replacement": "Replacement",
  "speedLimiters.jobType.emergency": "Emergency",

  "speedLimiters.jobStatus.scheduled": "Scheduled",
  "speedLimiters.jobStatus.in_progress": "In progress",
  "speedLimiters.jobStatus.completed": "Completed",
  "speedLimiters.jobStatus.qc_approved": "QC approved",
  "speedLimiters.jobStatus.closed": "Closed",
  "speedLimiters.jobStatus.canceled": "Canceled",

  "speedLimiters.deviceStatus.in_stock": "In stock",
  "speedLimiters.deviceStatus.installed": "Installed",
  "speedLimiters.deviceStatus.faulty": "Faulty",
  "speedLimiters.deviceStatus.retired": "Retired",

  "speedLimiters.certStatus.valid": "Valid",
  "speedLimiters.certStatus.expiring": "Expiring",
  "speedLimiters.certStatus.expired": "Expired",
  "speedLimiters.certStatus.revoked": "Revoked",

  "speedLimiters.kmhValue": "{value} km/h",

  // --- Overview (command center) ---
  "speedLimiters.overview.kpiCustomers": "Customers",
  "speedLimiters.overview.kpiDevicesInstalled": "Devices installed",
  "speedLimiters.overview.kpiInStock": "{count} in stock",
  "speedLimiters.overview.kpiOpenJobs": "Open jobs",
  "speedLimiters.overview.kpiValidCertificates": "Valid certificates",
  "speedLimiters.overview.expiryBoard": "Certificate expiry board",
  "speedLimiters.overview.bucketExpired": "Expired",
  "speedLimiters.overview.bucket30": "Within 30 days",
  "speedLimiters.overview.bucket60": "31–60 days",
  "speedLimiters.overview.bucket90": "61–90 days",
  "speedLimiters.overview.bucketEmpty": "No certificates",
  "speedLimiters.overview.daysOverdue": "{count} d overdue",
  "speedLimiters.overview.inDays": "in {count} d",
  "speedLimiters.overview.viewAll": "View all",
  "speedLimiters.overview.recentJobs": "Recent jobs",
  "speedLimiters.overview.jobNumber": "#{number}",
  "speedLimiters.overview.noJobs": "No jobs yet",
  "speedLimiters.overview.noJobsDesc": "Jobs you schedule for customers will appear here.",

  // --- Public certificate verification page ---
  "speedLimiters.verify.title": "Certificate verification",
  "speedLimiters.verify.checking": "Verifying certificate…",
  "speedLimiters.verify.status.valid": "Certificate valid",
  "speedLimiters.verify.status.validDesc":
    "This speed limiter certificate is authentic and currently valid.",
  "speedLimiters.verify.status.expired": "Certificate expired",
  "speedLimiters.verify.status.expiredDesc":
    "This certificate exists but its validity period has ended.",
  "speedLimiters.verify.status.revoked": "Certificate revoked",
  "speedLimiters.verify.status.revokedDesc":
    "This certificate has been revoked by the issuer and is no longer valid.",
  "speedLimiters.verify.status.not_found": "Certificate not found",
  "speedLimiters.verify.status.not_foundDesc":
    "No certificate matches this verification code.",
  "speedLimiters.verify.noCode": "The verification link is missing its code.",
  "speedLimiters.verify.error": "Verification failed. Please check your connection and try again.",
  "speedLimiters.verify.certificateNumber": "Certificate number",
  "speedLimiters.verify.issuedBy": "Issued by",
  "speedLimiters.verify.customer": "Customer",
  "speedLimiters.verify.vehicle": "Vehicle",
  "speedLimiters.verify.plate": "License plate",
  "speedLimiters.verify.setSpeed": "Set speed",
  "speedLimiters.verify.issuedAt": "Issue date",
  "speedLimiters.verify.expiresAt": "Expiry date",
  "speedLimiters.verify.issuingAuthority": "Issuing authority",
  "speedLimiters.verify.poweredBy": "Verification service by {app}",
} as const;
