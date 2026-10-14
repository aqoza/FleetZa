import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import L from "leaflet";
import { Hexagon, Pencil, Plus, Trash2 } from "lucide-react";
import { deleteRow, listPage, listRows, sanitizeSearch } from "../../lib/db";
import { bdiText } from "../../lib/bidi";
import { useAuth } from "../../context/AuthContext";
import { useT, useTp } from "../../i18n";
import { Badge, Bdi, Button, EmptyState, ErrorState, Input, LoadingState, Modal, Pagination } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { GeofenceForm } from "./GeofenceForm";
import { MapCanvas, fitTo, useLayer } from "./MapCanvas";
import { drawGeofences, geofencePoints } from "./layers";
import { geofenceColors } from "./labels";
import type { Geofence } from "./types";

const PAGE_SIZE = 25;

export default function GeofencesPage() {
  const t = useT();
  const tp = useTp();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Geofence | null>(null);
  const [deleting, setDeleting] = useState<Geofence | null>(null);
  const [actionError, setActionError] = useState("");
  const [map, setMap] = useState<L.Map | null>(null);
  const layer = useLayer(map);
  const fitted = useRef(false);
  const term = sanitizeSearch(search);

  const listQ = useQuery({
    queryKey: ["geofences", "list", { page, term }],
    queryFn: () =>
      listPage<Geofence>("geofences", page, PAGE_SIZE, (q) => {
        let f = q;
        if (term) f = f.or(`name.ilike.%${term}%,notes.ilike.%${term}%`);
        return f.order("name");
      }),
  });
  // Every geofence on the overview map: a tenant has a bounded handful.
  const allQ = useQuery({
    queryKey: ["geofences", "all"],
    queryFn: () => listRows<Geofence>("geofences", (q) => q.order("name").limit(500)),
  });

  useEffect(() => {
    if (!map || !layer) {
      fitted.current = false;
      return;
    }
    drawGeofences(layer, allQ.data ?? []);
    const pts = geofencePoints(allQ.data ?? []);
    if (!fitted.current && pts.length > 0) {
      fitTo(map, pts, 14);
      fitted.current = true;
    }
  }, [map, layer, allQ.data]);

  const remove = useMutation({
    mutationFn: (id: string) => deleteRow("geofences", id),
    onSuccess: () => {
      setActionError("");
      void qc.invalidateQueries({ queryKey: ["geofences"] });
      void qc.invalidateQueries({ queryKey: ["geofence_events"] });
      setDeleting(null);
      toast.success(t("toast.deleted"));
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : t("common.error"));
      setDeleting(null);
    },
  });

  const focus = (g: Geofence) => {
    if (!map) return;
    fitTo(map, geofencePoints([g]), 16);
    if (g.kind === "circle" && g.center_lat != null && g.center_lng != null && g.radius_m) {
      map.fitBounds(L.latLng(Number(g.center_lat), Number(g.center_lng)).toBounds(g.radius_m * 2.4));
    }
  };

  const alerts = (g: Geofence) =>
    [g.alert_on_enter && t("gpsTracking.alertEnter"), g.alert_on_exit && t("gpsTracking.alertExit")].filter(Boolean).join(" · ") ||
    t("gpsTracking.alertsOff");

  const columns: Array<DataTableColumn<Geofence>> = [
    {
      id: "name",
      header: t("gpsTracking.col.name"),
      cell: (g) => (
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: geofenceColors[g.color]?.hex }} aria-hidden />
          <Bdi className="font-medium text-ink">{g.name}</Bdi>
        </span>
      ),
      sortValue: (g) => g.name,
      exportValue: (g) => g.name,
    },
    {
      id: "shape",
      header: t("gpsTracking.col.shape"),
      minBreakpoint: "md",
      cell: (g) => (
        <span className="text-ink-2">
          {g.kind === "circle"
            ? t("gpsTracking.radiusValue", { radius: g.radius_m ?? 0 })
            : tp("gpsTracking.pointCount", g.polygon?.length ?? 0)}
        </span>
      ),
      exportValue: (g) => (g.kind === "circle" ? `circle ${g.radius_m} m` : `polygon ${g.polygon?.length ?? 0}`),
    },
    {
      id: "alerts",
      header: t("gpsTracking.col.alerts"),
      minBreakpoint: "lg",
      cell: (g) => <span className="text-ink-2">{alerts(g)}</span>,
      exportValue: alerts,
    },
    {
      id: "status",
      header: t("common.status"),
      cell: (g) => (
        <span className="whitespace-nowrap">
          {g.active ? <Badge tone="green">{t("gpsTracking.active")}</Badge> : <Badge tone="slate">{t("gpsTracking.inactive")}</Badge>}
        </span>
      ),
      sortValue: (g) => (g.active ? 1 : 0),
      exportValue: (g) => (g.active ? t("gpsTracking.active") : t("gpsTracking.inactive")),
    },
    ...(isManager
      ? [
          {
            id: "actions",
            header: "",
            align: "end",
            cell: (g) => (
              <div className="flex justify-end gap-1">
                <button
                  className="rounded p-1.5 text-ink-3 hover:bg-canvas hover:text-ink-2"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditing(g);
                  }}
                  aria-label={t("gpsTracking.editGeofence")}
                  title={t("action.edit")}
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  className="rounded p-1.5 text-ink-3 hover:bg-serious-soft hover:text-serious"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleting(g);
                  }}
                  aria-label={t("gpsTracking.deleteGeofence")}
                  title={t("action.delete")}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ),
          } satisfies DataTableColumn<Geofence>,
        ]
      : []),
  ];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          placeholder={t("action.search")}
          className="max-w-80"
        />
        {isManager && (
          <div className="ms-auto">
            <Button onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" /> {t("gpsTracking.newGeofence")}
            </Button>
          </div>
        )}
      </div>
      {actionError && (
        <div className="mb-4">
          <ErrorState message={actionError} />
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="min-w-0">
          {listQ.isLoading && <LoadingState />}
          {listQ.error && <ErrorState message={(listQ.error as Error).message} />}
          {listQ.data && (
            <DataTable<Geofence>
              tableId="gps-geofences"
              exportName="geofences"
              rows={listQ.data.rows}
              rowKey={(g) => g.id}
              onRowClick={focus}
              columns={columns}
              empty={
                <EmptyState
                  icon={<Hexagon className="h-10 w-10" />}
                  title={term ? t("common.noResults") : t("gpsTracking.geofencesEmptyTitle")}
                  description={term ? undefined : t("gpsTracking.geofencesEmptyDesc")}
                  action={
                    isManager && !term ? (
                      <Button onClick={() => setAdding(true)}>
                        <Plus className="h-4 w-4" /> {t("gpsTracking.newGeofence")}
                      </Button>
                    ) : undefined
                  }
                />
              }
              footer={<Pagination page={page} pageSize={PAGE_SIZE} total={listQ.data.total} onPage={setPage} />}
            />
          )}
        </div>
        <div className="min-w-0">
          <MapCanvas onMap={setMap} className="h-[50vh] xl:h-[calc(100vh-320px)] xl:min-h-[420px]" />
        </div>
      </div>

      <Modal title={t("gpsTracking.newGeofence")} open={adding} onClose={() => setAdding(false)} wide>
        {adding && <GeofenceForm others={allQ.data ?? []} onDone={() => setAdding(false)} onCancel={() => setAdding(false)} />}
      </Modal>
      <Modal title={t("gpsTracking.editGeofence")} open={!!editing} onClose={() => setEditing(null)} wide>
        {editing && (
          <GeofenceForm geofence={editing} others={allQ.data ?? []} onDone={() => setEditing(null)} onCancel={() => setEditing(null)} />
        )}
      </Modal>
      <Modal title={t("gpsTracking.deleteGeofence")} open={!!deleting} onClose={() => setDeleting(null)}>
        {deleting && (
          <>
            <p className="text-sm text-ink-2">{t("gpsTracking.confirmDeleteGeofence", { name: bdiText(deleting.name) })}</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeleting(null)}>{t("action.cancel")}</Button>
              <Button variant="danger" onClick={() => remove.mutate(deleting.id)} loading={remove.isPending}>
                {t("gpsTracking.deleteGeofence")}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
