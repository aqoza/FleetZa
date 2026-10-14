import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import L from "leaflet";
import { Route as RouteIcon } from "lucide-react";
import { listRows } from "../../lib/db";
import { detectStops, pathDistanceKm, type Fix } from "../../lib/gps";
import { useVehiclePicker } from "../../lib/pickers";
import { formatDateTime } from "../../lib/format";
import { bdiText } from "../../lib/bidi";
import { useTenant } from "../../context/AuthContext";
import { useT, useTp } from "../../i18n";
import { Card, EmptyState, ErrorState, Field, Input, LoadingState, Ltr } from "../../components/ui";
import { Combobox } from "../../components/Combobox";
import { MapCanvas, fitTo, useLayer } from "./MapCanvas";
import { esc } from "./layers";
import { TRACK_COLOR, dayRange, todayIso } from "./labels";
import type { Position } from "./types";

const MAX_FIXES = 5000;

export default function HistoryPage() {
  const t = useT();
  const tp = useTp();
  const tenant = useTenant();
  const [params, setParams] = useSearchParams();
  const vehicleId = params.get("vehicle") ?? "";
  const day = params.get("day") ?? todayIso();
  const picker = useVehiclePicker(vehicleId);
  const [map, setMap] = useState<L.Map | null>(null);
  const layer = useLayer(map);
  const stopMarkers = useRef<L.CircleMarker[]>([]);

  const set = (key: "vehicle" | "day", value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const [from, to] = dayRange(day);
  const trackQ = useQuery({
    queryKey: ["gps_positions", "track", vehicleId, day],
    enabled: !!vehicleId,
    queryFn: () =>
      listRows<Position>("gps_positions", (q) =>
        q
          .select("id, vehicle_id, recorded_at, lat, lng, speed_kmh, heading, odometer_km, source")
          .eq("vehicle_id", vehicleId)
          .gte("recorded_at", from)
          .lt("recorded_at", to)
          .order("recorded_at")
          .limit(MAX_FIXES),
      ),
  });

  const fixes: Fix[] = useMemo(
    () =>
      (trackQ.data ?? []).map((p) => ({
        lat: Number(p.lat),
        lng: Number(p.lng),
        recorded_at: p.recorded_at,
        speed_kmh: p.speed_kmh == null ? null : Number(p.speed_kmh),
      })),
    [trackQ.data],
  );
  const stops = useMemo(() => detectStops(fixes), [fixes]);
  const distance = useMemo(() => pathDistanceKm(fixes), [fixes]);
  const topSpeed = fixes.reduce<number | null>((m, f) => (f.speed_kmh != null && (m == null || f.speed_kmh > m) ? f.speed_kmh : m), null);
  const dt = (iso: string) => formatDateTime(iso, tenant.timezone);

  useEffect(() => {
    if (!map || !layer) return;
    const g = layer;
    g.clearLayers();
    stopMarkers.current = [];
    if (fixes.length === 0) return;
    const pts = fixes.map((f) => [f.lat, f.lng] as [number, number]);
    L.polyline(pts, { color: TRACK_COLOR, weight: 4, opacity: 0.85 }).addTo(g);
    L.circleMarker(pts[0], { radius: 7, color: "#ffffff", weight: 2, fillColor: "var(--color-good)", fillOpacity: 1 })
      .bindTooltip(esc(`${t("gpsTracking.firstFix")}: ${dt(fixes[0].recorded_at)}`))
      .addTo(g);
    L.circleMarker(pts[pts.length - 1], { radius: 7, color: "#ffffff", weight: 2, fillColor: "var(--color-serious)", fillOpacity: 1 })
      .bindTooltip(esc(`${t("gpsTracking.lastFix")}: ${dt(fixes[fixes.length - 1].recorded_at)}`))
      .addTo(g);
    for (const s of stops) {
      const m = L.circleMarker([s.lat, s.lng], { radius: 6, color: "#ffffff", weight: 2, fillColor: "var(--color-warn)", fillOpacity: 1 })
        .bindPopup(esc(`${tp("gpsTracking.stopMinutes", s.minutes)} · ${t("gpsTracking.stopRange", { from: bdiText(dt(s.from)), to: bdiText(dt(s.to)) })}`))
        .addTo(g);
      stopMarkers.current.push(m);
    }
    fitTo(map, pts, 16);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dt/t/tp are stable per render language
  }, [map, layer, fixes, stops]);

  const focusStop = (i: number) => {
    const m = stopMarkers.current[i];
    if (map && m) {
      map.setView(m.getLatLng(), Math.max(map.getZoom(), 15));
      m.openPopup();
    }
  };

  const stat = (label: string, value: string) => (
    <div>
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-ink tabular-nums">{value}</dd>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,320px)_200px]">
        <Field label={t("gpsTracking.vehicle")}>
          <Combobox {...picker} value={vehicleId} onChange={(v) => set("vehicle", v)} />
        </Field>
        <Field label={t("gpsTracking.date")}>
          <Input type="date" dir="ltr" value={day} max={todayIso()} onChange={(e) => set("day", e.target.value)} />
        </Field>
      </div>

      {!vehicleId && (
        <Card className="p-2">
          <EmptyState icon={<RouteIcon className="h-10 w-10" />} title={t("gpsTracking.pickVehicle")} />
        </Card>
      )}
      {vehicleId && trackQ.isLoading && <LoadingState />}
      {trackQ.error && <ErrorState message={(trackQ.error as Error).message} />}
      {vehicleId && trackQ.data && fixes.length === 0 && (
        <Card className="p-2">
          <EmptyState icon={<RouteIcon className="h-10 w-10" />} title={t("gpsTracking.noTrack")} />
        </Card>
      )}

      {fixes.length > 0 && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[300px_minmax(0,1fr)]">
          <div className="order-2 min-w-0 space-y-3 lg:order-1">
            <Card className="p-4">
              <dl className="grid grid-cols-2 gap-3">
                {stat(t("gpsTracking.distance"), t("gpsTracking.km", { km: distance.toFixed(1) }))}
                {stat(t("gpsTracking.maxSpeed"), topSpeed != null ? t("gpsTracking.speed", { speed: Math.round(topSpeed) }) : "—")}
                {fixes.length > 0 && stat(t("gpsTracking.firstFix"), dt(fixes[0].recorded_at))}
                {fixes.length > 0 && stat(t("gpsTracking.lastFix"), dt(fixes[fixes.length - 1].recorded_at))}
              </dl>
              <p className="mt-3 text-xs text-ink-3">{tp("gpsTracking.fixCount", fixes.length)}</p>
              {fixes.length >= MAX_FIXES && <p className="mt-1 text-xs text-warn">{t("gpsTracking.truncated", { count: MAX_FIXES })}</p>}
            </Card>
            <Card className="p-4">
              <h2 className="text-sm font-semibold text-ink">
                {t("gpsTracking.stops")} <span className="font-normal text-ink-3">· {tp("gpsTracking.stopCount", stops.length)}</span>
              </h2>
              <p className="mb-2 text-xs text-ink-3">{t("gpsTracking.stopsHint")}</p>
              {stops.length === 0 ? (
                <p className="text-sm text-ink-3">{t("gpsTracking.noStops")}</p>
              ) : (
                <ol className="-mx-1 max-h-72 space-y-1 overflow-y-auto">
                  {stops.map((s, i) => (
                    <li key={s.from}>
                      <button
                        type="button"
                        onClick={() => focusStop(i)}
                        className="w-full rounded-lg px-2 py-1.5 text-start text-sm transition-colors hover:bg-canvas"
                      >
                        <span className="font-medium text-ink">{tp("gpsTracking.stopMinutes", s.minutes)}</span>
                        <span className="block text-xs text-ink-3">
                          {t("gpsTracking.stopRange", { from: bdiText(dt(s.from)), to: bdiText(dt(s.to)) })}
                        </span>
                        <span className="block text-xs text-ink-3"><Ltr>{`${s.lat.toFixed(5)}, ${s.lng.toFixed(5)}`}</Ltr></span>
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          </div>
          <div className="order-1 min-w-0 lg:order-2">
            <MapCanvas onMap={setMap} className="h-[55vh] lg:h-[calc(100vh-320px)] lg:min-h-[420px]" />
          </div>
        </div>
      )}
    </div>
  );
}
