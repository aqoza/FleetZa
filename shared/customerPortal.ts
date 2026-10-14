/**
 * Customer portal rules shared by the SPA and tests. The database (migration
 * 20261008000028_customer_portal.sql) resolves links and enforces the request
 * lifecycle; this mirrors both for the screens.
 */

export const REQUEST_TYPES = ["service", "inspection", "installation", "renewal", "support", "other"] as const;
export type RequestType = (typeof REQUEST_TYPES)[number];

export const REQUEST_STATUSES = ["new", "in_review", "scheduled", "done", "rejected"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const OPEN_REQUEST_STATUSES: readonly RequestStatus[] = ["new", "in_review", "scheduled"];

/** Statuses a request can move to next. Mirrors app.portal_request_guard. */
export function nextRequestStatuses(from: RequestStatus): RequestStatus[] {
  if (from === "done" || from === "rejected") return ["in_review"];
  return (["in_review", "scheduled", "done", "rejected"] as RequestStatus[]).filter((s) => s !== from);
}

export const PORTAL_SECTIONS = ["vehicles", "certificates", "invoices", "quotes", "contracts"] as const;
export type PortalSection = (typeof PORTAL_SECTIONS)[number];

export type LinkState = "active" | "revoked" | "expired";

/** Mirrors app.customer_portal_link: revoked wins, then expiry. */
export function linkState(link: { active: boolean; expires_at: string | null }, nowIso: string): LinkState {
  if (!link.active) return "revoked";
  if (link.expires_at && Date.parse(link.expires_at) <= Date.parse(nowIso)) return "expired";
  return "active";
}

export function portalUrl(origin: string, token: string): string {
  return `${origin}/portal/${token}`;
}

export type CertificateState = "valid" | "expired" | "superseded" | "revoked";

/** What a customer still owes, per currency, across their open invoices. */
export function balanceByCurrency(invoices: Array<{ balance: number | string; currency: string }>): Array<[string, number]> {
  const sums = new Map<string, number>();
  for (const i of invoices) {
    const b = Number(i.balance);
    if (!(b > 0)) continue;
    sums.set(i.currency, Math.round(((sums.get(i.currency) ?? 0) + b) * 1000) / 1000);
  }
  return [...sums.entries()];
}
