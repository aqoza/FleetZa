import type { BadgeTone } from "../../components/ui";
import type { ClaimStatus, PolicyStatus } from "../../../shared/insurance";
import type { Claim, Policy } from "./types";

export const policyTone: Record<PolicyStatus, BadgeTone> = {
  upcoming: "blue",
  active: "green",
  expiring: "yellow",
  expired: "red",
  canceled: "slate",
};

export const claimTone: Record<ClaimStatus, BadgeTone> = {
  draft: "slate",
  submitted: "blue",
  under_review: "purple",
  approved: "green",
  rejected: "red",
  settled: "green",
  withdrawn: "slate",
};

export function insurerName(p: Pick<Policy, "insurer_name"> & { insurer: { name: string } | null }): string {
  return p.insurer?.name ?? p.insurer_name ?? "";
}

export function claimInsurer(c: Claim): string {
  return c.policy ? insurerName(c.policy) : "";
}

/** Today's date (YYYY-MM-DD) in the tenant's time zone. */
export function todayInTz(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
