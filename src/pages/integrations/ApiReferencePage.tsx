import type { ReactNode } from "react";
import { useT, type MessageKey } from "../../i18n";
import { Badge, Card } from "../../components/ui";
import { DELIVERY_HEADER, EVENT_HEADER, SIGNATURE_HEADER } from "../../../shared/webhooks";
import { scopeKey } from "./labels";

/** Static reference for /api/v1/* (ingestion endpoints owned by the telematics modules) and webhooks. */
const ENDPOINTS: Array<{ method: "GET" | "POST"; path: string; scope: string; module: MessageKey; desc: MessageKey; example?: string }> = [
  {
    method: "POST", path: "/api/v1/positions", scope: "telematics:write", module: "nav.gpsTracking", desc: "integrations.api.positions",
    example: `[{ "vehicle": "4TRK771", "recorded_at": "2026-10-08T09:30:00Z",
   "lat": 23.5880, "lng": 58.3829, "speed_kmh": 62, "heading": 140 }]`,
  },
  { method: "GET", path: "/api/v1/vehicles", scope: "vehicles:read", module: "nav.gpsTracking", desc: "integrations.api.vehicles" },
  {
    method: "POST", path: "/api/v1/driving-events", scope: "driver_events:write", module: "nav.driverBehavior", desc: "integrations.api.drivingEvents",
    example: `{ "vehicle_id": "…", "occurred_at": "2026-10-08T09:31:12Z",
  "event_type": "harsh_braking", "severity": "medium", "speed_kmh": 74 }`,
  },
  {
    method: "POST", path: "/api/v1/iot/readings", scope: "iot:write", module: "nav.iot", desc: "integrations.api.iot",
    example: `[{ "serial": "TMP-0042", "recorded_at": "2026-10-08T09:30:00Z",
   "metric": "temperature", "value": 4.2, "unit": "C" }]`,
  },
];

const ENVELOPE = `{
  "id": 48211,
  "event": "issue.created",
  "entity_type": "issue",
  "entity_id": "7d0c…",
  "occurred_at": "2026-10-08T09:30:00Z",
  "data": { "title": "Brake noise", "priority": "high", "vehicle_id": "…" }
}`;

const VERIFY = `import { createHmac, timingSafeEqual } from "node:crypto";

function verify(secret, header, rawBody) {
  const { t, v1 } = Object.fromEntries(header.split(",").map((p) => p.split("=")));
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const expected = createHmac("sha256", secret).update(\`\${t}.\${rawBody}\`).digest("hex");
  return timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
}`;

function Code({ children }: { children: ReactNode }) {
  return (
    <pre dir="ltr" className="overflow-x-auto rounded-lg border border-line bg-canvas p-3 text-start font-mono text-xs leading-relaxed text-ink">
      {children}
    </pre>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="space-y-3 p-4 sm:p-5">
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      {children}
    </Card>
  );
}

export default function ApiReferencePage() {
  const t = useT();
  const base = `${window.location.origin}/api/v1`;

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-2">{t("integrations.api.intro")}</p>

      <Section title={t("integrations.api.auth")}>
        <p className="text-sm text-ink-2">{t("integrations.api.authDesc")}</p>
        <div className="text-sm text-ink-2">{t("integrations.api.baseUrl")}</div>
        <Code>{base}</Code>
        <Code>{`curl ${base}/vehicles \\\n  -H "Authorization: Bearer fm_…"`}</Code>
      </Section>

      <Section title={t("integrations.api.endpoints")}>
        <div className="space-y-4">
          {ENDPOINTS.map((e) => (
            <div key={e.path} className="space-y-2 border-b border-line pb-4 last:border-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={e.method === "GET" ? "green" : "blue"}>{e.method}</Badge>
                <code dir="ltr" className="font-mono text-sm text-ink">{e.path}</code>
              </div>
              <p className="text-sm text-ink-2">{t(e.desc)}</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                <dt className="text-ink-3">{t("integrations.api.permission")}</dt>
                <dd className="text-ink-2">
                  {t(scopeKey(e.scope))} <code dir="ltr" className="font-mono text-ink-3">({e.scope})</code>
                </dd>
                <dt className="text-ink-3">{t("integrations.api.module")}</dt>
                <dd className="text-ink-2">{t(e.module)}</dd>
              </dl>
              {e.example && (
                <>
                  <div className="text-xs font-medium text-ink-3">{t("integrations.api.example")}</div>
                  <Code>{e.example}</Code>
                </>
              )}
            </div>
          ))}
        </div>
      </Section>

      <Section title={t("integrations.api.webhooks")}>
        <p className="text-sm text-ink-2">{t("integrations.api.webhooksDesc")}</p>
        <div className="text-sm font-medium text-ink-2">{t("integrations.api.headers")}</div>
        <dl className="space-y-2 text-sm">
          {[
            [EVENT_HEADER, t("integrations.api.headerEvent")],
            [DELIVERY_HEADER, t("integrations.api.headerDelivery")],
            [SIGNATURE_HEADER, t("integrations.api.headerSignature")],
          ].map(([h, d]) => (
            <div key={h}>
              <dt><code dir="ltr" className="font-mono text-xs text-ink">{h}</code></dt>
              <dd className="text-ink-2">{d}</dd>
            </div>
          ))}
        </dl>
        <Code>{ENVELOPE}</Code>
        <div className="text-sm font-medium text-ink-2">{t("integrations.api.verify")}</div>
        <p className="text-sm text-ink-2">{t("integrations.api.verifyDesc")}</p>
        <Code>{VERIFY}</Code>
      </Section>
    </div>
  );
}
