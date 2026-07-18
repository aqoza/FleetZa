export const enSettings = {
  // Page
  "settings.title": "Settings",
  "settings.subtitle": "Your organization, team members, and invitations",
  "settings.tab.organization": "Organization",
  "settings.tab.members": "Members",
  "settings.tab.invitations": "Invitations",
  "settings.adminsOnlyInvitations": "Only admins manage invitations.",

  // Organization form
  "settings.orgName": "Organization name",
  "settings.country": "Country",
  "settings.countryChangeHint":
    "Changing country updates formats and tax defaults for the whole organization.",
  "settings.currency": "Currency",
  "settings.timezone": "Timezone",
  "settings.middleEast": "Middle East",
  "settings.otherCountries": "Other countries",
  "settings.distance": "Distance",
  "settings.volume": "Volume",
  "settings.kilometers": "Kilometers",
  "settings.miles": "Miles",
  "settings.liters": "Liters",
  "settings.gallons": "Gallons (US)",
  "settings.saved": "Saved.",
  "settings.saveFailed": "Save failed",

  // Organization read-only view
  "settings.distanceUnit": "Distance unit",
  "settings.volumeUnit": "Volume unit",
  "settings.created": "Created",

  // Country profile card
  "settings.countryProfile": "Country profile",
  "settings.countryProfileDesc": "Defaults for {name} applied across the app.",
  "settings.egSample": "— e.g. {sample}",
  "settings.dateFormat": "Date format",
  "settings.tax": "Tax",
  "settings.noTax": "No {label}",
  "settings.renewalDefaults": "Renewal defaults",
  "settings.everyMonths": "every {count} mo",

  // Members
  "settings.role": "Role",
  "settings.joined": "Joined",
  "settings.noMembers": "No members yet",
  "settings.noMembersDesc": "Invite teammates from the Invitations tab.",
  "settings.roleForAria": "Role for {name}",
  "settings.roleChangeFailed": "Role change failed",
  "settings.removeFailed": "Remove failed",
  "settings.removeMember": "Remove member",
  "settings.removeMemberConfirmPre": "Remove",
  "settings.removeMemberConfirmPost":
    "from the organization? They will lose access immediately.",

  // Invitations
  "settings.inviteMember": "Invite member",
  "settings.createInvitation": "Create invitation",
  "settings.inviteFailed": "Invite failed",
  "settings.revokeFailed": "Revoke failed",
  "settings.invited": "Invited",
  "settings.revoke": "Revoke",
  "settings.revokeInvitation": "Revoke invitation",
  "settings.noInvitations": "No invitations yet",
  "settings.noInvitationsDesc":
    "Invite teammates to give them access to your fleet workspace.",
  "settings.inviteLinkHint":
    "Send the invite link to your teammate — the app does not email it yet.",
  "settings.revokeInvitationConfirmPre": "Revoke the invitation for",
  "settings.revokeInvitationConfirmPost": "? The invite link will stop working.",
  "settings.statusPending": "Pending",
  "settings.statusAccepted": "Accepted",
  "settings.statusRevoked": "Revoked",
  "settings.statusExpired": "Expired",
} as const;
