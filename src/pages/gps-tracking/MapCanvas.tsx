import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useT } from "../../i18n";

/** Muscat — a neutral start before the data fits the view. */
const DEFAULT_CENTER: L.LatLngExpression = [23.588, 58.3829];

/**
 * A Leaflet map with OpenStreetMap tiles (attribution required by the tile
 * policy). Always laid out left-to-right: maps don't mirror in RTL
 * (docs/I18N.md, charts and maps in dir="ltr"). The parent receives the map
 * instance and owns its layers.
 */
export function MapCanvas({
  onMap,
  className = "h-[60vh]",
}: {
  onMap: (map: L.Map | null) => void;
  className?: string;
}) {
  const t = useT();
  const el = useRef<HTMLDivElement>(null);
  const onMapRef = useRef(onMap);
  onMapRef.current = onMap;

  useEffect(() => {
    if (!el.current) return;
    const map = L.map(el.current, { center: DEFAULT_CENTER, zoom: 10, worldCopyJump: true });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    onMapRef.current(map);
    // The container can change size (tabs, sidebar): keep tiles in step.
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      onMapRef.current(null);
      map.remove();
    };
  }, []);

  return (
    <div dir="ltr" className={`relative z-0 overflow-hidden rounded-xl border border-line ${className}`}>
      <div ref={el} className="h-full w-full" role="region" aria-label={t("gpsTracking.map")} />
    </div>
  );
}

/** Fit the map to points once (or whenever `key` changes). */
export function fitTo(map: L.Map, points: Array<[number, number]>, maxZoom = 15) {
  if (points.length === 0) return;
  if (points.length === 1) map.setView(points[0], Math.min(maxZoom, 14));
  else map.fitBounds(L.latLngBounds(points), { padding: [24, 24], maxZoom });
}

/** A layer group that lives exactly as long as the given map instance. */
export function useLayer(map: L.Map | null): L.LayerGroup | null {
  const [group, setGroup] = useState<L.LayerGroup | null>(null);
  useEffect(() => {
    if (!map) return;
    const g = L.layerGroup().addTo(map);
    setGroup(g);
    return () => {
      g.remove();
      setGroup(null);
    };
  }, [map]);
  return group;
}
