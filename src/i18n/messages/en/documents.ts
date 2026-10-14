// Documents module (documents). Arabic lives in ../ar/documents.ts and must stay complete.
export const enDocuments = {
  "documents.title": "Documents",
  "documents.subtitle": "Every file in one place, with expiry tracking.",

  // Tabs
  "documents.tab.all": "All documents",
  "documents.tab.expiring": "Expiring",

  // List
  "documents.upload": "Upload",
  "documents.uploadTitle": "Upload a document",
  "documents.editTitle": "Edit document",
  "documents.deleteTitle": "Delete document",
  "documents.deleteConfirm": "Delete {name}? The file is removed for good.",
  "documents.search": "Search name, description or tag…",
  "documents.allCategories": "All categories",
  "documents.allLinks": "Any record",
  "documents.unlinked": "Not linked",
  "documents.allExpiry": "Any expiry",
  "documents.emptyTitle": "No documents yet",
  "documents.emptyDesc": "Upload contracts, licences, insurance cards and photos, and keep their expiry dates in view.",
  "documents.emptyFilteredTitle": "No matching documents",
  "documents.emptyFilteredDesc": "Try a different search or clear the filters.",
  "documents.ownOnly": "You see documents shared with the whole team and your own HR files.",
  "documents.count": { one: "{count} document", other: "{count} documents" },

  // Fields
  "documents.name": "Name",
  "documents.file": "File",
  "documents.fileHint": "Up to 25 MB. PDF, images, Office files…",
  "documents.replaceFileHint": "The file itself cannot be swapped; upload a new document instead.",
  "documents.category": "Category",
  "documents.description": "Description",
  "documents.expiresOn": "Expires on",
  "documents.expiresOnHint": "Managers get a reminder 30 and 7 days before, and when it lapses.",
  "documents.tags": "Tags",
  "documents.tagsHint": "Separate with commas.",
  "documents.linkedTo": "Linked to",
  "documents.linkType": "Record type",
  "documents.linkRecord": "Record",
  "documents.size": "Size",
  "documents.uploaded": "Uploaded",
  "documents.expiry": "Expiry",

  // Categories
  "documents.categoryLabel.general": "General",
  "documents.categoryLabel.contract": "Contract",
  "documents.categoryLabel.invoice": "Invoice",
  "documents.categoryLabel.receipt": "Receipt",
  "documents.categoryLabel.photo": "Photo",
  "documents.categoryLabel.license": "Licence",
  "documents.categoryLabel.insurance": "Insurance",
  "documents.categoryLabel.permit": "Permit",
  "documents.categoryLabel.report": "Report",
  "documents.categoryLabel.certificate": "Certificate",
  "documents.categoryLabel.other": "Other",

  // Linked record types
  "documents.entity.vehicle": "Vehicle",
  "documents.entity.driver": "Driver",
  "documents.entity.customer": "Customer",
  "documents.entity.supplier": "Supplier",
  "documents.entity.employee": "Employee",
  "documents.entity.incident": "Incident",
  "documents.entity.hr": "HR file",
  "documents.entity.other": "Other record",
  "documents.openRecord": "Open record",

  // Expiry
  "documents.expiryState.none": "No expiry",
  "documents.expiryState.ok": "Valid",
  "documents.expiryState.soon": "Expiring soon",
  "documents.expiryState.expired": "Expired",
  "documents.expiresToday": "Expires today",
  "documents.expiresIn": {
    one: "Expires tomorrow",
    other: "Expires in {count} days",
  },
  "documents.expiredAgo": {
    one: "Expired yesterday",
    other: "Expired {count} days ago",
  },
  "documents.expiringHint": "Documents that expired or expire in the next 30 days, soonest first.",
  "documents.expiringEmptyTitle": "Nothing expiring",
  "documents.expiringEmptyDesc": "No document expires in the next 30 days.",

  // Actions & results
  "documents.download": "Download",
  "documents.uploading": "Uploading…",
  "documents.uploaded.toast": "Document uploaded",
  "documents.fileRequired": "Choose a file to upload.",
  "documents.fileTooLarge": "That file is over 25 MB.",
  "documents.saveFailed": "Could not save the document.",
  "documents.uploadFailed": "The upload failed, so nothing was saved. Try again.",
  "documents.downloadFailed": "Could not open the file.",
  "documents.deleteFailed": "Could not delete the document.",

  // Panel on other records
  "documents.panelTitle": "Documents",
  "documents.panelEmpty": "No documents attached.",
  "documents.seeAll": "See all documents",
} as const;
