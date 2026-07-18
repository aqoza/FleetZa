import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { adminClient, DEFAULT_INSPECTION_ITEMS, type AppEnv } from "./lib";
import { getCountry, isSupportedCountry } from "../shared/countries";
import { DEFAULT_MODULES } from "../shared/modules";

const signupSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(128),
  fullName: z.string().min(1).max(120),
  companyName: z.string().min(1).max(120),
  country: z.string().length(2).default("US"),
  currency: z.string().length(3).optional(),
  timezone: z.string().min(1).max(64).optional(),
  distanceUnit: z.enum(["km", "mi"]).optional(),
  volumeUnit: z.enum(["L", "gal"]).optional(),
});

export const onboarding = new Hono<AppEnv>();

/**
 * Self-serve tenant signup: creates the auth user, the tenant, the owner
 * profile, stamps tenant/role into app_metadata, and seeds a default
 * inspection template. Rolls back best-effort on failure.
 */
onboarding.post("/signup", zValidator("json", signupSchema), async (c) => {
  const body = c.req.valid("json");
  if (!isSupportedCountry(body.country)) {
    return c.json({ error: `Unsupported country code "${body.country}".` }, 400);
  }
  const cfg = getCountry(body.country);
  const admin = adminClient(c.env);

  const { data: created, error: userErr } = await admin.auth.admin.createUser({
    email: body.email,
    password: body.password,
    email_confirm: true,
    user_metadata: { full_name: body.fullName },
  });
  if (userErr) {
    const already = /already|registered|exists/i.test(userErr.message);
    return c.json(
      { error: already ? "An account with this email already exists." : userErr.message },
      already ? 409 : 400,
    );
  }
  const userId = created.user.id;

  const cleanup = async (tenantId?: string) => {
    if (tenantId) await admin.from("tenants").delete().eq("id", tenantId);
    await admin.auth.admin.deleteUser(userId);
  };

  const { data: tenant, error: tenantErr } = await admin
    .from("tenants")
    .insert({
      name: body.companyName,
      country: body.country.toUpperCase(),
      currency: (body.currency ?? cfg.currency).toUpperCase(),
      timezone: body.timezone ?? cfg.timezone,
      distance_unit: body.distanceUnit ?? cfg.distanceUnit,
      volume_unit: body.volumeUnit ?? cfg.volumeUnit,
    })
    .select("id")
    .single();
  if (tenantErr || !tenant) {
    await cleanup();
    return c.json({ error: "Could not create organization." }, 500);
  }

  const { error: profileErr } = await admin.from("profiles").insert({
    id: userId,
    tenant_id: tenant.id,
    email: body.email,
    full_name: body.fullName,
    role: "owner",
  });
  if (profileErr) {
    await cleanup(tenant.id);
    return c.json({ error: "Could not create profile." }, 500);
  }

  const { error: metaErr } = await admin.auth.admin.updateUserById(userId, {
    app_metadata: { tenant_id: tenant.id, role: "owner" },
  });
  if (metaErr) {
    await cleanup(tenant.id);
    return c.json({ error: "Could not finalize account." }, 500);
  }

  await admin.from("inspection_templates").insert({
    tenant_id: tenant.id,
    name: "Standard vehicle inspection",
    items: DEFAULT_INSPECTION_ITEMS,
  });

  // Subscribe the new tenant to the default module set.
  await admin.from("tenant_modules").insert(
    DEFAULT_MODULES.map((moduleId) => ({
      tenant_id: tenant.id,
      module_id: moduleId,
      enabled_by: userId,
    })),
  );

  return c.json({ ok: true, tenantId: tenant.id }, 201);
});
