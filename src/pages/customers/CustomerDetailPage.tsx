import { Suspense, lazy, useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, format } from "date-fns";
import { ArrowLeft, Car, Pencil, Plus, RefreshCw, Star, Trash2, Unlink } from "lucide-react";
import {
  countRows, deleteRow, getRow, insertRow, listPage, listRows, sanitizeSearch, updateRow,
} from "../../lib/db";
import { recordRecent } from "../../lib/recent";
import { formatDate } from "../../lib/format";
import {
  certificateBucket, certificateStatusMeta, fleetCompliancePercent,
  type CertificateStatusFields,
} from "../../lib/certificateStatus";
import type {
  Contact, Customer, SlJob, SlJobStatus, SlJobType, SpeedLimiterCertificate, Vehicle,
} from "../../lib/types";
import { useAuth } from "../../context/AuthContext";
import { useModules } from "../../context/ModulesContext";
import { useT, type MessageKey } from "../../i18n";
import {
  Badge, Button, Card, EmptyState, ErrorState, Field, Input, LoadingState, Modal, PageHeader,
  Pagination, Select, Table, Textarea, type BadgeTone,
} from "../../components/ui";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { RenewCertificateModal } from "../speed-limiters/RenewCertificateModal";
import { CustomerForm, customerStatusMeta } from "./CustomersPage";

// Contributed by the sales module — kept in its own chunk so customers pages
// stay lean for tenants that do not sell.
const CustomerSalesPanel = lazy(() => import("../sales/CustomerSalesPanel"));

type JobRow = SlJob & { vehicles: Pick<Vehicle, "name"> | null };
type CertRow = SpeedLimiterCertificate & {
  vehicles: Pick<Vehicle, "name" | "license_plate"> | null;
};

/**
 * The one certificate a vehicle currently carries — the head of its chain
 * (`superseded_by IS NULL`), revoked heads included so the badge can say so.
 * Only the columns the row needs: this is fetched per visible page.
 */
type CertHead = Pick<
  SpeedLimiterCertificate,
  "id" | "vehicle_id" | "certificate_number" | "expires_at" | "status" | "superseded_by"
>;

/** Small cards, so the pages stay short enough to scan without scrolling. */
const VEHICLE_PAGE_SIZE = 10;
const CERT_PAGE_SIZE = 8;
const JOB_PAGE_SIZE = 8;

/**
 * Vehicle ids folded into a query string when filtering the vehicle list by
 * certificate status: the status lives on the certificate, so the matching
 * vehicles are resolved first and passed down as ids. Capped, and the cap is
 * surfaced rather than silently dropping vehicles.
 */
const STATUS_MATCH_CAP = 200;

/** Unassigned vehicles offered by the attach picker (a <select>, not a list). */
const ATTACH_LIMIT = 50;

/** Today + offset as a date-only string — the boundary the server filters on. */
function day(offset: number): string {
  return format(addDays(new Date(), offset), "yyyy-MM-dd");
}

// Shared enum keys — defined in the speedLimiters namespace by the hub.
const jobTypeKeys: Record<SlJobType, MessageKey> = {
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
  canceled: { labelKey: "speedLimiters.jobStatus.canceled", tone: "red" },
};

/** Certificate-status chips over the customer's vehicles. */
type VehicleFilterId = "all" | "valid" | "expiring" | "expired";

const VEHICLE_FILTERS: { id: VehicleFilterId; labelKey: MessageKey }[] = [
  { id: "all", labelKey: "customers.vehicleFilterAll" },
  { id: "valid", labelKey: "customers.vehicleFilterValid" },
  { id: "expiring", labelKey: "customers.vehicleFilterExpiring" },
  { id: "expired", labelKey: "customers.vehicleFilterExpired" },
];

function Kpi({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-medium text-ink-3">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-ink tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-ink-3">{hint}</div>}
    </Card>
  );
}

function ContactForm({
  customerId,
  contact,
  contacts,
  onDone,
}: {
  customerId: string;
  contact?: Contact;
  contacts: Contact[];
  onDone: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: contact?.name ?? "",
    title: contact?.title ?? "",
    department: contact?.department ?? "",
    email: contact?.email ?? "",
    phone: contact?.phone ?? "",
    whatsapp: contact?.whatsapp ?? "",
    notes: contact?.notes ?? "",
  });
  const [isPrimary, setIsPrimary] = useState(contact?.is_primary ?? contacts.length === 0);
  const [error, setError] = useState("");

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const mutation = useMutation({
    mutationFn: async () => {
      // Only one primary per customer: demote the previous primary first.
      if (isPrimary) {
        const others = contacts.filter((c) => c.is_primary && c.id !== contact?.id);
        for (const prev of others) {
          await updateRow<Contact>("contacts", prev.id, { is_primary: false });
        }
      }
      const values = {
        name: form.name.trim(),
        title: form.title.trim() || null,
        department: form.department.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        whatsapp: form.whatsapp.trim() || null,
        is_primary: isPrimary,
        notes: form.notes.trim() || null,
      };
      return contact
        ? updateRow<Contact>("contacts", contact.id, values)
        : insertRow<Contact>("contacts", { ...values, customer_id: customerId });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["contacts"] });
      onDone();
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("customers.saveFailed")),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    mutation.mutate();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && <ErrorState message={error} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("field.name")} required>
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} required />
        </Field>
        <Field label={t("customers.contactTitle")}>
          <Input value={form.title} onChange={(e) => set("title", e.target.value)} />
        </Field>
        <Field label={t("customers.department")}>
          <Input value={form.department} onChange={(e) => set("department", e.target.value)} />
        </Field>
        <Field label={t("field.email")}>
          <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
        </Field>
        <Field label={t("field.phone")}>
          <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} />
        </Field>
        <Field label={t("customers.whatsapp")}>
          <Input value={form.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm font-medium text-ink-2">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-line"
          checked={isPrimary}
          onChange={(e) => setIsPrimary(e.target.checked)}
        />
        {t("customers.primaryContact")}
      </label>
      <Field label={t("field.notes")}>
        <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>{t("action.cancel")}</Button>
        <Button type="submit" loading={mutation.isPending}>
          {contact ? t("action.saveChanges") : t("customers.addContact")}
        </Button>
      </div>
    </form>
  );
}

/**
 * Attach an existing unassigned vehicle. A service provider can hold hundreds
 * of them, so the picker is a bounded, server-searched page rather than every
 * unassigned vehicle in the tenant.
 */
function AttachVehicleForm({
  customerId,
  onDone,
}: {
  customerId: string;
  onDone: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [vehicleId, setVehicleId] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");

  const term = sanitizeSearch(search);

  const { data, isLoading, error: loadError } = useQuery({
    queryKey: ["vehicles", "unassigned", term],
    placeholderData: keepPreviousData,
    queryFn: () =>
      listPage<Vehicle>("vehicles", 0, ATTACH_LIMIT, (q) => {
        let query = q.is("customer_id", null).order("name");
        if (term) {
          query = query.or(
            `name.ilike.%${term}%,license_plate.ilike.%${term}%,` +
              `fleet_number.ilike.%${term}%,chassis_number.ilike.%${term}%,vin.ilike.%${term}%`,
          );
        }
        return query;
      }),
  });

  const mutation = useMutation({
    mutationFn: () => updateRow<Vehicle>("vehicles", vehicleId, { customer_id: customerId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["vehicles"] });
      onDone();
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("customers.saveFailed")),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    mutation.mutate();
  }

  const options = data?.rows ?? [];
  const total = data?.total ?? 0;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && <ErrorState message={error} />}
      {loadError && <ErrorState message={(loadError as Error).message} />}
      <Field label={t("action.search")}>
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setVehicleId("");
          }}
          placeholder={t("customers.attachSearchPlaceholder")}
        />
      </Field>
      {isLoading ? (
        <LoadingState />
      ) : options.length === 0 ? (
        <p className="text-sm text-ink-2">
          {term ? t("customers.noUnassignedMatches") : t("customers.noUnassignedVehicles")}
        </p>
      ) : (
        <>
          <Field label={t("customers.attachExistingLabel")} required>
            <Select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} required>
              <option value="">{t("customers.selectVehicle")}</option>
              {options.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}{v.license_plate ? ` — ${v.license_plate}` : ""}
                </option>
              ))}
            </Select>
          </Field>
          {total > options.length && (
            <p className="text-xs text-warn">
              {t("customers.attachNarrowHint", { count: options.length, total })}
            </p>
          )}
        </>
      )}
      <p className="text-xs text-ink-3">
        {t("customers.createVehicleHint")}{" "}
        <Link to="/vehicles" className="font-medium text-brand-700 hover:underline">
          {t("customers.goToVehicles")}
        </Link>
      </p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>{t("action.cancel")}</Button>
        {options.length > 0 && (
          <Button type="submit" loading={mutation.isPending}>{t("customers.attach")}</Button>
        )}
      </div>
    </form>
  );
}

export default function CustomerDetailPage() {
  const t = useT();
  const { customerId = "" } = useParams();
  const { isManager } = useAuth();
  const { isEnabled } = useModules();
  const qc = useQueryClient();
  // Customers is standalone master data — only surface speed-limiter panels
  // for tenants that actually run that module.
  const slEnabled = isEnabled("speed_limiters");
  const salesEnabled = isEnabled("sales");
  const certificatesEnabled = slEnabled && isEnabled("sl_certificates");

  const [editing, setEditing] = useState(false);
  const [addingContact, setAddingContact] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [deletingContact, setDeletingContact] = useState<Contact | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [detaching, setDetaching] = useState<Vehicle | null>(null);
  const [actionError, setActionError] = useState("");

  // Vehicles card: server-side search + certificate-status filter + paging.
  const [vehicleSearch, setVehicleSearch] = useState("");
  const [vehicleFilter, setVehicleFilter] = useState<VehicleFilterId>("all");
  const [vehiclePage, setVehiclePage] = useState(0);
  const [renewingId, setRenewingId] = useState<string | null>(null);
  const [certPage, setCertPage] = useState(0);
  const [certHistory, setCertHistory] = useState(false);
  const [jobPage, setJobPage] = useState(0);

  const { data: customer, isLoading, error } = useQuery({
    queryKey: ["customers", customerId],
    queryFn: () => getRow<Customer>("customers", customerId),
  });

  useEffect(() => {
    if (customer) recordRecent(customer.name, `/customers/${customer.id}`);
  }, [customer]);

  const contactsQ = useQuery({
    queryKey: ["contacts", customerId],
    queryFn: () =>
      listRows<Contact>("contacts", (q) =>
        q.eq("customer_id", customerId).order("created_at"),
      ),
  });

  // --- KPI tiles: exact head-only counts, never a list the page then filters ---

  const vehicleCountQ = useQuery({
    queryKey: ["vehicles", "customer", customerId, "count"],
    queryFn: () => countRows("vehicles", (q) => q.eq("customer_id", customerId)),
  });

  const limiterCountQ = useQuery({
    queryKey: ["speed_limiter_installations", "customer", customerId, "count"],
    queryFn: () =>
      countRows("speed_limiter_installations", (q) =>
        q.eq("customer_id", customerId).eq("status", "active"),
      ),
    enabled: slEnabled,
  });

  const jobCountsQ = useQuery({
    queryKey: ["sl_jobs", "customer", customerId, "counts"],
    enabled: slEnabled,
    queryFn: async () => {
      const [completed, pending] = await Promise.all([
        countRows("sl_jobs", (q) =>
          q
            .eq("customer_id", customerId)
            .in("status", ["completed", "qc_approved", "closed"]),
        ),
        countRows("sl_jobs", (q) =>
          q.eq("customer_id", customerId).in("status", ["scheduled", "in_progress"]),
        ),
      ]);
      return { completed, pending };
    },
  });

  /**
   * Certificate KPIs, as four head-only counts instead of one unbounded fetch
   * the page then buckets. "Live" is the certificate a vehicle currently
   * carries (`superseded_by IS NULL AND status = 'valid'`), so a renewed
   * predecessor is never counted as expired work — it is history, not a
   * failure — and a revoked certificate never counts as cover.
   */
  const certCountsQ = useQuery({
    queryKey: ["speed_limiter_certificates", "customer", customerId, "counts"],
    enabled: certificatesEnabled,
    queryFn: async () => {
      const [issued, expiring, expired, covered] = await Promise.all([
        countRows("speed_limiter_certificates", (q) => q.eq("customer_id", customerId)),
        countRows("speed_limiter_certificates", (q) =>
          q
            .eq("customer_id", customerId)
            .is("superseded_by", null)
            .eq("status", "valid")
            .gte("expires_at", day(0))
            .lte("expires_at", day(60)),
        ),
        countRows("speed_limiter_certificates", (q) =>
          q
            .eq("customer_id", customerId)
            .is("superseded_by", null)
            .eq("status", "valid")
            .lt("expires_at", day(0)),
        ),
        countRows("speed_limiter_certificates", (q) =>
          q
            .eq("customer_id", customerId)
            .is("superseded_by", null)
            .eq("status", "valid")
            .gte("expires_at", day(0)),
        ),
      ]);
      return { issued, expiring, expired, covered };
    },
  });

  // --- Vehicles card ---

  // % , ( ) are .or() logic-tree syntax, not search text.
  const vehicleTerm = sanitizeSearch(vehicleSearch);
  const statusFilterActive = certificatesEnabled && vehicleFilter !== "all";

  // Certificate status lives on the certificate, so filtering vehicles by it
  // means resolving the matching vehicles first (bounded) and passing the ids
  // into the vehicle query — the same shape the certificates list uses.
  const statusMatch = useQuery({
    queryKey: ["speed_limiter_certificates", "customer", customerId, "status-filter", vehicleFilter],
    enabled: statusFilterActive,
    queryFn: () =>
      listPage<Pick<SpeedLimiterCertificate, "vehicle_id">>(
        "speed_limiter_certificates",
        0,
        STATUS_MATCH_CAP,
        (q) => {
          let query = q
            .select("vehicle_id")
            .eq("customer_id", customerId)
            .is("superseded_by", null)
            .eq("status", "valid");
          if (vehicleFilter === "valid") query = query.gte("expires_at", day(0));
          else if (vehicleFilter === "expiring")
            query = query.gte("expires_at", day(0)).lte("expires_at", day(60));
          else query = query.lt("expires_at", day(0));
          return query.order("expires_at");
        },
      ),
  });
  const statusIds = statusFilterActive
    ? (statusMatch.data?.rows ?? []).map((r) => r.vehicle_id)
    : [];
  const statusTruncated = (statusMatch.data?.total ?? 0) > STATUS_MATCH_CAP;
  // A filter that matched nothing must not run `.in("id", [])` — resolve it
  // to an empty page here instead.
  const statusEmpty = statusFilterActive && statusMatch.isSuccess && statusIds.length === 0;
  const statusReady = !statusFilterActive || statusMatch.isSuccess;

  const vehiclesQ = useQuery({
    queryKey: [
      "vehicles", "customer", customerId, "list", vehiclePage, vehicleTerm, vehicleFilter, statusIds,
    ],
    enabled: statusReady && !statusEmpty,
    // Typing a plate re-runs the query on every keystroke; keep the previous
    // rows on screen (dimmed) instead of tearing the table down.
    placeholderData: keepPreviousData,
    queryFn: () =>
      listPage<Vehicle>("vehicles", vehiclePage, VEHICLE_PAGE_SIZE, (q) => {
        let query = q.eq("customer_id", customerId).order("name");
        if (vehicleTerm) {
          query = query.or(
            `name.ilike.%${vehicleTerm}%,license_plate.ilike.%${vehicleTerm}%,` +
              `fleet_number.ilike.%${vehicleTerm}%,chassis_number.ilike.%${vehicleTerm}%,` +
              `vin.ilike.%${vehicleTerm}%`,
          );
        }
        if (statusFilterActive) query = query.in("id", statusIds);
        return query;
      }),
  });
  const vehicles = statusEmpty ? [] : vehiclesQ.data?.rows ?? [];
  const vehicleTotal = statusEmpty ? 0 : vehiclesQ.data?.total ?? 0;

  // The certificate each visible vehicle currently carries — one keyed lookup
  // over the page's ids, never every certificate the customer holds.
  const pageVehicleIds = vehicles.map((v) => v.id);
  const headsQ = useQuery({
    queryKey: ["speed_limiter_certificates", "vehicle-heads", pageVehicleIds],
    enabled: certificatesEnabled && pageVehicleIds.length > 0,
    queryFn: () =>
      listRows<CertHead>("speed_limiter_certificates", (q) =>
        q
          .select("id, vehicle_id, certificate_number, expires_at, status, superseded_by")
          .is("superseded_by", null)
          .in("vehicle_id", pageVehicleIds),
      ),
  });
  const headByVehicle = new Map((headsQ.data ?? []).map((h) => [h.vehicle_id, h]));

  // --- Jobs + certificates cards ---

  const jobsQ = useQuery({
    queryKey: ["sl_jobs", "customer", customerId, "list", jobPage],
    enabled: slEnabled,
    placeholderData: keepPreviousData,
    queryFn: () =>
      listPage<JobRow>("sl_jobs", jobPage, JOB_PAGE_SIZE, (q) =>
        q
          .select("*, vehicles(name)")
          .eq("customer_id", customerId)
          .order("created_at", { ascending: false }),
      ),
  });

  const certsQ = useQuery({
    queryKey: ["speed_limiter_certificates", "customer", customerId, "list", certPage, certHistory],
    enabled: certificatesEnabled,
    placeholderData: keepPreviousData,
    queryFn: () =>
      listPage<CertRow>("speed_limiter_certificates", certPage, CERT_PAGE_SIZE, (q) => {
        let query = q
          .select("*, vehicles(name, license_plate)")
          .eq("customer_id", customerId);
        // Superseded predecessors are history: they are behind the toggle so
        // the card shows what the customer holds today.
        if (!certHistory) query = query.is("superseded_by", null);
        return query.order("issued_at", { ascending: false });
      }),
  });

  const removeContact = useMutation({
    mutationFn: (contactId: string) => deleteRow("contacts", contactId),
    onSuccess: () => {
      setActionError("");
      void qc.invalidateQueries({ queryKey: ["contacts"] });
      setDeletingContact(null);
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : t("customers.deleteFailed"));
      setDeletingContact(null);
    },
  });

  const detach = useMutation({
    mutationFn: (vehicleId: string) =>
      updateRow<Vehicle>("vehicles", vehicleId, { customer_id: null }),
    onSuccess: () => {
      setActionError("");
      void qc.invalidateQueries({ queryKey: ["vehicles"] });
      setDetaching(null);
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : t("customers.saveFailed"));
      setDetaching(null);
    },
  });

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={(error as Error).message} />;
  if (!customer) return <ErrorState message={t("customers.notFound")} />;

  const contacts = [...(contactsQ.data ?? [])].sort(
    (a, b) => Number(b.is_primary) - Number(a.is_primary),
  );
  const jobs = jobsQ.data?.rows ?? [];
  const jobTotal = jobsQ.data?.total ?? 0;
  const certs = certsQ.data?.rows ?? [];
  const certTotal = certsQ.data?.total ?? 0;

  const certCounts = certCountsQ.data;
  const totalVehicles = vehicleCountQ.data;
  // Cover is per vehicle, and the certificate count is matched on a snapshot
  // customer_id that detaching or transferring a vehicle never rewrites — the
  // shared helper clamps the ratio so the tile can never read over 100%.
  const compliancePct =
    certCounts === undefined || totalVehicles === undefined
      ? null
      : fleetCompliancePercent(certCounts.covered, totalVehicles);
  const compliance = compliancePct === null ? t("common.dash") : `${compliancePct}%`;
  const st = customerStatusMeta[customer.status];

  /** Narrowing the vehicle list always returns to its first page. */
  function setFilter(id: VehicleFilterId) {
    setVehicleFilter(id);
    setVehiclePage(0);
  }
  function setSearch(value: string) {
    setVehicleSearch(value);
    setVehiclePage(0);
  }

  /** One badge for every certificate on this page — bucket, tone and copy all
   *  come from the shared helper, so the vehicle rows and the certificates
   *  card can never disagree about what a certificate's state is. */
  function certBadge(c: CertificateStatusFields) {
    const { bucket, labelKey, tone, daysLeft } = certificateStatusMeta(c);
    if (bucket === "d30" || bucket === "d60" || bucket === "d90") {
      return <Badge tone={tone}>{t("speedLimiters.certStatus.expiresInDays", { count: daysLeft })}</Badge>;
    }
    if (bucket === "expired") {
      return (
        <Badge tone={tone}>
          {t("speedLimiters.certStatus.expiredDaysAgo", { count: Math.abs(daysLeft) })}
        </Badge>
      );
    }
    return <Badge tone={tone}>{t(labelKey)}</Badge>;
  }

  /** A link that lands on the certificate whichever list it lives in. */
  function certHref(c: CertRow) {
    const p = new URLSearchParams({ q: c.certificate_number });
    if (c.superseded_by != null) p.set("filter", "superseded");
    return `/speed-limiters/certificates?${p.toString()}`;
  }

  const certColumns: Array<DataTableColumn<Vehicle>> = certificatesEnabled
    ? [
        {
          id: "certificate",
          header: t("customers.vehicleCertificate"),
          cell: (v) => {
            const head = headByVehicle.get(v.id);
            if (!head) return <span className="text-ink-3">{t("common.dash")}</span>;
            return (
              <>
                <div className="text-ink-2">{head.certificate_number}</div>
                <div className="text-xs text-ink-3">{formatDate(head.expires_at)}</div>
              </>
            );
          },
          sortValue: (v) => headByVehicle.get(v.id)?.expires_at ?? null,
          exportValue: (v) => headByVehicle.get(v.id)?.certificate_number ?? null,
        },
        {
          id: "certStatus",
          header: t("common.status"),
          cell: (v) => {
            const head = headByVehicle.get(v.id);
            if (!head) {
              return <Badge tone="slate">{t("customers.vehicleNoCertificate")}</Badge>;
            }
            return certBadge(head);
          },
          sortValue: (v) => {
            const head = headByVehicle.get(v.id);
            return head ? certificateBucket(head) : null;
          },
          exportValue: (v) => {
            const head = headByVehicle.get(v.id);
            return head
              ? t(certificateStatusMeta(head).labelKey)
              : t("customers.vehicleNoCertificate");
          },
        },
      ]
    : [];

  const vehicleColumns: Array<DataTableColumn<Vehicle>> = [
    {
      id: "name",
      header: t("field.name"),
      cell: (v) => (
        <Link to={`/vehicles/${v.id}`} className="font-medium text-brand-700 hover:underline">
          {v.name}
        </Link>
      ),
      sortValue: (v) => v.name,
    },
    {
      id: "plate",
      header: t("field.licensePlate"),
      cell: (v) => (
        <span className="text-ink-2"><bdi>{v.license_plate ?? t("common.dash")}</bdi></span>
      ),
      sortValue: (v) => v.license_plate,
    },
    {
      id: "fleet",
      header: t("customers.fleetNumber"),
      cell: (v) => <span className="text-ink-2">{v.fleet_number ?? t("common.dash")}</span>,
      sortValue: (v) => v.fleet_number,
      minBreakpoint: "xl",
    },
    {
      id: "chassis",
      header: t("customers.chassisNumber"),
      cell: (v) => <span className="text-ink-2">{v.chassis_number ?? t("common.dash")}</span>,
      sortValue: (v) => v.chassis_number,
      minBreakpoint: "xl",
    },
    ...certColumns,
    {
      id: "actions",
      header: t("common.actions"),
      align: "end",
      cell: (v) => {
        if (!isManager) return null;
        const head = headByVehicle.get(v.id);
        const bucket = head ? certificateBucket(head) : null;
        // Renewal is offered exactly where it is the next step: a certificate
        // that has lapsed or is inside the 90-day window. A revoked head is
        // replaced by a new job, not renewed (the bulk action skips it too).
        const renewable =
          bucket === "expired" || bucket === "d30" || bucket === "d60" || bucket === "d90";
        return (
          <div className="flex justify-end gap-1">
            {certificatesEnabled && head && renewable && (
              <button
                className="rounded p-1.5 text-ink-3 hover:bg-good-soft hover:text-good"
                onClick={() => setRenewingId(head.id)}
                aria-label={t("customers.renewCertificate")}
                title={t("customers.renewCertificate")}
              >
                <RefreshCw className="h-4 w-4" />
              </button>
            )}
            <button
              className="rounded p-1.5 text-ink-3 hover:bg-serious-soft hover:text-serious"
              onClick={() => setDetaching(v)}
              aria-label={t("customers.detachVehicle")}
              title={t("customers.detachVehicle")}
            >
              <Unlink className="h-4 w-4" />
            </button>
          </div>
        );
      },
    },
  ];

  const vehicleError = (statusMatch.error ?? vehiclesQ.error) as Error | null;
  // Only the very first load has nothing to show; every later one keeps the
  // previous page visible (dimmed) while the new one arrives.
  const vehiclesLoading = !vehicleError && !statusEmpty && vehiclesQ.data === undefined;
  const vehiclesStale = vehiclesQ.isPlaceholderData || !statusReady;
  const vehicleFiltered = vehicleTerm !== "" || vehicleFilter !== "all";

  return (
    <>
      <Link
        to="/customers"
        className="mb-4 inline-flex items-center gap-1 text-sm text-ink-3 hover:text-ink-2"
      >
        <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" /> {t("customers.title")}
      </Link>
      <PageHeader
        title={customer.name}
        description={customer.cr_number ?? undefined}
        actions={
          <>
            <Badge tone={st.tone}>{t(st.labelKey)}</Badge>
            {isManager && (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                <Pencil className="h-4 w-4" /> {t("action.edit")}
              </Button>
            )}
          </>
        }
      />

      {actionError && (
        <div className="mb-4">
          <ErrorState message={actionError} />
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label={t("customers.vehicles")} value={totalVehicles ?? t("common.dash")} />
        {slEnabled && (
          <>
            <Kpi
              label={t("customers.kpiActiveLimiters")}
              value={limiterCountQ.data ?? t("common.dash")}
            />
            <Kpi
              label={t("customers.kpiJobsCompleted")}
              value={jobCountsQ.data?.completed ?? t("common.dash")}
            />
            <Kpi
              label={t("customers.kpiJobsPending")}
              value={jobCountsQ.data?.pending ?? t("common.dash")}
            />
          </>
        )}
        {certificatesEnabled && (
          <>
            <Kpi
              label={t("customers.kpiCertsIssued")}
              value={certCounts?.issued ?? t("common.dash")}
            />
            <Kpi
              label={t("customers.kpiCertsExpiring")}
              value={certCounts?.expiring ?? t("common.dash")}
            />
            <Kpi
              label={t("customers.kpiCertsExpired")}
              value={certCounts?.expired ?? t("common.dash")}
              hint={t("customers.expiredHint")}
            />
            <Kpi
              label={t("customers.kpiCompliance")}
              value={compliance}
              hint={t("customers.complianceHint")}
            />
          </>
        )}
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink">{t("customers.contacts")}</h3>
            {isManager && (
              <Button variant="secondary" onClick={() => setAddingContact(true)}>
                <Plus className="h-4 w-4" /> {t("action.add")}
              </Button>
            )}
          </div>
          {contactsQ.isLoading ? (
            <LoadingState />
          ) : contactsQ.error ? (
            <ErrorState message={(contactsQ.error as Error).message} />
          ) : contacts.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-3">
              {t("customers.noContacts")}
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {contacts.map((c) => (
                <li key={c.id} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      {c.is_primary && (
                        <Star
                          className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400"
                          aria-label={t("customers.primaryContact")}
                        />
                      )}
                      <span className="truncate text-sm font-medium text-ink">{c.name}</span>
                    </div>
                    {(c.title || c.department) && (
                      <div className="text-xs text-ink-3">
                        {[c.title, c.department].filter(Boolean).join(" · ")}
                      </div>
                    )}
                    <div className="mt-0.5 space-y-0.5 text-xs text-ink-3">
                      {c.phone && <div>{c.phone}</div>}
                      {c.whatsapp && (
                        <div>{t("customers.whatsapp")}: {c.whatsapp}</div>
                      )}
                      {c.email && <div className="truncate">{c.email}</div>}
                    </div>
                  </div>
                  {isManager && (
                    <div className="flex shrink-0 gap-1">
                      <button
                        className="rounded p-1.5 text-ink-3 hover:bg-canvas hover:text-ink-2"
                        onClick={() => setEditingContact(c)}
                        aria-label={t("customers.editContact")}
                        title={t("action.edit")}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        className="rounded p-1.5 text-ink-3 hover:bg-serious-soft hover:text-serious"
                        onClick={() => setDeletingContact(c)}
                        aria-label={t("customers.deleteContact")}
                        title={t("action.delete")}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-ink">{t("customers.vehicles")}</h3>
            {isManager && (
              <Button variant="secondary" onClick={() => setAttaching(true)}>
                <Plus className="h-4 w-4" /> {t("customers.attachVehicle")}
              </Button>
            )}
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-2">
            {certificatesEnabled && (
              <div className="flex flex-wrap gap-1.5">
                {VEHICLE_FILTERS.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setFilter(f.id)}
                    aria-pressed={vehicleFilter === f.id}
                    className={
                      vehicleFilter === f.id
                        ? "rounded-full bg-brand-600 px-3 py-1 text-xs font-medium text-white"
                        : "rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-ink-2 hover:bg-canvas"
                    }
                  >
                    {t(f.labelKey)}
                  </button>
                ))}
              </div>
            )}
            <div className="ms-auto w-full sm:w-64">
              <Input
                value={vehicleSearch}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("customers.vehicleSearchPlaceholder")}
                aria-label={t("customers.vehicleSearchPlaceholder")}
              />
            </div>
          </div>

          {statusTruncated && (
            <div className="mb-3 rounded-xl border border-warn/30 bg-warn-soft px-3 py-2 text-sm text-warn">
              {t("customers.vehicleFilterNarrowHint", { count: STATUS_MATCH_CAP })}
            </div>
          )}

          {vehiclesLoading && <LoadingState />}
          {vehicleError && <ErrorState message={vehicleError.message} />}
          {!vehiclesLoading && !vehicleError && (
            <div
              className={`transition-opacity ${vehiclesStale ? "opacity-60" : ""}`}
              aria-busy={vehiclesStale}
            >
              <DataTable<Vehicle>
                tableId="customer_vehicles"
                exportName="customer_vehicles"
                columns={vehicleColumns}
                rows={vehicles}
                rowKey={(v) => v.id}
                empty={
                  <EmptyState
                    icon={<Car className="h-10 w-10" />}
                    title={
                      vehicleFiltered
                        ? t("customers.noVehiclesFilteredTitle")
                        : t("customers.noVehicles")
                    }
                    description={
                      vehicleFiltered ? t("customers.noVehiclesFilteredDesc") : undefined
                    }
                  />
                }
                footer={
                  <Pagination
                    page={vehiclePage}
                    pageSize={VEHICLE_PAGE_SIZE}
                    total={vehicleTotal}
                    onPage={setVehiclePage}
                  />
                }
              />
            </div>
          )}
        </Card>
      </div>

      {salesEnabled && (
        <div className="mb-4">
          <Suspense fallback={<LoadingState />}>
            <CustomerSalesPanel customerId={customerId} />
          </Suspense>
        </div>
      )}

      {slEnabled && (
      <div className={`grid gap-4 ${certificatesEnabled ? "lg:grid-cols-2" : ""}`}>
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink">{t("customers.jobs")}</h3>
            <Link
              to="/speed-limiters/jobs"
              className="text-xs font-medium text-brand-700 hover:underline"
            >
              {t("customers.viewAllJobs")}
            </Link>
          </div>
          {jobsQ.isLoading ? (
            <LoadingState />
          ) : jobsQ.error ? (
            <ErrorState message={(jobsQ.error as Error).message} />
          ) : (
            <>
              {jobs.length === 0 ? (
                <p className="py-6 text-center text-sm text-ink-3">{t("customers.noJobs")}</p>
              ) : (
              <Table
                headers={[
                  t("customers.jobNumber"),
                  t("customers.type"),
                  t("common.status"),
                  t("field.vehicle"),
                  t("customers.scheduled"),
                ]}
              >
                {jobs.map((j) => {
                  const jm = jobStatusMeta[j.status];
                  return (
                    <tr key={j.id} className="transition-colors hover:bg-canvas">
                      <td className="px-4 py-3">
                        <Link
                          to={`/speed-limiters/jobs/${j.id}`}
                          className="font-medium text-brand-700 hover:underline"
                        >
                          #{j.number}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-ink-2">{t(jobTypeKeys[j.job_type])}</td>
                      <td className="px-4 py-3">
                        <Badge tone={jm.tone}>{t(jm.labelKey)}</Badge>
                      </td>
                      <td className="px-4 py-3 text-ink-2">{j.vehicles?.name ?? t("common.dash")}</td>
                      <td className="px-4 py-3 text-ink-2">{formatDate(j.scheduled_date)}</td>
                    </tr>
                  );
                })}
              </Table>
              )}
              <Pagination
                page={jobPage}
                pageSize={JOB_PAGE_SIZE}
                total={jobTotal}
                onPage={setJobPage}
              />
            </>
          )}
        </Card>

        {certificatesEnabled && (
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-ink">
                {t("customers.certificates")}
              </h3>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    setCertHistory((h) => !h);
                    setCertPage(0);
                  }}
                  aria-pressed={certHistory}
                  className={
                    certHistory
                      ? "rounded-full bg-brand-600 px-3 py-1 text-xs font-medium text-white"
                      : "rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-ink-2 hover:bg-canvas"
                  }
                >
                  {t("customers.certsIncludeHistory")}
                </button>
                <Link
                  to="/speed-limiters/certificates"
                  className="text-xs font-medium text-brand-700 hover:underline"
                >
                  {t("customers.viewAllCertificates")}
                </Link>
              </div>
            </div>
            {certsQ.isLoading ? (
              <LoadingState />
            ) : certsQ.error ? (
              <ErrorState message={(certsQ.error as Error).message} />
            ) : (
              <>
                {certs.length === 0 ? (
                  <p className="py-6 text-center text-sm text-ink-3">
                    {t("customers.noCertificates")}
                  </p>
                ) : (
                <Table
                  headers={[
                    t("customers.certificateNumber"),
                    t("field.vehicle"),
                    t("customers.expires"),
                  ]}
                >
                  {certs.map((c) => (
                    <tr key={c.id} className="transition-colors hover:bg-canvas">
                      <td className="px-4 py-3">
                        <Link
                          to={certHref(c)}
                          className="font-medium text-brand-700 hover:underline"
                        >
                          {c.certificate_number}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-ink-2">
                        <div>{c.vehicles?.name ?? t("common.dash")}</div>
                        {/* Plates are digits + Latin letters; <bdi> keeps the
                            RTL paragraph from reordering "5637 RA". */}
                        {c.vehicles?.license_plate && (
                          <div className="text-xs text-ink-3">
                            <bdi>{c.vehicles.license_plate}</bdi>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {certBadge(c)}
                          <span className="text-xs text-ink-3">{formatDate(c.expires_at)}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </Table>
                )}
                <Pagination
                  page={certPage}
                  pageSize={CERT_PAGE_SIZE}
                  total={certTotal}
                  onPage={setCertPage}
                />
              </>
            )}
          </Card>
        )}
      </div>
      )}

      <RenewCertificateModal
        certificateId={renewingId}
        onClose={() => setRenewingId(null)}
      />

      <Modal
        title={t("customers.editCustomer")}
        open={editing}
        onClose={() => setEditing(false)}
        wide
      >
        {editing && <CustomerForm customer={customer} onDone={() => setEditing(false)} />}
      </Modal>

      <Modal
        title={t("customers.addContact")}
        open={addingContact}
        onClose={() => setAddingContact(false)}
        wide
      >
        {addingContact && (
          <ContactForm
            customerId={customerId}
            contacts={contactsQ.data ?? []}
            onDone={() => setAddingContact(false)}
          />
        )}
      </Modal>

      <Modal
        title={t("customers.editContact")}
        open={!!editingContact}
        onClose={() => setEditingContact(null)}
        wide
      >
        {editingContact && (
          <ContactForm
            customerId={customerId}
            contact={editingContact}
            contacts={contactsQ.data ?? []}
            onDone={() => setEditingContact(null)}
          />
        )}
      </Modal>

      <Modal
        title={t("customers.deleteContact")}
        open={!!deletingContact}
        onClose={() => setDeletingContact(null)}
      >
        {deletingContact && (
          <>
            <p className="text-sm text-ink-2">
              {t("customers.deleteContactConfirm", { name: deletingContact.name })}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeletingContact(null)}>
                {t("action.cancel")}
              </Button>
              <Button
                variant="danger"
                onClick={() => removeContact.mutate(deletingContact.id)}
                loading={removeContact.isPending}
              >
                {t("customers.deleteContact")}
              </Button>
            </div>
          </>
        )}
      </Modal>

      <Modal
        title={t("customers.attachVehicle")}
        open={attaching}
        onClose={() => setAttaching(false)}
      >
        {attaching && (
          <AttachVehicleForm customerId={customerId} onDone={() => setAttaching(false)} />
        )}
      </Modal>

      <Modal
        title={t("customers.detachVehicle")}
        open={!!detaching}
        onClose={() => setDetaching(null)}
      >
        {detaching && (
          <>
            <p className="text-sm text-ink-2">
              {t("customers.detachConfirm", {
                vehicle: detaching.name,
                customer: customer.name,
              })}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDetaching(null)}>
                {t("action.cancel")}
              </Button>
              <Button
                variant="danger"
                onClick={() => detach.mutate(detaching.id)}
                loading={detach.isPending}
              >
                {t("customers.detachVehicle")}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
