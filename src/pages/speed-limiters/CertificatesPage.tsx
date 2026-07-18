import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addMonths, format } from "date-fns";
import { Ban, Check, Copy, Printer, RefreshCw, Settings, ShieldCheck, Trash2 } from "lucide-react";
import { deleteRow, insertRow, listRows, updateRow } from "../../lib/db";
import { supabase } from "../../lib/supabase";
import { daysUntil, formatDate } from "../../lib/format";
import type { Customer, SlSettings, SpeedLimiterCertificate, Vehicle } from "../../lib/types";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useT, type MessageKey, type Translate } from "../../i18n";
import {
  Badge, Button, EmptyState, ErrorState, Field, Input, LoadingState, Modal, PageHeader, Table, Textarea,
} from "../../components/ui";

type CertRow = SpeedLimiterCertificate & {
  vehicles: Pick<Vehicle, "name" | "license_plate"> | null;
  customers: Pick<Customer, "name"> | null;
};

type Bucket = "revoked" | "expired" | "d30" | "d60" | "d90" | "ok";
type FilterId = "all" | "valid" | "d30" | "d60" | "d90" | "expired" | "revoked";

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

function matchesFilter(bucket: Bucket, filter: FilterId): boolean {
  if (filter === "all") return true;
  if (filter === "valid") return bucket !== "revoked" && bucket !== "expired";
  return bucket === filter;
}

function expiresCell(c: CertRow, t: Translate) {
  const bucket = bucketOf(c);
  if (bucket === "ok") {
    return <span className="text-slate-600">{formatDate(c.expires_at)}</span>;
  }
  const date = <span className="text-xs text-slate-500">{formatDate(c.expires_at)}</span>;
  if (bucket === "revoked") {
    return (
      <div className="flex items-center gap-2">
        <Badge tone="slate">{t("speedLimiters.certStatus.revoked")}</Badge>
        {date}
      </div>
    );
  }
  if (bucket === "expired") {
    return (
      <div className="flex items-center gap-2">
        <Badge tone="red">{t("speedLimiters.certStatus.expired")}</Badge>
        {date}
      </div>
    );
  }
  const tone = bucket === "d30" ? "red" : bucket === "d60" ? "yellow" : "blue";
  return (
    <div className="flex items-center gap-2">
      <Badge tone={tone}>{t("slCertificates.expiresInDays", { count: daysUntil(c.expires_at) })}</Badge>
      {date}
    </div>
  );
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
      if (rpcError) throw new Error(rpcError.message);
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
  const [renewing, setRenewing] = useState<CertRow | null>(null);
  const [revoking, setRevoking] = useState<CertRow | null>(null);
  const [deleting, setDeleting] = useState<CertRow | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");

  const { data: certs, isLoading, error } = useQuery({
    queryKey: ["speed_limiter_certificates"],
    queryFn: () =>
      listRows<CertRow>("speed_limiter_certificates", (q) =>
        q.select("*, vehicles(name, license_plate), customers(name)").order("expires_at"),
      ),
  });

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

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (certs ?? []).filter((c) => {
      if (!matchesFilter(bucketOf(c), filter)) return false;
      if (needle) {
        const hay = [
          c.certificate_number,
          c.customers?.name,
          c.vehicles?.name,
          c.vehicles?.license_plate,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [certs, filter, search]);

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
              onClick={() => setFilter(f.id)}
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
            onChange={(e) => setSearch(e.target.value)}
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

      {!isLoading && !error && filtered.length === 0 && (
        <EmptyState
          icon={<ShieldCheck className="h-10 w-10" />}
          title={certs?.length ? t("slCertificates.emptyFilteredTitle") : t("slCertificates.emptyTitle")}
          description={
            certs?.length ? t("slCertificates.emptyFilteredDesc") : t("slCertificates.emptyDesc")
          }
        />
      )}

      {!isLoading && !error && filtered.length > 0 && (
        <Table
          headers={[
            t("slCertificates.number"),
            t("slCertificates.customer"),
            t("slCertificates.vehicle"),
            t("slCertificates.issued"),
            t("slCertificates.expires"),
            "",
          ]}
        >
          {filtered.map((c) => (
            <tr key={c.id} className="hover:bg-slate-50">
              <td className="px-4 py-3">
                <div className="font-medium text-slate-800">{c.certificate_number}</div>
                {c.issuing_authority && (
                  <div className="text-xs text-slate-500">{c.issuing_authority}</div>
                )}
              </td>
              <td className="px-4 py-3 text-slate-600">{c.customers?.name ?? "—"}</td>
              <td className="px-4 py-3">
                <div className="text-slate-700">{c.vehicles?.name ?? "—"}</div>
                {c.vehicles?.license_plate && (
                  <div className="text-xs text-slate-500">{c.vehicles.license_plate}</div>
                )}
              </td>
              <td className="px-4 py-3 text-slate-600">{formatDate(c.issued_at)}</td>
              <td className="px-4 py-3">{expiresCell(c, t)}</td>
              <td className="px-4 py-3 text-end">
                {isManager && (
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
                )}
              </td>
            </tr>
          ))}
        </Table>
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
