/**
 * Renewing a speed limiter certificate — the one implementation.
 *
 * Renewal used to live as a private form inside CertificatesPage, reachable
 * only from a row icon in the certificates list. A customer who turns up with
 * five vehicles is renewed from the vehicle page, the customer page and the
 * list, so the flow lives here and every surface mounts the same component.
 *
 * Two rules the callers must not have to know about, and so are enforced here:
 *
 *  - the certificate number comes from `next_certificate_number()`, called
 *    exactly ONCE per certificate at insert time (it advances a counter, so a
 *    number fetched early and then not used burns a number, and a number
 *    reused across two inserts collides);
 *  - the UIN identifies the fitted limiter, not the document — a renewal
 *    reprints the number the installation already carries, and only derives
 *    one when the limiter has none yet, writing it back so later renewals
 *    reprint it too.
 *
 * Callers typically hold a certificate id and nothing else (a vehicle page has
 * no joined customer name, a bulk action has no form), so the modal takes an
 * id, treats any row it is handed as a render hint, and fetches the joined row
 * it needs itself. `renewCertificate` is exported separately so the list page's
 * bulk action runs the identical write without the chrome.
 */
import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addMonths, format } from "date-fns";
import { insertRow, listRows, updateRow, wrapDbError } from "../../lib/db";
import { supabase } from "../../lib/supabase";
import { resolveUin } from "../../lib/certificate";
import type {
  Customer,
  SlSettings,
  SlTechnician,
  SpeedLimiterCertificate,
  SpeedLimiterInstallation,
  Vehicle,
} from "../../lib/types";
import { useT } from "../../i18n";
import { Button, ErrorState, Field, Input, LoadingState, Modal, Select } from "../../components/ui";

/** The joined shape the renewal write needs: the certificate plus the vehicle's
 *  chassis/VIN (for a derived UIN) and the customer's name (for the summary).
 *  Both joins are optional so a caller can pass a bare row as a render hint. */
export type RenewCertificateSource = SpeedLimiterCertificate & {
  vehicles?: Pick<Vehicle, "name" | "license_plate" | "chassis_number" | "vin"> | null;
  customers?: Pick<Customer, "name"> | null;
};

/** The fields an operator may change on a renewal; everything else is carried
 *  forward from the certificate being replaced. */
export interface RenewCertificateValues {
  issuing_authority: string | null;
  set_speed_kmh: number | null;
  set_speed_secondary_kmh: number | null;
  issued_at: string;
  expires_at: string;
  /**
   * Technician named on the new document. A snapshot of the NAME, not a
   * reference: an issued certificate must not change because staff were
   * renamed or removed later — the same reason limiter_type and
   * tamper_seal_number are copied here rather than joined at print time.
   */
  technician_name: string | null;
}

const SOURCE_SELECT =
  "*, vehicles(name, license_plate, chassis_number, vin), customers(name)";

/** The joined row keyed by id — shared by the modal and any caller that only
 *  holds an id (a bulk action over rows that were selected without joins). */
export async function fetchRenewSource(
  certificateId: string,
): Promise<RenewCertificateSource | null> {
  const rows = await listRows<RenewCertificateSource>(
    "speed_limiter_certificates",
    (q) => q.select(SOURCE_SELECT).eq("id", certificateId).limit(1),
  );
  return rows[0] ?? null;
}

/**
 * Issue the replacement certificate. One call = one certificate = one number,
 * so bulk renewals must await this sequentially rather than Promise.all it.
 *
 * Does NOT invalidate queries — the caller owns that, because a bulk run
 * invalidates once at the end instead of after every row.
 */
export async function renewCertificate(
  cert: RenewCertificateSource,
  values: RenewCertificateValues,
): Promise<SpeedLimiterCertificate> {
  // Atomic number allocation: call the RPC exactly once, at insert time.
  const { data: certNumber, error: rpcError } = await supabase.rpc("next_certificate_number");
  if (rpcError) throw wrapDbError(rpcError);
  // The UIN identifies the fitted limiter, so a renewal reprints the one
  // this installation already carries; it is only derived when the limiter
  // has none yet, and then kept so later renewals reprint it too.
  const uin = resolveUin(
    cert.uin,
    cert.vehicles?.chassis_number ?? cert.vehicles?.vin,
    certNumber as string,
  );
  if (uin && !cert.uin && cert.installation_id) {
    await updateRow<SpeedLimiterInstallation>(
      "speed_limiter_installations",
      cert.installation_id,
      { uin },
    );
  }
  return insertRow<SpeedLimiterCertificate>("speed_limiter_certificates", {
    certificate_number: certNumber as string,
    vehicle_id: cert.vehicle_id,
    customer_id: cert.customer_id,
    device_id: cert.device_id,
    installation_id: cert.installation_id,
    issuing_authority: values.issuing_authority,
    set_speed_kmh: values.set_speed_kmh,
    set_speed_secondary_kmh: values.set_speed_secondary_kmh,
    tamper_seal_number: cert.tamper_seal_number,
    uin,
    limiter_type: cert.limiter_type,
    technician_name: values.technician_name,
    issued_at: values.issued_at,
    expires_at: values.expires_at,
    renewed_from: cert.id,
  });
}

/**
 * The technicians offered when issuing a certificate. Active only — a
 * technician who has left should not be nameable on a new document, though
 * certificates they already signed keep their snapshot.
 */
export function useActiveTechnicians(enabled = true) {
  return useQuery({
    queryKey: ["sl_technicians", "active"],
    enabled,
    queryFn: () =>
      listRows<SlTechnician>("sl_technicians", (q) =>
        q.eq("active", true).order("name", { ascending: true }),
      ),
  });
}

/**
 * Which name to preselect, most specific first: the technician configured as
 * the default, then whoever the certificate being replaced named, then blank.
 *
 * The second step matters for bulk renewals of imported history — without it a
 * renewal would silently drop a name the previous document carried.
 */
export function resolveDefaultTechnicianName(
  technicians: SlTechnician[] | undefined,
  defaultTechnicianId: string | null | undefined,
  previous: string | null | undefined,
): string {
  const configured = defaultTechnicianId
    ? technicians?.find((tech) => tech.id === defaultTechnicianId)?.name
    : undefined;
  return configured ?? previous ?? "";
}

/** Today's date and today + validity, the defaults every renewal starts from. */
export function defaultRenewalDates(validityMonths: number): {
  issued_at: string;
  expires_at: string;
} {
  const today = new Date();
  return {
    issued_at: format(today, "yyyy-MM-dd"),
    expires_at: format(addMonths(today, validityMonths), "yyyy-MM-dd"),
  };
}

function RenewForm({
  cert,
  validityMonths,
  technicians,
  defaultTechnicianId,
  onDone,
  onRenewed,
}: {
  cert: RenewCertificateSource;
  validityMonths: number;
  technicians: SlTechnician[];
  defaultTechnicianId: string | null;
  onDone: () => void;
  onRenewed?: (created: SpeedLimiterCertificate) => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [form, setForm] = useState(() => ({
    issuing_authority: cert.issuing_authority ?? "",
    set_speed_kmh: cert.set_speed_kmh != null ? String(cert.set_speed_kmh) : "",
    set_speed_secondary_kmh:
      cert.set_speed_secondary_kmh != null ? String(cert.set_speed_secondary_kmh) : "",
    // The name, not an id: this is a snapshot of what goes on the document,
    // and it must still round-trip when the previous certificate named someone
    // who is no longer on the active list.
    technician_name: resolveDefaultTechnicianName(
      technicians,
      defaultTechnicianId,
      cert.technician_name,
    ),
    ...defaultRenewalDates(validityMonths),
  }));
  const [error, setError] = useState("");

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const mutation = useMutation({
    mutationFn: () =>
      renewCertificate(cert, {
        issuing_authority: form.issuing_authority.trim() || null,
        set_speed_kmh: form.set_speed_kmh === "" ? null : Number(form.set_speed_kmh),
        set_speed_secondary_kmh:
          form.set_speed_secondary_kmh === "" ? null : Number(form.set_speed_secondary_kmh),
        issued_at: form.issued_at,
        expires_at: form.expires_at,
        technician_name: form.technician_name.trim() || null,
      }),
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: ["speed_limiter_certificates"] });
      // The RPC advanced cert_next_number.
      void qc.invalidateQueries({ queryKey: ["sl_settings"] });
      onRenewed?.(created);
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
        <p className="text-sm text-ink-2">
          {t("slCertificates.renewLead", { number: cert.certificate_number })}
        </p>
        <p className="mt-1 text-xs text-ink-3">{t("slCertificates.renewNumberHint")}</p>
      </div>
      <div className="rounded-lg bg-canvas p-3 text-sm">
        <div className="flex justify-between gap-4 py-0.5">
          <span className="text-ink-3">{t("slCertificates.customer")}</span>
          <span className="text-end font-medium text-ink">
            {cert.customers?.name ?? t("common.dash")}
          </span>
        </div>
        <div className="flex justify-between gap-4 py-0.5">
          <span className="text-ink-3">{t("slCertificates.vehicle")}</span>
          <span className="text-end font-medium text-ink">
            {cert.vehicles?.name ?? t("common.dash")}
          </span>
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
        <Field
          label={t("slCertificates.setSpeedSecondary")}
          hint={t("slCertificates.setSpeedSecondaryHint")}
        >
          <Input
            type="number" min={0} step="1"
            value={form.set_speed_secondary_kmh}
            onChange={(e) => set("set_speed_secondary_kmh", e.target.value)}
          />
        </Field>
        <Field label={t("slCertificates.technician")} hint={t("slCertificates.technicianHint")}>
          <Select
            value={form.technician_name}
            onChange={(e) => set("technician_name", e.target.value)}
          >
            <option value="">{t("slCertificates.technicianNone")}</option>
            {/* A name carried over from the previous certificate that is not on
                the active list still needs to be selectable, or opening the
                dialog would silently blank it. */}
            {form.technician_name !== "" &&
              !technicians.some((tech) => tech.name === form.technician_name) && (
                <option value={form.technician_name}>{form.technician_name}</option>
              )}
            {technicians.map((tech) => (
              <option key={tech.id} value={tech.name}>
                {tech.name}
              </option>
            ))}
          </Select>
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

export interface RenewCertificateModalProps {
  /** Certificate to renew. `null` closes the modal — there is no separate
   *  `open` prop, so the caller keeps a single piece of state. */
  certificateId: string | null;
  /**
   * A row the caller already has, used only as a render hint so the summary
   * appears without a loading flash. The write always uses the joined row this
   * component fetches, so an unjoined hint is safe.
   */
  cert?: RenewCertificateSource | null;
  /** Default validity; read from `sl_settings` when omitted. */
  validityMonths?: number;
  onClose: () => void;
  /** Called with the newly issued certificate, after the caches are invalidated. */
  onRenewed?: (created: SpeedLimiterCertificate) => void;
}

/**
 * The renew dialog, chrome included. Mount it once per page and drive it with
 * the id of the certificate being renewed:
 *
 *   <RenewCertificateModal
 *     certificateId={renewingId}
 *     onClose={() => setRenewingId(null)}
 *   />
 */
export function RenewCertificateModal({
  certificateId,
  cert,
  validityMonths,
  onClose,
  onRenewed,
}: RenewCertificateModalProps) {
  const t = useT();
  const open = certificateId != null;

  // The hint may be a bare row (no joins); the chassis behind a derived UIN
  // only exists on the joined one, so that is what the write runs against.
  const source = useQuery({
    queryKey: ["speed_limiter_certificates", "renew-source", certificateId],
    enabled: open,
    queryFn: () => fetchRenewSource(certificateId!),
  });

  // Always read while open, even when the caller passed validityMonths: the
  // row also carries the default technician. The query key is shared, so a
  // page that already loaded settings pays nothing for this.
  const settings = useQuery({
    queryKey: ["sl_settings"],
    queryFn: () => listRows<SlSettings>("sl_settings"),
    enabled: open,
  });
  const technicians = useActiveTechnicians(open);

  // The form seeds its expiry date once, at mount, so it must not mount before
  // the validity period is known.
  const months =
    validityMonths ?? settings.data?.[0]?.cert_validity_months ?? 12;
  const monthsReady = validityMonths !== undefined || !settings.isLoading;

  const hint = cert && cert.id === certificateId ? cert : null;
  const row = source.data ?? null;
  // The form seeds the technician once at mount too, so wait for the list.
  const loading = source.isLoading || !monthsReady || settings.isLoading || technicians.isLoading;

  return (
    <Modal title={t("slCertificates.renewTitle")} open={open} onClose={onClose} wide>
      {loading && (
        <>
          {hint && (
            <p className="mb-3 text-sm text-ink-2">
              {t("slCertificates.renewLead", { number: hint.certificate_number })}
            </p>
          )}
          <LoadingState />
        </>
      )}
      {!loading && source.error && (
        <ErrorState message={(source.error as Error).message} />
      )}
      {!loading && !source.error && !row && (
        <ErrorState message={t("slCertificates.renewLoadFailed")} />
      )}
      {!loading && row && (
        <RenewForm
          // A fresh form per certificate: the defaults are seeded at mount.
          key={row.id}
          cert={row}
          validityMonths={months}
          technicians={technicians.data ?? []}
          defaultTechnicianId={settings.data?.[0]?.default_technician_id ?? null}
          onDone={onClose}
          onRenewed={onRenewed}
        />
      )}
    </Modal>
  );
}

export default RenewCertificateModal;
