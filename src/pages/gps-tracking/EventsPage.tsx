import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Activity } from "lucide-react";
import { listPage, listRows } from "../../lib/db";
import { useVehiclePicker } from "../../lib/pickers";
import { formatDateTime } from "../../lib/format";
import { useTenant } from "../../context/AuthContext";
import { useT } from "../../i18n";
import { Badge, Bdi, EmptyState, ErrorState, LoadingState, Pagination, Select } from "../../components/ui";
import { Combobox } from "../../components/Combobox";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { geofenceColors } from "./labels";
import type { Geofence, GeofenceEvent } from "./types";

const PAGE_SIZE = 25;

export default function EventsPage() {
  const t = useT();
  const tenant = useTenant();
  const [geofence, setGeofence] = useState("all");
  const [vehicle, setVehicle] = useState("");
  const [kind, setKind] = useState("all");
  const [page, setPage] = useState(0);
  const picker = useVehiclePicker(vehicle);

  const fencesQ = useQuery({
    queryKey: ["geofences", "all"],
    queryFn: () => listRows<Geofence>("geofences", (q) => q.order("name").limit(500)),
  });
  const eventsQ = useQuery({
    queryKey: ["geofence_events", "list", { page, geofence, vehicle, kind }],
    queryFn: () =>
      listPage<GeofenceEvent>("geofence_events", page, PAGE_SIZE, (q) => {
        let f = q.select(
          "*, vehicle:vehicles!geofence_events_vehicle_id_fkey(name,license_plate)," +
            " geofence:geofences!geofence_events_geofence_id_fkey(name,color)",
        );
        if (geofence !== "all") f = f.eq("geofence_id", geofence);
        if (vehicle) f = f.eq("vehicle_id", vehicle);
        if (kind !== "all") f = f.eq("event", kind);
        return f.order("at", { ascending: false });
      }),
  });

  const filtersOn = geofence !== "all" || !!vehicle || kind !== "all";
  const label = (e: GeofenceEvent) => (e.event === "enter" ? t("gpsTracking.event.enter") : t("gpsTracking.event.exit"));

  const columns: Array<DataTableColumn<GeofenceEvent>> = [
    {
      id: "time",
      header: t("gpsTracking.col.time"),
      cell: (e) => <span className="whitespace-nowrap text-ink-2">{formatDateTime(e.at, tenant.timezone)}</span>,
      sortValue: (e) => e.at,
      exportValue: (e) => e.at,
    },
    {
      id: "vehicle",
      header: t("gpsTracking.col.vehicle"),
      cell: (e) => (
        <Link to={`/vehicles/${e.vehicle_id}`} className="font-medium text-brand-700 hover:underline" onClick={(ev) => ev.stopPropagation()}>
          <Bdi>{e.vehicle?.name ?? "—"}</Bdi>
        </Link>
      ),
      sortValue: (e) => e.vehicle?.name ?? null,
      exportValue: (e) => e.vehicle?.name ?? "",
    },
    {
      id: "event",
      header: t("gpsTracking.col.event"),
      cell: (e) => <Badge tone={e.event === "enter" ? "blue" : "slate"}>{label(e)}</Badge>,
      sortValue: label,
      exportValue: label,
    },
    {
      id: "geofence",
      header: t("gpsTracking.col.geofence"),
      cell: (e) => (
        <span className="inline-flex items-center gap-2 text-ink-2">
          {e.geofence && (
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: geofenceColors[e.geofence.color]?.hex }} aria-hidden />
          )}
          <Bdi>{e.geofence?.name ?? "—"}</Bdi>
        </span>
      ),
      sortValue: (e) => e.geofence?.name ?? null,
      exportValue: (e) => e.geofence?.name ?? "",
    },
  ];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Select
          value={geofence}
          onChange={(e) => {
            setGeofence(e.target.value);
            setPage(0);
          }}
          className="max-w-56"
        >
          <option value="all">{t("gpsTracking.allGeofences")}</option>
          {(fencesQ.data ?? []).map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </Select>
        <div className="w-full max-w-64">
          <Combobox
            {...picker}
            placeholder={t("gpsTracking.allVehicles")}
            value={vehicle}
            onChange={(v) => {
              setVehicle(v);
              setPage(0);
            }}
          />
        </div>
        <Select
          value={kind}
          onChange={(e) => {
            setKind(e.target.value);
            setPage(0);
          }}
          className="max-w-44"
        >
          <option value="all">{t("gpsTracking.allEvents")}</option>
          <option value="enter">{t("gpsTracking.event.enter")}</option>
          <option value="exit">{t("gpsTracking.event.exit")}</option>
        </Select>
      </div>
      {eventsQ.isLoading && <LoadingState />}
      {eventsQ.error && <ErrorState message={(eventsQ.error as Error).message} />}
      {eventsQ.data && (
        <DataTable<GeofenceEvent>
          tableId="gps-geofence-events"
          exportName="geofence-events"
          rows={eventsQ.data.rows}
          rowKey={(e) => e.id}
          columns={columns}
          empty={
            <EmptyState
              icon={<Activity className="h-10 w-10" />}
              title={filtersOn ? t("common.noResults") : t("gpsTracking.eventsEmptyTitle")}
              description={filtersOn ? undefined : t("gpsTracking.eventsEmptyDesc")}
            />
          }
          footer={<Pagination page={page} pageSize={PAGE_SIZE} total={eventsQ.data.total} onPage={setPage} />}
        />
      )}
    </>
  );
}
