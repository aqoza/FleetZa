import type { MessageKey } from "../../i18n";

export type GeoResult =
  | { ok: true; lat: number; lng: number; accuracy: number }
  | { ok: false; reasonKey: MessageKey };

/**
 * One position fix from the browser. Never rejects: a denied permission, a
 * timeout or a browser without geolocation resolves with the reason, so a
 * check-in can still be saved without coordinates.
 */
export function getPosition(timeoutMs = 10000): Promise<GeoResult> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.resolve({ ok: false, reasonKey: "field.checkin.unsupported" });
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ ok: true, lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) =>
        resolve({
          ok: false,
          reasonKey: e.code === e.PERMISSION_DENIED ? "field.checkin.denied" : "field.checkin.unavailable",
        }),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60000 },
    );
  });
}
