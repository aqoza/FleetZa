import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import L from "leaflet";
import { MapPinned } from "lucide-react";
import { countRows, listRows } from "../../lib/db";
import { recencyBucket, type Recency } from "../../lib/gps";
import { relativeTime } from "../../lib/notifications";
import { useI18n, useT, useTp } from "../../i18n";
import { Bdi, Card, EmptyState, ErrorState, Input, LoadingState, Ltr } from "../../components/ui";
import { MapCanvas, fitTo, useLayer } from "./MapCanvas";
import { drawGeofences, esc } from "./layers";
import { recencyMeta } from "./labels";
import type { Geofence, LastPosition } from "./types";

const REFRESH_MS = 30_000;

export default function LiveMapPage() {
  const t = useT();
  const tp = useTp();
  const { language } = useI18n();
  const [map, setMap] = useState<L.Map | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const markers = useRef(new Map<string, L.CircleMarker>());
  const fitted = useRef(false);

  // One row per vehicle with a fix: bounded by the fleet size.
  const lastQ = useQuery({
    queryKey: ["vehicle_last_positions", "live"],
    queryFn: () =>
      listRows<LastPosition>("vehicle_last_positions", (q) =>
        q
          .select(
            "*, vehicle:vehicles!vehicle_last_positions_vehicle_id_fkey(name,license_plate)," +
              " driver:drivers!vehicle_last_positions_driver_id_fkey(first_name,last_name)",
          )
          .order("recorded_at", { ascending: false })
          .limit(5000),
      ),
    refetchInterval: REFRESH_MS,
  });
  const vehicleCountQ = useQuery({
    queryKey: ["vehicles", "count"],
    queryFn: () => countRows("vehicles"),
  });
  const fencesQ = useQuery({
    queryKey: ["geofences", "map"],
    queryFn: () => listRows<Geofence>("geofences", (q) => q.eq("active", true).order("name").limit(500)),
  });

  const now = lastQ.dataUpdatedAt || Date.now();
  const rows = useMemo(
    () => (lastQ.data ?? []).map((p) => ({ ...p, bucket: recencyBucket(p, now) })),
    [lastQ.data, now],
  );
  const counts = useMemo(() => {
    const c: Record<Recency, number> = { moving: 0, idle: 0, stale: 0, none: 0 };
    for (const r of rows) c[r.bucket]++;
    return c;
  }, [rows]);
  const withoutFix = Math.max(0, (vehicleCountQ.data ?? 0) - rows.length);

  const term = search.trim().toLowerCase();
  const visible = term
    ? rows.filter((r) =>
        [r.vehicle?.name, r.vehicle?.license_plate].some((v) => v?.toLowerCase().includes(term)),
      )
    : rows;

  // Geofence overlay.
  const fenceLayer = useLayer(map);
  useEffect(() => {
    if (fenceLayer) drawGeofences(fenceLayer, fencesQ.data ?? []);
  }, [fenceLayer, fencesQ.data]);

  // Vehicle markers: update in place so open popups survive a refresh.
  useEffect(() => {
    if (!map) {
      markers.current.clear();
      fitted.current = false;
      return;
    }
    const seen = new Set<string>();
    for (const r of rows) {
      seen.add(r.vehicle_id);
      const color = recencyMeta[r.bucket].color;
      const latlng: [number, number] = [Number(r.lat), Number(r.lng)];
      const label = esc(r.vehicle?.name ?? "—");
      const html =
        `<strong>${label}</strong><br/>${esc(t(recencyMeta[r.bucket].labelKey))}` +
        (r.speed_kmh != null ? ` · ${esc(t("gpsTracking.speed", { speed: Math.round(Number(r.speed_kmh)) }))}` : "") +
        `<br/>${esc(t("gpsTracking.lastSeen", { time: relativeTime(r.recorded_at, now, language) }))}`;
      let m = markers.current.get(r.vehicle_id);
      if (!m) {
        m = L.circleMarker(latlng, { radius: 8, weight: 2, color: "#ffffff", fillColor: color, fillOpacity: 1 })
          .bindTooltip(label)
          .bindPopup(html)
          .addTo(map);
        const id = r.vehicle_id;
        m.on("click", () => setSelected(id));
        markers.current.set(r.vehicle_id, m);
      } else {
        m.setLatLng(latlng).setStyle({ fillColor: color }).setPopupContent(html);
      }
    }
    for (const [id, m] of markers.current) {
      if (!seen.has(id)) {
        m.remove();
        markers.current.delete(id);
      }
    }
    if (!fitted.current && rows.length > 0) {
      fitTo(map, rows.map((r) => [Number(r.lat), Number(r.lng)]));
      fitted.current = true;
    }
  }, [map, rows, now, language, t]);

  const focus = (id: string) => {
    setSelected(id);
    const m = markers.current.get(id);
    if (map && m) {
      map.setView(m.getLatLng(), Math.max(map.getZoom(), 14));
      m.openPopup();
    }
  };

  if (lastQ.isLoading) return <LoadingState />;
  if (lastQ.error) return <ErrorState message={(lastQ.error as Error).message} />;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-ink-2">
        {(["moving", "idle", "stale"] as const).map((b) => (
          <span key={b} className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: recencyMeta[b].color }} aria-hidden />
            {t(recencyMeta[b].labelKey)}
            <span className="tabular-nums text-ink-3">{counts[b]}</span>
          </span>
        ))}
        {withoutFix > 0 && <span className="text-ink-3">{tp("gpsTracking.withoutFix", withoutFix)}</span>}
        <span className="text-xs text-ink-3 sm:ms-auto">{t("gpsTracking.autoRefresh")}</span>
      </div>

      {rows.length === 0 && (
        <Card className="p-2">
          <EmptyState
            icon={<MapPinned className="h-10 w-10" />}
            title={t("gpsTracking.noFixesTitle")}
            description={t("gpsTracking.noFixesDesc")}
          />
        </Card>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[300px_minmax(0,1fr)]">
        <Card className="order-2 flex min-w-0 flex-col p-3 lg:order-1 lg:h-[calc(100vh-300px)] lg:min-h-[420px]">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("gpsTracking.searchVehicles")}
            className="mb-2"
          />
          {visible.length === 0 && rows.length > 0 && <p className="p-2 text-sm text-ink-3">{t("gpsTracking.noMatch")}</p>}
          <ul className="-mx-1 max-h-80 overflow-y-auto lg:max-h-none lg:flex-1">
            {visible.map((r) => (
              <li key={r.vehicle_id}>
                <button
                  type="button"
                  onClick={() => focus(r.vehicle_id)}
                  className={`flex w-full items-start gap-2 rounded-lg px-2 py-2 text-start transition-colors hover:bg-canvas ${
                    selected === r.vehicle_id ? "bg-canvas" : ""
                  }`}
                >
                  <span
                    className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: recencyMeta[r.bucket].color }}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink"><Bdi>{r.vehicle?.name ?? "—"}</Bdi></span>
                    <span className="block truncate text-xs text-ink-3">
                      {r.vehicle?.license_plate && <><Ltr>{r.vehicle.license_plate}</Ltr> · </>}
                      {relativeTime(r.recorded_at, now, language)}
                    </span>
                  </span>
                  {r.speed_kmh != null && (
                    <span className="shrink-0 text-xs text-ink-2 tabular-nums">
                      {t("gpsTracking.speed", { speed: Math.round(Number(r.speed_kmh)) })}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          {selected && (
            <Link
              to={`/gps/history?vehicle=${selected}`}
              className="mt-2 block border-t border-line pt-2 text-center text-sm text-brand-700 hover:underline"
            >
              {t("gpsTracking.viewHistory")}
            </Link>
          )}
        </Card>
        <div className="order-1 min-w-0 lg:order-2">
          <MapCanvas onMap={setMap} className="h-[55vh] lg:h-[calc(100vh-300px)] lg:min-h-[420px]" />
        </div>
      </div>
    </div>
  );
}
