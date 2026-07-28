import { Hono } from "hono";
import { z } from "zod";
import { adminClient, type AppEnv } from "./lib";

export const verify = new Hono<AppEnv>();

/**
 * The shape of the joined row this endpoint reads.
 *
 * Declared rather than inferred: the embedded-resource select is wide enough
 * that supabase-js's string parser gives up and widens the row to an error
 * type. Naming it here keeps the handler type-checked end to end and replaces
 * the per-field `as unknown as` casts this file used to carry.
 */
type CertVerifyRow = {
  certificate_number: string;
  uin: string | null;
  issued_at: string;
  expires_at: string;
  status: string;
  set_speed_kmh: number | null;
  set_speed_secondary_kmh: number | null;
  issuing_authority: string | null;
  limiter_type: string | null;
  tamper_seal_number: string | null;
  technician_name: string | null;
  vehicles: {
    name: string;
    license_plate: string | null;
    chassis_number: string | null;
    engine_number: string | null;
    make: string | null;
    model: string | null;
    year: number | null;
  } | null;
  customers: { name: string } | null;
  tenants: { name: string } | null;
  sl_devices: {
    serial: string | null;
    manufacturer: string | null;
    model: string | null;
    limiter_type: string | null;
  } | null;
  sl_jobs: {
    completed_at: string | null;
    sl_technicians: { name: string } | null;
  } | null;
  speed_limiter_installations: {
    installed_at: string | null;
    tamper_seal_number: string | null;
  } | null;
};

/**
 * PUBLIC certificate verification (the QR code on printed certificates points
 * here via the /verify page). Looked up by certificate uuid — unguessable —
 * and returns only the fields an inspector needs. No auth, cross-tenant by
 * design, service role scoped to this single row.
 *
 * The response is additive-only: printed certificates already in circulation
 * link here, so fields may be added but never removed or renamed.
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
      "certificate_number, uin, issued_at, expires_at, status, set_speed_kmh, set_speed_secondary_kmh, issuing_authority, limiter_type, tamper_seal_number, technician_name, " +
        "vehicles(name, license_plate, chassis_number, engine_number, make, model, year), " +
        "customers(name), tenants(name), sl_devices(serial, manufacturer, model, limiter_type), " +
        "sl_jobs(completed_at, sl_technicians(name)), speed_limiter_installations(installed_at, tamper_seal_number)",
    )
    .eq("id", id)
    .maybeSingle<CertVerifyRow>();

  if (!cert) return c.json({ status: "not_found" }, 404);

  const vehicle = cert.vehicles;
  const customer = cert.customers;
  const tenant = cert.tenants;
  const device = cert.sl_devices;

  // Same precedence the printed document uses (CertificatePrintPage): the
  // certificate's own snapshot first, so a verified document keeps reporting
  // what it was issued with even after the device record moves or is edited.
  const limiterType =
    cert.limiter_type ??
    device?.limiter_type ??
    ([device?.manufacturer, device?.model].filter(Boolean).join(" ") || null);
  const tamperSeal =
    cert.tamper_seal_number ?? cert.speed_limiter_installations?.tamper_seal_number ?? null;
  const installedAt =
    cert.speed_limiter_installations?.installed_at ??
    (cert.sl_jobs?.completed_at ? cert.sl_jobs.completed_at.slice(0, 10) : null) ??
    cert.issued_at;

  const expired = new Date(`${cert.expires_at}T23:59:59`) < new Date();
  const status = cert.status === "revoked" ? "revoked" : expired ? "expired" : "valid";

  return c.json({
    status,
    certificateNumber: cert.certificate_number,
    // The UIN is printed on the certificate, so an inspector scanning the QR
    // can cross-check it against the paper in front of them.
    uin: cert.uin,
    issuedAt: cert.issued_at,
    expiresAt: cert.expires_at,
    setSpeedKmh: cert.set_speed_kmh,
    setSpeedSecondaryKmh: cert.set_speed_secondary_kmh,
    issuingAuthority: cert.issuing_authority,
    vehiclePlate: vehicle?.license_plate ?? null,
    vehicleName: vehicle?.name ?? null,
    customerName: customer?.name ?? null,
    issuedBy: tenant?.name ?? null,
    // Added so a roadside inspector can check the document against the vehicle
    // in front of them rather than just its number. Every field here is
    // already printed on the certificate that carries this QR code, so it
    // exposes nothing the holder of the link does not already have.
    chassisNumber: vehicle?.chassis_number ?? null,
    engineNumber: vehicle?.engine_number ?? null,
    vehicleMake: vehicle?.make ?? null,
    vehicleModel: vehicle?.model ?? null,
    vehicleYear: vehicle?.year ?? null,
    limiterType,
    deviceSerial: device?.serial ?? null,
    tamperSealNumber: tamperSeal,
    installedAt,
    technicianName:
      cert.technician_name ?? cert.sl_jobs?.sl_technicians?.name ?? null,
  });
});
