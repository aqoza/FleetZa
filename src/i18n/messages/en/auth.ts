// Auth module — page-specific strings for login, signup, and accept-invite.
// Shared auth strings (auth.welcomeBack, auth.signIn, field.email, …) live in
// common.ts and are reused directly — do NOT duplicate them here.
export const enAuth = {
  // Signup — country picker groups and tax hint
  "auth.middleEast": "Middle East",
  "auth.otherCountries": "Other countries",
  "auth.taxHint": "{label} {rate}% will be applied to maintenance costs.",

  // Accept invite
  "auth.joinOrg": "Join {org}",
  "auth.invitedAs": "You've been invited as {role} ({email}).",
  "auth.choosePassword": "Choose a password",
  "auth.joinOrganization": "Join organization",
  "auth.inviteProblem": "Invitation problem",
  "auth.checkingInvite": "Checking invitation…",
  "auth.inviteMissingToken": "This invitation link is missing its token.",
  "auth.inviteNotFound": "Invitation not found",
  "auth.inviteAcceptFailed": "Could not accept invitation",
  "auth.inviteHelp": "Ask your administrator to send a new invitation, or",
  "auth.signInLink": "sign in",
} as const;
