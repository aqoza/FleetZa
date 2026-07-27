import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import QRCode from "qrcode";
import { ArrowLeft, Printer } from "lucide-react";
import { getCountry } from "../../../shared/countries";
import { listRows } from "../../lib/db";
import {
  formatDocumentDate,
  formatSpeedBand,
  registrationLine,
  toArabicDigits,
  type RegistrationBlock,
} from "../../lib/certificate";
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
import { translateIn, useI18n } from "../../i18n";
import { Button, Card, ErrorState, LoadingState } from "../../components/ui";

type CertPrintRow = SpeedLimiterCertificate & {
  vehicles: Pick<
    Vehicle,
    | "name" | "license_plate" | "chassis_number" | "engine_number" | "vin"
    | "make" | "model" | "year"
  > | null;
  customers: Pick<Customer, "name"> | null;
  sl_devices: Pick<SlDevice, "serial" | "manufacturer" | "model" | "limiter_type"> | null;
  sl_jobs:
    | (Pick<SlJob, "completed_at"> & { sl_technicians: Pick<SlTechnician, "name"> | null })
    | null;
  speed_limiter_installations: Pick<
    SpeedLimiterInstallation,
    "installed_at" | "tamper_seal_number" | "uin"
  > | null;
};

const DASH = "—";

/**
 * Column geometry, measured off the reference document. The four-column body
 * tables and the closing strip use different splits there, so both are kept.
 */
const BODY_COLS = ["27%", "24%", "24%", "25%"];
const HEAD_COLS = ["24%", "20%", "28%", "28%"];
const UIN_COLS = ["24.7%", "23.6%", "25.7%", "26%"];
const STRIP_COLS = ["35.5%", "36.2%", "28.3%"];

function Cols({ widths }: { widths: string[] }) {
  return (
    <colgroup>
      {widths.map((w) => (
        <col key={w} style={{ width: w }} />
      ))}
    </colgroup>
  );
}

/** One bordered cell. Labels and values share a weight, as on the reference. */
function Cell({
  children,
  span,
  className = "",
}: {
  children?: ReactNode;
  span?: number;
  className?: string;
}) {
  return (
    <td
      colSpan={span}
      className={`border border-ink px-1 py-[2px] align-top text-[13px] leading-4 text-ink ${className}`}
    >
      {/* Values are identifiers in mixed scripts (plates, chassis, VINs). <bdi>
          orders each one on its own so "5637 RA" doesn't become "RA 5637" on an
          Arabic certificate, while the cell keeps the table's own alignment. */}
      <bdi>{children}</bdi>
    </td>
  );
}

/** Black section banner in the official document style — fills survive print. */
function SectionBanner({ children }: { children: ReactNode }) {
  return (
    <div className="print-exact mt-3 bg-ink px-1 py-[2px] text-[13px] leading-4 text-surface">
      {children}
    </div>
  );
}

function DocTable({ cols, children }: { cols: string[]; children: ReactNode }) {
  return (
    <table className="mt-1.5 w-full table-fixed border-collapse break-inside-avoid">
      <Cols widths={cols} />
      <tbody>{children}</tbody>
    </table>
  );
}

/**
 * The official Road Speed Limiter certificate, reproducing the dealer format
 * used across Oman: bilingual masthead, Installation/Renewal type, declaration,
 * vehicle / speed-limiter / dealer tables, UIN + validity, the QR + signature +
 * stamp strip, and the flag-colored footer with the bilingual registration
 * line. The QR resolves to the public /verify endpoint.
 */
export default function CertificatePrintPage() {
  const { t, language } = useI18n();
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
            "*, vehicles(name, license_plate, chassis_number, engine_number, vin, make, model, year), " +
              "customers(name), sl_devices(serial, manufacturer, model, limiter_type), " +
              "sl_jobs(completed_at, sl_technicians(name)), " +
              "speed_limiter_installations(installed_at, tamper_seal_number, uin)",
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
  const speedBand =
    formatSpeedBand(
      cert.set_speed_kmh,
      cert.set_speed_secondary_kmh,
      t("slCertificates.report.speedUnit"),
    ) ?? DASH;
  // Snapshot first: an issued document must reprint identically even after the
  // device record has been edited or the limiter moved to another vehicle.
  const limiterType =
    cert.limiter_type ??
    device?.limiter_type ??
    (device?.manufacturer
      ? [device.manufacturer, device.model].filter(Boolean).join(" ")
      : t("slCertificates.report.defaultLimiterType"));
  const installedOn =
    cert.speed_limiter_installations?.installed_at ??
    (cert.sl_jobs?.completed_at ? cert.sl_jobs.completed_at.slice(0, 10) : null) ??
    cert.issued_at;
  const tamperSeal =
    cert.tamper_seal_number ??
    cert.speed_limiter_installations?.tamper_seal_number ??
    DASH;
  const uin = cert.uin ?? cert.speed_limiter_installations?.uin ?? cert.certificate_number;
  const countryName = getCountry(tenant.country).name;

  // Phones and the verify URL stay LTR-isolated so digit groups don't
  // bidi-reorder on an Arabic certificate (same treatment as the settings form).
  const phoneNode = tenant.phone ? <span dir="ltr">{tenant.phone}</span> : null;
  const dealerContact: ReactNode =
    tenant.address && phoneNode ? (
      <>
        {tenant.address} · {phoneNode}
      </>
    ) : (
      tenant.address ?? phoneNode ?? countryName
    );

  // The registration strip prints in both languages on every copy, so its
  // labels are pulled per-language rather than from the active dictionary.
  const registration: RegistrationBlock = {
    crNumber: tenant.cr_number,
    poBox: tenant.po_box,
    postalCode: tenant.postal_code,
    locality: tenant.city,
    phones: [tenant.phone, tenant.phone_secondary],
  };
  const labelsFor = (lang: "en" | "ar") => ({
    cr: translateIn(lang, "slCertificates.report.footerCr"),
    poBox: translateIn(lang, "slCertificates.report.footerPoBox"),
    postalCode: translateIn(lang, "slCertificates.report.footerPostalCode"),
    gsm: translateIn(lang, "slCertificates.report.footerGsm"),
    separator: translateIn(lang, "slCertificates.report.footerSeparator"),
  });
  const registrationEn = registrationLine(registration, labelsFor("en"));
  const registrationAr = registrationLine(
    { ...registration, locality: tenant.city_ar ?? tenant.city },
    labelsFor("ar"),
    toArabicDigits,
  );
  const servicesLine =
    (language === "ar" ? tenant.services_line_ar : null) ?? tenant.services_line;
  const hasFooter = Boolean(
    servicesLine || registrationEn || registrationAr || tenant.email,
  );

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

      <Card className="mx-auto max-w-3xl px-10 py-8 print:rounded-none print:border-0 print:px-8 print:py-4 print:shadow-none">
        {/* Masthead — Arabic trade name above the English one, both in the
            letterhead blue. Tenants that never set an Arabic name print one line. */}
        <div className="text-center text-doc-head">
          {tenant.name_ar && (
            <p dir="rtl" className="text-2xl font-bold leading-tight">
              {tenant.name_ar}
            </p>
          )}
          <h1 className="text-3xl font-bold uppercase leading-tight tracking-wide rtl:tracking-normal">
            {tenant.name}
          </h1>
        </div>

        {/* Report type + reference row */}
        <p className="mt-5 text-center text-[13px] leading-4 text-ink">
          {cert.renewed_from
            ? t("slCertificates.report.typeRenewal")
            : t("slCertificates.report.typeInstallation")}
        </p>
        <table className="mt-1 w-full table-fixed border-collapse">
          <Cols widths={HEAD_COLS} />
          <tbody>
            <tr>
              <Cell>{cert.certificate_number}</Cell>
              <Cell />
              <Cell>{t("slCertificates.report.countryOfInstallation")}</Cell>
              <Cell>{countryName}</Cell>
            </tr>
          </tbody>
        </table>

        {cert.status === "revoked" && (
          <div className="print-exact mt-4 border-2 border-serious bg-serious-soft px-4 py-3 text-center">
            <p className="text-base font-bold uppercase tracking-wide text-serious rtl:tracking-normal">
              {t("slCertificates.revokedBanner")}
            </p>
            {cert.revoked_at && (
              <p className="mt-1 text-xs text-serious">
                {t("slCertificates.revokedOn", {
                  date: formatDocumentDate(cert.revoked_at) ?? DASH,
                })}
              </p>
            )}
            {cert.revoked_reason && (
              <p className="mt-0.5 text-xs text-serious">{cert.revoked_reason}</p>
            )}
          </div>
        )}

        {/* Declaration */}
        <SectionBanner>{t("slCertificates.report.declarationTitle")}</SectionBanner>
        <p className="mt-1.5 text-[13px] leading-[19px] text-ink">
          {t("slCertificates.report.declarationText", { speed: speedBand })}
        </p>

        {/* Vehicle details */}
        <SectionBanner>{t("slCertificates.report.vehicleDetails")}</SectionBanner>
        <DocTable cols={BODY_COLS}>
          <tr>
            <Cell>{t("slCertificates.report.vehicleOwner")}</Cell>
            <Cell span={3}>{cert.customers?.name ?? tenant.name}</Cell>
          </tr>
          <tr>
            <Cell>{t("slCertificates.report.registrationNo")}</Cell>
            <Cell>{vehicle?.license_plate ?? vehicle?.name ?? DASH}</Cell>
            <Cell>{t("slCertificates.report.chassisNo")}</Cell>
            <Cell>{vehicle?.chassis_number ?? vehicle?.vin ?? DASH}</Cell>
          </tr>
          <tr>
            <Cell>{t("slCertificates.report.engineNo")}</Cell>
            <Cell>{vehicle?.engine_number ?? DASH}</Cell>
            <Cell>{t("slCertificates.report.makeOfVehicle")}</Cell>
            <Cell>{vehicle?.make ?? DASH}</Cell>
          </tr>
          <tr>
            <Cell>{t("slCertificates.report.modelOfVehicle")}</Cell>
            <Cell>{vehicle?.model ?? DASH}</Cell>
            <Cell>{t("slCertificates.report.yearOfManufacture")}</Cell>
            <Cell>{vehicle?.year ?? DASH}</Cell>
          </tr>
        </DocTable>

        {/* Speed limiter details */}
        <SectionBanner>{t("slCertificates.report.slDetails")}</SectionBanner>
        <DocTable cols={BODY_COLS}>
          <tr>
            <Cell>{t("slCertificates.report.limiterType")}</Cell>
            <Cell>{limiterType}</Cell>
            <Cell>{t("slCertificates.report.setSpeedLimit")}</Cell>
            <Cell>{speedBand}</Cell>
          </tr>
          <tr>
            <Cell>{t("slCertificates.report.serialNo")}</Cell>
            <Cell>{device?.serial ?? DASH}</Cell>
            <Cell>{t("slCertificates.report.tamperSealNo")}</Cell>
            <Cell>{tamperSeal}</Cell>
          </tr>
          <tr>
            <Cell>{t("slCertificates.report.dateOfInstallation")}</Cell>
            <Cell>
              <span dir="ltr">{formatDocumentDate(installedOn) ?? DASH}</span>
            </Cell>
            <Cell>{t("slCertificates.report.technicianName")}</Cell>
            <Cell>{cert.sl_jobs?.sl_technicians?.name ?? DASH}</Cell>
          </tr>
        </DocTable>

        {/* Dealer details */}
        <SectionBanner>{t("slCertificates.report.dealerDetails")}</SectionBanner>
        <DocTable cols={BODY_COLS}>
          <tr>
            <Cell>{t("slCertificates.report.dealerName")}</Cell>
            <Cell span={3}>{tenant.name}</Cell>
          </tr>
          <tr>
            <Cell>{t("slCertificates.report.addressPhone")}</Cell>
            <Cell span={3}>{dealerContact}</Cell>
          </tr>
        </DocTable>

        {/* UIN + validity */}
        <table className="mt-4 w-full table-fixed border-collapse break-inside-avoid">
          <Cols widths={UIN_COLS} />
          <tbody>
            <tr>
              <Cell>{t("slCertificates.report.uinLabel")}</Cell>
              <Cell>{uin}</Cell>
              <Cell>{t("slCertificates.report.validUpto")}</Cell>
              <Cell>
                <span dir="ltr">{formatDocumentDate(cert.expires_at) ?? DASH}</span>
              </Cell>
            </tr>
          </tbody>
        </table>

        {/* QR + signature + stamp strip. The reference leaves the middle cell
            empty and carries the signature and stamp together on the right. */}
        <table className="mt-4 w-full table-fixed border-collapse break-inside-avoid">
          <Cols widths={STRIP_COLS} />
          <tbody>
            <tr>
              <Cell className="h-[92px] text-center">
                {qr ? (
                  <img
                    src={qr}
                    alt={t("slCertificates.scanToVerify")}
                    className="mx-auto h-[72px] w-[72px]"
                  />
                ) : (
                  <div className="mx-auto h-[72px] w-[72px] border border-dashed border-line" />
                )}
              </Cell>
              <Cell className="text-center">
                {tenant.signature_url && (
                  <img
                    src={tenant.signature_url}
                    alt={t("slCertificates.report.signature")}
                    className="mx-auto max-h-[72px] object-contain"
                  />
                )}
              </Cell>
              <Cell className="text-center">
                {tenant.stamp_url && (
                  <img
                    src={tenant.stamp_url}
                    alt={t("slCertificates.report.stamp")}
                    className="mx-auto max-h-[72px] object-contain"
                  />
                )}
              </Cell>
            </tr>
          </tbody>
        </table>

        {/* Footer strip — the services band in the flag colors, then the
            registration line in Arabic and English, then the e-mail. */}
        {hasFooter && (
          <div className="mt-6 -mx-10 break-inside-avoid print:-mx-8">
            {servicesLine && (
              <>
                <div className="print-exact bg-doc-red px-4 py-1 text-center text-[11px] font-bold uppercase tracking-wide text-surface rtl:tracking-normal">
                  {servicesLine}
                </div>
                <div className="print-exact h-5 bg-doc-green" />
              </>
            )}
            <div className="px-10 pt-1.5 text-center text-[11.5px] leading-[16px] text-ink print:px-8">
              {registrationAr && <p dir="rtl">{registrationAr}</p>}
              {registrationEn && <p dir="ltr">{registrationEn}</p>}
              {tenant.email && (
                <p dir="auto">
                  {t("slCertificates.report.footerEmail", { value: tenant.email })}
                </p>
              )}
            </div>
          </div>
        )}

        <div className="mt-6 border-t border-line pt-3 text-center text-[11px] text-ink-3 print:hidden">
          <p>{t("slCertificates.generatedBy")}</p>
          <p className="mt-0.5">
            {t("slCertificates.verifyAt")} <span dir="ltr">{verifyUrl}</span>
          </p>
        </div>
      </Card>
    </>
  );
}
