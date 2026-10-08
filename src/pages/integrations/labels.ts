import type { BadgeTone } from "../../components/ui";
import type { MessageKey } from "../../i18n";
import { eventSpec } from "../../lib/automation";
import type { DeliveryStatus } from "./types";

export const scopeKey = (scope: string) => `integrations.scope.${scope}` as MessageKey;
export const deliveryStatusKey = (s: DeliveryStatus) => `integrations.status.${s}` as MessageKey;
export const DELIVERY_TONE: Record<DeliveryStatus, BadgeTone> = {
  pending: "blue",
  delivered: "green",
  failed: "red",
};

/** A readable event label: the automation catalog's, else the raw name. */
export function eventLabel(t: (k: MessageKey) => string, event: string): string {
  if (event === "webhook.test") return t("integrations.testEvent");
  return eventSpec(event) ? t(`automation.ev.${event}` as MessageKey) : event;
}
