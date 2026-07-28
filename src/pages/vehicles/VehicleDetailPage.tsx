import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Pencil, Printer, RefreshCw, Trash2, UserCheck, Wrench } from "lucide-react";
import { deleteRow, getRow, insertRow, listRows, updateRow } from "../../lib/db";
import { recordRecent } from "../../lib/recent";
import { formatDate, formatDistance, formatMoney } from "../../lib/format";
import { certificateStatusMeta } from "../../lib/certificateStatus";
import { fuelTypes, vehicleStatus, vehicleTypes, workOrderStatus, issueStatus } from "../../lib/labels";
import { useDriverPicker } from "../../lib/pickers";
import type {
  Customer, Driver, FuelLog, Issue, SlJob, SlJobStatus, SlJobType,
  SpeedLimiterCertificate, SpeedLimiterInstallation, Vehicle, VehicleAssignment, WorkOrder,
} from "../../lib/types";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useModules } from "../../context/ModulesContext";
import { useT, type MessageKey } from "../../i18n";
import {
  Badge, Button, Card, ErrorState, Field, LoadingState, Modal, PageHeader,
  type BadgeTone,
} from "../../components/ui";
import { Combobox } from "../../components/Combobox";
import { VehicleForm } from "./VehicleForm";
import { RenewCertificateModal } from "../speed-limiters/RenewCertificateModal";

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

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="text-end font-medium text-slate-800">{value}</span>
    </div>
  );
}

export default function VehicleDetailPage() {
  const t = useT();
  const { id = "" } = useParams();
  const tenant = useTenant();
  const { isManager } = useAuth();
  const { isEnabled } = useModules();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const customersOn = isEnabled("customers");
  const speedLimitersOn = isEnabled("speed_limiters");
  const slCertsOn = speedLimitersOn && isEnabled("sl_certificates");
  const [editing, setEditing] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [selectedDriver, setSelectedDriver] = useState("");
  const [actionError, setActionError] = useState("");
  const [renewingId, setRenewingId] = useState<string | null>(null);

  const { data: vehicle, isLoading } = useQuery({
    queryKey: ["vehicles", id],
    queryFn: () => getRow<Vehicle>("vehicles", id),
  });

  useEffect(() => {
    if (vehicle) recordRecent(vehicle.name, `/vehicles/${vehicle.id}`);
  }, [vehicle]);

  const { data: assignment } = useQuery({
    queryKey: ["assignments", "open", id],
    queryFn: async () => {
      const rows = await listRows<VehicleAssignment & { drivers: Driver }>(
        "vehicle_assignments",
        (q) => q.select("*, drivers(*)").eq("vehicle_id", id).is("ended_at", null).limit(1),
      );
      return rows[0] ?? null;
    },
  });

  const driverPicker = useDriverPicker(selectedDriver, { activeOnly: true });

  const { data: recentFuel } = useQuery({
    queryKey: ["fuel_logs", "vehicle", id],
    queryFn: () =>
      listRows<FuelLog>("fuel_logs", (q) =>
        q.eq("vehicle_id", id).order("filled_at", { ascending: false }).limit(5),
      ),
  });

  const { data: openWork } = useQuery({
    queryKey: ["work_orders", "vehicle", id],
    queryFn: () =>
      listRows<WorkOrder>("work_orders", (q) =>
        q.eq("vehicle_id", id).order("created_at", { ascending: false }).limit(5),
      ),
  });

  const { data: openIssues } = useQuery({
    queryKey: ["issues", "vehicle", id],
    queryFn: () =>
      listRows<Issue>("issues", (q) =>
        q.eq("vehicle_id", id).in("status", ["open", "in_progress"]).limit(5),
      ),
  });

  const { data: owner } = useQuery({
    queryKey: ["customers", vehicle?.customer_id],
    enabled: customersOn && !!vehicle?.customer_id,
    queryFn: () => getRow<Customer>("customers", vehicle!.customer_id!),
  });

  const { data: slInstallation } = useQuery({
    queryKey: ["speed_limiter_installations", "vehicle", id],
    enabled: speedLimitersOn,
    queryFn: async () => {
      const rows = await listRows<SpeedLimiterInstallation>(
        "speed_limiter_installations",
        (q) => q.eq("vehicle_id", id).eq("status", "active").limit(1),
      );
      return rows[0] ?? null;
    },
  });

  /**
   * The one certificate this vehicle currently carries — the head of its
   * supersession chain, and not revoked. Same predicate as the server-side
   * "live" filter the certificates list uses, so this can never disagree with
   * it: `superseded_by IS NULL AND status = 'valid'`.
   *
   * "Live" says nothing about expiry: hundreds of imported register rows are
   * live and long expired, and those are exactly the renewals a technician
   * comes here to issue.
   */
  const { data: currentCert, isLoading: currentCertLoading, error: currentCertError } = useQuery({
    queryKey: ["speed_limiter_certificates", "vehicle-current", id],
    enabled: slCertsOn,
    queryFn: async () => {
      const rows = await listRows<SpeedLimiterCertificate>(
        "speed_limiter_certificates",
        (q) =>
          q
            .eq("vehicle_id", id)
            .is("superseded_by", null)
            .eq("status", "valid")
            .order("issued_at", { ascending: false })
            .limit(1),
      );
      return rows[0] ?? null;
    },
  });

  const { data: slCerts, isLoading: slCertsLoading, error: slCertsError } = useQuery({
    queryKey: ["speed_limiter_certificates", "vehicle", id],
    enabled: slCertsOn,
    queryFn: () =>
      listRows<SpeedLimiterCertificate>("speed_limiter_certificates", (q) =>
        q.eq("vehicle_id", id).order("expires_at", { ascending: false }).limit(5),
      ),
  });

  const { data: slJobs } = useQuery({
    queryKey: ["sl_jobs", "vehicle", id],
    enabled: speedLimitersOn,
    queryFn: () =>
      listRows<SlJob>("sl_jobs", (q) =>
        q.eq("vehicle_id", id).order("created_at", { ascending: false }).limit(5),
      ),
  });

  const assign = useMutation({
    mutationFn: async () => {
      if (assignment) {
        await updateRow("vehicle_assignments", assignment.id, {
          ended_at: new Date().toISOString(),
        });
      }
      if (selectedDriver) {
        await insertRow("vehicle_assignments", { vehicle_id: id, driver_id: selectedDriver });
      }
    },
    onSuccess: () => {
      setActionError("");
      void qc.invalidateQueries({ queryKey: ["assignments"] });
      setAssigning(false);
    },
    onError: (err) => {
      setAssigning(false);
      setActionError(err instanceof Error ? err.message : t("common.error"));
    },
  });

  const remove = useMutation({
    mutationFn: () => deleteRow("vehicles", id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["vehicles"] });
      navigate("/vehicles");
    },
    // The delete guard (issued certificates / completed work) surfaces here
    // with a localized message from wrapDbError.
    onError: (err) => {
      setConfirmDelete(false);
      setActionError(err instanceof Error ? err.message : t("common.error"));
    },
  });

  if (isLoading) return <LoadingState />;
  if (!vehicle) return <ErrorState message={t("vehicles.notFound")} />;

  const st = vehicleStatus[vehicle.status];
  const currentDriver = assignment?.drivers;

  const ownerValue: ReactNode =
    vehicle.ownership === "customer" ? (
      customersOn && vehicle.customer_id ? (
        <Link to={`/customers/${vehicle.customer_id}`} className="text-brand-700 hover:underline">
          {owner?.name ?? t("vehicles.ownerCustomer")}
        </Link>
      ) : (
        t("vehicles.ownerCustomer")
      )
    ) : (
      t("vehicles.ownerCompany")
    );

  // One source of truth for certificate state (src/lib/certificateStatus.ts):
  // revoked > superseded > expired > 30/60/90-day bands. A renewed-then-lapsed
  // certificate reads "Superseded", not a misleading red "Expired".
  function certBadge(c: SpeedLimiterCertificate) {
    const { bucket, labelKey, tone, daysLeft } = certificateStatusMeta(c);
    return (
      <Badge tone={tone}>
        {bucket === "d30" || bucket === "d60" || bucket === "d90"
          ? t("speedLimiters.certStatus.expiresInDays", { count: daysLeft })
          : t(labelKey)}
      </Badge>
    );
  }

  // The current certificate gets its own block, so the list below is history.
  // Three mutually exclusive states, in this order: a failed read is never
  // allowed to fall through to "no certificate" — on a compliance surface that
  // reads as a confirmed fact and gets a live certificate re-issued.
  const certsError = currentCertError ?? slCertsError;
  const certsLoading = currentCertLoading || slCertsLoading;
  const historyCerts = (slCerts ?? []).filter((c) => c.id !== currentCert?.id);
  // No live certificate but rows exist ⇒ the head was revoked (status is
  // valid | revoked, and a vehicle has exactly one head). Only meaningful once
  // both reads succeeded.
  const hasRevokedHead = !currentCert && (slCerts?.length ?? 0) > 0;

  return (
    <>
      <Link to="/vehicles" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" /> {t("vehicles.title")}
      </Link>
      <PageHeader
        title={vehicle.name}
        description={[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || undefined}
        /*
         * Compliance state at the top of the page: whether this vehicle's
         * certificate is valid, close to expiry, or lapsed is the reason most
         * people open a vehicle, and it otherwise only appears further down.
         * Same certBadge as the cards below, so the colours and thresholds
         * cannot drift apart.
         *
         * Deliberately absent while a certificate read is loading or failing:
         * a missing badge reads as "not shown", but a wrong one reads as a
         * confirmed fact — and "valid" on a vehicle whose certificate lapsed
         * is exactly the mistake that keeps a truck on the road uncertified.
         */
        badge={
          slCertsOn && !certsError && !certsLoading
            ? currentCert
              ? certBadge(currentCert)
              : hasRevokedHead
                ? <Badge tone="slate">{t("speedLimiters.certStatus.revoked")}</Badge>
                : undefined
            : undefined
        }
        actions={
          isManager && (
            <>
              {/* Renewal is the job a technician opens this page to finish, so
                  it leads — but only when there is a live certificate to
                  replace; otherwise the card offers the job link instead.
                  Suppressed while either certificate read is failing: we do not
                  know what we would be renewing. */}
              {slCertsOn && !certsError && currentCert && (
                <Button onClick={() => setRenewingId(currentCert.id)}>
                  <RefreshCw className="h-4 w-4" /> {t("vehicles.renewCertificate")}
                </Button>
              )}
              <Button variant="secondary" onClick={() => setEditing(true)}>
                <Pencil className="h-4 w-4" /> {t("action.edit")}
              </Button>
              <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="h-4 w-4" /> {t("action.delete")}
              </Button>
            </>
          )
        }
      />

      {actionError && (
        <div className="mb-4">
          <ErrorState message={actionError} />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5">
          <h3 className="mb-2 text-sm font-semibold text-slate-900">{t("vehicles.details")}</h3>
          <InfoRow label={t("field.status")} value={t(st.labelKey)} />
          <InfoRow label={t("vehicles.owner")} value={ownerValue} />
          <InfoRow label={t("vehicles.type")} value={t(vehicleTypes[vehicle.vehicle_type])} />
          <InfoRow label={t("vehicles.fuel")} value={t(fuelTypes[vehicle.fuel_type])} />
          <InfoRow label={t("field.odometer")} value={formatDistance(vehicle.odometer, tenant.distance_unit)} />
          <InfoRow label={t("field.licensePlate")} value={vehicle.license_plate ?? t("common.dash")} />
          <InfoRow label={t("field.vin")} value={vehicle.vin ?? t("common.dash")} />
          {vehicle.chassis_number && (
            <InfoRow label={t("vehicles.chassisNumber")} value={vehicle.chassis_number} />
          )}
          {vehicle.engine_number && (
            <InfoRow label={t("vehicles.engineNumber")} value={vehicle.engine_number} />
          )}
          {vehicle.fleet_number && (
            <InfoRow label={t("vehicles.fleetNumber")} value={vehicle.fleet_number} />
          )}
          <InfoRow label={t("vehicles.purchased")} value={formatDate(vehicle.purchase_date)} />
          <InfoRow label={t("vehicles.purchasePrice")} value={formatMoney(vehicle.purchase_price, tenant.currency)} />
          {vehicle.notes && (
            <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">{vehicle.notes}</p>
          )}
        </Card>

        <Card className="p-5">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">{t("vehicles.assignedDriver")}</h3>
            {isManager && (
              <Button variant="ghost" onClick={() => { setSelectedDriver(assignment?.driver_id ?? ""); setAssigning(true); }}>
                <UserCheck className="h-4 w-4" /> {assignment ? t("vehicles.change") : t("vehicles.assign")}
              </Button>
            )}
          </div>
          {currentDriver ? (
            <div>
              <div className="text-sm font-medium text-slate-800">
                {currentDriver.first_name} {currentDriver.last_name}
              </div>
              <div className="text-xs text-slate-500">
                {t("vehicles.since", { date: formatDate(assignment!.started_at) })}
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">{t("vehicles.noDriver")}</p>
          )}

          <h3 className="mb-2 mt-6 text-sm font-semibold text-slate-900">{t("vehicles.openIssues")}</h3>
          {openIssues?.length ? (
            <ul className="space-y-1.5">
              {openIssues.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate text-slate-700">{i.title}</span>
                  <Badge tone={issueStatus[i.status].tone}>{t(issueStatus[i.status].labelKey)}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">{t("vehicles.noOpenIssues")}</p>
          )}
        </Card>

        <Card className="p-5">
          <h3 className="mb-2 text-sm font-semibold text-slate-900">{t("vehicles.recentWorkOrders")}</h3>
          {openWork?.length ? (
            <ul className="space-y-1.5">
              {openWork.map((w) => (
                <li key={w.id} className="flex items-center justify-between gap-2 text-sm">
                  <Link to={`/maintenance/work-orders/${w.id}`} className="truncate text-brand-700 hover:underline">
                    #{w.number} {w.title}
                  </Link>
                  <Badge tone={workOrderStatus[w.status].tone}>{t(workOrderStatus[w.status].labelKey)}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">{t("vehicles.noWorkOrders")}</p>
          )}

          <h3 className="mb-2 mt-6 text-sm font-semibold text-slate-900">{t("vehicles.recentFuel")}</h3>
          {recentFuel?.length ? (
            <ul className="space-y-1.5">
              {recentFuel.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-slate-600">{formatDate(f.filled_at, tenant.timezone)}</span>
                  <span className="font-medium text-slate-800">
                    {formatMoney(f.total_cost, tenant.currency)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">{t("vehicles.noFuelLogs")}</p>
          )}
        </Card>

        {speedLimitersOn && (
          <Card className="p-5">
            <h3 className="mb-2 text-sm font-semibold text-slate-900">{t("vehicles.speedLimiterPanel")}</h3>
            {slInstallation ? (
              <div>
                <div className="text-sm font-medium text-slate-800">{slInstallation.device_serial}</div>
                <div className="text-xs text-slate-500">
                  {t("vehicles.since", { date: formatDate(slInstallation.installed_at) })}
                </div>
                <InfoRow
                  label={t("speedLimiters.verify.setSpeed")}
                  value={
                    slInstallation.set_speed_kmh != null
                      ? t("speedLimiters.kmhValue", { value: slInstallation.set_speed_kmh })
                      : t("common.dash")
                  }
                />
              </div>
            ) : (
              <p className="text-sm text-slate-500">{t("vehicles.noSpeedLimiter")}</p>
            )}

            {slCertsOn && (
              <>
                <div className="mb-2 mt-6 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900">{t("customers.certificates")}</h3>
                  {/* Land on the certificates list already searched for this
                      vehicle — its search matches plate, name, chassis and VIN. */}
                  <Link
                    to={`/speed-limiters/certificates?q=${encodeURIComponent(
                      vehicle.license_plate ?? vehicle.name,
                    )}`}
                    className="text-xs text-brand-700 hover:underline"
                  >
                    {t("customers.viewAllCertificates")}
                  </Link>
                </div>
                {/* Failed read — say so. Never render the empty state here. */}
                {certsError && <ErrorState message={t("vehicles.certificatesError")} />}

                {!certsError && !certsLoading && currentCert && (
                  <div className="rounded-xl border border-line bg-canvas p-3">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                      {t("vehicles.currentCertificate")}
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-ink">
                        {currentCert.certificate_number}
                      </span>
                      {certBadge(currentCert)}
                    </div>
                    {currentCert.uin && (
                      <div className="mt-1.5 flex justify-between gap-4 text-xs">
                        <span className="text-ink-3">{t("speedLimiters.verify.uin")}</span>
                        <span className="text-end font-medium text-ink-2 tabular-nums">
                          {currentCert.uin}
                        </span>
                      </div>
                    )}
                    <div className="mt-1 flex justify-between gap-4 text-xs">
                      <span className="text-ink-3">{t("slCertificates.expires")}</span>
                      <span className="text-end font-medium text-ink-2 tabular-nums">
                        {formatDate(currentCert.expires_at)}
                      </span>
                    </div>
                    <div className="mt-2.5 flex flex-wrap items-center gap-4 border-t border-line pt-2.5">
                      <Link
                        to={`/speed-limiters/certificates/${currentCert.id}/print`}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-700 hover:underline"
                      >
                        <Printer className="h-3.5 w-3.5" /> {t("slCertificates.print")}
                      </Link>
                      {isManager && (
                        <button
                          type="button"
                          onClick={() => setRenewingId(currentCert.id)}
                          className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-700 hover:underline"
                        >
                          <RefreshCw className="h-3.5 w-3.5" /> {t("slCertificates.renew")}
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Nothing to renew — and we know it, because both reads
                    succeeded. Point at the job that issues the first
                    certificate rather than offering a dead button. */}
                {!certsError && !certsLoading && !currentCert && (
                  <div className="rounded-xl border border-line bg-canvas p-3">
                    <p className="text-sm text-ink-2">
                      {hasRevokedHead
                        ? t("vehicles.noValidCertificate")
                        : t("vehicles.noCertificate")}
                    </p>
                    <p className="mt-1 text-xs text-ink-3">
                      {hasRevokedHead
                        ? t("vehicles.noValidCertificateHint")
                        : t("vehicles.noCertificateHint")}
                    </p>
                    <Link
                      to="/speed-limiters/jobs"
                      className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-brand-700 hover:underline"
                    >
                      <Wrench className="h-3.5 w-3.5" /> {t("vehicles.createSlJob")}
                    </Link>
                  </div>
                )}

                {/* Without a trusted head we cannot say which rows are history:
                    the live one would be listed among the superseded. */}
                {!certsError && historyCerts.length > 0 && (
                  <>
                    <h4 className="mb-1.5 mt-4 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                      {t("vehicles.certificateHistory")}
                    </h4>
                    <ul className="space-y-1.5">
                      {historyCerts.map((c) => (
                        <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
                          <span className="truncate text-ink-2">{c.certificate_number}</span>
                          <span className="flex items-center gap-2">
                            <span className="text-xs tabular-nums text-ink-3">
                              {formatDate(c.expires_at)}
                            </span>
                            {certBadge(c)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            )}

            <div className="mb-2 mt-6 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">{t("customers.jobs")}</h3>
              <Link to="/speed-limiters/jobs" className="text-xs text-brand-700 hover:underline">
                {t("customers.viewAllJobs")}
              </Link>
            </div>
            {slJobs?.length ? (
              <ul className="space-y-1.5">
                {slJobs.map((j) => (
                  <li key={j.id} className="flex items-center justify-between gap-2 text-sm">
                    <Link to={`/speed-limiters/jobs/${j.id}`} className="truncate text-brand-700 hover:underline">
                      #{j.number} {t(jobTypeKeys[j.job_type])}
                    </Link>
                    <Badge tone={jobStatusMeta[j.status].tone}>{t(jobStatusMeta[j.status].labelKey)}</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">{t("customers.noJobs")}</p>
            )}
          </Card>
        )}
      </div>

      {/* The shared renewal flow — number allocation, UIN write-back and the
          renewed_from link all live in it, so every surface mounts the same
          component. It invalidates the certificate caches itself; a derived
          UIN may also have been written back to the installation. */}
      {slCertsOn && (
        <RenewCertificateModal
          certificateId={renewingId}
          cert={currentCert}
          onClose={() => setRenewingId(null)}
          onRenewed={() => {
            void qc.invalidateQueries({ queryKey: ["speed_limiter_installations"] });
          }}
        />
      )}

      <Modal title={t("vehicles.edit")} open={editing} onClose={() => setEditing(false)} wide>
        <VehicleForm vehicle={vehicle} onDone={() => { setEditing(false); void qc.invalidateQueries({ queryKey: ["vehicles", id] }); }} />
      </Modal>

      <Modal title={t("vehicles.assignDriver")} open={assigning} onClose={() => setAssigning(false)}>
        <div className="space-y-4">
          <Field label={t("field.driver")} hint={t("vehicles.unassignHint")}>
            <Combobox
              {...driverPicker}
              value={selectedDriver}
              onChange={setSelectedDriver}
              placeholder={t("vehicles.unassigned")}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAssigning(false)}>{t("action.cancel")}</Button>
            <Button onClick={() => assign.mutate()} loading={assign.isPending}>{t("action.save")}</Button>
          </div>
        </div>
      </Modal>

      <Modal title={t("vehicles.delete")} open={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <p className="text-sm text-slate-600">
          {t("vehicles.deleteConfirmPrefix")}{" "}
          <span className="font-semibold">{vehicle.name}</span>{" "}
          {t("vehicles.deleteConfirmSuffix")}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmDelete(false)}>{t("action.cancel")}</Button>
          <Button variant="danger" onClick={() => remove.mutate()} loading={remove.isPending}>
            {t("vehicles.delete")}
          </Button>
        </div>
      </Modal>
    </>
  );
}
