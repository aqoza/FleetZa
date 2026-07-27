import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { addDays, format } from "date-fns";
import { Award, Building2, Cpu, Wrench } from "lucide-react";
import { countRows, listPage, listRows } from "../../lib/db";
import { formatDate } from "../../lib/format";
import { certificateDaysLeft } from "../../lib/certificateStatus";
import type { SlJob, SlJobStatus, SlJobType, SpeedLimiterCertificate } from "../../lib/types";
import { useModules } from "../../context/ModulesContext";
import { Badge, Card, EmptyState, ErrorState, LoadingState, StatCard } from "../../components/ui";
import type { BadgeTone } from "../../components/ui";
import { useT, type MessageKey, type Translate } from "../../i18n";

type JobRow = SlJob & { vehicles: { name: string } | null };
type CertRow = SpeedLimiterCertificate & {
  vehicles: { name: string } | null;
  customers: { name: string } | null;
};

/** Rows each expiry card lists. The count beside the title is the real total. */
const BUCKET_ROWS = 5;
/** Rows in the recent-jobs strip. */
const RECENT_JOBS = 6;

/** A date-only bound `offset` days from today, in the viewer's local calendar. */
const day = (offset: number) => format(addDays(new Date(), offset), "yyyy-MM-dd");

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

/**
 * The four columns of the expiry board. `id` doubles as the certificates list
 * filter, so every card is a working queue: the link lands on exactly the rows
 * the card counted (`/speed-limiters/certificates?filter=d30`).
 */
type BucketId = "expired" | "d30" | "d60" | "d90";

/**
 * The board reads as one urgency ramp, most urgent first, and every step is a
 * token pair with a designed dark counterpart (src/index.css):
 *
 *   expired  serious  — red, act now
 *   d30      warn     — amber, act this month
 *   d60      brand    — accent blue, on the radar
 *   d90      neutral  — ink/canvas, informational
 *
 * Amber is deliberately used ONCE. `--color-warn` is #d97706 and
 * `--color-warn-soft` is #fffbeb, i.e. exactly amber-600/amber-50, so a d60
 * card painted with the raw amber classes rendered an identical chip to d30
 * and the two neighbours collapsed into one colour. Cooling d60 to the brand
 * ramp and d90 to neutral restores four distinct steps in both themes.
 */
const BUCKETS: { id: BucketId; titleKey: MessageKey; border: string; chip: string }[] = [
  {
    id: "expired",
    titleKey: "speedLimiters.overview.bucketExpired",
    border: "border-t-serious",
    chip: "bg-serious-soft text-serious",
  },
  {
    id: "d30",
    titleKey: "speedLimiters.overview.bucket30",
    border: "border-t-warn",
    chip: "bg-warn-soft text-warn",
  },
  {
    id: "d60",
    titleKey: "speedLimiters.overview.bucket60",
    border: "border-t-brand-500",
    chip: "bg-brand-50 text-brand-700",
  },
  {
    id: "d90",
    titleKey: "speedLimiters.overview.bucket90",
    border: "border-t-ink-3",
    chip: "bg-canvas text-ink-2",
  },
];

/** Days-from-today window per bucket; `expired` is everything before today. */
const BUCKET_DAYS: Record<Exclude<BucketId, "expired">, [number, number]> = {
  d30: [0, 30],
  d60: [31, 60],
  d90: [61, 90],
};

/**
 * One expiry bucket: the exact server-side total plus only the handful of rows
 * the card shows. `listPage` asks PostgREST for `count=exact` alongside the
 * range, so the badge is the real total (not "how many rows we happened to
 * download") and the whole board costs four small requests instead of pulling
 * every certificate in the tenant and bucketing it in the browser.
 *
 * The filters are the server-side equivalent of `certificateBucket`, and they
 * match the certificates list chip of the same name exactly.
 */
function useBucket(id: BucketId, enabled: boolean) {
  return useQuery({
    queryKey: ["speed_limiter_certificates", "overview", id],
    enabled,
    queryFn: () =>
      listPage<CertRow>("speed_limiter_certificates", 0, BUCKET_ROWS, (q) => {
        // "Live" is the one certificate a vehicle currently carries:
        // superseded_by IS NULL AND status = 'valid'. A predecessor that a
        // renewal already replaced is history and is never work to do.
        const live = q
          .select("*, vehicles(name), customers(name)")
          .is("superseded_by", null)
          .eq("status", "valid");
        if (id === "expired") {
          // Most recently lapsed first — the front of the renewal backlog.
          return live.lt("expires_at", day(0)).order("expires_at", { ascending: false });
        }
        const [from, to] = BUCKET_DAYS[id];
        return live
          .gte("expires_at", day(from))
          .lte("expires_at", day(to))
          .order("expires_at", { ascending: true });
      }),
  });
}

function BucketCard({
  titleKey,
  border,
  chip,
  filter,
  total,
  entries,
  t,
}: {
  titleKey: MessageKey;
  border: string;
  chip: string;
  filter: BucketId;
  total: number;
  entries: CertRow[];
  t: Translate;
}) {
  return (
    <Card className={`border-t-4 p-4 ${border}`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">{t(titleKey)}</h3>
        <span
          className={`inline-flex min-w-6 items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${chip}`}
        >
          {total}
        </span>
      </div>
      {entries.length === 0 ? (
        <p className="mt-3 text-xs text-ink-3">{t("speedLimiters.overview.bucketEmpty")}</p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {entries.map((cert) => {
            const days = certificateDaysLeft(cert.expires_at);
            return (
              <li key={cert.id} className="py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-ink">
                    {cert.certificate_number}
                  </span>
                  <span className="shrink-0 text-xs font-medium text-ink-3 tabular-nums">
                    {days < 0
                      ? t("speedLimiters.overview.daysOverdue", { count: Math.abs(days) })
                      : t("speedLimiters.overview.inDays", { count: days })}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-2 text-xs text-ink-3">
                  <span className="truncate">
                    {[cert.customers?.name, cert.vehicles?.name].filter(Boolean).join(" · ") ||
                      t("common.dash")}
                  </span>
                  <span className="shrink-0">{formatDate(cert.expires_at)}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Link
        to={`/speed-limiters/certificates?filter=${filter}`}
        className="mt-2 inline-block text-xs font-medium text-brand-600 hover:text-brand-700"
      >
        {total > entries.length
          ? t("speedLimiters.overview.viewAllCount", { count: total })
          : t("speedLimiters.overview.viewAll")}
      </Link>
    </Card>
  );
}

export default function OverviewPage() {
  const t = useT();
  const { isEnabled } = useModules();
  const certificatesEnabled = isEnabled("sl_certificates");

  // Every KPI is a head-only count: the tile needs a number, not the rows.
  const customersCountQ = useQuery({
    queryKey: ["customers", "overview", "count"],
    queryFn: () => countRows("customers"),
  });

  const deviceCountsQ = useQuery({
    queryKey: ["sl_devices", "overview", "counts"],
    queryFn: async () => {
      const [installed, inStock] = await Promise.all([
        countRows("sl_devices", (q) => q.eq("status", "installed")),
        countRows("sl_devices", (q) => q.eq("status", "in_stock")),
      ]);
      return { installed, inStock };
    },
  });

  const openJobsCountQ = useQuery({
    queryKey: ["sl_jobs", "overview", "openCount"],
    queryFn: () => countRows("sl_jobs", (q) => q.in("status", ["scheduled", "in_progress"])),
  });

  /** Valid = live and not yet expired; superseded predecessors never count. */
  const validCertsCountQ = useQuery({
    queryKey: ["speed_limiter_certificates", "overview", "validCount"],
    enabled: certificatesEnabled,
    queryFn: () =>
      countRows("speed_limiter_certificates", (q) =>
        q.is("superseded_by", null).eq("status", "valid").gte("expires_at", day(0)),
      ),
  });

  const expiredQ = useBucket("expired", certificatesEnabled);
  const d30Q = useBucket("d30", certificatesEnabled);
  const d60Q = useBucket("d60", certificatesEnabled);
  const d90Q = useBucket("d90", certificatesEnabled);
  const bucketQueries: Record<BucketId, ReturnType<typeof useBucket>> = {
    expired: expiredQ,
    d30: d30Q,
    d60: d60Q,
    d90: d90Q,
  };

  const recentJobsQ = useQuery({
    queryKey: ["sl_jobs", "overview", "recent"],
    queryFn: () =>
      listRows<JobRow>("sl_jobs", (q) =>
        q
          .select("*, vehicles(name)")
          .order("created_at", { ascending: false })
          .limit(RECENT_JOBS),
      ),
  });

  const queries = [
    customersCountQ,
    deviceCountsQ,
    openJobsCountQ,
    validCertsCountQ,
    recentJobsQ,
    expiredQ,
    d30Q,
    d60Q,
    d90Q,
  ];
  const isLoading = queries.some((q) => q.isLoading);
  const error = queries.map((q) => q.error).find((e): e is Error => e != null);

  const recentJobs = recentJobsQ.data ?? [];

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error.message} />;

  return (
    <div className="space-y-6">
      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<Building2 className="h-5 w-5" />}
          tone="green"
          label={t("speedLimiters.overview.kpiCustomers")}
          value={customersCountQ.data ?? 0}
        />
        <StatCard
          icon={<Cpu className="h-5 w-5" />}
          tone="blue"
          label={t("speedLimiters.overview.kpiDevicesInstalled")}
          value={deviceCountsQ.data?.installed ?? 0}
          sub={t("speedLimiters.overview.kpiInStock", {
            count: deviceCountsQ.data?.inStock ?? 0,
          })}
        />
        <StatCard
          icon={<Wrench className="h-5 w-5" />}
          tone="violet"
          label={t("speedLimiters.overview.kpiOpenJobs")}
          value={openJobsCountQ.data ?? 0}
        />
        {certificatesEnabled && (
          <StatCard
            icon={<Award className="h-5 w-5" />}
            tone="amber"
            label={t("speedLimiters.overview.kpiValidCertificates")}
            value={validCertsCountQ.data ?? 0}
          />
        )}
      </div>

      {/* Certificate expiry board */}
      {certificatesEnabled && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide rtl:tracking-normal text-ink-3">
            {t("speedLimiters.overview.expiryBoard")}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {BUCKETS.map((bucket) => (
              <BucketCard
                key={bucket.id}
                titleKey={bucket.titleKey}
                border={bucket.border}
                chip={bucket.chip}
                filter={bucket.id}
                total={bucketQueries[bucket.id].data?.total ?? 0}
                entries={bucketQueries[bucket.id].data?.rows ?? []}
                t={t}
              />
            ))}
          </div>
        </section>
      )}

      {/* Recent jobs */}
      <section>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide rtl:tracking-normal text-ink-3">
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
          <Card className="divide-y divide-line">
            {recentJobs.map((job) => (
              <Link
                key={job.id}
                to={`/speed-limiters/jobs/${job.id}`}
                className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-canvas"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-ink">
                      {t("speedLimiters.overview.jobNumber", { number: job.number })}
                    </span>
                    <span className="text-sm text-ink-2">{t(jobTypeKey[job.job_type])}</span>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-ink-3">
                    {job.vehicles?.name ?? t("common.dash")}
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
