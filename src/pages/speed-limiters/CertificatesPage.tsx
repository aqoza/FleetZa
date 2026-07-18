import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, addMonths, format } from "date-fns";
import { Ban, Check, Copy, Printer, RefreshCw, Settings, ShieldCheck, Trash2 } from "lucide-react";
import { deleteRow, insertRow, listPage, listRows, updateRow, wrapDbError } from "../../lib/db";
import { supabase } from "../../lib/supabase";
import { daysUntil, formatDate } from "../../lib/format";
import type { Customer, SlSettings, SpeedLimiterCertificate, Vehicle } from "../../lib/types";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useT, type MessageKey, type Translate } from "../../i18n";
import {
  Badge, Button, EmptyState, ErrorState, Field, Input, LoadingState, Modal, PageHeader, Pagination,
  Textarea,
} from "../../components/ui";
import { DataTable, type DataTableColumn } from "../../components/DataTable";

type CertRow = SpeedLimiterCertificate & {
  vehicles: Pick<Vehicle, "name" | "license_plate"> | null;
  customers: Pick<Customer, "name"> | null;
};

type Bucket = "revoked" | "expired" | "d30" | "d60" | "d90" | "ok";
type FilterId = "all" | "valid" | "d30" | "d60" | "d90" | "expired" | "revoked";

const PAGE_SIZE = 25;

const FILTERS: { id: FilterId; labelKey: MessageKey }[] = [
  { id: "all", labelKey: "slCertificates.filterAll" },
  { id: "valid", labelKey: "slCertificates.filterValid" },
  { id: "d30", labelKey: "slCertificates.filter30" },
  { id: "d60", labelKey: "slCertificates.filter60" },
  { id: "d90", labelKey: "slCertificates.filter90" },
  { id: "expired", labelKey: "slCertificates.filterExpired" },
  { id: "revoked", labelKey: "slCertificates.filterRevoked" },
];

function bucketOf(c: SpeedLimiterCertificate): Bucket {
  if (c.status === "revoked") return "revoked";
  const days = daysUntil(c.expires_at);
  if (days < 0) return "expired";
  if (days <= 30) return "d30";
  if (days <= 60) return "d60";
  if (days <= 90) return "d90";
  return "ok";
}

function statusLabel(c: CertRow, t: Translate): string {
  const bucket = bucketOf(c);
  if (bucket === "revoked") return t("speedLimiters.certStatus.revoked");
  if (bucket === "expired") return t("speedLimiters.certStatus.expired");
  if (bucket === "ok") return t("speedLimiters.certStatus.valid");
  return t("slCertificates.expiresInDays", { count: daysUntil(c.expires_at) });
}

function statusBadge(c: CertRow, t: Translate) {
  const bucket = bucketOf(c);
  if (bucket === "revoked") return <Badge tone="slate">{statusLabel(c, t)}</Badge>;
  if (bucket === "expired") return <Badge tone="red">{statusLabel(c, t)}</Badge>;
  if (bucket === "ok") return <Badge tone="green">{statusLabel(c, t)}</Badge>;
  const tone = bucket === "d30" ? "red" : bucket === "d60" ? "yellow" : "blue";
  return <Badge tone={tone}>{statusLabel(c, t)}</Badge>;
}

function RenewForm({
  cert,
  validityMonths,
  onDone,
}: {
  cert: CertRow;
  validityMonths: number;
  onDone: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [form, setForm] = useState(() => ({
    issuing_authority: cert.issuing_authority ?? "",
    set_speed_kmh: cert.set_speed_kmh != null ? String(cert.set_speed_kmh) : "",
    issued_at: format(new Date(), "yyyy-MM-dd"),
    expires_at: format(addMonths(new Date(), validityMonths), "yyyy-MM-dd"),
  }));
  const [error, setError] = useState("");

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const mutation = useMutation({
    mutationFn: async () => {
      // Atomic number allocation: call the RPC exactly once, at insert time.
      const { data: certNumber, error: rpcError } = await supabase.rpc("next_certificate_number");
      if (rpcError) throw wrapDbError(rpcError);
      return insertRow<SpeedLimiterCertificate>("speed_limiter_certificates", {
        certificate_number: certNumber as string,
        vehicle_id: cert.vehicle_id,
        customer_id: cert.customer_id,
        device_id: cert.device_id,
        installation_id: cert.installation_id,
        issuing_authority: form.issuing_authority.trim() || null,
        set_speed_kmh: form.set_speed_kmh === "" ? null : Number(form.set_speed_kmh),
        issued_at: form.issued_at,
        expires_at: form.expires_at,
        renewed_from: cert.id,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["speed_limiter_certificates"] });
      // The RPC advanced cert_next_number.
      void qc.invalidateQueries({ queryKey: ["sl_settings"] });
      onDone();
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("slCertificates.renewFailed")),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    mutation.mutate();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && <ErrorState message={error} />}
      <div>
        <p className="text-sm text-slate-600">
          {t("slCertificates.renewLead", { number: cert.certificate_number })}
        </p>
        <p className="mt-1 text-xs text-slate-500">{t("slCertificates.renewNumberHint")}</p>
      </div>
      <div className="rounded-lg bg-slate-50 p-3 text-sm">
        <div className="flex justify-between gap-4 py-0.5">
          <span className="text-slate-500">{t("slCertificates.customer")}</span>
          <span className="text-end font-medium text-slate-800">{cert.customers?.name ?? "—"}</span>
        </div>
        <div className="flex justify-between gap-4 py-0.5">
          <span className="text-slate-500">{t("slCertificates.vehicle")}</span>
          <span className="text-end font-medium text-slate-800">{cert.vehicles?.name ?? "—"}</span>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("slCertificates.issuingAuthority")}>
          <Input
            value={form.issuing_authority}
            onChange={(e) => set("issuing_authority", e.target.value)}
          />
        </Field>
        <Field label={t("slCertificates.setSpeed")}>
          <Input
            type="number" min={0} step="1"
            value={form.set_speed_kmh}
            onChange={(e) => set("set_speed_kmh", e.target.value)}
          />
        </Field>
        <Field label={t("slCertificates.issuedAt")} required>
          <Input
            type="date" required
            value={form.issued_at}
            onChange={(e) => set("issued_at", e.target.value)}
          />
        </Field>
        <Field label={t("slCertificates.expiresAt")} required>
          <Input
            type="date" required
            value={form.expires_at}
            onChange={(e) => set("expires_at", e.target.value)}
          />
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>{t("action.cancel")}</Button>
        <Button type="submit" loading={mutation.isPending}>{t("slCertificates.renewConfirm")}</Button>
      </div>
    </form>
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
      <p className="text-sm text-slate-600">
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
  const tenant = useTenant();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    cert_prefix: settings.cert_prefix,
    cert_validity_months: String(settings.cert_validity_months),
  });
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      // sl_settings has tenant_id as its primary key, so update by tenant_id
      // rather than the id-based updateRow helper.
      const { error: updateError } = await supabase
        .from("sl_settings")
        .update({
          cert_prefix: form.cert_prefix.trim(),
          cert_validity_months: Number(form.cert_validity_months),
        })
        .eq("tenant_id", tenant.id);
      if (updateError) throw new Error(updateError.message);
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
  const qc = useQueryClient();
  const [filter, setFilter] = useState<FilterId>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [renewing, setRenewing] = useState<CertRow | null>(null);
  const [revoking, setRevoking] = useState<CertRow | null>(null);
  const [deleting, setDeleting] = useState<CertRow | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");

  // ilike pattern characters are stripped so user input stays a literal match.
  const searchTerm = search.trim().replace(/[%,]/g, "");

  const { data, isLoading, error } = useQuery({
    queryKey: ["speed_limiter_certificates", "list", page, filter, searchTerm],
    queryFn: () =>
      listPage<CertRow>("speed_limiter_certificates", page, PAGE_SIZE, (q) => {
        let query = q
          .select("*, vehicles(name, license_plate), customers(name)")
          .order("expires_at");
        // Server-side equivalents of bucketOf/matchesFilter (daysUntil counts
        // whole days from today, so date-only boundaries line up).
        const day = (offset: number) => format(addDays(new Date(), offset), "yyyy-MM-dd");
        if (filter === "revoked") query = query.eq("status", "revoked");
        else if (filter === "valid") query = query.neq("status", "revoked").gte("expires_at", day(0));
        else if (filter === "expired") query = query.neq("status", "revoked").lt("expires_at", day(0));
        else if (filter === "d30")
          query = query.neq("status", "revoked").gte("expires_at", day(0)).lte("expires_at", day(30));
        else if (filter === "d60")
          query = query.neq("status", "revoked").gte("expires_at", day(31)).lte("expires_at", day(60));
        else if (filter === "d90")
          query = query.neq("status", "revoked").gte("expires_at", day(61)).lte("expires_at", day(90));
        if (searchTerm) query = query.ilike("certificate_number", `%${searchTerm}%`);
        return query;
      }),
  });
  const certs = data?.rows ?? [];
  const total = data?.total ?? 0;
  const hasFilters = filter !== "all" || searchTerm !== "";

  const { data: settingsRows } = useQuery({
    queryKey: ["sl_settings"],
    queryFn: () => listRows<SlSettings>("sl_settings"),
  });
  const settings = settingsRows?.[0] ?? null;

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

  const columns: Array<DataTableColumn<CertRow>> = [
    {
      id: "number",
      header: t("slCertificates.number"),
      cell: (c) => (
        <>
          <div className="font-medium text-slate-800">{c.certificate_number}</div>
          {c.issuing_authority && (
            <div className="text-xs text-slate-500">{c.issuing_authority}</div>
          )}
        </>
      ),
      sortValue: (c) => c.certificate_number,
    },
    {
      id: "customer",
      header: t("slCertificates.customer"),
      cell: (c) => <span className="text-slate-600">{c.customers?.name ?? "—"}</span>,
      sortValue: (c) => c.customers?.name ?? null,
      minBreakpoint: "md",
    },
    {
      id: "vehicle",
      header: t("slCertificates.vehicle"),
      cell: (c) => (
        <>
          <div className="text-slate-700">{c.vehicles?.name ?? "—"}</div>
          {c.vehicles?.license_plate && (
            <div className="text-xs text-slate-500">{c.vehicles.license_plate}</div>
          )}
        </>
      ),
      sortValue: (c) => c.vehicles?.name ?? null,
    },
    {
      id: "issued",
      header: t("slCertificates.issued"),
      cell: (c) => <span className="text-slate-600">{formatDate(c.issued_at)}</span>,
      sortValue: (c) => c.issued_at,
      minBreakpoint: "lg",
    },
    {
      id: "expires",
      header: t("slCertificates.expires"),
      cell: (c) => <span className="text-slate-600">{formatDate(c.expires_at)}</span>,
      sortValue: (c) => c.expires_at,
    },
    {
      id: "status",
      header: t("common.status"),
      cell: (c) => statusBadge(c, t),
      sortValue: (c) => statusLabel(c, t),
    },
    {
      id: "actions",
      header: t("common.actions"),
      align: "end",
      cell: (c) =>
        isManager && (
          <div className="flex justify-end gap-1">
            <Link
              to={`/speed-limiters/certificates/${c.id}/print`}
              className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              aria-label={t("slCertificates.print")}
              title={t("slCertificates.print")}
            >
              <Printer className="h-4 w-4" />
            </Link>
            <button
              onClick={() => copyVerifyLink(c.id)}
              className={
                copiedId === c.id
                  ? "rounded p-1.5 text-emerald-600"
                  : "rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
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
            <button
              onClick={() => setRenewing(c)}
              className="rounded p-1.5 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600"
              aria-label={t("slCertificates.renew")}
              title={t("slCertificates.renew")}
            >
              <RefreshCw className="h-4 w-4" />
            </button>
            {c.status !== "revoked" && (
              <button
                onClick={() => setRevoking(c)}
                className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                aria-label={t("slCertificates.revoke")}
                title={t("slCertificates.revoke")}
              >
                <Ban className="h-4 w-4" />
              </button>
            )}
            {isAdmin && (
              <button
                onClick={() => setDeleting(c)}
                className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
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
              onClick={() => {
                setFilter(f.id);
                setPage(0);
              }}
              aria-pressed={filter === f.id}
              className={
                filter === f.id
                  ? "rounded-full bg-brand-600 px-3 py-1 text-xs font-medium text-white"
                  : "rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
              }
            >
              {t(f.labelKey)}
            </button>
          ))}
        </div>
        <div className="ms-auto w-full sm:w-72">
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder={t("slCertificates.searchPlaceholder")}
          />
        </div>
      </div>

      {isLoading && <LoadingState />}
      {error && <ErrorState message={(error as Error).message} />}
      {actionError && (
        <div className="mb-4">
          <ErrorState message={actionError} />
        </div>
      )}

      {!isLoading && !error && (
        <DataTable<CertRow>
          tableId="sl_certificates"
          exportName="sl_certificates"
          columns={columns}
          rows={certs}
          rowKey={(c) => c.id}
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
          footer={<Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />}
        />
      )}

      <Modal title={t("slCertificates.renewTitle")} open={!!renewing} onClose={() => setRenewing(null)} wide>
        {renewing && (
          <RenewForm
            cert={renewing}
            validityMonths={settings?.cert_validity_months ?? 12}
            onDone={() => setRenewing(null)}
          />
        )}
      </Modal>

      <Modal title={t("slCertificates.revokeTitle")} open={!!revoking} onClose={() => setRevoking(null)}>
        {revoking && <RevokeForm cert={revoking} onDone={() => setRevoking(null)} />}
      </Modal>

      <Modal title={t("slCertificates.deleteTitle")} open={!!deleting} onClose={() => setDeleting(null)}>
        {deleting && (
          <>
            <p className="text-sm text-slate-600">
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
