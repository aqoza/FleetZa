import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import QRCode from "qrcode";
import { ArrowLeft, Printer } from "lucide-react";
import { getCountry } from "../../../shared/countries";
import { listRows } from "../../lib/db";
import { formatDate } from "../../lib/format";
import type {
  Customer,
  SlDevice,
  SlJob,
  SlTechnician,
  SpeedLimiterCertificate,
  SpeedLimiterInstallation,
  Vehicle,
} from "../../lib/types";
import { useTenant } from "../../context/AuthContext";
import { useT } from "../../i18n";
import { Button, Card, ErrorState, LoadingState } from "../../components/ui";

type CertPrintRow = SpeedLimiterCertificate & {
  vehicles: Pick<
    Vehicle,
    "name" | "license_plate" | "chassis_number" | "vin" | "make" | "model" | "year"
  > | null;
  customers: Pick<Customer, "name"> | null;
  sl_devices: Pick<SlDevice, "serial" | "manufacturer" | "model"> | null;
  sl_jobs:
    | (Pick<SlJob, "completed_at"> & { sl_technicians: Pick<SlTechnician, "name"> | null })
    | null;
  speed_limiter_installations: Pick<SpeedLimiterInstallation, "installed_at"> | null;
};

/** Black section banner in the official document style — fills survive print. */
function SectionBanner({ children }: { children: ReactNode }) {
  return (
    <div className="print-exact mt-5 bg-ink px-3 py-1.5 text-sm font-bold uppercase tracking-wide text-surface rtl:tracking-normal">
      {children}
    </div>
  );
}

/** One bordered label/value cell pair of the document tables. */
function Cell({ label, value, grow }: { label: string; value: ReactNode; grow?: boolean }) {
  return (
    <div className={`flex min-w-0 ${grow ? "flex-[2]" : "flex-1"}`}>
      <div className="w-40 shrink-0 border border-ink/70 px-2.5 py-1.5 text-sm font-medium text-ink">
        {label}
      </div>
      <div className="min-w-0 flex-1 border border-ink/70 border-s-0 px-2.5 py-1.5 text-sm text-ink">
        {value}
      </div>
    </div>
  );
}

const DASH = "—";

/**
 * The official Road Speed Limiter certificate/report, matching the Omani
 * dealer format: letterhead, Installation/Renewal type, declaration, vehicle /
 * speed-limiter / dealer detail tables, UIN + validity, and the QR +
 * signature + stamp strip. The QR resolves to the public /verify endpoint.
 */
export default function CertificatePrintPage() {
  const t = useT();
  const { certId = "" } = useParams();
  const tenant = useTenant();
  const [qr, setQr] = useState("");
  const [copied, setCopied] = useState(false);

  const { data: cert, isLoading, error } = useQuery({
    queryKey: ["speed_limiter_certificates", certId],
    queryFn: async () => {
      const rows = await listRows<CertPrintRow>("speed_limiter_certificates", (q) =>
        q
          .select(
            "*, vehicles(name, license_plate, chassis_number, vin, make, model, year), " +
              "customers(name), sl_devices(serial, manufacturer, model), " +
              "sl_jobs(completed_at, sl_technicians(name)), " +
              "speed_limiter_installations(installed_at)",
          )
          .eq("id", certId)
          .limit(1),
      );
      return rows[0] ?? null;
    },
  });

  const verifyUrl = cert ? `${location.origin}/verify?c=${cert.id}` : "";

  useEffect(() => {
    if (!verifyUrl) return;
    let active = true;
    void QRCode.toDataURL(verifyUrl, { width: 160, margin: 1 }).then(
      (url) => {
        if (active) setQr(url);
      },
      () => {
        /* keep the empty placeholder if QR generation fails */
      },
    );
    return () => {
      active = false;
    };
  }, [verifyUrl]);

  function copyVerifyLink() {
    void navigator.clipboard.writeText(verifyUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={(error as Error).message} />;
  if (!cert) return <ErrorState message={t("slCertificates.notFound")} />;

  const vehicle = cert.vehicles;
  const device = cert.sl_devices;
  const speedPair =
    cert.set_speed_kmh != null
      ? t("slCertificates.report.kmphPair", { value: cert.set_speed_kmh })
      : DASH;
  const limiterType = device?.manufacturer
    ? [device.manufacturer, device.model].filter(Boolean).join(" ")
    : t("slCertificates.report.defaultLimiterType");
  const installedOn =
    cert.speed_limiter_installations?.installed_at ??
    (cert.sl_jobs?.completed_at ? cert.sl_jobs.completed_at.slice(0, 10) : null) ??
    cert.issued_at;
  const countryName = getCountry(tenant.country).name;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          to="/speed-limiters/certificates"
          className="inline-flex items-center gap-1 text-sm text-ink-3 hover:text-ink-2"
        >
          <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" /> {t("slCertificates.title")}
        </Link>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={copyVerifyLink}>
            {copied ? t("slCertificates.linkCopied") : t("slCertificates.copyVerifyLink")}
          </Button>
          <Button onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> {t("slCertificates.print")}
          </Button>
        </div>
      </div>

      <Card className="mx-auto max-w-3xl px-10 py-8 print:border-0 print:shadow-none">
        {/* Letterhead */}
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-wide text-brand-700 rtl:tracking-normal">
            {tenant.name}
          </h1>
        </div>

        {/* Report type + reference row */}
        <p className="mt-5 text-center text-sm font-medium text-ink">
          {cert.renewed_from
            ? t("slCertificates.report.typeRenewal")
            : t("slCertificates.report.typeInstallation")}
        </p>
        <div className="mt-1 flex">
          <div className="flex-1 border border-ink/70 px-2.5 py-1.5 text-sm font-medium text-ink">
            {cert.certificate_number}
          </div>
          <div className="w-44 shrink-0 border border-ink/70 border-s-0 px-2.5 py-1.5 text-sm font-medium text-ink">
            {t("slCertificates.report.countryOfInstallation")}
          </div>
          <div className="w-32 shrink-0 border border-ink/70 border-s-0 px-2.5 py-1.5 text-sm text-ink">
            {countryName}
          </div>
        </div>

        {cert.status === "revoked" && (
          <div className="print-exact mt-4 border-2 border-serious bg-serious-soft px-4 py-3 text-center">
            <p className="text-base font-bold uppercase tracking-wide text-serious rtl:tracking-normal">
              {t("slCertificates.revokedBanner")}
            </p>
            {cert.revoked_at && (
              <p className="mt-1 text-xs text-serious">
                {t("slCertificates.revokedOn", { date: formatDate(cert.revoked_at) })}
              </p>
            )}
            {cert.revoked_reason && (
              <p className="mt-0.5 text-xs text-serious">{cert.revoked_reason}</p>
            )}
          </div>
        )}

        {/* Declaration */}
        <SectionBanner>{t("slCertificates.report.declarationTitle")}</SectionBanner>
        <p className="mt-2 text-sm leading-6 text-ink">
          {t("slCertificates.report.declarationText", { speed: speedPair })}
        </p>

        {/* Vehicle details */}
        <SectionBanner>{t("slCertificates.report.vehicleDetails")}</SectionBanner>
        <div className="mt-2">
          <div className="flex">
            <Cell
              label={t("slCertificates.report.vehicleOwner")}
              value={cert.customers?.name ?? tenant.name}
              grow
            />
          </div>
          <div className="flex">
            <Cell
              label={t("slCertificates.report.registrationNo")}
              value={vehicle?.license_plate ?? vehicle?.name ?? DASH}
            />
            <Cell
              label={t("slCertificates.report.chassisNo")}
              value={vehicle?.chassis_number ?? vehicle?.vin ?? DASH}
            />
          </div>
          <div className="flex">
            <Cell label={t("slCertificates.report.engineNo")} value={DASH} />
            <Cell
              label={t("slCertificates.report.makeOfVehicle")}
              value={vehicle?.make ?? DASH}
            />
          </div>
          <div className="flex">
            <Cell
              label={t("slCertificates.report.modelOfVehicle")}
              value={vehicle?.model ?? DASH}
            />
            <Cell
              label={t("slCertificates.report.yearOfManufacture")}
              value={vehicle?.year ?? DASH}
            />
          </div>
        </div>

        {/* Speed limiter details */}
        <SectionBanner>{t("slCertificates.report.slDetails")}</SectionBanner>
        <div className="mt-2">
          <div className="flex">
            <Cell label={t("slCertificates.report.limiterType")} value={limiterType} />
            <Cell label={t("slCertificates.report.setSpeedLimit")} value={speedPair} />
          </div>
          <div className="flex">
            <Cell label={t("slCertificates.report.serialNo")} value={device?.serial ?? DASH} />
            <Cell label={t("slCertificates.report.tamperSealNo")} value="N/A" />
          </div>
          <div className="flex">
            <Cell
              label={t("slCertificates.report.dateOfInstallation")}
              value={formatDate(installedOn)}
            />
            <Cell
              label={t("slCertificates.report.technicianName")}
              value={cert.sl_jobs?.sl_technicians?.name ?? DASH}
            />
          </div>
        </div>

        {/* Dealer details */}
        <SectionBanner>{t("slCertificates.report.dealerDetails")}</SectionBanner>
        <div className="mt-2">
          <div className="flex">
            <Cell label={t("slCertificates.report.dealerName")} value={tenant.name} grow />
          </div>
          <div className="flex">
            <Cell label={t("slCertificates.report.addressPhone")} value={countryName} grow />
          </div>
        </div>

        {/* UIN + validity */}
        <div className="mt-5 flex">
          <div className="w-40 shrink-0 border border-ink/70 px-2.5 py-1.5 text-sm font-medium text-ink">
            {t("slCertificates.report.uinLabel")}
          </div>
          <div className="min-w-0 flex-1 border border-ink/70 border-s-0 px-2.5 py-1.5 text-sm text-ink">
            {cert.certificate_number}
          </div>
          <div className="w-28 shrink-0 border border-ink/70 border-s-0 px-2.5 py-1.5 text-sm font-medium text-ink">
            {t("slCertificates.report.validUpto")}
          </div>
          <div className="w-32 shrink-0 border border-ink/70 border-s-0 px-2.5 py-1.5 text-sm text-ink">
            {formatDate(cert.expires_at)}
          </div>
        </div>

        {/* QR + signature + stamp strip */}
        <div className="mt-6 flex">
          <div className="flex flex-1 items-center justify-center border border-ink/70 p-3">
            {qr ? (
              <img src={qr} alt={t("slCertificates.scanToVerify")} className="h-28 w-28" />
            ) : (
              <div className="h-28 w-28 border border-dashed border-line" />
            )}
          </div>
          <div className="flex flex-1 items-end justify-center border border-ink/70 border-s-0 p-3">
            <span className="text-xs text-ink-3">
              {t("slCertificates.authorizedSignature")}
            </span>
          </div>
          <div className="flex flex-1 items-end justify-center border border-ink/70 border-s-0 p-3">
            <span className="text-xs text-ink-3">{t("slCertificates.companyStamp")}</span>
          </div>
        </div>

        <div className="mt-6 border-t border-line pt-3 text-center text-[11px] text-ink-3">
          <p>{t("slCertificates.generatedBy")}</p>
          <p className="mt-0.5">
            {t("slCertificates.verifyAt")} <span dir="ltr">{verifyUrl}</span>
          </p>
        </div>
      </Card>
    </>
  );
}
