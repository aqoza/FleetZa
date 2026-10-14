import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Pencil, Plus, Trash2 } from "lucide-react";
import { deleteRow, listPage } from "../../lib/db";
import { useDriverPicker, useVehiclePicker } from "../../lib/pickers";
import { formatDateTime } from "../../lib/format";
import { DRIVING_EVENT_TYPES, SEVERITIES } from "../../../shared/driverScore";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useModules } from "../../context/ModulesContext";
import { useT } from "../../i18n";
import { Badge, Bdi, Button, Card, EmptyState, ErrorState, LoadingState, Modal, Pagination, Select } from "../../components/ui";
import { Combobox } from "../../components/Combobox";
import { useToast } from "../../components/Toast";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { EventForm } from "./EventForm";
import { personName, severityTone } from "./labels";
import { EVENT_SELECT, type DrivingEvent } from "./types";

const PAGE_SIZE = 25;

/** The events list. With `driverId` it is that driver's timeline (driver detail page). */
export function EventsTable({ driverId }: { driverId?: string }) {
  const t = useT();
  const tenant = useTenant();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [type, setType] = useState("all");
  const [severity, setSeverity] = useState("all");
  const [driver, setDriver] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<DrivingEvent | null>(null);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<DrivingEvent | null>(null);
  const [actionError, setActionError] = useState("");
  const driverPicker = useDriverPicker(driver);
  const vehiclePicker = useVehiclePicker(vehicle);
  const driverFilter = driverId ?? driver;

  const listQ = useQuery({
    queryKey: ["driving_events", { page, type, severity, driver: driverFilter, vehicle }],
    queryFn: () =>
      listPage<DrivingEvent>("driving_events", page, PAGE_SIZE, (q) => {
        let f = q.select(EVENT_SELECT);
        if (type !== "all") f = f.eq("event_type", type);
        if (severity !== "all") f = f.eq("severity", severity);
        if (driverFilter) f = f.eq("driver_id", driverFilter);
        if (vehicle) f = f.eq("vehicle_id", vehicle);
        return f.order("occurred_at", { ascending: false });
      }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteRow("driving_events", id),
    onSuccess: () => {
      setActionError("");
      void qc.invalidateQueries({ queryKey: ["driving_events"] });
      void qc.invalidateQueries({ queryKey: ["driver_scores"] });
      setDeleting(null);
      toast.success(t("toast.deleted"));
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : t("common.error"));
      setDeleting(null);
    },
  });

  const resetPage = <V,>(fn: (v: V) => void) => (v: V) => {
    fn(v);
    setPage(0);
  };

  const speed = (e: DrivingEvent) => {
    if (e.speed_kmh == null) return "—";
    const s = Math.round(Number(e.speed_kmh));
    return e.speed_limit_kmh != null
      ? t("driverBehavior.speedVsLimit", { speed: s, limit: Math.round(Number(e.speed_limit_kmh)) })
      : t("driverBehavior.speedOnly", { speed: s });
  };

  const columns: Array<DataTableColumn<DrivingEvent>> = [
    {
      id: "time",
      header: t("driverBehavior.col.time"),
      cell: (e) => <span className="whitespace-nowrap text-ink-2">{formatDateTime(e.occurred_at, tenant.timezone)}</span>,
      sortValue: (e) => e.occurred_at,
      exportValue: (e) => e.occurred_at,
    },
    {
      id: "type",
      header: t("driverBehavior.col.type"),
      cell: (e) => <span className="font-medium text-ink">{t(`driverBehavior.type.${e.event_type}`)}</span>,
      sortValue: (e) => e.event_type,
      exportValue: (e) => e.event_type,
    },
    {
      id: "severity",
      header: t("driverBehavior.col.severity"),
      cell: (e) => <Badge tone={severityTone[e.severity]}>{t(`driverBehavior.severity.${e.severity}`)}</Badge>,
      sortValue: (e) => SEVERITIES.indexOf(e.severity),
      exportValue: (e) => e.severity,
    },
    ...(driverId
      ? []
      : [
          {
            id: "driver",
            header: t("driverBehavior.col.driver"),
            cell: (e) =>
              e.driver_id ? (
                <Link
                  to={`/driver-behavior/drivers/${e.driver_id}`}
                  className="font-medium text-brand-700 hover:underline"
                >
                  <Bdi>{personName(e.driver)}</Bdi>
                </Link>
              ) : (
                <span className="text-ink-3">{t("driverBehavior.unassigned")}</span>
              ),
            sortValue: (e) => personName(e.driver) || null,
            exportValue: (e) => personName(e.driver),
          } satisfies DataTableColumn<DrivingEvent>,
        ]),
    {
      id: "vehicle",
      header: t("driverBehavior.col.vehicle"),
      minBreakpoint: "sm",
      cell: (e) => <Bdi className="text-ink-2">{e.vehicle?.name ?? "—"}</Bdi>,
      sortValue: (e) => e.vehicle?.name ?? null,
      exportValue: (e) => e.vehicle?.name ?? "",
    },
    {
      id: "speed",
      header: t("driverBehavior.col.speed"),
      align: "end",
      minBreakpoint: "md",
      cell: (e) => <span className="whitespace-nowrap text-ink-2 tabular-nums">{speed(e)}</span>,
      sortValue: (e) => e.speed_kmh,
      exportValue: (e) => e.speed_kmh ?? "",
    },
    {
      id: "source",
      header: t("driverBehavior.col.source"),
      minBreakpoint: "lg",
      defaultHidden: !!driverId,
      cell: (e) => <span className="text-ink-2">{t(`driverBehavior.source.${e.source}`)}</span>,
      sortValue: (e) => e.source,
      exportValue: (e) => e.source,
    },
    ...(isManager
      ? [
          {
            id: "actions",
            header: "",
            align: "end",
            cell: (e) => (
              <div className="flex justify-end gap-1">
                <button
                  className="rounded p-1.5 text-ink-3 hover:bg-canvas hover:text-ink"
                  onClick={() => setEditing(e)}
                  aria-label={t("driverBehavior.editEvent")}
                  title={t("action.edit")}
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  className="rounded p-1.5 text-ink-3 hover:bg-serious-soft hover:text-serious"
                  onClick={() => setDeleting(e)}
                  aria-label={t("driverBehavior.deleteEvent")}
                  title={t("action.delete")}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ),
          } satisfies DataTableColumn<DrivingEvent>,
        ]
      : []),
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Select value={type} onChange={(e) => resetPage(setType)(e.target.value)} className="max-w-48">
          <option value="all">{t("driverBehavior.allTypes")}</option>
          {DRIVING_EVENT_TYPES.map((ty) => (
            <option key={ty} value={ty}>{t(`driverBehavior.type.${ty}`)}</option>
          ))}
        </Select>
        <Select value={severity} onChange={(e) => resetPage(setSeverity)(e.target.value)} className="max-w-44">
          <option value="all">{t("driverBehavior.allSeverities")}</option>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>{t(`driverBehavior.severity.${s}`)}</option>
          ))}
        </Select>
        {!driverId && (
          <div className="w-full max-w-56">
            <Combobox {...driverPicker} placeholder={t("driverBehavior.allDrivers")} value={driver} onChange={resetPage(setDriver)} />
          </div>
        )}
        <div className="w-full max-w-56">
          <Combobox {...vehiclePicker} placeholder={t("driverBehavior.allVehicles")} value={vehicle} onChange={resetPage(setVehicle)} />
        </div>
        {isManager && !driverId && (
          <Button className="ms-auto" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> {t("driverBehavior.addEvent")}
          </Button>
        )}
      </div>
      {actionError && (
        <div className="mb-3">
          <ErrorState message={actionError} />
        </div>
      )}
      {listQ.isLoading && <LoadingState />}
      {listQ.error && <ErrorState message={(listQ.error as Error).message} />}
      {listQ.data && (
        <DataTable<DrivingEvent>
          tableId={driverId ? "driver-events" : "driving-events"}
          exportName="driving-events"
          rows={listQ.data.rows}
          rowKey={(e) => e.id}
          columns={columns}
          empty={
            <EmptyState
              icon={<Activity className="h-10 w-10" />}
              title={t("driverBehavior.eventsEmpty")}
              description={driverId ? undefined : t("driverBehavior.eventsEmptyHint")}
            />
          }
          footer={<Pagination page={page} pageSize={PAGE_SIZE} total={listQ.data.total} onPage={setPage} />}
        />
      )}

      {(adding || editing) && (
        <EventForm
          open
          event={editing}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
        />
      )}

      <Modal title={t("driverBehavior.deleteEvent")} open={!!deleting} onClose={() => setDeleting(null)}>
        {deleting && (
          <>
            <p className="text-sm text-ink-2">{t("driverBehavior.confirmDeleteEvent")}</p>
            <p className="mt-2 text-xs text-ink-3">
              {t(`driverBehavior.type.${deleting.event_type}`)} · <Bdi>{deleting.vehicle?.name ?? ""}</Bdi> ·{" "}
              {formatDateTime(deleting.occurred_at, tenant.timezone)}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeleting(null)}>{t("action.cancel")}</Button>
              <Button variant="danger" onClick={() => remove.mutate(deleting.id)} loading={remove.isPending}>
                {t("driverBehavior.deleteEvent")}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

export default function EventsPage() {
  const t = useT();
  const { isEnabled } = useModules();
  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-3 p-4">
        <p className="min-w-0 flex-1 text-sm text-ink-2">{t("driverBehavior.apiHint")}</p>
        {isEnabled("integrations") && (
          <Link to="/integrations" className="text-sm font-medium text-brand-700 hover:underline">
            {t("driverBehavior.openIntegrations")}
          </Link>
        )}
      </Card>
      <EventsTable />
    </div>
  );
}
