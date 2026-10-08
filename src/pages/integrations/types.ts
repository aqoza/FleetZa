export interface WebhookSubscription {
  id: string;
  name: string;
  url: string;
  events: string[];
  active: boolean;
  failure_count: number;
  last_delivery_at: string | null;
  last_success_at: string | null;
  created_at: string;
}

export type DeliveryStatus = "pending" | "delivered" | "failed";

export interface WebhookDelivery {
  id: string;
  subscription_id: string;
  event_id: number | null;
  event: string;
  status: DeliveryStatus;
  attempts: number;
  next_attempt_at: string;
  last_attempt_at: string | null;
  response_code: number | null;
  last_error: string | null;
  delivered_at: string | null;
  created_at: string;
}

export interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  active: boolean;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export const API_SCOPES = [
  "telematics:write",
  "driver_events:write",
  "iot:write",
  "vehicles:read",
  "deliveries:write",
] as const;
