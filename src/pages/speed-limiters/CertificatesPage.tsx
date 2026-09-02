import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, format } from "date-fns";
import {
  Ban, Check, Copy, FileText, Printer, Receipt, RefreshCw, Settings, ShieldCheck, Trash2,
} from "lucide-react";
import {
  countRows, deleteRow, listPage, listRows, sanitizeSearch, updateRow, wrapDbError,
} from "../../lib/db";
import { supabase } from "../../lib/supabase";
import { formatDate } from "../../lib/format";
import {
  certificateBucket, certificateStatusMeta, type CertificateBucket,
} from "../../lib/certificateStatus";
import {
  BILLING_FILTER_STATES, certificateBillingMeta, certificateBillingState, certificateTrackingLink,
  parseBillingFilter, type BillingFilter, type CertificateDocumentKind, type InvoiceableCertificate,
} from "../../lib/certificateBilling";
import type {
  Customer,
  SlSettings,
  SlTechnician,
  SpeedLimiterCertificate,
  Vehicle,
} from "../../lib/types";
import { useAuth } from "../../context/AuthContext";
import { useModules } from "../../context/ModulesContext";
import { useT, type MessageKey, type Translate } from "../../i18n";
import {
  Badge, Button, EmptyState, ErrorState, Field, Input, LoadingState, Modal, PageHeader, Pagination,
  Textarea,
} from "../../components/ui";
import { Combobox } from "../../components/Combobox";
import { useTechnicianPicker } from "../../lib/pickers";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import {
  RenewCertificateModal, defaultRenewalDates, renewCertificate,
  resolveDefaultTechnicianName, useActiveTechnicians,
} from "./RenewCertificateModal";
import { CertificateDocumentModal, useCertificateTracking } from "./CertificateDocumentModal";

type CertRow = SpeedLimiterCertificate & {
  vehicles: Pick<Vehicle, "name" | "license_plate" | "chassis_number" | "vin"> | null;
  customers: Pick<Customer, "name"> | null;
};

/** Just enough of the replacement certificate to label and link to it. */
type SuccessorRow = Pick<
  SpeedLimiterCertificate,
  "id" | "certificate_number" | "status" | "superseded_by"
>;

type FilterId =
  | "all" | "valid" | "d30" | "d60" | "d90" | "expired" | "revoked" | "superseded";

const PAGE_SIZE = 25;

/**
 * Vehicle ids folded into the certificate search. PostgREST cannot OR across
 * an embedded resource and its parent, so matching a plate means looking the
 * vehicles up first and passing their ids down — bounded, because the ids
 * travel in the query string.
 */
const VEHICLE_MATCH_CAP = 100;

const FILTERS: { id: FilterId; labelKey: MessageKey }[] = [
  { id: "all", labelKey: "slCertificates.filterAll" },
  { id: "valid", labelKey: "slCertificates.filterValid" },
  { id: "d30", labelKey: "slCertificates.filter30" },
  { id: "d60", labelKey: "slCertificates.filter60" },
  { id: "d90", labelKey: "slCertificates.filter90" },
  { id: "expired", labelKey: "slCertificates.filterExpired" },
  { id: "revoked", labelKey: "slCertificates.filterRevoked" },
  { id: "superseded", labelKey: "slCertificates.filterSuperseded" },
];

const FILTER_IDS = new Set<string>(FILTERS.map((f) => f.id));

/**
 * The second axis, shown with the sales module: where the certificate is in
 * the commercial chain. Composes with the expiry chips and the search because
 * it filters server-side on the `billing_state` computed column
 * (…_certificate_billing.sql), so "expiring AND not quoted" is one query —
 * which is the renewal-quote worklist.
 */
const BILLING_FILTERS: { id: BillingFilter; labelKey: MessageKey }[] = [
  { id: "all", labelKey: "slCertificates.billingFilterAll" },
  { id: "unquoted", labelKey: "slCertificates.billingFilterUnquoted" },
  { id: "quoted", labelKey: "slCertificates.billingFilterQuoted" },
  { id: "unbilled", labelKey: "slCertificates.billingFilterUnbilled" },
  { id: "invoiced", labelKey: "slCertificates.billingFilterInvoiced" },
  { id: "paid", labelKey: "slCertificates.billingFilterPaid" },
];

/** The shape the invoice dialog needs, from a list row and its embedded joins. */
function toInvoiceable(c: CertRow): InvoiceableCertificate {
  return {
    id: c.id,
    certificate_number: c.certificate_number,
    customer_id: c.customer_id,
    customer_name: c.customers?.name ?? null,
    vehicle_id: c.vehicle_id,
    vehicle_name: c.vehicles?.name ?? null,
    license_plate: c.vehicles?.license_plate ?? null,
  };
}

/**
 * Filters that look BACKWARD, and therefore read newest-first.
 *
 * The forward-looking chips (valid, ≤30, 31–60, 61–90) are a queue of what is
 * about to lapse, so ascending expiry — soonest first — puts the next job on
 * top. Expired, revoked and superseded are the opposite: they are the tail of
 * a paper register that goes back to 2022, and ascending would open the
 * hundreds-of-rows backlog on its oldest certificate. Whoever follows the
 * overview board's Expired bucket or the context panel's "long overdue" link
 * wants the ones that JUST lapsed — the renewals still worth chasing — so
 * these order descending and page 1 matches the preview those surfaces show.
 */
const BACKWARD_FILTERS = new Set<FilterId>(["expired", "revoked", "superseded"]);

/**
 * Sort rank for the Status column: most urgent first when ascending. The
 * bucket ids sort alphabetically (d30, d60, d90, expired, ok, …), which files
 * the expired rows in the middle of the table; urgency is what a person
 * clicking that header is asking for. Not-actionable states (revoked, then
 * superseded) sink to the bottom.
 */
const BUCKET_URGENCY: Record<CertificateBucket, number> = {
  expired: 0,
  d30: 1,
  d60: 2,
  d90: 3,
  ok: 4,
  revoked: 5,
  superseded: 6,
};

function parseFilter(raw: string | null): FilterId {
  return raw && FILTER_IDS.has(raw) ? (raw as FilterId) : "all";
}

/**
 * The certificate half of the search as one PostgREST `.or()` logic tree: the
 * document's own identifiers, plus the vehicles resolved in step 1 (PostgREST
 * cannot OR a parent column against an embedded resource, so the plate/chassis
 * match arrives as ids). `term` must already be sanitized — %, commas and
 * parentheses are tree syntax.
 */
function searchOr(term: string, vehicleIds: string[]): string {
  const clauses = [
    `certificate_number.ilike.%${term}%`,
    `uin.ilike.%${term}%`,
    `tamper_seal_number.ilike.%${term}%`,
  ];
  if (vehicleIds.length > 0) clauses.push(`vehicle_id.in.(${vehicleIds.join(",")})`);
  return clauses.join(",");
}

function statusBadge(c: CertRow, t: Translate) {
  const { bucket, labelKey, tone, daysLeft } = certificateStatusMeta(c);
  return (
    <Badge tone={tone}>
      {bucket === "d30" || bucket === "d60" || bucket === "d90"
        ? t("slCertificates.expiresInDays", { count: daysLeft })
        : t(labelKey)}
    </Badge>
  );
}

/** A certificate the bulk action refuses to renew, and why. */
type SkipReason = "revoked" | "superseded";

function skipReason(c: CertRow): SkipReason | null {
  if (c.status === "revoked") return "revoked";
  if (c.superseded_by != null) return "superseded";
  return null;
}

const SKIP_LABEL: Record<SkipReason, MessageKey> = {
  revoked: "slCertificates.bulkSkipRevoked",
  superseded: "slCertificates.bulkSkipSuperseded",
};

/** The same refusal, phrased for a single row's disabled Renew icon. */
const RENEW_BLOCKED_LABEL: Record<SkipReason, MessageKey> = {
  revoked: "slCertificates.renewBlockedRevoked",
  superseded: "slCertificates.renewBlockedSuperseded",
};

/**
 * The row's Renew icon, refusing exactly what the bulk action refuses.
 *
 * A revoked certificate and one a later renewal already replaced cannot be
 * renewed; offering a live button for either meant the same certificate was
 * renewable one way and skipped the other. Disabled-with-a-reason rather than
 * hidden (the pattern sales' row actions use): the icon stays where the eye
 * expects it and says why it will not fire, instead of vanishing.
 */
function RenewRowAction({
  cert,
  onRenew,
}: {
  cert: CertRow;
  onRenew: (cert: CertRow) => void;
}) {
  const t = useT();
  const reason = skipReason(cert);
  const label = reason ? t(RENEW_BLOCKED_LABEL[reason]) : t("slCertificates.renew");
  return (
    <button
      type="button"
      onClick={() => onRenew(cert)}
      disabled={reason !== null}
      className="rounded p-1.5 text-ink-3 hover:bg-good-soft hover:text-good disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink-3"
      aria-label={label}
      title={label}
    >
      <RefreshCw className="h-4 w-4" />
    </button>
  );
}

/**
 * Renew a whole selection — the customer who turns up with five vehicles.
 *
 * Certificate numbers come from an RPC that must be called once per
 * certificate, so the run is strictly sequential. It never rolls back: a row
 * that succeeded stays issued, and the summary names every success and every
 * failure rather than reporting one verdict for the batch.
 */
function BulkRenewForm({
  certs,
  validityMonths,
  technicians,
  defaultTechnicianId,
  onDone,
  onBusyChange,
  onInvoice,
}: {
  certs: CertRow[];
  validityMonths: number;
  technicians: SlTechnician[];
  defaultTechnicianId: string | null;
  onDone: () => void;
  /** Reports the in-flight run upward so the dialog can refuse to close. */
  onBusyChange: (busy: boolean) => void;
  /**
   * Bill what was just issued. The renewal IS the work the customer pays
   * for, so the report offers the invoice right where the certificates were
   * made rather than sending the operator to find them again. Absent when
   * the billing module is off.
   */
  onInvoice?: (issued: InvoiceableCertificate[]) => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const eligible = certs.filter((c) => skipReason(c) === null);
  const skipped = certs
    .map((c) => ({ cert: c, reason: skipReason(c) }))
    .filter((s): s is { cert: CertRow; reason: SkipReason } => s.reason !== null);

  const [dates, setDates] = useState(() => defaultRenewalDates(validityMonths));
  const [done, setDone] = useState(0);
  const [results, setResults] = useState<{
    ok: { from: string; to: string; issued: InvoiceableCertificate }[];
    failed: { from: string; message: string }[];
  } | null>(null);

  const run = useMutation({
    mutationFn: async () => {
      const ok: { from: string; to: string; issued: InvoiceableCertificate }[] = [];
      const failed: { from: string; message: string }[] = [];
      for (const cert of eligible) {
        try {
          const created = await renewCertificate(cert, {
            issuing_authority: cert.issuing_authority,
            set_speed_kmh: cert.set_speed_kmh,
            set_speed_secondary_kmh: cert.set_speed_secondary_kmh,
            issued_at: dates.issued_at,
            expires_at: dates.expires_at,
            // Bulk has no per-row picker, so each renewal keeps the name its
            // predecessor carried and falls back to the configured default.
            technician_name:
              resolveDefaultTechnicianName(
                technicians,
                defaultTechnicianId,
                cert.technician_name,
              ) || null,
          });
          ok.push({
            from: cert.certificate_number,
            to: created.certificate_number,
            // The new certificate, shaped for the invoice dialog: its own id
            // and number, the vehicle and customer carried over from the row
            // it replaced (renewal copies both forward).
            issued: {
              ...toInvoiceable(cert),
              id: created.id,
              certificate_number: created.certificate_number,
            },
          });
        } catch (err) {
          failed.push({
            from: cert.certificate_number,
            message: err instanceof Error ? err.message : t("slCertificates.renewFailed"),
          });
        }
        setDone((n) => n + 1);
      }
      return { ok, failed };
    },
    // Whatever happened, some certificates may now exist: refresh regardless.
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["speed_limiter_certificates"] });
      // The RPC advanced cert_next_number, once per issued certificate.
      void qc.invalidateQueries({ queryKey: ["sl_settings"] });
    },
    onSuccess: (r) => setResults(r),
  });

  // The run issues real certificates one at a time and only has a report to
  // show once the loop ends. Dismissing the dialog mid-run would let the rest
  // of the writes land — numbers burned from the tenant sequence — with no
  // record of which ones succeeded, so the dialog is held shut while it runs.
  const busy = run.isPending;
  useEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);

  if (results) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-ink-2">
          {results.failed.length === 0
            ? t("slCertificates.bulkDoneAll", { count: results.ok.length })
            : t("slCertificates.bulkDonePartial", {
                done: results.ok.length,
                total: results.ok.length + results.failed.length,
                failed: results.failed.length,
              })}
        </p>
        {results.ok.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-3">
              {t("slCertificates.bulkSucceeded")}
            </h3>
            <ul className="mt-1 space-y-0.5 text-sm text-ink-2">
              {results.ok.map((r) => (
                <li key={r.from}>
                  {t("speedLimiters.certStatus.supersededBy", { number: r.to })} — {r.from}
                </li>
              ))}
            </ul>
          </div>
        )}
        {results.failed.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-3">
              {t("slCertificates.bulkFailed")}
            </h3>
            <ul className="mt-1 space-y-0.5 text-sm text-serious">
              {results.failed.map((r) => (
                <li key={r.from}>
                  <span className="font-medium">{r.from}</span> — {r.message}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          {onInvoice && results.ok.length > 0 && (
            <Button
              variant="secondary"
              onClick={() => onInvoice(results.ok.map((r) => r.issued))}
            >
              <Receipt className="h-4 w-4" />
              {t("slCertificates.invoiceAfterRenew", { count: results.ok.length })}
            </Button>
          )}
          <Button onClick={onDone}>{t("action.close")}</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-ink-2">
          {t("slCertificates.bulkRenewLead", { count: eligible.length })}
        </p>
        <p className="mt-1 text-xs text-ink-3">{t("slCertificates.renewNumberHint")}</p>
      </div>

      {eligible.length > 0 && (
        <div className="rounded-lg bg-canvas p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-3">
            {t("slCertificates.bulkEligible", { count: eligible.length })}
          </h3>
          <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto text-sm text-ink-2">
            {eligible.map((c) => (
              <li key={c.id} className="flex justify-between gap-4">
                <span className="font-medium text-ink">{c.certificate_number}</span>
                {/* A plate like "5637 RA" is digits + Latin letters: inside the
                    RTL paragraph the bidi algorithm would reorder it to
                    "RA 5637". <bdi> isolates it, so the operator confirming a
                    renewal reads the plate exactly as the register prints it. */}
                <span className="text-end text-ink-3">
                  <bdi>{c.vehicles?.license_plate ?? c.vehicles?.name ?? t("common.dash")}</bdi>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {skipped.length > 0 && (
        <div className="rounded-lg bg-canvas p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-3">
            {t("slCertificates.bulkSkipped", { count: skipped.length })}
          </h3>
          <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto text-sm text-ink-2">
            {skipped.map(({ cert, reason }) => (
              <li key={cert.id} className="flex justify-between gap-4">
                <span className="font-medium text-ink">{cert.certificate_number}</span>
                <span className="text-end text-ink-3">{t(SKIP_LABEL[reason])}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {eligible.length === 0 ? (
        <>
          <ErrorState message={t("slCertificates.bulkNoneEligible")} />
          <div className="flex justify-end">
            <Button variant="secondary" onClick={onDone}>{t("action.close")}</Button>
          </div>
        </>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("slCertificates.issuedAt")} required>
              <Input
                type="date" required
                value={dates.issued_at}
                onChange={(e) => setDates((d) => ({ ...d, issued_at: e.target.value }))}
              />
            </Field>
            <Field label={t("slCertificates.expiresAt")} required>
              <Input
                type="date" required
                value={dates.expires_at}
                onChange={(e) => setDates((d) => ({ ...d, expires_at: e.target.value }))}
              />
            </Field>
          </div>
          {run.isPending && (
            <p className="text-sm text-ink-2 tabular-nums" role="status" aria-live="polite">
              {t("slCertificates.bulkProgress", {
                done: Math.min(done + 1, eligible.length),
                total: eligible.length,
              })}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onDone} disabled={run.isPending}>
              {t("action.cancel")}
            </Button>
            <Button onClick={() => run.mutate()} loading={run.isPending}>
              {t("slCertificates.bulkConfirm", { count: eligible.length })}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function RevokeForm({ cert, onDone }: { cert: CertRow; onDone: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      updateRow<SpeedLimiterCertificate>("speed_limiter_certificates", cert.id, {
        status: "revoked",
        revoked_at: new Date().toISOString(),
        revoked_reason: reason.trim(),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["speed_limiter_certificates"] });
      onDone();
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("slCertificates.revokeFailed")),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    mutation.mutate();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && <ErrorState message={error} />}
      <p className="text-sm text-ink-2">
        {t("slCertificates.revokeLead", { number: cert.certificate_number })}
      </p>
      <Field label={t("slCertificates.revokeReason")} required>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} required />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>{t("action.cancel")}</Button>
        <Button type="submit" variant="danger" loading={mutation.isPending}>
          {t("slCertificates.revokeConfirm")}
        </Button>
      </div>
    </form>
  );
}

function SettingsForm({ settings, onDone }: { settings: SlSettings; onDone: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    cert_prefix: settings.cert_prefix,
    cert_validity_months: String(settings.cert_validity_months),
    default_technician_id: settings.default_technician_id ?? "",
  });
  const technicianPicker = useTechnicianPicker(form.default_technician_id);
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      // sl_settings has tenant_id as its primary key, so update by tenant_id
      // rather than the id-based updateRow helper. RLS scopes the row.
      const { error: updateError } = await supabase
        .from("sl_settings")
        .update({
          cert_prefix: form.cert_prefix.trim(),
          cert_validity_months: Number(form.cert_validity_months),
          default_technician_id: form.default_technician_id || null,
        })
        .eq("tenant_id", settings.tenant_id);
      if (updateError) throw wrapDbError(updateError);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["sl_settings"] });
      onDone();
    },
    onError: (err) =>
      setError(err instanceof Error ? err.message : t("slCertificates.settingsSaveFailed")),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    mutation.mutate();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && <ErrorState message={error} />}
      <Field label={t("slCertificates.certPrefix")} hint={t("slCertificates.certPrefixHint")} required>
        <Input
          value={form.cert_prefix}
          onChange={(e) => setForm((f) => ({ ...f, cert_prefix: e.target.value }))}
          required
        />
      </Field>
      <Field label={t("slCertificates.validityMonths")} hint={t("slCertificates.validityHint")} required>
        <Input
          type="number" min={1} step="1" required
          value={form.cert_validity_months}
          onChange={(e) => setForm((f) => ({ ...f, cert_validity_months: e.target.value }))}
        />
      </Field>
      <Field
        label={t("slCertificates.defaultTechnician")}
        hint={t("slCertificates.defaultTechnicianHint")}
      >
        <Combobox
          {...technicianPicker}
          value={form.default_technician_id}
          onChange={(v) => setForm((f) => ({ ...f, default_technician_id: v }))}
          placeholder={t("slCertificates.defaultTechnicianNone")}
        />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>{t("action.cancel")}</Button>
        <Button type="submit" loading={mutation.isPending}>{t("action.saveChanges")}</Button>
      </div>
    </form>
  );
}

export default function CertificatesPage() {
  const t = useT();
  const { isManager, isAdmin } = useAuth();
  const { isEnabled } = useModules();
  // Quotes come with sales, invoices with billing (which requires sales).
  const salesOn = isEnabled("sales");
  const billingOn = salesOn && isEnabled("billing");
  const qc = useQueryClient();

  // Filter, search and page live in the URL: /speed-limiters/certificates?filter=d30
  // is a shareable "these are due" link, the state survives a refresh, and the
  // back button walks the filters the way a user expects. `page` is 1-based in
  // the URL (a human reads it) and 0-based everywhere else.
  const [params, setParams] = useSearchParams();
  const filter = parseFilter(params.get("filter"));
  // Only meaningful with sales on; a stale ?billing= in a shared link is
  // ignored rather than filtering on a column nobody can see.
  const billing: BillingFilter = salesOn ? parseBillingFilter(params.get("billing")) : "all";
  const search = params.get("q") ?? "";
  const pageParam = Number(params.get("page"));
  const page = Number.isFinite(pageParam) && pageParam >= 2 ? Math.floor(pageParam) - 1 : 0;

  /** Narrowing the result set always returns to page 1 — in one navigation, so
   *  the list never fires a query for a page the new filter cannot have. */
  function patchParams(
    next: { filter?: FilterId; billing?: BillingFilter; q?: string; page?: number },
    replace: boolean,
  ) {
    const p = new URLSearchParams(params);
    if (next.filter !== undefined) {
      if (next.filter === "all") p.delete("filter");
      else p.set("filter", next.filter);
      p.delete("page");
    }
    if (next.billing !== undefined) {
      if (next.billing === "all") p.delete("billing");
      else p.set("billing", next.billing);
      p.delete("page");
    }
    if (next.q !== undefined) {
      if (next.q === "") p.delete("q");
      else p.set("q", next.q);
      p.delete("page");
    }
    if (next.page !== undefined) {
      if (next.page <= 0) p.delete("page");
      else p.set("page", String(next.page + 1));
    }
    setParams(p, { replace });
  }

  const [renewingId, setRenewingId] = useState<string | null>(null);
  const [renewingHint, setRenewingHint] = useState<CertRow | null>(null);
  const [bulkRenewing, setBulkRenewing] = useState<CertRow[] | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  /** Which document is being raised from a selection, and for what. */
  const [raising, setRaising] = useState<{
    kind: CertificateDocumentKind;
    certs: InvoiceableCertificate[];
  } | null>(null);
  const [revoking, setRevoking] = useState<CertRow | null>(null);
  const [deleting, setDeleting] = useState<CertRow | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");

  // % , ( ) are .or() logic-tree syntax, not search text.
  const term = sanitizeSearch(search);

  // Step 1 of the search: which vehicles match? Own columns only, capped.
  const vehicleMatch = useQuery({
    queryKey: ["vehicles", "cert-search", term],
    enabled: term !== "",
    queryFn: () =>
      listPage<Pick<Vehicle, "id">>("vehicles", 0, VEHICLE_MATCH_CAP, (q) =>
        q
          .select("id")
          .or(
            `name.ilike.%${term}%,license_plate.ilike.%${term}%,` +
              `chassis_number.ilike.%${term}%,vin.ilike.%${term}%`,
          )
          .order("name"),
      ),
  });
  const vehicleIds = term === "" ? [] : (vehicleMatch.data?.rows ?? []).map((v) => v.id);
  // More vehicles matched than we can fold into one query string. Say so
  // rather than quietly dropping certificates from the results.
  const vehicleMatchTruncated = (vehicleMatch.data?.total ?? 0) > VEHICLE_MATCH_CAP;
  const searchReady = term === "" || vehicleMatch.isSuccess;

  const { data, isPlaceholderData, error } = useQuery({
    queryKey: ["speed_limiter_certificates", "list", page, filter, billing, term, vehicleIds],
    enabled: searchReady,
    // Typing a plate re-runs a two-step search; keep the previous rows on
    // screen (dimmed) instead of tearing the table down on every keystroke.
    placeholderData: keepPreviousData,
    queryFn: () =>
      listPage<CertRow>("speed_limiter_certificates", page, PAGE_SIZE, (q) => {
        let query = q
          .select("*, vehicles(name, license_plate, chassis_number, vin), customers(name)")
          // Forward-looking filters read soonest-first; the backward-looking
          // ones read most-recently-lapsed first. See BACKWARD_FILTERS.
          .order("expires_at", { ascending: !BACKWARD_FILTERS.has(filter) });
        // Server-side equivalents of certificateBucket (certificateDaysLeft
        // counts whole days from today, so date-only boundaries line up).
        // "live" — the one certificate a vehicle currently carries — is
        // superseded_by IS NULL AND status = 'valid'; supersession and
        // revocation are separate axes and are never folded together.
        const day = (offset: number) => format(addDays(new Date(), offset), "yyyy-MM-dd");
        const live = (f: typeof query) => f.is("superseded_by", null).eq("status", "valid");
        if (filter === "superseded") query = query.not("superseded_by", "is", null);
        else if (filter === "revoked") query = query.eq("status", "revoked");
        else if (filter === "valid") query = live(query).gte("expires_at", day(0));
        else if (filter === "expired") query = live(query).lt("expires_at", day(0));
        else if (filter === "d30")
          query = live(query).gte("expires_at", day(0)).lte("expires_at", day(30));
        else if (filter === "d60")
          query = live(query).gte("expires_at", day(31)).lte("expires_at", day(60));
        else if (filter === "d90")
          query = live(query).gte("expires_at", day(61)).lte("expires_at", day(90));
        // "All" is every certificate the fleet currently holds: the 15
        // superseded predecessors are history and have their own chip.
        else query = query.is("superseded_by", null);
        // Billing is a computed column, so "not invoiced" composes with the
        // expiry chips and the search instead of needing a list of its own.
        if (billing !== "all") query = query.in("billing_state", BILLING_FILTER_STATES[billing]);
        if (term) query = query.or(searchOr(term, vehicleIds));
        return query;
      }),
  });
  const certs = data?.rows ?? [];
  const total = data?.total ?? 0;
  const hasFilters = filter !== "all" || billing !== "all" || term !== "";

  // A technician typing an old certificate number finds nothing, because the
  // default view hides the predecessors a renewal replaced. Rather than let
  // that read as "we have no record of it", count the superseded matches and
  // point at them. Head-only, and only when the visible search came up empty.
  const { data: supersededMatches } = useQuery({
    queryKey: ["speed_limiter_certificates", "superseded-match", term, vehicleIds],
    enabled: filter === "all" && term !== "" && data !== undefined && total === 0,
    queryFn: () =>
      countRows("speed_limiter_certificates", (q) =>
        q.not("superseded_by", "is", null).or(searchOr(term, vehicleIds)),
      ),
  });

  // The replacement certificates for whatever superseded rows this page shows
  // — bounded by the page size, so it stays one small keyed lookup.
  const successorIds = certs
    .map((c) => c.superseded_by)
    .filter((id): id is string => id != null);
  const { data: successorRows } = useQuery({
    queryKey: ["speed_limiter_certificates", "successors", successorIds],
    enabled: successorIds.length > 0,
    queryFn: () =>
      listRows<SuccessorRow>("speed_limiter_certificates", (q) =>
        q.select("id, certificate_number, status, superseded_by").in("id", successorIds),
      ),
  });
  const successors = new Map((successorRows ?? []).map((s) => [s.id, s]));

  // The quote, order and invoice behind each certificate on this page — two
  // keyed lookups bounded by the page size, through the same definitions the
  // database's guard and reports use (src/lib/certificateBilling.ts).
  const { tracking } = useCertificateTracking(
    certs.map((c) => c.id),
    salesOn,
  );
  const stateOf = (c: CertRow) =>
    certificateBillingState(tracking.invoices.get(c.id), tracking.quotes.get(c.id));

  const { data: settingsRows } = useQuery({
    queryKey: ["sl_settings"],
    queryFn: () => listRows<SlSettings>("sl_settings"),
  });
  const settings = settingsRows?.[0] ?? null;
  const validityMonths = settings?.cert_validity_months ?? 12;
  // Offered in the bulk dialog; the single-certificate modal loads its own.
  const technicians = useActiveTechnicians();

  const remove = useMutation({
    mutationFn: (id: string) => deleteRow("speed_limiter_certificates", id),
    onSuccess: () => {
      setActionError("");
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: ["speed_limiter_certificates"] });
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : t("slCertificates.deleteFailed"));
      setDeleting(null);
    },
  });

  function copyVerifyLink(id: string) {
    void navigator.clipboard.writeText(`${location.origin}/verify?c=${id}`);
    setCopiedId(id);
    window.setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 2000);
  }

  function openRenew(cert: CertRow) {
    setRenewingHint(cert);
    setRenewingId(cert.id);
  }

  /** A link that lands on the successor whichever list it lives in. */
  function successorHref(s: SuccessorRow) {
    const target: FilterId = s.superseded_by != null ? "superseded" : "all";
    const p = new URLSearchParams({ q: s.certificate_number });
    if (target !== "all") p.set("filter", target);
    return `/speed-limiters/certificates?${p.toString()}`;
  }

  const columns: Array<DataTableColumn<CertRow>> = [
    {
      id: "number",
      header: t("slCertificates.number"),
      cell: (c) => {
        const successor = c.superseded_by ? successors.get(c.superseded_by) : undefined;
        return (
          <>
            <div className="font-medium text-ink">{c.certificate_number}</div>
            {c.issuing_authority && (
              <div className="text-xs text-ink-3">{c.issuing_authority}</div>
            )}
            {successor && (
              <Link
                to={successorHref(successor)}
                className="text-xs font-medium text-brand-700 hover:underline"
              >
                {t("speedLimiters.certStatus.supersededBy", {
                  number: successor.certificate_number,
                })}
              </Link>
            )}
          </>
        );
      },
      sortValue: (c) => c.certificate_number,
    },
    {
      id: "customer",
      header: t("slCertificates.customer"),
      cell: (c) => <span className="text-ink-2">{c.customers?.name ?? t("common.dash")}</span>,
      sortValue: (c) => c.customers?.name ?? null,
      minBreakpoint: "md",
    },
    {
      id: "vehicle",
      header: t("slCertificates.vehicle"),
      cell: (c) => (
        <>
          <div className="text-ink-2">{c.vehicles?.name ?? t("common.dash")}</div>
          {c.vehicles?.license_plate && (
            <div className="text-xs text-ink-3"><bdi>{c.vehicles.license_plate}</bdi></div>
          )}
        </>
      ),
      sortValue: (c) => c.vehicles?.name ?? null,
    },
    {
      id: "issued",
      header: t("slCertificates.issued"),
      cell: (c) => <span className="text-ink-2">{formatDate(c.issued_at)}</span>,
      sortValue: (c) => c.issued_at,
      minBreakpoint: "lg",
    },
    {
      id: "expires",
      header: t("slCertificates.expires"),
      cell: (c) => <span className="text-ink-2">{formatDate(c.expires_at)}</span>,
      sortValue: (c) => c.expires_at,
    },
    {
      id: "status",
      header: t("common.status"),
      cell: (c) => statusBadge(c, t),
      sortValue: (c) => BUCKET_URGENCY[certificateBucket(c)],
      exportValue: (c) => t(certificateStatusMeta(c).labelKey),
    },
    ...(salesOn
      ? [
          {
            id: "billing",
            header: t("slCertificates.billing"),
            minBreakpoint: "md",
            cell: (c) => {
              const meta = certificateBillingMeta[stateOf(c)];
              const link = certificateTrackingLink(
                tracking.invoices.get(c.id),
                tracking.quotes.get(c.id),
              );
              return (
                <div className="flex flex-col items-start gap-0.5">
                  <Badge tone={meta.tone}>{t(meta.labelKey)}</Badge>
                  {link && (
                    <Link
                      to={link.to}
                      className="text-xs font-medium text-brand-700 hover:underline tabular-nums"
                      title={t("slCertificates.openDocument", { number: link.number })}
                    >
                      {link.number}
                    </Link>
                  )}
                </div>
              );
            },
            sortValue: (c) => t(certificateBillingMeta[stateOf(c)].labelKey),
          } satisfies DataTableColumn<CertRow>,
        ]
      : []),
    {
      id: "actions",
      header: t("common.actions"),
      align: "end",
      cell: (c) =>
        isManager && (
          <div className="flex justify-end gap-1">
            <Link
              to={`/speed-limiters/certificates/${c.id}/print`}
              className="rounded p-1.5 text-ink-3 hover:bg-canvas hover:text-ink-2"
              aria-label={t("slCertificates.print")}
              title={t("slCertificates.print")}
            >
              <Printer className="h-4 w-4" />
            </Link>
            <button
              onClick={() => copyVerifyLink(c.id)}
              className={
                copiedId === c.id
                  ? "rounded p-1.5 text-good"
                  : "rounded p-1.5 text-ink-3 hover:bg-canvas hover:text-ink-2"
              }
              aria-label={
                copiedId === c.id
                  ? t("slCertificates.linkCopied")
                  : t("slCertificates.copyVerifyLink")
              }
              title={
                copiedId === c.id
                  ? t("slCertificates.linkCopied")
                  : t("slCertificates.copyVerifyLink")
              }
            >
              {copiedId === c.id ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </button>
            <RenewRowAction cert={c} onRenew={openRenew} />
            {c.status !== "revoked" && (
              <button
                onClick={() => setRevoking(c)}
                className="rounded p-1.5 text-ink-3 hover:bg-serious-soft hover:text-serious"
                aria-label={t("slCertificates.revoke")}
                title={t("slCertificates.revoke")}
              >
                <Ban className="h-4 w-4" />
              </button>
            )}
            {isAdmin && (
              <button
                onClick={() => setDeleting(c)}
                className="rounded p-1.5 text-ink-3 hover:bg-serious-soft hover:text-serious"
                aria-label={t("action.delete")}
                title={t("action.delete")}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        ),
    },
  ];

  const listError = (vehicleMatch.error ?? error) as Error | null;
  // Only the very first load has nothing to show; every later one keeps the
  // previous page visible while the new one arrives.
  const listLoading = !listError && data === undefined;
  const listStale = isPlaceholderData || (term !== "" && !searchReady);

  return (
    <>
      <PageHeader
        title={t("slCertificates.title")}
        description={t("slCertificates.description")}
        actions={
          isAdmin && (
            <Button variant="secondary" onClick={() => setSettingsOpen(true)} disabled={!settings}>
              <Settings className="h-4 w-4" /> {t("slCertificates.settings")}
            </Button>
          )
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => patchParams({ filter: f.id }, false)}
              aria-pressed={filter === f.id}
              className={
                filter === f.id
                  ? "rounded-full bg-brand-600 px-3 py-1 text-xs font-medium text-white"
                  : "rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-ink-2 hover:bg-canvas"
              }
            >
              {t(f.labelKey)}
            </button>
          ))}
        </div>
        <div className="ms-auto w-full sm:w-72">
          <Input
            value={search}
            onChange={(e) => patchParams({ q: e.target.value }, true)}
            placeholder={t("slCertificates.searchPlaceholder")}
          />
        </div>
      </div>

      {salesOn && (
        <div className="mb-4 flex flex-wrap items-center gap-1.5" aria-label={t("slCertificates.billing")}>
          {BILLING_FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => patchParams({ billing: f.id }, false)}
              aria-pressed={billing === f.id}
              className={
                billing === f.id
                  ? "rounded-full bg-brand-600 px-3 py-1 text-xs font-medium text-white"
                  : "rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-ink-2 hover:bg-canvas"
              }
            >
              {t(f.labelKey)}
            </button>
          ))}
        </div>
      )}

      {vehicleMatchTruncated && (
        <div className="mb-4 rounded-xl border border-warn/30 bg-warn-soft px-3 py-2 text-sm text-warn">
          {t("slCertificates.searchNarrowHint", { count: VEHICLE_MATCH_CAP })}
        </div>
      )}

      {(supersededMatches ?? 0) > 0 && (
        <div className="mb-4 rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-ink-2">
          {t("slCertificates.searchSupersededHint", { count: supersededMatches ?? 0 })}{" "}
          <Link
            to={`/speed-limiters/certificates?filter=superseded&q=${encodeURIComponent(search)}`}
            className="font-medium text-brand-700 hover:underline"
          >
            {t("slCertificates.searchSupersededLink")}
          </Link>
        </div>
      )}

      {listLoading && <LoadingState />}
      {listError && <ErrorState message={listError.message} />}
      {actionError && (
        <div className="mb-4">
          <ErrorState message={actionError} />
        </div>
      )}

      {!listLoading && !listError && (
        <div
          className={`transition-opacity ${listStale ? "opacity-60" : ""}`}
          aria-busy={listStale}
        >
          <DataTable<CertRow>
            tableId="sl_certificates"
            exportName="sl_certificates"
            columns={columns}
            rows={certs}
            rowKey={(c) => c.id}
            selectable={isManager}
            bulkActions={(selected) => (
              <>
                <Button onClick={() => setBulkRenewing(selected)}>
                  <RefreshCw className="h-4 w-4" />
                  {t("slCertificates.bulkRenew")}
                </Button>
                {salesOn && (
                  <Button
                    variant="secondary"
                    onClick={() =>
                      setRaising({ kind: "quote", certs: selected.map(toInvoiceable) })
                    }
                  >
                    <FileText className="h-4 w-4" />
                    {t("slCertificates.createQuote")}
                  </Button>
                )}
                {billingOn && (
                  <Button
                    variant="secondary"
                    onClick={() =>
                      setRaising({ kind: "invoice", certs: selected.map(toInvoiceable) })
                    }
                  >
                    <Receipt className="h-4 w-4" />
                    {t("slCertificates.createInvoice")}
                  </Button>
                )}
              </>
            )}
            empty={
              <EmptyState
                icon={<ShieldCheck className="h-10 w-10" />}
                title={
                  hasFilters || total > 0
                    ? t("slCertificates.emptyFilteredTitle")
                    : t("slCertificates.emptyTitle")
                }
                description={
                  hasFilters || total > 0
                    ? t("slCertificates.emptyFilteredDesc")
                    : t("slCertificates.emptyDesc")
                }
              />
            }
            footer={
              <Pagination
                page={page}
                pageSize={PAGE_SIZE}
                total={total}
                onPage={(n) => patchParams({ page: n }, false)}
              />
            }
          />
        </div>
      )}

      <RenewCertificateModal
        certificateId={renewingId}
        cert={renewingHint}
        validityMonths={validityMonths}
        onClose={() => setRenewingId(null)}
      />

      <Modal
        title={t("slCertificates.bulkRenewTitle", { count: bulkRenewing?.length ?? 0 })}
        open={!!bulkRenewing}
        onClose={() => setBulkRenewing(null)}
        busy={bulkBusy}
        busyTitle={t("slCertificates.bulkCloseBlocked")}
        wide
      >
        {bulkRenewing && (
          <BulkRenewForm
            certs={bulkRenewing}
            validityMonths={validityMonths}
            technicians={technicians.data ?? []}
            defaultTechnicianId={settings?.default_technician_id ?? null}
            onDone={() => setBulkRenewing(null)}
            onBusyChange={setBulkBusy}
            onInvoice={
              billingOn
                ? (issued) => {
                    setBulkRenewing(null);
                    setRaising({ kind: "invoice", certs: issued });
                  }
                : undefined
            }
          />
        )}
      </Modal>

      <CertificateDocumentModal
        kind={raising?.kind ?? "invoice"}
        certificates={raising?.certs ?? null}
        onClose={() => setRaising(null)}
      />

      <Modal title={t("slCertificates.revokeTitle")} open={!!revoking} onClose={() => setRevoking(null)}>
        {revoking && <RevokeForm cert={revoking} onDone={() => setRevoking(null)} />}
      </Modal>

      <Modal title={t("slCertificates.deleteTitle")} open={!!deleting} onClose={() => setDeleting(null)}>
        {deleting && (
          <>
            <p className="text-sm text-ink-2">
              {t("slCertificates.deleteConfirm", { number: deleting.certificate_number })}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeleting(null)}>{t("action.cancel")}</Button>
              <Button
                variant="danger"
                onClick={() => remove.mutate(deleting.id)}
                loading={remove.isPending}
              >
                {t("slCertificates.deleteTitle")}
              </Button>
            </div>
          </>
        )}
      </Modal>

      <Modal title={t("slCertificates.settingsTitle")} open={settingsOpen} onClose={() => setSettingsOpen(false)}>
        {settings && <SettingsForm settings={settings} onDone={() => setSettingsOpen(false)} />}
      </Modal>
    </>
  );
}
