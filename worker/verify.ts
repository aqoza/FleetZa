import { Hono } from "hono";
import { z } from "zod";
import { adminClient, type AppEnv } from "./lib";

export const verify = new Hono<AppEnv>();

/**
 * PUBLIC certificate verification (the QR code on printed certificates points
 * here via the /verify page). Looked up by certificate uuid — unguessable —
 * and returns only the fields an inspector needs. No auth, cross-tenant by
 * design, service role scoped to this single row.
 */
verify.get("/:id", async (c) => {
  const id = c.req.param("id");
  if (!z.string().uuid().safeParse(id).success) {
    return c.json({ status: "not_found" }, 404);
  }
  const admin = adminClient(c.env);
  const { data: cert } = await admin
    .from("speed_limiter_certificates")
    .select(
      "certificate_number, issued_at, expires_at, status, set_speed_kmh, issuing_authority, vehicles(name, license_plate), sl_customers(name), tenants(name)",
    )
    .eq("id", id)
    .maybeSingle();

  if (!cert) return c.json({ status: "not_found" }, 404);

  const vehicle = cert.vehicles as unknown as { name: string; license_plate: string | null } | null;
  const customer = cert.sl_customers as unknown as { name: string } | null;
  const tenant = cert.tenants as unknown as { name: string } | null;

  const expired = new Date(`${cert.expires_at}T23:59:59`) < new Date();
  const status = cert.status === "revoked" ? "revoked" : expired ? "expired" : "valid";

  return c.json({
    status,
    certificateNumber: cert.certificate_number,
    issuedAt: cert.issued_at,
    expiresAt: cert.expires_at,
    setSpeedKmh: cert.set_speed_kmh,
    issuingAuthority: cert.issuing_authority,
    vehiclePlate: vehicle?.license_plate ?? null,
    vehicleName: vehicle?.name ?? null,
    customerName: customer?.name ?? null,
    issuedBy: tenant?.name ?? null,
  });
});
