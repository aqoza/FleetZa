import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import QRCode from "qrcode";
import { ArrowLeft, Download, Printer } from "lucide-react";
// Self-hosted, loaded only by this chunk — the rest of the app deliberately
// carries no webfont (docs/DESIGN_SYSTEM.md). A printed legal document is a
// scoped, explicit exception; the family is applied inline below rather than
// as a Tailwind token so the exception can't leak into other pages.
import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/600.css";
import "@fontsource/ibm-plex-sans-arabic/700.css";
import { getCountry } from "../../../shared/countries";
import { listRows } from "../../lib/db";
import {
  formatDocumentDate,
  formatSpeedBand,
  registrationLine,
  toArabicDigits,
  type RegistrationBlock,
  type RegistrationLabels,
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
    | (Pick<SlJob, "completed_at" | "job_type"> & {
        sl_technicians: Pick<SlTechnician, "name"> | null;
      })
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
      {widths.map((w, i) => (
        // Widths repeat across a table, so the index is the only stable key.
        // eslint-disable-next-line react/no-array-index-key
        <col key={i} style={{ width: w }} />
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
      className={`border border-ink px-1.5 py-1.5 align-top text-[13px] leading-4 text-ink ${className}`}
    >
      {/* Values are identifiers in mixed scripts (plates, chassis, VINs). <bdi>
          orders each one on its own so "5637 RA" doesn't become "RA 5637" on an
          Arabic certificate, while the cell keeps the table's own alignment. */}
      <bdi>{children}</bdi>
    </td>
  );
}

/**
 * Black section banner in the official document style.
 *
 * The fill is an SVG rect rather than a CSS background for the same reason as
 * the footer bands: a browser drops background fills from print unless
 * "Background graphics" is ticked, which is off by default and cannot be set
 * from the page. Here it matters more than colour — the label is white, so a
 * dropped fill prints white-on-white and the section heading disappears
 * entirely. An SVG rect is content and always prints.
 */
function SectionBanner({ children }: { children: ReactNode }) {
  return (
    <div className="mt-4">
      <svg
        aria-hidden="true"
        className="block h-6 w-full"
        preserveAspectRatio="none"
        viewBox="0 0 100 24"
      >
        <rect x="0" y="0" width="100" height="24" fill="var(--color-ink)" />
      </svg>
      <div className="-mt-6 h-6 px-1.5 text-[13px] leading-6 text-surface">{children}</div>
    </div>
  );
}

function DocTable({ cols, children }: { cols: string[]; children: ReactNode }) {
  return (
    <table className="mt-2 w-full table-fixed border-collapse break-inside-avoid">
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
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");

  const { data: cert, isLoading, error } = useQuery({
    queryKey: ["speed_limiter_certificates", certId],
    queryFn: async () => {
      const rows = await listRows<CertPrintRow>("speed_limiter_certificates", (q) =>
        q
          .select(
            "*, vehicles(name, license_plate, chassis_number, engine_number, vin, make, model, year), " +
              "customers(name), sl_devices(serial, manufacturer, model, limiter_type), " +
              "sl_jobs(completed_at, job_type, sl_technicians(name)), " +
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
  // Captured as locals so the async downloadPdf closure below doesn't need its
  // own narrowing of `cert` (TS doesn't carry the guard above into a nested
  // function body). These are the same values the JSX renders — the PDF is
  // built from them rather than from the DOM.
  const certificateNumber = cert.certificate_number;
  const certStatus = cert.status;
  const revokedAt = cert.revoked_at;
  const revokedReason = cert.revoked_reason;
  const customerName = cert.customers?.name ?? null;
  const technicianName = cert.sl_jobs?.sl_technicians?.name ?? null;
  const expiresAt = cert.expires_at;
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
  // The heading states the work that was done, which the job knows directly.
  // `renewed_from` is only a fallback: a renewal of a limiter fitted before the
  // tenant kept records here has no predecessor row, and would otherwise print
  // as an Installation.
  const jobType = cert.sl_jobs?.job_type;
  const isRenewal = jobType
    ? jobType !== "installation" && jobType !== "replacement"
    : Boolean(cert.renewed_from);
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
  // The stamp's box height, scaled by the tenant's setting. The 84px default
  // is the strip row's own budget (see the signature cell below); the scale
  // is DB-constrained to 50-200 so this stays a sane number.
  const stampMaxHeight = Math.round((84 * (tenant.stamp_scale ?? 100)) / 100);

  // Same value as `dealerContact`, flattened for the PDF (which takes strings,
  // and runs bidi itself rather than needing the dir="ltr" wrapper).
  const dealerContactText =
    tenant.address && tenant.phone
      ? `${tenant.address} · ${tenant.phone}`
      : tenant.address ?? tenant.phone ?? countryName;

  // The registration strip prints in both languages on every copy, so its
  // labels are pulled per-language rather than from the active dictionary.
  const registration: RegistrationBlock = {
    crNumber: tenant.cr_number,
    poBox: tenant.po_box,
    postalCode: tenant.postal_code,
    locality: tenant.city,
    website: tenant.website,
    phone: tenant.phone,
    phoneSecondary: tenant.phone_secondary,
  };
  const labelsFor = (lang: "en" | "ar"): RegistrationLabels => ({
    cr: translateIn(lang, "slCertificates.report.footerCr"),
    poBox: translateIn(lang, "slCertificates.report.footerPoBox"),
    postalCode: translateIn(lang, "slCertificates.report.footerPostalCode"),
    website: translateIn(lang, "slCertificates.report.footerWebsite"),
    phone: translateIn(lang, "slCertificates.report.footerPhone"),
    phoneSecondary: translateIn(lang, "slCertificates.report.footerPhoneSecondary"),
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
  // Authorized-signatory block. Like the services line, the strip carries one
  // language rather than both, so it follows the document's own half: the
  // Arabic forms when the certificate is being issued in Arabic, with the
  // Latin ones as the fallback a tenant that set neither still gets.
  const signatoryName =
    (language === "ar" ? tenant.signatory_name_ar : null) ?? tenant.signatory_name;
  const signatoryCompany = (language === "ar" ? tenant.name_ar : null) ?? tenant.name;
  const hasFooter = Boolean(
    servicesLine || registrationEn || registrationAr || tenant.email,
  );

  /**
   * The download is a real vector PDF, not a screenshot of this page.
   *
   * It is built from the values computed above rather than from the DOM, so
   * the two renderings can not disagree about content; only the layout is
   * expressed twice (see CertificatePdfDocument). Everything is imported on
   * click — the renderer is a large dependency and no one who merely views a
   * certificate should pay for it.
   */
  async function downloadPdf() {
    setDownloading(true);
    setDownloadError("");
    try {
      const [{ pdf }, { registerCertificateFonts }, { default: PdfDocument }] =
        await Promise.all([
          import("@react-pdf/renderer"),
          import("./certificatePdfFonts"),
          import("./CertificatePdfDocument"),
        ]);
      registerCertificateFonts();

      const r = t("slCertificates.report.registrationNo");
      const blob = await pdf(
        <PdfDocument
          masthead={{ ar: tenant.name_ar, en: tenant.name }}
          typeLabel={
            isRenewal
              ? t("slCertificates.report.typeRenewal")
              : t("slCertificates.report.typeInstallation")
          }
          head={{
            certificateNumber,
            countryLabel: t("slCertificates.report.countryOfInstallation"),
            countryName,
          }}
          revoked={
            certStatus === "revoked"
              ? {
                  title: t("slCertificates.revokedBanner"),
                  on: revokedAt
                    ? t("slCertificates.revokedOn", {
                        date: formatDocumentDate(revokedAt) ?? DASH,
                      })
                    : null,
                  reason: revokedReason,
                }
              : null
          }
          declaration={{
            title: t("slCertificates.report.declarationTitle"),
            body: t("slCertificates.report.declarationText", { speed: speedBand }),
          }}
          sections={[
            {
              title: t("slCertificates.report.vehicleDetails"),
              rows: [
                {
                  label: t("slCertificates.report.vehicleOwner"),
                  value: customerName ?? tenant.name,
                },
                {
                  label: r,
                  value: vehicle?.license_plate ?? vehicle?.name ?? DASH,
                  label2: t("slCertificates.report.chassisNo"),
                  value2: vehicle?.chassis_number ?? vehicle?.vin ?? DASH,
                },
                {
                  label: t("slCertificates.report.engineNo"),
                  value: vehicle?.engine_number ?? DASH,
                  label2: t("slCertificates.report.makeOfVehicle"),
                  value2: vehicle?.make ?? DASH,
                },
                {
                  label: t("slCertificates.report.modelOfVehicle"),
                  value: vehicle?.model ?? DASH,
                  label2: t("slCertificates.report.yearOfManufacture"),
                  value2: vehicle?.year != null ? String(vehicle.year) : DASH,
                },
              ],
            },
            {
              title: t("slCertificates.report.slDetails"),
              rows: [
                {
                  label: t("slCertificates.report.limiterType"),
                  value: limiterType,
                  label2: t("slCertificates.report.setSpeedLimit"),
                  value2: speedBand,
                },
                {
                  label: t("slCertificates.report.serialNo"),
                  value: device?.serial ?? DASH,
                  label2: t("slCertificates.report.tamperSealNo"),
                  value2: tamperSeal,
                },
                {
                  label: t("slCertificates.report.dateOfInstallation"),
                  value: formatDocumentDate(installedOn) ?? DASH,
                  label2: t("slCertificates.report.technicianName"),
                  value2: technicianName ?? DASH,
                },
              ],
            },
            {
              title: t("slCertificates.report.dealerDetails"),
              rows: [
                { label: t("slCertificates.report.dealerName"), value: tenant.name },
                {
                  label: t("slCertificates.report.addressPhone"),
                  value: dealerContactText,
                },
              ],
            },
          ]}
          uin={{
            label: t("slCertificates.report.uinLabel"),
            value: uin,
            validLabel: t("slCertificates.report.validUpto"),
            validValue: formatDocumentDate(expiresAt) ?? DASH,
          }}
          strip={{
            qr: qr || null,
            signatureUrl: tenant.signature_url,
            stampUrl: tenant.stamp_url,
            stampMaxHeight: (46 * (tenant.stamp_scale ?? 100)) / 100,
            forCompany: signatoryName
              ? t("slCertificates.report.forCompany", { name: signatoryCompany })
              : null,
            signatoryName,
          }}
          footer={
            hasFooter
              ? {
                  servicesLine,
                  registrationAr,
                  registrationEn,
                  email: tenant.email
                    ? t("slCertificates.report.footerEmail", { value: tenant.email })
                    : null,
                }
              : null
          }
        />,
      ).toBlob();

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${certificateNumber.replace(/[/\\]/g, "-")}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setDownloadError(t("slCertificates.downloadFailed"));
    } finally {
      setDownloading(false);
    }
  }

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
          <Button variant="secondary" loading={downloading} onClick={() => void downloadPdf()}>
            {!downloading && <Download className="h-4 w-4" />} {t("slCertificates.download")}
          </Button>
          <Button onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> {t("slCertificates.print")}
          </Button>
        </div>
      </div>
      {downloadError && (
        <p className="-mt-2 mb-4 text-end text-sm text-serious print:hidden">{downloadError}</p>
      )}

      <Card className="mx-auto max-w-3xl print:rounded-none print:border-0 print:shadow-none">
        {/*
          `flex flex-col` + a page-height floor is what lets the footer pin
          to the bottom (below, via `mt-auto`) instead of sitting wherever
          the content happens to end. min-h-[250mm] is deliberately short of
          a full 297mm A4 sheet: it has to clear this padding AND whatever
          margin the browser's print dialog adds on top (that second part
          isn't knowable from here), so the number leans conservative rather
          than exact — print-preview a certificate after this change to
          confirm. IBM Plex Sans Arabic is applied inline here rather than as
          a Tailwind token or on the shared `Card`, so the exception to the
          app's no-webfont rule can't leak past this one page.
        */}
        <div
          className="flex min-h-[250mm] flex-col px-10 py-8 print:px-8 print:py-4"
          style={{ fontFamily: '"IBM Plex Sans Arabic", "Inter", ui-sans-serif, system-ui, sans-serif' }}
        >
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
          {isRenewal
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

        {/* QR + signature + stamp strip. The middle cell carries the
            authorized-signatory block, the right one the company stamp. */}
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
                {/* With a signatory configured the cell carries the block the
                    dealer signs under: "For <trade name>", the mark, the
                    signatory's name. It has to stay inside the strip's 92px
                    row so the certificate keeps to one A4 page, so the two
                    11px/14px lines are paid for out of the image's cap
                    (14 + 2 + 52 + 2 + 14 = 84 ≤ the 86px of content the row
                    leaves). A tenant with no signatory prints exactly what it
                    printed before: the mark alone, at its full height. */}
                {signatoryName ? (
                  <span className="block text-[11px] leading-[14px]">
                    <span className="block">
                      {t("slCertificates.report.forCompany", { name: signatoryCompany })}
                    </span>
                    {tenant.signature_url ? (
                      <img
                        src={tenant.signature_url}
                        alt={t("slCertificates.report.signature")}
                        className="mx-auto my-0.5 max-h-[52px] max-w-full object-contain"
                      />
                    ) : (
                      // Room to sign by hand, as on the scanned original.
                      <span className="my-0.5 block h-[52px]" />
                    )}
                    <span className="block font-semibold">{signatoryName}</span>
                  </span>
                ) : (
                  tenant.signature_url && (
                    <img
                      src={tenant.signature_url}
                      alt={t("slCertificates.report.signature")}
                      className="mx-auto max-h-[84px] object-contain"
                    />
                  )
                )}
              </Cell>
              <Cell className="text-center">
                {tenant.stamp_url && (
                  <img
                    src={tenant.stamp_url}
                    alt={t("slCertificates.report.stamp")}
                    className="mx-auto object-contain"
                    style={{ maxHeight: `${stampMaxHeight}px` }}
                  />
                )}
              </Cell>
            </tr>
          </tbody>
        </table>

        {/* Footer strip — the services band in the flag colors, then the
            registration line in Arabic and English, then the e-mail.
            `mt-auto` pushes it to the bottom of the flex-column Card above
            rather than leaving it wherever the content happens to end. */}
        {hasFooter && (
          <div className="mt-auto -mx-10 break-inside-avoid pt-6 print:-mx-8">
            {servicesLine && (
              <>
                {/*
                  The flag bands are drawn as SVG rather than as a CSS
                  background. A browser strips background fills from print
                  unless the user has ticked "Background graphics" — off by
                  default, and nothing on the page can turn it on, so
                  `print-color-adjust: exact` alone does not save it. An SVG
                  rect is content, not a background, so it prints either way.
                  Verified by rendering this page with printBackground:false.
                  The band sits behind the text via a negative margin so the
                  two stay one visual unit.
                */}
                <svg
                  aria-hidden="true"
                  className="block h-6 w-full"
                  preserveAspectRatio="none"
                  viewBox="0 0 100 24"
                >
                  <rect x="0" y="0" width="100" height="24" fill="var(--color-doc-red)" />
                </svg>
                <div className="-mt-6 h-6 px-4 text-center text-[11px] font-bold uppercase leading-6 tracking-wide text-surface rtl:tracking-normal">
                  {servicesLine}
                </div>
                <svg
                  aria-hidden="true"
                  className="block h-5 w-full"
                  preserveAspectRatio="none"
                  viewBox="0 0 100 20"
                >
                  <rect x="0" y="0" width="100" height="20" fill="var(--color-doc-green)" />
                </svg>
              </>
            )}
            {/* Website + two labelled contact numbers made this line longer
                than the reference's single "GSM: a / b" segment, so it now
                wraps to two lines in each language pass. Sized down from the
                document's original 11.5px/16px to keep that bounded. */}
            <div className="px-10 pt-1.5 text-center text-[10.5px] leading-[14px] text-ink print:px-8">
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
        </div>
      </Card>
    </>
  );
}
