import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Loader2, SearchX, XCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { LANGUAGES, useI18n, type MessageKey } from "../../i18n";

/**
 * Public certificate verification page (linked from the QR code printed on
 * certificates). Standalone: no auth, no tenant context, no AppLayout — it must
 * work for anyone scanning the code.
 */

type VerifyStatus = "valid" | "expired" | "revoked" | "not_found";

interface VerifyResult {
  status: VerifyStatus;
  certificateNumber?: string | null;
  issuedAt?: string | null;
  expiresAt?: string | null;
  setSpeedKmh?: number | null;
  issuingAuthority?: string | null;
  vehiclePlate?: string | null;
  vehicleName?: string | null;
  customerName?: string | null;
  issuedBy?: string | null;
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

function formatPlainDate(iso: string): string {
  return new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString();
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

  const rows: Array<[MessageKey, string]> = [];
  if (result) {
    if (result.certificateNumber)
      rows.push(["speedLimiters.verify.certificateNumber", result.certificateNumber]);
    if (result.issuedBy) rows.push(["speedLimiters.verify.issuedBy", result.issuedBy]);
    if (result.customerName) rows.push(["speedLimiters.verify.customer", result.customerName]);
    if (result.vehicleName) rows.push(["speedLimiters.verify.vehicle", result.vehicleName]);
    if (result.vehiclePlate) rows.push(["speedLimiters.verify.plate", result.vehiclePlate]);
    if (result.setSpeedKmh != null)
      rows.push([
        "speedLimiters.verify.setSpeed",
        t("speedLimiters.kmhValue", { value: result.setSpeedKmh }),
      ]);
    if (result.issuedAt)
      rows.push(["speedLimiters.verify.issuedAt", formatPlainDate(result.issuedAt)]);
    if (result.expiresAt)
      rows.push(["speedLimiters.verify.expiresAt", formatPlainDate(result.expiresAt)]);
    if (result.issuingAuthority)
      rows.push(["speedLimiters.verify.issuingAuthority", result.issuingAuthority]);
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

              {rows.length > 0 && (
                <dl className="mt-5 divide-y divide-slate-100">
                  {rows.map(([labelKey, value]) => (
                    <div key={labelKey} className="flex items-center justify-between gap-4 py-2.5">
                      <dt className="text-sm text-ink-3">{t(labelKey)}</dt>
                      <dd className="text-end text-sm font-medium text-ink">{value}</dd>
                    </div>
                  ))}
                </dl>
              )}
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
