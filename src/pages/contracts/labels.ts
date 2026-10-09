import type { BadgeTone } from "../../components/ui";
import { periodAmount, type ContractStatus, type RevenueTerms } from "../../../shared/contracts";
import type { Contract } from "./types";

export const statusTone: Record<ContractStatus, BadgeTone> = {
  draft: "slate",
  active: "green",
  expired: "yellow",
  terminated: "red",
  renewed: "blue",
};

/** Revenue terms of a loaded contract, with its vehicles' per-period rates. */
export function revenueTerms(c: Contract): RevenueTerms {
  return {
    status: c.status,
    billing_frequency: c.billing_frequency,
    next_billing_date: c.next_billing_date,
    end_date: c.end_date,
    recurring_amount: c.recurring_amount,
    vehicle_amount: (c.vehicles ?? []).reduce((s, v) => s + Number(v.rate_override ?? 0), 0),
  };
}

export function contractPeriodAmount(c: Contract): number {
  return periodAmount(revenueTerms(c));
}

/** YYYY-MM-DD of now in a time zone. */
export function todayIn(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
