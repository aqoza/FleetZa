import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Wrench } from "lucide-react";
import { listRows } from "../../lib/db";
import { daysUntil, formatDate } from "../../lib/format";
import type {
  SlCustomer,
  SlDevice,
  SlJob,
  SlJobStatus,
  SlJobType,
  SpeedLimiterCertificate,
} from "../../lib/types";
import { useModules } from "../../context/ModulesContext";
import { Badge, Card, EmptyState, ErrorState, LoadingState } from "../../components/ui";
import type { BadgeTone } from "../../components/ui";
import { useT, type MessageKey, type Translate } from "../../i18n";

type JobRow = SlJob & { vehicles: { name: string } | null };
type CertRow = SpeedLimiterCertificate & {
  vehicles: { name: string } | null;
  sl_customers: { name: string } | null;
};

const jobTypeKey: Record<SlJobType, MessageKey> = {
  installation: "speedLimiters.jobType.installation",
  inspection: "speedLimiters.jobType.inspection",
  maintenance: "speedLimiters.jobType.maintenance",
  removal: "speedLimiters.jobType.removal",
  replacement: "speedLimiters.jobType.replacement",
  emergency: "speedLimiters.jobType.emergency",
};

const jobStatusMeta: Record<SlJobStatus, { labelKey: MessageKey; tone: BadgeTone }> = {
  scheduled: { labelKey: "speedLimiters.jobStatus.scheduled", tone: "blue" },
  in_progress: { labelKey: "speedLimiters.jobStatus.in_progress", tone: "yellow" },
  completed: { labelKey: "speedLimiters.jobStatus.completed", tone: "green" },
  qc_approved: { labelKey: "speedLimiters.jobStatus.qc_approved", tone: "purple" },
  closed: { labelKey: "speedLimiters.jobStatus.closed", tone: "slate" },
  canceled: { labelKey: "speedLimiters.jobStatus.canceled", tone: "slate" },
};

function KpiCard({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <Card className="p-5">
      <div className="text-sm font-medium text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </Card>
  );
}

type BucketEntry = { cert: CertRow; days: number };

const bucketStyles = {
  expired: { border: "border-t-red-500", count: "bg-red-50 text-red-700" },
  d30: { border: "border-t-orange-500", count: "bg-orange-50 text-orange-700" },
  d60: { border: "border-t-amber-400", count: "bg-amber-50 text-amber-700" },
  d90: { border: "border-t-blue-500", count: "bg-blue-50 text-blue-700" },
} as const;

function BucketCard({
  titleKey,
  tone,
  entries,
  t,
}: {
  titleKey: MessageKey;
  tone: keyof typeof bucketStyles;
  entries: BucketEntry[];
  t: Translate;
}) {
  const styles = bucketStyles[tone];
  return (
    <Card className={`border-t-4 p-4 ${styles.border}`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">{t(titleKey)}</h3>
        <span
          className={`inline-flex min-w-6 items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold ${styles.count}`}
        >
          {entries.length}
        </span>
      </div>
      {entries.length === 0 ? (
        <p className="mt-3 text-xs text-slate-400">{t("speedLimiters.overview.bucketEmpty")}</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100">
          {entries.slice(0, 5).map(({ cert, days }) => (
            <li key={cert.id} className="py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-slate-800">
                  {cert.certificate_number}
                </span>
                <span className="shrink-0 text-xs font-medium text-slate-500">
                  {days < 0
                    ? t("speedLimiters.overview.daysOverdue", { count: Math.abs(days) })
                    : t("speedLimiters.overview.inDays", { count: days })}
                </span>
              </div>
              <div className="mt-0.5 flex items-center justify-between gap-2 text-xs text-slate-500">
                <span className="truncate">
                  {[cert.sl_customers?.name, cert.vehicles?.name].filter(Boolean).join(" · ") || "—"}
                </span>
                <span className="shrink-0">{formatDate(cert.expires_at)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Link
        to="/speed-limiters/certificates"
        className="mt-2 inline-block text-xs font-medium text-brand-600 hover:text-brand-700"
      >
        {t("speedLimiters.overview.viewAll")}
      </Link>
    </Card>
  );
}

export default function OverviewPage() {
  const t = useT();
  const { isEnabled } = useModules();
  const certificatesEnabled = isEnabled("sl_certificates");

  const customersQ = useQuery({
    queryKey: ["sl_customers"],
    queryFn: () => listRows<SlCustomer>("sl_customers", (q) => q.order("name")),
  });

  const devicesQ = useQuery({
    queryKey: ["sl_devices", "overview"],
    queryFn: () => listRows<SlDevice>("sl_devices", (q) => q.order("serial")),
  });

  const jobsQ = useQuery({
    queryKey: ["sl_jobs", "overview"],
    queryFn: () =>
      listRows<JobRow>("sl_jobs", (q) =>
        q.select("*, vehicles(name)").order("created_at", { ascending: false }),
      ),
  });

  const certsQ = useQuery({
    queryKey: ["speed_limiter_certificates", "overview"],
    queryFn: () =>
      listRows<CertRow>("speed_limiter_certificates", (q) =>
        q.select("*, vehicles(name), sl_customers(name)").order("expires_at"),
      ),
    enabled: certificatesEnabled,
  });

  const kpis = useMemo(() => {
    const devices = devicesQ.data ?? [];
    const jobs = jobsQ.data ?? [];
    const certs = certsQ.data ?? [];
    return {
      customers: (customersQ.data ?? []).length,
      devicesInstalled: devices.filter((d) => d.status === "installed").length,
      devicesInStock: devices.filter((d) => d.status === "in_stock").length,
      openJobs: jobs.filter((j) => j.status === "scheduled" || j.status === "in_progress").length,
      validCertificates: certs.filter((c) => c.status === "valid" && daysUntil(c.expires_at) >= 0)
        .length,
    };
  }, [customersQ.data, devicesQ.data, jobsQ.data, certsQ.data]);

  const buckets = useMemo(() => {
    const entries: BucketEntry[] = (certsQ.data ?? [])
      .filter((c) => c.status === "valid")
      .map((cert) => ({ cert, days: daysUntil(cert.expires_at) }));
    const asc = (a: BucketEntry, b: BucketEntry) => a.days - b.days;
    return {
      expired: entries.filter((e) => e.days < 0).sort((a, b) => b.days - a.days),
      d30: entries.filter((e) => e.days >= 0 && e.days <= 30).sort(asc),
      d60: entries.filter((e) => e.days >= 31 && e.days <= 60).sort(asc),
      d90: entries.filter((e) => e.days >= 61 && e.days <= 90).sort(asc),
    };
  }, [certsQ.data]);

  const recentJobs = (jobsQ.data ?? []).slice(0, 6);

  const isLoading =
    customersQ.isLoading || devicesQ.isLoading || jobsQ.isLoading || certsQ.isLoading;
  const error = customersQ.error ?? devicesQ.error ?? jobsQ.error ?? certsQ.error;

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={(error as Error).message} />;

  return (
    <div className="space-y-6">
      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label={t("speedLimiters.overview.kpiCustomers")} value={kpis.customers} />
        <KpiCard
          label={t("speedLimiters.overview.kpiDevicesInstalled")}
          value={kpis.devicesInstalled}
          sub={t("speedLimiters.overview.kpiInStock", { count: kpis.devicesInStock })}
        />
        <KpiCard label={t("speedLimiters.overview.kpiOpenJobs")} value={kpis.openJobs} />
        {certificatesEnabled && (
          <KpiCard
            label={t("speedLimiters.overview.kpiValidCertificates")}
            value={kpis.validCertificates}
          />
        )}
      </div>

      {/* Certificate expiry board */}
      {certificatesEnabled && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide rtl:tracking-normal text-slate-500">
            {t("speedLimiters.overview.expiryBoard")}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <BucketCard
              titleKey="speedLimiters.overview.bucketExpired"
              tone="expired"
              entries={buckets.expired}
              t={t}
            />
            <BucketCard
              titleKey="speedLimiters.overview.bucket30"
              tone="d30"
              entries={buckets.d30}
              t={t}
            />
            <BucketCard
              titleKey="speedLimiters.overview.bucket60"
              tone="d60"
              entries={buckets.d60}
              t={t}
            />
            <BucketCard
              titleKey="speedLimiters.overview.bucket90"
              tone="d90"
              entries={buckets.d90}
              t={t}
            />
          </div>
        </section>
      )}

      {/* Recent jobs */}
      <section>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide rtl:tracking-normal text-slate-500">
            {t("speedLimiters.overview.recentJobs")}
          </h2>
          <Link
            to="/speed-limiters/jobs"
            className="text-xs font-medium text-brand-600 hover:text-brand-700"
          >
            {t("speedLimiters.overview.viewAll")}
          </Link>
        </div>
        {recentJobs.length === 0 ? (
          <EmptyState
            icon={<Wrench className="h-10 w-10" />}
            title={t("speedLimiters.overview.noJobs")}
            description={t("speedLimiters.overview.noJobsDesc")}
          />
        ) : (
          <Card className="divide-y divide-slate-100">
            {recentJobs.map((job) => (
              <Link
                key={job.id}
                to={`/speed-limiters/jobs/${job.id}`}
                className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-800">
                      {t("speedLimiters.overview.jobNumber", { number: job.number })}
                    </span>
                    <span className="text-sm text-slate-600">{t(jobTypeKey[job.job_type])}</span>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-slate-500">
                    {job.vehicles?.name ?? "—"}
                  </div>
                </div>
                <Badge tone={jobStatusMeta[job.status].tone}>
                  {t(jobStatusMeta[job.status].labelKey)}
                </Badge>
              </Link>
            ))}
          </Card>
        )}
      </section>
    </div>
  );
}
