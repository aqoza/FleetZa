export const enSpeedLimiters = {
  "speedLimiters.title": "Speed limiters",
  "speedLimiters.subtitle": "Speed limiter installations and certificates across your fleet",

  // Tabs
  "speedLimiters.tabInstallations": "Installations",
  "speedLimiters.tabCertificates": "Certificates",

  // KPIs
  "speedLimiters.kpiActiveInstallations": "Active installations",
  "speedLimiters.kpiVehiclesCovered": "Vehicles covered",

  // Installations table
  "speedLimiters.device": "Device",
  "speedLimiters.setSpeed": "Set speed",
  "speedLimiters.kmhValue": "{value} km/h",
  "speedLimiters.installed": "Installed",
  "speedLimiters.status.active": "Active",
  "speedLimiters.status.maintenance": "Maintenance",
  "speedLimiters.status.removed": "Removed",

  // Installation actions & form
  "speedLimiters.newInstallation": "New installation",
  "speedLimiters.editInstallation": "Edit installation",
  "speedLimiters.deleteInstallation": "Delete installation",
  "speedLimiters.selectVehicle": "Select vehicle…",
  "speedLimiters.deviceSerial": "Device serial",
  "speedLimiters.brand": "Brand",
  "speedLimiters.model": "Model",
  "speedLimiters.setSpeedKmh": "Set speed (km/h)",
  "speedLimiters.installedAt": "Installation date",
  "speedLimiters.technician": "Technician",
  "speedLimiters.deleteInstallationConfirm":
    "Delete the installation of device {serial} on {vehicle}? This cannot be undone.",

  // Installations empty state
  "speedLimiters.noInstallationsYet": "No installations yet",
  "speedLimiters.installationsEmptyDesc":
    "Record the speed limiter devices installed on your vehicles to track them and their certificates.",

  // Certificates table
  "speedLimiters.certificateNumber": "Certificate #",
  "speedLimiters.issued": "Issued",
  "speedLimiters.expires": "Expires",
  "speedLimiters.expired": "Expired",
  "speedLimiters.expiresInDays": "Expires in {count} d",

  // Certificate actions & form
  "speedLimiters.newCertificate": "New certificate",
  "speedLimiters.editCertificate": "Edit certificate",
  "speedLimiters.deleteCertificate": "Delete certificate",
  "speedLimiters.renewCertificate": "Renew certificate",
  "speedLimiters.renew": "Renew",
  "speedLimiters.installation": "Installation",
  "speedLimiters.installationHint": "Optional — link the certificate to an installed device",
  "speedLimiters.noLinkedInstallation": "No linked installation",
  "speedLimiters.issuingAuthority": "Issuing authority",
  "speedLimiters.issuedAt": "Issue date",
  "speedLimiters.expiresAt": "Expiry date",
  "speedLimiters.deleteCertificateConfirm":
    "Delete certificate {number} for {vehicle}? This cannot be undone.",

  // Certificates empty state
  "speedLimiters.noCertificatesYet": "No certificates yet",
  "speedLimiters.certificatesEmptyDesc":
    "Track speed limiter certificates so they are renewed before they expire.",

  // Errors
  "speedLimiters.saveFailed": "Save failed",
  "speedLimiters.deleteFailed": "Delete failed",
} as const;
