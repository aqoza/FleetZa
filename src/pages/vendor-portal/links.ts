export type LinkState = "active" | "revoked" | "expired";

/** Mirrors app.vendor_portal_link: revoked wins, then expiry. */
export function linkState(link: { active: boolean; expires_at: string | null }, nowIso: string): LinkState {
  if (!link.active) return "revoked";
  if (link.expires_at && Date.parse(link.expires_at) <= Date.parse(nowIso)) return "expired";
  return "active";
}

export function vendorLinkUrl(token: string, origin = window.location.origin): string {
  return `${origin}/vendor/${token}`;
}

/** What is still owed to the supplier, per currency, across their non-void bills. */
export function outstandingByCurrency(bills: Array<{ status: string; balance: number; currency: string }>): Array<[string, number]> {
  const sums = new Map<string, number>();
  for (const b of bills) {
    if (b.status === "void" || !(Number(b.balance) > 0)) continue;
    sums.set(b.currency, Math.round(((sums.get(b.currency) ?? 0) + Number(b.balance)) * 1000) / 1000);
  }
  return [...sums.entries()];
}
