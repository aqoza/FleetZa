import L from "leaflet";
import { geofenceColors } from "./labels";
import type { Geofence } from "./types";

/** Draw geofences into a layer group (cleared first). */
export function drawGeofences(group: L.LayerGroup, fences: Geofence[], opts: { label?: boolean } = {}) {
  group.clearLayers();
  for (const g of fences) {
    const color = geofenceColors[g.color]?.hex ?? geofenceColors.blue.hex;
    const style: L.PathOptions = { color, weight: 2, fillColor: color, fillOpacity: g.active ? 0.12 : 0.04, dashArray: g.active ? undefined : "4 4" };
    let layer: L.Path | null = null;
    if (g.kind === "circle" && g.center_lat != null && g.center_lng != null && g.radius_m != null) {
      layer = L.circle([Number(g.center_lat), Number(g.center_lng)], { ...style, radius: g.radius_m });
    } else if (g.kind === "polygon" && g.polygon && g.polygon.length >= 3) {
      layer = L.polygon(g.polygon.map(([a, b]) => [Number(a), Number(b)] as [number, number]), style);
    }
    if (layer) {
      if (opts.label !== false) layer.bindTooltip(g.name);
      layer.addTo(group);
    }
  }
}

/** Every point a geofence covers, for fitting the view. */
export function geofencePoints(fences: Geofence[]): Array<[number, number]> {
  return fences.flatMap((g) =>
    g.kind === "circle" && g.center_lat != null && g.center_lng != null
      ? [[Number(g.center_lat), Number(g.center_lng)] as [number, number]]
      : (g.polygon ?? []).map(([a, b]) => [Number(a), Number(b)] as [number, number]),
  );
}

/** Escape user text before it goes into Leaflet's HTML tooltips/popups. */
export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
