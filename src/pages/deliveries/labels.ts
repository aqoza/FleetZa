import type { BadgeTone } from "../../components/ui";
import type { DeliveryStatus, RouteStatus } from "../../../shared/deliveries";

export const deliveryTone: Record<DeliveryStatus, BadgeTone> = {
  pending: "slate",
  assigned: "blue",
  out_for_delivery: "purple",
  delivered: "green",
  failed: "red",
  returned: "yellow",
};

export const routeTone: Record<RouteStatus, BadgeTone> = {
  planned: "blue",
  out_for_delivery: "purple",
  completed: "green",
  canceled: "slate",
};

export const driverName = (d: { first_name: string; last_name: string } | null) =>
  d ? `${d.first_name} ${d.last_name}`.trim() : null;

/** Public link the recipient opens. */
export const trackingUrl = (token: string) => `${window.location.origin}/track/${token}`;

/** Opens the location in the phone's map app (or Google Maps on desktop). */
export function mapUrl(d: { lat: number | null; lng: number | null; address: string; city: string | null }): string {
  const q = d.lat != null && d.lng != null ? `${d.lat},${d.lng}` : [d.address, d.city].filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

/** YYYY-MM-DD of now in a time zone. */
export function todayInTz(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** Parse an optional coordinate input; undefined means invalid. */
export function parseCoord(v: string, max: number): number | null | undefined {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && Math.abs(n) <= max ? n : undefined;
}
