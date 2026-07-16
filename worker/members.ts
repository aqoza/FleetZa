import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { adminClient, requireAdminRole, requireAuth, type AppEnv } from "./lib";

export const members = new Hono<AppEnv>();

members.use("*", requireAuth);

const roleSchema = z.object({ role: z.enum(["admin", "manager", "viewer"]) });

/** Change a member's role (owner role itself is immutable). */
members.patch("/:id/role", zValidator("json", roleSchema), async (c) => {
  const denied = requireAdminRole(c);
  if (denied) return denied;

  const targetId = c.req.param("id");
  const { role } = c.req.valid("json");
  const admin = adminClient(c.env);

  const { data: target } = await admin
    .from("profiles")
    .select("id, role, tenant_id")
    .eq("id", targetId)
    .eq("tenant_id", c.get("tenantId"))
    .maybeSingle();
  if (!target) return c.json({ error: "Member not found." }, 404);
  if (target.role === "owner") return c.json({ error: "The owner's role cannot be changed." }, 400);

  const { error: metaErr } = await admin.auth.admin.updateUserById(targetId, {
    app_metadata: { tenant_id: c.get("tenantId"), role },
  });
  if (metaErr) return c.json({ error: "Could not update role." }, 500);

  await admin.from("profiles").update({ role }).eq("id", targetId);
  return c.json({ ok: true });
});

/** Remove a member from the organization (deletes their login). */
members.delete("/:id", async (c) => {
  const denied = requireAdminRole(c);
  if (denied) return denied;

  const targetId = c.req.param("id");
  if (targetId === c.get("user").id) {
    return c.json({ error: "You cannot remove yourself." }, 400);
  }
  const admin = adminClient(c.env);

  const { data: target } = await admin
    .from("profiles")
    .select("id, role")
    .eq("id", targetId)
    .eq("tenant_id", c.get("tenantId"))
    .maybeSingle();
  if (!target) return c.json({ error: "Member not found." }, 404);
  if (target.role === "owner") return c.json({ error: "The owner cannot be removed." }, 400);

  const { error } = await admin.auth.admin.deleteUser(targetId);
  if (error) return c.json({ error: "Could not remove member." }, 500);
  return c.json({ ok: true });
});
