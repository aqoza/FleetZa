import { Hono } from "hono";
import { onboarding } from "./onboarding";
import { invitations } from "./invitations";
import { members } from "./members";
import { quotes } from "./quotes";
import { verify } from "./verify";
import { integrations } from "./integrations";
import { security } from "./security";
import { customerPortal } from "./customerPortal";
import { vendorPortal } from "./vendorPortal";
import { tracking } from "./tracking";
import { positionsApi } from "./v1/positions";
import { vehiclesApi } from "./v1/vehicles";
import { drivingEventsApi } from "./v1/drivingEvents";
import { iotApi } from "./v1/iot";

export type Bindings = {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
};

const app = new Hono<{ Bindings: Bindings }>().basePath("/api");

app.get("/health", (c) => c.json({ ok: true, service: "fleetmanage-api" }));

app.route("/onboarding", onboarding);
app.route("/invitations", invitations);
app.route("/members", members);
app.route("/quotes", quotes);
app.route("/verify", verify);
app.route("/integrations", integrations);
app.route("/security", security);
// Public capability links (no auth; token-scoped, whitelisted payloads).
app.route("/portal", customerPortal);
app.route("/vendor-portal", vendorPortal);
app.route("/track", tracking);
// Public REST API — API-key auth (worker/apiKey.ts), tenant pinned by the key.
app.route("/v1/positions", positionsApi);
app.route("/v1/vehicles", vehiclesApi);
app.route("/v1/driving-events", drivingEventsApi);
app.route("/v1/iot", iotApi);

app.notFound((c) => c.json({ error: "Not found" }, 404));

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Internal error" }, 500);
});

export default app;
