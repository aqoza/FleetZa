/**
 * Certificate status — one source of truth for "what state is this speed
 * limiter certificate in", shared by every surface that renders one.
 *
 * The rules used to be written three times with three different thresholds
 * (CertificatesPage: 30/60/90 day bands; CustomerDetailPage and
 * VehicleDetailPage: a flat 60), and none of the three knew about
 * supersession — so a certificate that had already been renewed still shouted
 * "Expired" from the customer and vehicle pages, and got counted as work to do.
 *
 * Supersession lives in the database: `superseded_by` points at the
 * certificate that IMMEDIATELY replaced this one, so a vehicle's certificates
 * form a linked list (oldest → … → previous → newest, whose pointer is NULL).
 * The head of that list is the one certificate the vehicle legally carries.
 * A trigger maintains it, keyed on vehicle_id — do NOT confuse it with
 * `renewed_from`, which only records the row an operator pressed Renew on and
 * is NULL for every imported historical certificate.
 *
 * The predicates here mirror the server-side filters exactly, so a client-side
 * count can never disagree with a paginated query:
 *
 *   live        →  .is("superseded_by", null).eq("status", "valid")
 *   superseded  →  .not("superseded_by", "is", null)
 *   revoked     →  .eq("status", "revoked")
 *
 * Revocation is a SEPARATE axis from supersession and is never folded into it:
 * a revoked head means the vehicle has no valid certificate at all, it does
 * not resurrect the predecessor.
 *
 * Pure logic only — no React, no db layer, so it is cheap to unit-test.
 */
import type { BadgeTone } from "../components/ui";
import type { MessageKey } from "../i18n";
import { daysUntil } from "./format";
import type { SlCertificateStatus } from "./types";

const MS_PER_DAY = 86_400_000;

/**
 * The smallest shape any of these helpers needs. Deliberately not the full
 * `SpeedLimiterCertificate` row, so a page can pass a partial select, an
 * embedded row, or a generated `Database[…]["Row"]` (whose `status` is a plain
 * `string`) without a cast. `superseded_by` is optional because a query that
 * did not ask for the column means "not superseded", same as NULL.
 */
export interface CertificateStatusFields {
  status: SlCertificateStatus | string;
  expires_at: string;
  superseded_by?: string | null;
}

/**
 * Every state a certificate can be shown in, widest-net first. Adds
 * "superseded" to the revoked | expired | d30 | d60 | d90 | ok set the
 * certificates list already used.
 */
export type CertificateBucket =
  | "revoked"
  | "superseded"
  | "expired"
  | "d30"
  | "d60"
  | "d90"
  | "ok";

/**
 * Whole days from now until an expiry date; negative once it has passed, 0 on
 * the expiry date itself (a certificate is still good on the day it expires).
 *
 * With no clock this is exactly `daysUntil` from ./format. Tests pass an
 * explicit `now` so the 0/30/31/60/61/90/91 boundaries are asserted precisely
 * instead of "whatever time the suite happened to run"; a test below pins the
 * two paths to the same answer.
 */
export function certificateDaysLeft(expiresAt: string, now?: Date): number {
  let days: number;
  if (now === undefined) {
    days = daysUntil(expiresAt);
  } else {
    const target = new Date(expiresAt.length === 10 ? `${expiresAt}T00:00:00` : expiresAt);
    days = Math.ceil((target.getTime() - now.getTime()) / MS_PER_DAY);
  }
  // On the expiry day itself the operand is a negative fraction, so Math.ceil
  // hands back -0 — which Intl.NumberFormat renders as "-0" ("Expires in -0 d").
  // Normalise it to a plain zero before anyone formats it.
  return days === 0 ? 0 : days;
}

/**
 * True when this row is the certificate the vehicle currently carries — the
 * head of its chain, not revoked. Matches the server-side live filter.
 *
 * Note that "live" says nothing about expiry: the bulk import of the paper
 * register left hundreds of live-but-long-expired certificates, and those are
 * precisely the renewal backlog the user is hunting for.
 */
export function isLiveCertificate(cert: CertificateStatusFields): boolean {
  return cert.superseded_by == null && cert.status === "valid";
}

/** True when a later certificate has replaced this one. */
export function isSupersededCertificate(cert: CertificateStatusFields): boolean {
  return cert.superseded_by != null;
}

/**
 * The single state to show for a certificate. Precedence, highest first:
 *
 *   1. revoked     — an explicit act by the issuer outranks everything.
 *   2. superseded  — checked BEFORE expiry, because a renewed certificate that
 *                    also lapsed reads "Superseded", not "Expired": it is
 *                    history, not work, and flagging it red sends a technician
 *                    out to renew a vehicle that is already compliant.
 *   3. expiry bands.
 */
export function certificateBucket(
  cert: CertificateStatusFields,
  now?: Date,
): CertificateBucket {
  if (cert.status === "revoked") return "revoked";
  if (isSupersededCertificate(cert)) return "superseded";
  const days = certificateDaysLeft(cert.expires_at, now);
  if (days < 0) return "expired";
  if (days <= 30) return "d30";
  if (days <= 60) return "d60";
  if (days <= 90) return "d90";
  return "ok";
}

/**
 * Label key + badge tone per bucket, in the same shape as src/lib/labels.ts —
 * render with `t(certificateBucketMeta[bucket].labelKey)`.
 *
 * "superseded" is slate, never red: it is not a failure, it means the vehicle
 * was renewed. Red is reserved for states that need someone to act.
 */
export const certificateBucketMeta: Record<
  CertificateBucket,
  { labelKey: MessageKey; tone: BadgeTone }
> = {
  revoked: { labelKey: "speedLimiters.certStatus.revoked", tone: "slate" },
  superseded: { labelKey: "speedLimiters.certStatus.superseded", tone: "slate" },
  expired: { labelKey: "speedLimiters.certStatus.expired", tone: "red" },
  d30: { labelKey: "speedLimiters.certStatus.expiring", tone: "red" },
  d60: { labelKey: "speedLimiters.certStatus.expiring", tone: "yellow" },
  d90: { labelKey: "speedLimiters.certStatus.expiring", tone: "blue" },
  ok: { labelKey: "speedLimiters.certStatus.valid", tone: "green" },
};

/**
 * Fleet coverage as a whole percent — "how much of this customer's fleet
 * carries an in-date live certificate" — or null when there is nothing to
 * divide, so the caller renders a dash.
 *
 * The clamp is the point. `covered` counts CERTIFICATES, matched on the
 * certificate's own `customer_id`: a snapshot written when the certificate was
 * issued and copied forward by renewal. Nothing rewrites it when a vehicle is
 * later detached or transferred to another customer — there is no such trigger
 * — so the numerator can outrun `totalVehicles`, which counts the vehicles the
 * customer owns TODAY. Detaching a vehicle whose certificate is in date drops
 * the denominator and leaves the numerator alone, and an unclamped ratio then
 * renders "200%". Cover is per vehicle and a vehicle carries one live
 * certificate at a time, so the honest ceiling is the fleet size.
 */
export function fleetCompliancePercent(
  covered: number,
  totalVehicles: number,
): number | null {
  if (totalVehicles <= 0) return null;
  const bounded = Math.min(Math.max(covered, 0), totalVehicles);
  return Math.round((bounded / totalVehicles) * 100);
}

/**
 * Everything a badge needs in one call. `daysLeft` is handed back so a caller
 * that wants the countdown ("Expires in 6 d") can render it without recomputing
 * — and without drifting from the bucket it was derived from.
 */
export function certificateStatusMeta(
  cert: CertificateStatusFields,
  now?: Date,
): { bucket: CertificateBucket; labelKey: MessageKey; tone: BadgeTone; daysLeft: number } {
  const bucket = certificateBucket(cert, now);
  return {
    bucket,
    ...certificateBucketMeta[bucket],
    daysLeft: certificateDaysLeft(cert.expires_at, now),
  };
}
