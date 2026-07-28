import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Loader2, SearchX, XCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { LANGUAGES, useI18n, type MessageKey } from "../../i18n";
import { formatDocumentDate, formatSpeedBand } from "../../lib/certificate";

/**
 * Public certificate verification page (linked from the QR code printed on
 * certificates). Standalone: no auth, no tenant context, no AppLayout — it must
 * work for anyone scanning the code.
 */

type VerifyStatus = "valid" | "expired" | "revoked" | "not_found";

interface VerifyResult {
  status: VerifyStatus;
  certificateNumber?: string | null;
  uin?: string | null;
  issuedAt?: string | null;
  expiresAt?: string | null;
  setSpeedKmh?: number | null;
  setSpeedSecondaryKmh?: number | null;
  issuingAuthority?: string | null;
  vehiclePlate?: string | null;
  vehicleName?: string | null;
  customerName?: string | null;
  issuedBy?: string | null;
  chassisNumber?: string | null;
  engineNumber?: string | null;
  vehicleMake?: string | null;
  vehicleModel?: string | null;
  vehicleYear?: number | null;
  limiterType?: string | null;
  deviceSerial?: string | null;
  tamperSealNumber?: string | null;
  installedAt?: string | null;
  technicianName?: string | null;
}

const banners: Record<
  VerifyStatus,
  { labelKey: MessageKey; descKey: MessageKey; wrap: string; icon: LucideIcon }
> = {
  valid: {
    labelKey: "speedLimiters.verify.status.valid",
    descKey: "speedLimiters.verify.status.validDesc",
    wrap: "border-emerald-200 bg-emerald-50 text-emerald-800",
    icon: CheckCircle2,
  },
  expired: {
    labelKey: "speedLimiters.verify.status.expired",
    descKey: "speedLimiters.verify.status.expiredDesc",
    wrap: "border-amber-200 bg-amber-50 text-amber-800",
    icon: AlertTriangle,
  },
  revoked: {
    labelKey: "speedLimiters.verify.status.revoked",
    descKey: "speedLimiters.verify.status.revokedDesc",
    wrap: "border-red-200 bg-red-50 text-red-800",
    icon: XCircle,
  },
  not_found: {
    labelKey: "speedLimiters.verify.status.not_found",
    descKey: "speedLimiters.verify.status.not_foundDesc",
    wrap: "border-line bg-canvas text-ink-2",
    icon: SearchX,
  },
};

// Same pattern as AuthShell's switcher — public pages persist language locally only.
function VerifyLanguageSwitcher() {
  const { language, setLanguage, t } = useI18n();
  return (
    <div className="mb-6 flex justify-center">
      <div className="inline-flex rounded-lg border border-line bg-surface p-0.5 shadow-sm">
        {LANGUAGES.map(({ code, labelKey }) => (
          <button
            key={code}
            onClick={() => setLanguage(code)}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              language === code ? "bg-brand-600 text-white" : "text-ink-3 hover:text-ink-2"
            }`}
          >
            {t(labelKey)}
          </button>
        ))}
      </div>
    </div>
  );
}

// The same DD-MM-YYYY the certificate itself prints (formatDocumentDate is
// locale-independent). The point of this page is checking it against the paper
// in hand, so a browser-locale date like 7/11/2024 — which an Omani inspector
// would read as 7 November — would defeat it.
function formatPlainDate(iso: string): string {
  return formatDocumentDate(iso) ?? iso;
}

export default function VerifyPage() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const certUuid = params.get("c");

  const [result, setResult] = useState<VerifyResult | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!certUuid) return;
    let canceled = false;
    setResult(null);
    setFailed(false);
    void (async () => {
      try {
        const res = await fetch(`/api/verify/${encodeURIComponent(certUuid)}`);
        const json = (await res.json().catch(() => null)) as VerifyResult | null;
        if (canceled) return;
        if (json && typeof json.status === "string" && json.status in banners) {
          setResult(json);
        } else {
          setFailed(true);
        }
      } catch {
        if (!canceled) setFailed(true);
      }
    })();
    return () => {
      canceled = true;
    };
  }, [certUuid]);

  const noCode = !certUuid;
  const loading = !noCode && !failed && !result;
  const banner = banners[noCode ? "not_found" : (result?.status ?? "not_found")];
  const Icon = banner.icon;

  // Grouped the way the certificate itself is laid out, so someone holding the
  // paper can read down the phone and the document in the same order. Every
  // row is dropped when its value is missing rather than shown blank — a
  // half-filled table reads as "data is missing" to an inspector.
  const sections: Array<{ titleKey: MessageKey; rows: Array<[MessageKey, string]> }> = [];
  if (result) {
    const band = formatSpeedBand(
      result.setSpeedKmh,
      result.setSpeedSecondaryKmh,
      t("slCertificates.report.speedUnit"),
    );
    const vehicleDescription = [result.vehicleMake, result.vehicleModel]
      .filter(Boolean)
      .join(" ");

    const push = (
      titleKey: MessageKey,
      candidates: Array<[MessageKey, string | number | null | undefined]>,
    ) => {
      const rows = candidates
        .filter(([, value]) => value !== null && value !== undefined && value !== "")
        .map(([key, value]) => [key, String(value)] as [MessageKey, string]);
      if (rows.length) sections.push({ titleKey, rows });
    };

    push("speedLimiters.verify.section.vehicle", [
      ["speedLimiters.verify.plate", result.vehiclePlate],
      // Most vehicles are named after their plate; showing both would just
      // repeat the line above.
      [
        "speedLimiters.verify.vehicle",
        result.vehicleName === result.vehiclePlate ? null : result.vehicleName,
      ],
      ["speedLimiters.verify.makeModel", vehicleDescription],
      ["speedLimiters.verify.year", result.vehicleYear],
      ["speedLimiters.verify.chassis", result.chassisNumber],
      ["speedLimiters.verify.engine", result.engineNumber],
      ["speedLimiters.verify.customer", result.customerName],
    ]);

    push("speedLimiters.verify.section.limiter", [
      ["speedLimiters.verify.limiterType", result.limiterType],
      ["speedLimiters.verify.setSpeed", band],
      ["speedLimiters.verify.serialNo", result.deviceSerial],
      ["speedLimiters.verify.tamperSeal", result.tamperSealNumber],
      ["speedLimiters.verify.technician", result.technicianName],
      [
        "speedLimiters.verify.installedAt",
        result.installedAt ? formatPlainDate(result.installedAt) : null,
      ],
    ]);

    push("speedLimiters.verify.section.validity", [
      ["speedLimiters.verify.certificateNumber", result.certificateNumber],
      ["speedLimiters.verify.uin", result.uin],
      ["speedLimiters.verify.issuedAt", result.issuedAt ? formatPlainDate(result.issuedAt) : null],
      [
        "speedLimiters.verify.expiresAt",
        result.expiresAt ? formatPlainDate(result.expiresAt) : null,
      ],
      ["speedLimiters.verify.issuedBy", result.issuedBy],
      ["speedLimiters.verify.issuingAuthority", result.issuingAuthority],
    ]);
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-md">
        <VerifyLanguageSwitcher />
        <div className="mb-6 flex items-center justify-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-base font-bold text-white">
            F
          </div>
          <span className="text-lg font-semibold text-ink">{t("app.name")}</span>
        </div>

        <div className="rounded-2xl border border-line bg-surface p-7 shadow-sm">
          <h1 className="mb-5 text-center text-lg font-semibold text-ink">
            {t("speedLimiters.verify.title")}
          </h1>

          {loading && (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-ink-3">
              <Loader2 className="h-5 w-5 animate-spin" />
              {t("speedLimiters.verify.checking")}
            </div>
          )}

          {failed && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {t("speedLimiters.verify.error")}
            </div>
          )}

          {!loading && !failed && (
            <>
              <div className={`rounded-xl border px-5 py-6 text-center ${banner.wrap}`}>
                <Icon className="mx-auto h-10 w-10" />
                <div className="mt-2 text-lg font-semibold">{t(banner.labelKey)}</div>
                <p className="mt-1 text-sm opacity-90">
                  {noCode ? t("speedLimiters.verify.noCode") : t(banner.descKey)}
                </p>
              </div>

              {sections.map((section) => (
                <section key={section.titleKey} className="mt-6">
                  <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3 rtl:tracking-normal">
                    {t(section.titleKey)}
                  </h2>
                  <dl className="divide-y divide-line border-t border-line">
                    {section.rows.map(([labelKey, value]) => (
                      <div
                        key={labelKey}
                        className="flex items-baseline justify-between gap-4 py-2.5"
                      >
                        <dt className="shrink-0 text-sm text-ink-3">{t(labelKey)}</dt>
                        {/* Identifiers are mixed-script (plates, chassis, VINs);
                            <bdi> keeps each one ordered on its own so a plate
                            doesn't reverse on the Arabic pass. */}
                        <dd className="min-w-0 break-words text-end text-sm font-medium text-ink">
                          <bdi>{value}</bdi>
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
            </>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-ink-3">
          {t("speedLimiters.verify.poweredBy", { app: t("app.name") })}
        </p>
      </div>
    </div>
  );
}
