import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import L from "leaflet";
import { insertRow, updateRow } from "../../lib/db";
import { useT } from "../../i18n";
import { Button, ErrorState, Field, Input, Select, Textarea } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { MapCanvas, fitTo, useLayer } from "./MapCanvas";
import { drawGeofences } from "./layers";
import { geofenceColors } from "./labels";
import type { Geofence, GeofenceColor, GeofenceKind } from "./types";

/** "23.6, 58.4" per line → points; null when any line is not a coordinate pair. */
export function parsePoints(text: string): Array<[number, number]> | null {
  const out: Array<[number, number]> = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(/[,\s]+/).filter(Boolean).map(Number);
    if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) return null;
    const [lat, lng] = parts;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    out.push([lat, lng]);
  }
  return out;
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

export function GeofenceForm({
  geofence,
  others,
  onDone,
  onCancel,
}: {
  geofence?: Geofence;
  /** The tenant's other geofences, drawn faintly for context. */
  others: Geofence[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({
    name: geofence?.name ?? "",
    kind: geofence?.kind ?? ("circle" as GeofenceKind),
    center_lat: geofence?.center_lat != null ? String(geofence.center_lat) : "",
    center_lng: geofence?.center_lng != null ? String(geofence.center_lng) : "",
    radius_m: geofence?.radius_m != null ? String(geofence.radius_m) : "500",
    points: (geofence?.polygon ?? []).map(([a, b]) => `${a}, ${b}`).join("\n"),
    color: geofence?.color ?? ("blue" as GeofenceColor),
    active: geofence?.active ?? true,
    alert_on_enter: geofence?.alert_on_enter ?? false,
    alert_on_exit: geofence?.alert_on_exit ?? false,
    notes: geofence?.notes ?? "",
  });
  const [error, setError] = useState("");
  const [map, setMap] = useState<L.Map | null>(null);
  const shape = useLayer(map);
  const context = useLayer(map);
  const fitted = useRef(false);
  const kindRef = useRef(form.kind);
  kindRef.current = form.kind;

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // Clicks place the center (circle) or append a point (polygon).
  useEffect(() => {
    if (!map) return;
    const onClick = (e: L.LeafletMouseEvent) => {
      const lat = round(e.latlng.lat);
      const lng = round(e.latlng.lng);
      if (kindRef.current === "circle") setForm((f) => ({ ...f, center_lat: String(lat), center_lng: String(lng) }));
      else setForm((f) => ({ ...f, points: `${f.points.trim() ? `${f.points.trim()}\n` : ""}${lat}, ${lng}` }));
    };
    map.on("click", onClick);
    map.getContainer().style.cursor = "crosshair";
    return () => {
      map.off("click", onClick);
    };
  }, [map]);

  useEffect(() => {
    if (context) drawGeofences(context, others.filter((o) => o.id !== geofence?.id), { label: true });
  }, [context, others, geofence?.id]);

  const points = useMemo(() => parsePoints(form.points), [form.points]);
  const lat = form.center_lat === "" ? NaN : Number(form.center_lat);
  const lng = form.center_lng === "" ? NaN : Number(form.center_lng);
  const radius = Number(form.radius_m);

  // Live preview of the shape being drawn.
  useEffect(() => {
    if (!map || !shape) return;
    const g = shape;
    g.clearLayers();
    const color = geofenceColors[form.color].hex;
    const style = { color, weight: 3, fillColor: color, fillOpacity: 0.2 };
    let pts: Array<[number, number]> = [];
    if (form.kind === "circle" && Number.isFinite(lat) && Number.isFinite(lng)) {
      L.circle([lat, lng], { ...style, radius: Number.isFinite(radius) && radius > 0 ? radius : 10 }).addTo(g);
      L.circleMarker([lat, lng], { radius: 4, color, fillColor: color, fillOpacity: 1 }).addTo(g);
      pts = [[lat, lng]];
    } else if (form.kind === "polygon" && points && points.length > 0) {
      if (points.length >= 3) L.polygon(points, style).addTo(g);
      else L.polyline(points, style).addTo(g);
      for (const p of points) L.circleMarker(p, { radius: 4, color, fillColor: color, fillOpacity: 1 }).addTo(g);
      pts = points;
    }
    if (!fitted.current && pts.length > 0) {
      fitTo(map, pts, 15);
      if (form.kind === "circle" && Number.isFinite(radius)) map.fitBounds(L.latLng(lat, lng).toBounds(radius * 2.4));
      fitted.current = true;
    }
  }, [map, shape, form.kind, form.color, lat, lng, radius, points]);

  const mutation = useMutation({
    mutationFn: () => {
      const values: Record<string, unknown> = {
        name: form.name.trim(),
        kind: form.kind,
        color: form.color,
        active: form.active,
        alert_on_enter: form.alert_on_enter,
        alert_on_exit: form.alert_on_exit,
        notes: form.notes.trim() || null,
      };
      if (form.kind === "circle") {
        Object.assign(values, { center_lat: lat, center_lng: lng, radius_m: Math.round(radius), polygon: null });
      } else {
        Object.assign(values, { polygon: points, center_lat: null, center_lng: null, radius_m: null });
      }
      return geofence ? updateRow("geofences", geofence.id, values) : insertRow("geofences", values);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["geofences"] });
      toast.success(geofence ? t("gpsTracking.geofenceSaved") : t("gpsTracking.geofenceCreated"));
      onDone();
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("common.error")),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (form.kind === "circle" && !(Number.isFinite(lat) && Number.isFinite(lng))) return setError(t("gpsTracking.centerRequired"));
    if (form.kind === "polygon" && (!points || points.length < 3)) return setError(t("gpsTracking.pointsInvalid"));
    mutation.mutate();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && <ErrorState message={error} />}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t("gpsTracking.f.name")} required>
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} required maxLength={100} />
        </Field>
        <Field label={t("gpsTracking.f.kind")}>
          <Select value={form.kind} onChange={(e) => set("kind", e.target.value as GeofenceKind)}>
            <option value="circle">{t("gpsTracking.kind.circle")}</option>
            <option value="polygon">{t("gpsTracking.kind.polygon")}</option>
          </Select>
        </Field>
        <Field label={t("gpsTracking.f.color")}>
          <Select value={form.color} onChange={(e) => set("color", e.target.value as GeofenceColor)}>
            {Object.entries(geofenceColors).map(([v, c]) => (
              <option key={v} value={v}>{t(c.labelKey)}</option>
            ))}
          </Select>
        </Field>
      </div>

      <MapCanvas onMap={setMap} className="h-72 sm:h-80" />

      {form.kind === "circle" ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t("gpsTracking.f.centerLat")} hint={t("gpsTracking.f.centerHint")}>
            <Input type="number" dir="ltr" step="any" min={-90} max={90} value={form.center_lat} onChange={(e) => set("center_lat", e.target.value)} />
          </Field>
          <Field label={t("gpsTracking.f.centerLng")}>
            <Input type="number" dir="ltr" step="any" min={-180} max={180} value={form.center_lng} onChange={(e) => set("center_lng", e.target.value)} />
          </Field>
          <Field label={t("gpsTracking.f.radius")} required>
            <Input type="number" dir="ltr" min={10} max={100000} step={1} value={form.radius_m} onChange={(e) => set("radius_m", e.target.value)} required />
          </Field>
        </div>
      ) : (
        <Field label={t("gpsTracking.f.points")} hint={t("gpsTracking.f.pointsHint")}>
          <Textarea dir="ltr" rows={5} value={form.points} onChange={(e) => set("points", e.target.value)} className="font-mono text-xs" />
          {form.points.trim() && (
            <button type="button" className="mt-1 text-xs text-brand-700 hover:underline" onClick={() => set("points", "")}>
              {t("gpsTracking.clearPoints")}
            </button>
          )}
        </Field>
      )}

      <div className="space-y-2">
        {([
          ["alert_on_enter", "gpsTracking.f.alertEnter"],
          ["alert_on_exit", "gpsTracking.f.alertExit"],
        ] as const).map(([key, label]) => (
          <label key={key} className="flex items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" className="h-4 w-4 rounded border-line" checked={form[key]} onChange={(e) => set(key, e.target.checked)} />
            {t(label)}
          </label>
        ))}
        <label className="flex items-start gap-2 text-sm text-ink-2">
          <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-line" checked={form.active} onChange={(e) => set("active", e.target.checked)} />
          <span>
            <span className="font-medium">{t("gpsTracking.f.active")}</span>
            <span className="block text-xs text-ink-3">{t("gpsTracking.f.activeHint")}</span>
          </span>
        </label>
      </div>
      <Field label={t("gpsTracking.f.notes")}>
        <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} maxLength={2000} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>{t("action.cancel")}</Button>
        <Button type="submit" loading={mutation.isPending}>{geofence ? t("action.saveChanges") : t("action.create")}</Button>
      </div>
    </form>
  );
}
