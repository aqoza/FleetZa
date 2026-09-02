export const enSlCertificates = {
  // List page
  "slCertificates.title": "Certificates",
  "slCertificates.description":
    "Speed limiter compliance certificates issued to your customers",
  "slCertificates.settings": "Certificate settings",
  "slCertificates.searchPlaceholder": "Certificate #, UIN, seal, vehicle or plate…",
  "slCertificates.searchNarrowHint":
    "More than {count} vehicles match this search — only the first {count} are included. Narrow the search to see the rest.",
  "slCertificates.searchSupersededHint":
    "{count} superseded certificates match — they were replaced by a later renewal, so they are hidden here.",
  "slCertificates.searchSupersededLink": "Show them",

  // Filter chips
  "slCertificates.filterAll": "All",
  "slCertificates.filterValid": "Valid",
  "slCertificates.filter30": "≤ 30 days",
  "slCertificates.filter60": "31–60 days",
  "slCertificates.filter90": "61–90 days",
  "slCertificates.filterExpired": "Expired",
  "slCertificates.filterRevoked": "Revoked",
  "slCertificates.filterSuperseded": "Superseded",

  // Table
  "slCertificates.number": "Certificate #",
  "slCertificates.customer": "Customer",
  "slCertificates.vehicle": "Vehicle",
  "slCertificates.issued": "Issued",
  "slCertificates.expires": "Expires",
  "slCertificates.expiresInDays": "Expires in {count} d",

  // Row actions
  "slCertificates.print": "Print",
  "slCertificates.download": "Download",
  "slCertificates.downloadFailed": "Couldn't create the PDF — try again",
  "slCertificates.copyVerifyLink": "Copy verify link",
  "slCertificates.linkCopied": "Link copied",
  "slCertificates.renew": "Renew",
  "slCertificates.renewBlockedRevoked": "Cannot be renewed — this certificate was revoked",
  "slCertificates.renewBlockedSuperseded":
    "Cannot be renewed — a later certificate has already replaced it",
  "slCertificates.revoke": "Revoke",

  // Renew modal
  "slCertificates.renewTitle": "Renew certificate",
  "slCertificates.renewLead": "Issue a new certificate replacing {number}.",
  "slCertificates.renewNumberHint":
    "The new certificate number is assigned automatically when issued.",
  "slCertificates.issuingAuthority": "Issuing authority",
  "slCertificates.setSpeed": "Set speed (km/h)",
  "slCertificates.setSpeedSecondary": "Second band (km/h)",
  "slCertificates.setSpeedSecondaryHint":
    "Optional. Certificates print both bands as a pair, e.g. 70/90 KMPH.",
  "slCertificates.technician": "Technician",
  "slCertificates.technicianHint": "Printed on the certificate. Defaults to the technician set in certificate settings.",
  "slCertificates.technicianNone": "— none —",
  "slCertificates.defaultTechnician": "Default technician",
  "slCertificates.defaultTechnicianHint":
    "Preselected when issuing a certificate. The name is copied onto each certificate as it is issued, so renaming or removing a technician never changes a document already issued.",
  "slCertificates.defaultTechnicianNone": "— no default —",
  "slCertificates.issuedAt": "Issue date",
  "slCertificates.expiresAt": "Expiry date",
  "slCertificates.renewConfirm": "Issue certificate",
  "slCertificates.renewFailed": "Renewal failed",
  // Toasts — the new certificate number is what gets printed and filed.
  "slCertificates.toast.issued": "Certificate {number} issued.",
  "slCertificates.toast.renewed": "Renewed as certificate {number}.",
  "slCertificates.renewLoadFailed": "This certificate could not be loaded, so it cannot be renewed.",

  // Bulk renew — one customer, several vehicles, one operation
  "slCertificates.bulkRenew": "Renew selected",
  "slCertificates.bulkRenewTitle": "Renew {count} certificates",
  "slCertificates.bulkRenewLead":
    "A replacement certificate is issued for each of the {count} vehicles below, carrying over its authority and set speeds.",
  "slCertificates.bulkEligible": "Will be renewed ({count})",
  "slCertificates.bulkSkipped": "Skipped ({count})",
  "slCertificates.bulkSkipRevoked": "Revoked — cannot be renewed",
  "slCertificates.bulkSkipSuperseded": "Already renewed",
  "slCertificates.bulkNoneEligible": "None of the selected certificates can be renewed.",
  "slCertificates.bulkProgress": "Issuing {done} of {total}…",
  "slCertificates.bulkCloseBlocked":
    "Certificates are being issued — this stays open until the run finishes, so you get the full report.",
  "slCertificates.bulkConfirm": "Issue {count} certificates",
  "slCertificates.bulkDoneAll": "Issued {count} certificates.",
  "slCertificates.bulkDonePartial":
    "Issued {done} of {total} certificates. {failed} failed — the ones below were not renewed.",
  "slCertificates.bulkSucceeded": "Issued",
  "slCertificates.bulkFailed": "Failed",

  // Billing — derived from the invoice that bills the certificate
  // (src/lib/certificateBilling.ts); shown only when the billing module is on.
  "slCertificates.billing": "Billing",
  "slCertificates.billing.unbilled": "Not invoiced",
  "slCertificates.billing.quoted": "Quoted",
  "slCertificates.billing.ordered": "Ordered",
  "slCertificates.billing.draft": "Draft invoice",
  "slCertificates.billing.invoiced": "Invoiced",
  "slCertificates.billing.overdue": "Overdue",
  "slCertificates.billing.paid": "Paid",
  "slCertificates.billingFilterAll": "Any billing",
  "slCertificates.billingFilterUnquoted": "Not quoted",
  "slCertificates.billingFilterQuoted": "Quoted",
  "slCertificates.billingFilterUnbilled": "Not invoiced",
  "slCertificates.billingFilterInvoiced": "Invoiced",
  "slCertificates.billingFilterPaid": "Paid",
  "slCertificates.openInvoice": "Open invoice {number}",
  "slCertificates.openDocument": "Open {number}",
  "slCertificates.skipQuoted": "Already quoted on {number}",
  "slCertificates.skipOrdered": "Already ordered on {number}",

  // Quote dialog — the renewal quote, before the work
  "slCertificates.createQuote": "Create quote",
  "slCertificates.quoteTitle": "Quote {count} renewals",
  "slCertificates.quoteLead":
    "One quote for {customer}, with a line per vehicle carrying its plate and the certificate being renewed. Send it in the same step, or review it first.",
  "slCertificates.quoteEligible": "Will be quoted ({count})",
  "slCertificates.quoteOthersPending":
    "{name} has {count} more renewals due that are not quoted yet.",
  "slCertificates.quoteSendNow": "Mark as sent and copy the customer link",
  "slCertificates.quoteSendNowHint":
    "Skips the draft step: the quote is sent at once and the link the customer accepts from is ready to paste into a message.",
  "slCertificates.quoteConfirm": "Create draft quote",
  "slCertificates.quoteConfirmSend": "Create and send quote",
  "slCertificates.quoteCreated": "Draft quote {number} created with {count} lines.",
  "slCertificates.quoteSent": "Quote {number} sent — customer link copied.",
  "slCertificates.quoteSentLead":
    "Quote {number} is marked as sent. Share this link with the customer; they can accept the quote from it.",
  "slCertificates.openQuote": "Open quote {number}",
  "slCertificates.quoteFailed": "Could not create the quote",
  "slCertificates.quoteCloseBlocked":
    "The quote is being created — this stays open until it is done.",

  // Invoice dialog — one draft invoice for a selection of certificates
  "slCertificates.createInvoice": "Create invoice",
  "slCertificates.invoiceTitle": "Invoice {count} certificates",
  "slCertificates.invoiceLead":
    "One draft invoice for {customer}, with a line per vehicle carrying its plate and certificate number. Lines and prices can still be adjusted before the invoice is issued.",
  "slCertificates.invoiceEligible": "Will be invoiced ({count})",
  "slCertificates.invoiceSkipped": "Skipped ({count})",
  "slCertificates.invoiceSkipInvoiced": "Already on {number}",
  "slCertificates.invoiceSkipOtherCustomer": "Different customer — {name}",
  "slCertificates.invoiceSkipNoCustomer": "No customer to bill",
  "slCertificates.invoiceNoneEligible": "None of the selected certificates can be invoiced.",
  "slCertificates.invoiceOthersPending":
    "{name} has {count} more certificates that are not invoiced yet.",
  "slCertificates.invoiceAddOthers": "Add them to this invoice",
  "slCertificates.invoiceOnlySelected": "Only the selected ones",
  "slCertificates.invoiceCatalogItem": "Catalog item",
  "slCertificates.invoiceCatalogHint": "Optional — prefills the description, price and tax.",
  "slCertificates.invoiceDescription": "Description",
  "slCertificates.invoiceDescriptionHint":
    "Printed on every line, followed by the plate and the certificate number.",
  "slCertificates.invoiceDefaultDescription": "Speed limiter certificate renewal",
  "slCertificates.invoiceUnitPrice": "Price per vehicle",
  "slCertificates.invoiceTaxRate": "Tax %",
  "slCertificates.invoicePreview": "{count} lines · {total} incl. tax",
  "slCertificates.invoiceConfirm": "Create draft invoice",
  "slCertificates.invoiceCreated": "Draft invoice {number} created with {count} lines.",
  "slCertificates.invoiceFailed": "Could not create the invoice",
  "slCertificates.invoiceCloseBlocked":
    "The invoice is being created — this stays open until it is done.",
  "slCertificates.invoiceAfterRenew": "Create an invoice for these {count} certificates",

  // Revoke modal
  "slCertificates.revokeTitle": "Revoke certificate",
  "slCertificates.revokeLead":
    "Certificate {number} will be marked as revoked and the public verification page will show it as revoked.",
  "slCertificates.revokeReason": "Reason",
  "slCertificates.revokeConfirm": "Revoke certificate",
  "slCertificates.revokeFailed": "Revoke failed",

  // Delete modal
  "slCertificates.deleteTitle": "Delete certificate",
  "slCertificates.deleteConfirm":
    "Delete certificate {number}? This cannot be undone.",
  "slCertificates.deleteFailed": "Delete failed",

  // Settings modal
  "slCertificates.settingsTitle": "Certificate settings",
  "slCertificates.certPrefix": "Certificate number prefix",
  "slCertificates.certPrefixHint":
    "Used when generating new certificate numbers, e.g. SLC.",
  "slCertificates.validityMonths": "Validity (months)",
  "slCertificates.validityHint":
    "Default validity period for new and renewed certificates.",
  "slCertificates.settingsSaveFailed": "Failed to save settings",

  // Empty states
  "slCertificates.emptyTitle": "No certificates yet",
  "slCertificates.emptyDesc":
    "Certificates are issued from completed jobs and will appear here.",
  "slCertificates.emptyFilteredTitle": "No matching certificates",
  "slCertificates.emptyFilteredDesc":
    "Try a different filter or search term.",

  // Print page
  "slCertificates.printTitle": "Speed Limiter Compliance Certificate",
  "slCertificates.certNumberLabel": "Certificate No.",
  "slCertificates.fieldCustomer": "Customer",
  "slCertificates.fieldVehicle": "Vehicle",
  "slCertificates.fieldPlate": "License plate",
  "slCertificates.fieldChassis": "Chassis number",
  "slCertificates.fieldDeviceSerial": "Device serial",
  "slCertificates.fieldSetSpeed": "Set speed",
  "slCertificates.fieldIssued": "Issue date",
  "slCertificates.fieldExpires": "Expiry date",
  "slCertificates.fieldAuthority": "Issuing authority",
  "slCertificates.scanToVerify": "Scan to verify",
  "slCertificates.authorizedSignature": "Authorized signature",
  "slCertificates.companyStamp": "Company stamp",
  "slCertificates.revokedBanner": "This certificate has been revoked",
  "slCertificates.revokedOn": "Revoked on {date}",
  "slCertificates.notFound": "Certificate not found",

  // Official RSL report (Oman dealer format — wording matches the document
  // dealers file with the ROP, so it is intentionally left verbatim).
  "slCertificates.report.typeInstallation": "Installation",
  "slCertificates.report.typeRenewal": "Renewal",
  "slCertificates.report.applicableStandard": "Applicable Standard",
  "slCertificates.report.certificateNo": "Certificate No.",
  "slCertificates.report.countryOfInstallation": "Country of installation",
  "slCertificates.report.declarationTitle": "DECLARATION",
  "slCertificates.report.declarationText":
    "This is to certify that the vehicle with below mentioned details has been fitted with Road Speed Limiter device, programmed for a top speed of maximum {speed}. The speed limiter fitted to the vehicle complies with the Applicable Standard. The device is Calibrated and sealed.",
  "slCertificates.report.vehicleDetails": "VEHICLE DETAILS",
  "slCertificates.report.vehicleOwner": "Vehicle Owner",
  "slCertificates.report.registrationNo": "Registration No.",
  "slCertificates.report.chassisNo": "Chassis No.",
  "slCertificates.report.engineNo": "Engine No.",
  "slCertificates.report.makeOfVehicle": "Make of Vehicle",
  "slCertificates.report.modelOfVehicle": "Model of Vehicle",
  "slCertificates.report.yearOfManufacture": "Year of Manufacture",
  "slCertificates.report.slDetails": "SPEED LIMITER DETAILS",
  "slCertificates.report.limiterType": "Type of Speed Limiter",
  "slCertificates.report.defaultLimiterType": "Electronic Pedal",
  "slCertificates.report.setSpeedLimit": "Set Speed Limit",
  "slCertificates.report.serialNo": "Serial No.",
  "slCertificates.report.tamperSealNo": "Tamper Seal No.",
  "slCertificates.report.dateOfInstallation": "Date of Installation",
  "slCertificates.report.technicianName": "Technician Name",
  "slCertificates.report.dealerDetails": "DEALER DETAILS",
  "slCertificates.report.dealerName": "Dealer Name",
  "slCertificates.report.addressPhone": "Address & Phone",
  "slCertificates.report.uinLabel": "UIN (Unique identification number)",
  "slCertificates.report.validUpto": "Valid Upto",
  "slCertificates.report.speedUnit": "KMPH",

  // Footer strip — the services band and the registration line, which the
  // document prints twice (Arabic above English) on every copy.
  "slCertificates.report.footerCr": "C.R.No.{value}",
  "slCertificates.report.footerPoBox": "P.O. Box: {value}",
  "slCertificates.report.footerPostalCode": "Postal Code: {value}",
  "slCertificates.report.footerWebsite": "Website: {value}",
  // The dealer names each line separately, so the two numbers carry their own
  // labels rather than being slash-joined into one "GSM:" segment.
  "slCertificates.report.footerPhone": "Service & Support: {value}",
  "slCertificates.report.footerPhoneSecondary": "Alternative Contact: {value}",
  "slCertificates.report.footerSeparator": ", ",
  "slCertificates.report.footerEmail": "E-mail: {value}",
  "slCertificates.report.signature": "Authorized signature",
  "slCertificates.report.stamp": "Company stamp",
  // Authorized-signatory block: "For <trade name>" above the signature, the
  // signatory's own name below it.
  "slCertificates.report.forCompany": "For {name}",
} as const;
