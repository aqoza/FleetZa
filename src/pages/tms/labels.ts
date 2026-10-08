import type { BadgeTone } from "../../components/ui";
import type { ShipmentStatus } from "../../../shared/tms";
import type { Shipment } from "./types";

export const shipmentTone: Record<ShipmentStatus, BadgeTone> = {
  draft: "slate",
  booked: "blue",
  dispatched: "blue",
  in_transit: "purple",
  exception: "red",
  delivered: "green",
  closed: "green",
  canceled: "slate",
};

export const driverName = (d: { first_name: string; last_name: string } | null) =>
  d ? `${d.first_name} ${d.last_name}`.trim() : null;

/** Who carries the shipment, for lists. */
export const carrierLabel = (s: Pick<Shipment, "carrier_type" | "vehicle" | "carrier">) =>
  s.carrier_type === "own" ? s.vehicle?.name ?? null : s.carrier?.name ?? null;

/** Delivered after the window closed; null when there is nothing to judge. */
export function isLate(s: Pick<Shipment, "delivered_at" | "delivery_window_end">): boolean | null {
  if (!s.delivered_at || !s.delivery_window_end) return null;
  return Date.parse(s.delivered_at) > Date.parse(s.delivery_window_end);
}

/** ISO timestamp → value for <input type="datetime-local"> in the browser's zone. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** <input type="datetime-local"> value → ISO, or null when empty. */
export const fromLocalInput = (v: string): string | null => (v ? new Date(v).toISOString() : null);
