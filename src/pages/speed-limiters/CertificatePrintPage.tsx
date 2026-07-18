import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import QRCode from "qrcode";
import { ArrowLeft, Printer } from "lucide-react";
import { listRows } from "../../lib/db";
import { formatDate } from "../../lib/format";
import type { SlCustomer, SlDevice, SpeedLimiterCertificate, Vehicle } from "../../lib/types";
import { useTenant } from "../../context/AuthContext";
import { useT } from "../../i18n";
import { Button, Card, ErrorState, LoadingState } from "../../components/ui";

type CertPrintRow = SpeedLimiterCertificate & {
  vehicles: Pick<Vehicle, "name" | "license_plate" | "chassis_number"> | null;
  sl_customers: Pick<SlCustomer, "name"> | null;
  sl_devices: Pick<SlDevice, "serial"> | null;
};

function DetailItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide rtl:tracking-normal text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-slate-800">{value}</dd>
    </div>
  );
}

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
            "*, vehicles(name, license_plate, chassis_number), sl_customers(name), sl_devices(serial)",
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
    void QRCode.toDataURL(verifyUrl, { width: 200, margin: 1 }).then(
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

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          to="/speed-limiters/certificates"
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
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

      <Card className="mx-auto max-w-3xl p-10 print:border-0 print:shadow-none">
        <div className="text-center">
          <p className="text-sm font-semibold uppercase tracking-widest rtl:tracking-normal text-slate-500">
            {tenant.name}
          </p>
          <h1 className="mt-2 text-2xl font-bold text-slate-900">
            {t("slCertificates.printTitle")}
          </h1>
          <p className="mt-4 text-xs uppercase tracking-wide rtl:tracking-normal text-slate-400">
            {t("slCertificates.certNumberLabel")}
          </p>
          <p className="text-xl font-bold tracking-wide text-slate-900">
            {cert.certificate_number}
          </p>
        </div>

        {cert.status === "revoked" && (
          <div className="mt-6 rounded-lg border-2 border-red-300 bg-red-50 px-4 py-3 text-center">
            <p className="text-base font-bold uppercase tracking-wide rtl:tracking-normal text-red-700">
              {t("slCertificates.revokedBanner")}
            </p>
            {cert.revoked_at && (
              <p className="mt-1 text-xs text-red-600">
                {t("slCertificates.revokedOn", { date: formatDate(cert.revoked_at) })}
              </p>
            )}
            {cert.revoked_reason && (
              <p className="mt-0.5 text-xs text-red-600">{cert.revoked_reason}</p>
            )}
          </div>
        )}

        <dl className="mt-8 grid grid-cols-1 gap-x-10 gap-y-4 sm:grid-cols-2">
          <DetailItem
            label={t("slCertificates.fieldCustomer")}
            value={cert.sl_customers?.name ?? "—"}
          />
          <DetailItem label={t("slCertificates.fieldVehicle")} value={cert.vehicles?.name ?? "—"} />
          <DetailItem
            label={t("slCertificates.fieldPlate")}
            value={cert.vehicles?.license_plate ?? "—"}
          />
          {cert.vehicles?.chassis_number && (
            <DetailItem
              label={t("slCertificates.fieldChassis")}
              value={cert.vehicles.chassis_number}
            />
          )}
          {cert.sl_devices?.serial && (
            <DetailItem
              label={t("slCertificates.fieldDeviceSerial")}
              value={cert.sl_devices.serial}
            />
          )}
          <DetailItem
            label={t("slCertificates.fieldSetSpeed")}
            value={
              cert.set_speed_kmh != null
                ? t("speedLimiters.kmhValue", { value: cert.set_speed_kmh })
                : "—"
            }
          />
          <DetailItem label={t("slCertificates.fieldIssued")} value={formatDate(cert.issued_at)} />
          <DetailItem label={t("slCertificates.fieldExpires")} value={formatDate(cert.expires_at)} />
          <DetailItem
            label={t("slCertificates.fieldAuthority")}
            value={cert.issuing_authority ?? "—"}
          />
        </dl>

        <div className="mt-12 flex flex-wrap items-end justify-between gap-8">
          <div className="text-center">
            {qr ? (
              <img src={qr} alt={t("slCertificates.scanToVerify")} className="mx-auto" />
            ) : (
              <div className="mx-auto h-[200px] w-[200px] rounded border border-dashed border-slate-200" />
            )}
            <p className="mt-1 text-xs text-slate-500">{t("slCertificates.scanToVerify")}</p>
          </div>
          <div className="flex flex-1 flex-wrap justify-end gap-10">
            <div className="w-44 border-t border-slate-400 pt-2 text-center text-xs text-slate-500">
              {t("slCertificates.authorizedSignature")}
            </div>
            <div className="w-44 border-t border-slate-400 pt-2 text-center text-xs text-slate-500">
              {t("slCertificates.companyStamp")}
            </div>
          </div>
        </div>

        <div className="mt-10 border-t border-slate-200 pt-4 text-center text-[11px] text-slate-400">
          <p>{t("slCertificates.generatedBy")}</p>
          <p className="mt-0.5">
            {t("slCertificates.verifyAt")} <span dir="ltr">{verifyUrl}</span>
          </p>
        </div>
      </Card>
    </>
  );
}
