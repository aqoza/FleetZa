import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { adminClient, type AppEnv } from "./lib";

export const invitations = new Hono<AppEnv>();

/** Public: look up an invitation so the accept page can show org + email. */
invitations.get("/:token", async (c) => {
  const token = c.req.param("token");
  if (!z.string().uuid().safeParse(token).success) {
    return c.json({ error: "Invalid invitation link." }, 400);
  }
  const admin = adminClient(c.env);
  const { data: invite } = await admin
    .from("invitations")
    .select("email, role, status, expires_at, tenant_id, tenants(name)")
    .eq("token", token)
    .maybeSingle();

  if (!invite || invite.status !== "pending" || new Date(invite.expires_at) < new Date()) {
    return c.json({ error: "This invitation is invalid or has expired." }, 404);
  }
  const tenant = invite.tenants as unknown as { name: string } | null;
  return c.json({ email: invite.email, role: invite.role, organization: tenant?.name ?? "" });
});

const acceptSchema = z.object({
  token: z.string().uuid(),
  fullName: z.string().min(1).max(120),
  password: z.string().min(8).max(128),
});

/** Public: accept an invitation — creates the user inside the inviting tenant. */
invitations.post("/accept", zValidator("json", acceptSchema), async (c) => {
  const body = c.req.valid("json");
  const admin = adminClient(c.env);

  const { data: invite } = await admin
    .from("invitations")
    .select("id, email, role, status, expires_at, tenant_id")
    .eq("token", body.token)
    .maybeSingle();

  if (!invite || invite.status !== "pending" || new Date(invite.expires_at) < new Date()) {
    return c.json({ error: "This invitation is invalid or has expired." }, 404);
  }

  const { data: created, error: userErr } = await admin.auth.admin.createUser({
    email: invite.email,
    password: body.password,
    email_confirm: true,
    user_metadata: { full_name: body.fullName },
    app_metadata: { tenant_id: invite.tenant_id, role: invite.role },
  });
  if (userErr) {
    const already = /already|registered|exists/i.test(userErr.message);
    return c.json(
      {
        error: already
          ? "An account with this email already exists. Ask your admin to remove it first."
          : userErr.message,
      },
      already ? 409 : 400,
    );
  }

  const { error: profileErr } = await admin.from("profiles").insert({
    id: created.user.id,
    tenant_id: invite.tenant_id,
    email: invite.email,
    full_name: body.fullName,
    role: invite.role,
  });
  if (profileErr) {
    await admin.auth.admin.deleteUser(created.user.id);
    return c.json({ error: "Could not create profile." }, 500);
  }

  await admin.from("invitations").update({ status: "accepted" }).eq("id", invite.id);

  return c.json({ ok: true, email: invite.email }, 201);
});
