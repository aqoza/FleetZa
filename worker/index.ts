import { Hono } from "hono";
import { onboarding } from "./onboarding";
import { invitations } from "./invitations";
import { members } from "./members";
import { verify } from "./verify";

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
app.route("/verify", verify);

app.notFound((c) => c.json({ error: "Not found" }, 404));

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Internal error" }, 500);
});

export default app;
