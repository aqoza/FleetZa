import { Hono } from "hono";
import { adminClient, requireAuth, type AppEnv } from "./lib";
import {
  DELIVERY_HEADER, DELIVERY_TIMEOUT_MS, EVENT_HEADER, SIGNATURE_HEADER, isSafeWebhookUrl, signatureHeader,
} from "../shared/webhooks";

/**
 * /api/integrations/* — webhook delivery dispatch (member JWT).
 * Owned by the `integrations` module.
 *
 * POST /dispatch delivers the caller's tenant's due webhook deliveries. Any
 * member may trigger it (the SPA calls it when the integrations page opens
 * and on "Deliver now"); it only sends what is already queued. Claiming and
 * the retry state machine live in SQL (claim_webhook_deliveries,
 * record_webhook_attempt, service role only), so two concurrent calls never
 * send the same delivery twice within the 2-minute lease.
 */
export const integrations = new Hono<AppEnv>();

integrations.use("*", requireAuth);

interface ClaimedDelivery {
  id: string;
  url: string;
  secret: string;
  event: string;
  payload: unknown;
  attempts: number;
}

interface AttemptResult {
  ok: boolean;
  code: number | null;
  error: string | null;
}

async function deliver(d: ClaimedDelivery): Promise<AttemptResult> {
  if (!isSafeWebhookUrl(d.url)) return { ok: false, code: null, error: "URL refused (not a public https endpoint)" };
  const body = JSON.stringify(d.payload);
  const timestamp = Math.floor(Date.now() / 1000);
  try {
    const res = await fetch(d.url, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "FleetMaster-Webhooks/1",
        [EVENT_HEADER]: d.event,
        [DELIVERY_HEADER]: d.id,
        [SIGNATURE_HEADER]: await signatureHeader(d.secret, timestamp, body),
      },
      body,
    });
    // Drain so the connection is released; receivers' bodies are not stored.
    await res.body?.cancel().catch(() => undefined);
    if (res.status >= 200 && res.status < 300) return { ok: true, code: res.status, error: null };
    const reason = res.status >= 300 && res.status < 400 ? "Redirects are not followed" : res.statusText || "Non-2xx response";
    return { ok: false, code: res.status, error: reason };
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    const error = name === "TimeoutError" || name === "AbortError"
      ? `No response within ${DELIVERY_TIMEOUT_MS / 1000}s`
      : err instanceof Error ? err.message : "Network error";
    return { ok: false, code: null, error };
  }
}

integrations.post("/dispatch", async (c) => {
  const tenantId = c.get("tenantId");
  const admin = adminClient(c.env);

  const { data, error } = await admin.rpc("claim_webhook_deliveries", { p_tenant: tenantId, p_limit: 20 });
  if (error) return c.json({ error: "Could not load deliveries." }, 500);
  const claimed = (data ?? []) as ClaimedDelivery[];

  const results = await Promise.all(
    claimed.map(async (d) => {
      const r = await deliver(d);
      const { data: status } = await admin.rpc("record_webhook_attempt", {
        p_id: d.id,
        p_ok: r.ok,
        p_response_code: r.code,
        p_error: r.error,
      });
      return status as string | null;
    }),
  );

  return c.json({
    claimed: claimed.length,
    delivered: results.filter((s) => s === "delivered").length,
    retrying: results.filter((s) => s === "pending").length,
    failed: results.filter((s) => s === "failed").length,
  });
});
