import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Pencil, Trash2, UserCheck } from "lucide-react";
import { deleteRow, getRow, insertRow, listRows, updateRow } from "../../lib/db";
import { daysUntil, formatDate, formatDistance, formatMoney } from "../../lib/format";
import { fuelTypes, vehicleStatus, vehicleTypes, workOrderStatus, issueStatus } from "../../lib/labels";
import type {
  Customer, Driver, FuelLog, Issue, SlJob, SlJobStatus, SlJobType,
  SpeedLimiterCertificate, SpeedLimiterInstallation, Vehicle, VehicleAssignment, WorkOrder,
} from "../../lib/types";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useModules } from "../../context/ModulesContext";
import { useT, type MessageKey } from "../../i18n";
import {
  Badge, Button, Card, ErrorState, Field, LoadingState, Modal, PageHeader, Select,
  type BadgeTone,
} from "../../components/ui";
import { VehicleForm } from "./VehicleForm";

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

  const { data: vehicle, isLoading } = useQuery({
    queryKey: ["vehicles", id],
    queryFn: () => getRow<Vehicle>("vehicles", id),
  });

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

  const { data: drivers } = useQuery({
    queryKey: ["drivers"],
    queryFn: () => listRows<Driver>("drivers", (q) => q.eq("status", "active").order("first_name")),
  });

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

  const { data: slCerts } = useQuery({
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

  function certBadge(c: SpeedLimiterCertificate) {
    if (c.status === "revoked") {
      return <Badge tone="red">{t("speedLimiters.certStatus.revoked")}</Badge>;
    }
    const days = daysUntil(c.expires_at);
    if (days < 0) return <Badge tone="red">{t("speedLimiters.certStatus.expired")}</Badge>;
    if (days <= 60) return <Badge tone="yellow">{t("speedLimiters.certStatus.expiring")}</Badge>;
    return <Badge tone="green">{t("speedLimiters.certStatus.valid")}</Badge>;
  }

  return (
    <>
      <Link to="/vehicles" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" /> {t("vehicles.title")}
      </Link>
      <PageHeader
        title={vehicle.name}
        description={[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || undefined}
        actions={
          isManager && (
            <>
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
                  <Link to="/speed-limiters/certificates" className="text-xs text-brand-700 hover:underline">
                    {t("customers.viewAllCertificates")}
                  </Link>
                </div>
                {slCerts?.length ? (
                  <ul className="space-y-1.5">
                    {slCerts.map((c) => (
                      <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
                        <span className="truncate text-slate-700">{c.certificate_number}</span>
                        <span className="flex items-center gap-2">
                          <span className="text-xs text-slate-500">{formatDate(c.expires_at)}</span>
                          {certBadge(c)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-500">{t("customers.noCertificates")}</p>
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

      <Modal title={t("vehicles.edit")} open={editing} onClose={() => setEditing(false)} wide>
        <VehicleForm vehicle={vehicle} onDone={() => { setEditing(false); void qc.invalidateQueries({ queryKey: ["vehicles", id] }); }} />
      </Modal>

      <Modal title={t("vehicles.assignDriver")} open={assigning} onClose={() => setAssigning(false)}>
        <div className="space-y-4">
          <Field label={t("field.driver")} hint={t("vehicles.unassignHint")}>
            <Select value={selectedDriver} onChange={(e) => setSelectedDriver(e.target.value)}>
              <option value="">{t("vehicles.unassigned")}</option>
              {drivers?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.first_name} {d.last_name}
                </option>
              ))}
            </Select>
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
