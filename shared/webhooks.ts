/**
 * Outbound webhooks — the parts the SPA, the worker and the docs page share.
 *
 * Every delivery is a POST with a JSON envelope
 *   { id, event, entity_type, entity_id, occurred_at, data }
 * and these headers:
 *   X-FleetManage-Event      the event name ("vehicle.created", "webhook.test", …)
 *   X-FleetManage-Delivery   the delivery id (stable across retries; dedupe on it)
 *   X-FleetManage-Signature  "t=<unix seconds>,v1=<hex HMAC-SHA256(secret, `${t}.${body}`)>"
 */

export const SIGNATURE_HEADER = "X-FleetManage-Signature";
export const EVENT_HEADER = "X-FleetManage-Event";
export const DELIVERY_HEADER = "X-FleetManage-Delivery";
export const DELIVERY_TIMEOUT_MS = 10_000;
export const MAX_ATTEMPTS = 6;

const BLOCKED_HOST =
  /^(localhost|.*\.localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\..*|10\..*|192\.168\..*|169\.254\..*|172\.(1[6-9]|2[0-9]|3[01])\..*|\[.*)$/;

/**
 * Same rule as app.valid_webhook_url: https, no credentials, no local or
 * private-network host. The worker checks it again right before each call.
 */
export function isSafeWebhookUrl(raw: string): boolean {
  const url = raw.trim();
  if (url.length < 12 || url.length > 2000) return false;
  if (!/^https:\/\/[^/?#@\s]+(\/\S*)?$/.test(url)) return false;
  const host = url.slice(8).split("/")[0].split(":")[0].toLowerCase();
  return !BLOCKED_HOST.test(host);
}

export const WILDCARD_EVENT = "*";
const EVENT_NAME = /^([a-z][a-z_]*\.[a-z][a-z_]*|\*)$/;

export function isValidEventList(events: string[]): boolean {
  return events.length >= 1 && events.length <= 50 && events.every((e) => EVENT_NAME.test(e));
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** HMAC-SHA256 of `${timestamp}.${body}` as lowercase hex (WebCrypto: worker and Node). */
export async function hmacHex(secret: string, timestamp: number, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  return toHex(await crypto.subtle.sign("HMAC", key, enc.encode(`${timestamp}.${body}`)));
}

export async function signatureHeader(secret: string, timestamp: number, body: string): Promise<string> {
  return `t=${timestamp},v1=${await hmacHex(secret, timestamp, body)}`;
}

/** Retry schedule after the n-th failed attempt (mirrors app.webhook_backoff). */
export function backoffMinutes(attempts: number): number {
  return 4 ** (Math.max(attempts, 1) - 1);
}

/** A receiver-side check, shown on the docs page and used by the tests. */
export async function verifySignature(
  secret: string,
  header: string,
  body: string,
  nowSeconds: number,
  toleranceSeconds = 300,
): Promise<boolean> {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=", 2) as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || !parts.v1 || Math.abs(nowSeconds - t) > toleranceSeconds) return false;
  return (await hmacHex(secret, t, body)) === parts.v1;
}
