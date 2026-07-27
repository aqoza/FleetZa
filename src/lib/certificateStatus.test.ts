import { describe, expect, it } from "vitest";
import {
  certificateBucket,
  certificateBucketMeta,
  certificateDaysLeft,
  certificateStatusMeta,
  fleetCompliancePercent,
  isLiveCertificate,
  isSupersededCertificate,
  type CertificateStatusFields,
} from "./certificateStatus";

// A fixed clock, mid-morning so no boundary lands on midnight. Every helper
// takes `now` explicitly, which is the whole reason the boundaries below can be
// asserted as exact numbers instead of "roughly a month".
const NOW = new Date("2026-07-27T09:00:00");

/** The date-only value an expires_at column would hold `days` from NOW. */
function expiresIn(days: number): string {
  const d = new Date(NOW);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function cert(over: Partial<CertificateStatusFields> = {}): CertificateStatusFields {
  return { status: "valid", expires_at: expiresIn(365), superseded_by: null, ...over };
}

describe("certificateDaysLeft", () => {
  it("counts whole days and reads 0 on the expiry date itself", () => {
    // A certificate is still good on the day it expires, so today must not
    // come out negative — that is what keeps "expires today" out of the
    // expired bucket. toBe uses Object.is, so this also pins the -0 that raw
    // Math.ceil returns here and that Intl would render as "-0".
    expect(certificateDaysLeft(expiresIn(0), NOW)).toBe(0);
    expect(certificateDaysLeft(expiresIn(1), NOW)).toBe(1);
    expect(certificateDaysLeft(expiresIn(90), NOW)).toBe(90);
  });

  it("goes negative once the date has passed", () => {
    expect(certificateDaysLeft(expiresIn(-1), NOW)).toBe(-1);
    expect(certificateDaysLeft(expiresIn(-1200), NOW)).toBe(-1200);
  });

  it("accepts a timestamp as well as a date-only column value", () => {
    expect(certificateDaysLeft("2026-08-02T00:00:00", NOW)).toBe(6);
  });

  it("matches the shared daysUntil helper when no clock is injected", () => {
    // The injected-clock path duplicates the arithmetic of daysUntil() in
    // ./format. Pin them together so the test-only path can never drift from
    // the one the app actually runs.
    const target = expiresIn(45);
    expect(certificateDaysLeft(target)).toBe(certificateDaysLeft(target, new Date()));
  });
});

describe("certificateBucket — expiry bands", () => {
  it("puts a certificate expiring today in the 30-day band, not expired", () => {
    expect(certificateBucket(cert({ expires_at: expiresIn(0) }), NOW)).toBe("d30");
  });

  it("treats yesterday as expired", () => {
    expect(certificateBucket(cert({ expires_at: expiresIn(-1) }), NOW)).toBe("expired");
  });

  it("closes the 30-day band at exactly 30 and opens 60 at 31", () => {
    expect(certificateBucket(cert({ expires_at: expiresIn(30) }), NOW)).toBe("d30");
    expect(certificateBucket(cert({ expires_at: expiresIn(31) }), NOW)).toBe("d60");
  });

  it("closes the 60-day band at exactly 60 and opens 90 at 61", () => {
    expect(certificateBucket(cert({ expires_at: expiresIn(60) }), NOW)).toBe("d60");
    expect(certificateBucket(cert({ expires_at: expiresIn(61) }), NOW)).toBe("d90");
  });

  it("closes the 90-day band at exactly 90 and is plain ok at 91", () => {
    // 91 is the first day that raises no alarm anywhere in the product; the
    // three pages used to disagree about where this line sat.
    expect(certificateBucket(cert({ expires_at: expiresIn(90) }), NOW)).toBe("d90");
    expect(certificateBucket(cert({ expires_at: expiresIn(91) }), NOW)).toBe("ok");
  });
});

describe("certificateBucket — supersession", () => {
  it("reads a renewed certificate as superseded even though it also expired", () => {
    // The precedence that matters most: a renewed-then-lapsed certificate is
    // history. Calling it "Expired" sends a technician to renew a vehicle that
    // is already compliant, and inflates every overdue count.
    expect(
      certificateBucket(
        cert({ expires_at: expiresIn(-400), superseded_by: "newer-cert-id" }),
        NOW,
      ),
    ).toBe("superseded");
  });

  it("reads a renewed certificate as superseded while it is still in date", () => {
    // SOM-WS-101644 in the live tenant: renewed early, so it has not lapsed
    // yet. It must not appear in "Due soon" — the renewal already happened.
    expect(
      certificateBucket(cert({ expires_at: expiresIn(6), superseded_by: "newer" }), NOW),
    ).toBe("superseded");
  });

  it("treats a null superseded_by as the live head of the chain", () => {
    expect(certificateBucket(cert({ superseded_by: null }), NOW)).toBe("ok");
  });

  it("treats an absent superseded_by the same as null", () => {
    // A query that did not select the column must not silently mark every row
    // superseded; `undefined` means "nothing replaced this", same as NULL.
    const partial: CertificateStatusFields = { status: "valid", expires_at: expiresIn(365) };
    expect(certificateBucket(partial, NOW)).toBe("ok");
    expect(isSupersededCertificate(partial)).toBe(false);
  });
});

describe("certificateBucket — revocation", () => {
  it("outranks supersession", () => {
    expect(
      certificateBucket(cert({ status: "revoked", superseded_by: "newer" }), NOW),
    ).toBe("revoked");
  });

  it("outranks expiry", () => {
    expect(
      certificateBucket(cert({ status: "revoked", expires_at: expiresIn(-400) }), NOW),
    ).toBe("revoked");
  });

  it("outranks a perfectly healthy expiry date", () => {
    expect(certificateBucket(cert({ status: "revoked" }), NOW)).toBe("revoked");
  });
});

describe("isLiveCertificate", () => {
  it("matches the server predicate: superseded_by IS NULL AND status = valid", () => {
    expect(isLiveCertificate(cert())).toBe(true);
    expect(isLiveCertificate(cert({ superseded_by: "newer" }))).toBe(false);
    expect(isLiveCertificate(cert({ status: "revoked" }))).toBe(false);
    expect(isLiveCertificate(cert({ status: "revoked", superseded_by: "newer" }))).toBe(false);
  });

  it("keeps long-expired certificates live", () => {
    // 474 of the tenant's certificates are expired imports of the paper
    // register and were never renewed. They are still the head of their
    // vehicle's chain — they ARE the renewal backlog, so counting them as
    // not-live would hide exactly what the user is looking for.
    expect(isLiveCertificate(cert({ expires_at: expiresIn(-1200) }))).toBe(true);
  });

  it("does not resurrect a predecessor when the head is revoked", () => {
    // Revocation and supersession are separate axes: a revoked head means the
    // vehicle has NO valid certificate, not that the older one is live again.
    const head = cert({ status: "revoked" });
    const predecessor = cert({ superseded_by: "head-id" });
    expect(isLiveCertificate(head)).toBe(false);
    expect(isLiveCertificate(predecessor)).toBe(false);
  });
});

describe("certificateBucketMeta", () => {
  it("gives superseded a neutral tone, never red", () => {
    // Red means "someone must act". A renewed certificate needs nothing.
    expect(certificateBucketMeta.superseded.tone).toBe("slate");
    expect(certificateBucketMeta.superseded.labelKey).toBe(
      "speedLimiters.certStatus.superseded",
    );
  });

  it("escalates tone as the expiry closes in", () => {
    expect(certificateBucketMeta.ok.tone).toBe("green");
    expect(certificateBucketMeta.d90.tone).toBe("blue");
    expect(certificateBucketMeta.d60.tone).toBe("yellow");
    expect(certificateBucketMeta.d30.tone).toBe("red");
    expect(certificateBucketMeta.expired.tone).toBe("red");
  });

  it("covers every bucket, so no page can render a blank badge", () => {
    const buckets = ["revoked", "superseded", "expired", "d30", "d60", "d90", "ok"] as const;
    for (const b of buckets) {
      expect(certificateBucketMeta[b].labelKey).toBeTruthy();
      expect(certificateBucketMeta[b].tone).toBeTruthy();
    }
  });
});

describe("certificateStatusMeta", () => {
  it("returns the bucket, its badge meta and the countdown in one call", () => {
    expect(certificateStatusMeta(cert({ expires_at: expiresIn(6) }), NOW)).toEqual({
      bucket: "d30",
      labelKey: "speedLimiters.certStatus.expiring",
      tone: "red",
      daysLeft: 6,
    });
  });

  it("still reports days left for a superseded row, for a history column", () => {
    const meta = certificateStatusMeta(
      cert({ expires_at: expiresIn(-30), superseded_by: "newer" }),
      NOW,
    );
    expect(meta.bucket).toBe("superseded");
    expect(meta.daysLeft).toBe(-30);
  });
});

describe("fleetCompliancePercent", () => {
  it("reports plain coverage of the fleet", () => {
    expect(fleetCompliancePercent(0, 4)).toBe(0);
    expect(fleetCompliancePercent(1, 4)).toBe(25);
    expect(fleetCompliancePercent(4, 4)).toBe(100);
  });

  it("rounds to whole percent", () => {
    expect(fleetCompliancePercent(1, 3)).toBe(33);
    expect(fleetCompliancePercent(2, 3)).toBe(67);
  });

  it("never exceeds 100% when a covered vehicle has been detached", () => {
    // The numerator counts certificates matched on the certificate's own
    // customer_id — a snapshot taken at issue and copied forward by renewal.
    // Detaching a vehicle (the Detach action on the customer page) clears
    // vehicles.customer_id and leaves the certificate's untouched, so a
    // customer with two in-date certificates can be left owning one vehicle.
    // Unclamped that renders "200%".
    expect(fleetCompliancePercent(2, 1)).toBe(100);
    expect(fleetCompliancePercent(50, 3)).toBe(100);
  });

  it("returns null when there is no fleet to divide by", () => {
    // A customer with no vehicles gets a dash, not a division by zero.
    expect(fleetCompliancePercent(0, 0)).toBeNull();
    expect(fleetCompliancePercent(3, 0)).toBeNull();
    expect(fleetCompliancePercent(0, -1)).toBeNull();
  });
});

describe("the GAWHRAT tenant on 2026-07-27", () => {
  // Regression guard built from the live register. Five certificates are
  // unexpired; only three are live, and the user's "Due soon" panel must show
  // exactly the two that are both live and inside 30 days.
  const rows = [
    { number: "SOM-WS-101645", expires_at: "2026-08-02", superseded_by: null },
    { number: "SOM-WS-101649", expires_at: "2026-08-17", superseded_by: null },
    { number: "SOM-WS-00488", expires_at: "2027-07-28", superseded_by: null },
    { number: "SOM-WS-101644", expires_at: "2026-08-02", superseded_by: "id-of-00487" },
    { number: "SOM-WS-00487", expires_at: "2027-07-28", superseded_by: "id-of-00488" },
  ];

  it("surfaces only the two live certificates that are actually due", () => {
    const due = rows
      .filter((r) => {
        const bucket = certificateBucket({ status: "valid", ...r }, NOW);
        return bucket === "d30";
      })
      .map((r) => r.number);
    expect(due).toEqual(["SOM-WS-101645", "SOM-WS-101649"]);
  });

  it("keeps the two already-renewed rows out of the way", () => {
    // Both are unexpired, so a naive expiry-only rule lists them as work.
    // They were renewed; SOM-WS-101644 is the row that made the brief count
    // three renewals due instead of two.
    expect(certificateBucket({ status: "valid", ...rows[3] }, NOW)).toBe("superseded");
    expect(certificateBucket({ status: "valid", ...rows[4] }, NOW)).toBe("superseded");
  });

  it("counts three live certificates among the five unexpired rows", () => {
    expect(rows.filter((r) => isLiveCertificate({ status: "valid", ...r })).length).toBe(3);
  });
});
