/**
 * GPS tracking — module `gps_tracking`. Live map of each vehicle's newest
 * fix, route history with stops, geofences and the enter / exit events the
 * database records when a fix crosses one (migration 20261008000014).
 * Positions arrive through POST /api/v1/positions (worker/v1/positions.ts),
 * or by hand / CSV on the Positions tab.
 */
import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { HubNav } from "../../components/HubNav";
import { LoadingState, PageHeader } from "../../components/ui";
import { useT } from "../../i18n";

const LiveMapPage = lazy(() => import("./LiveMapPage"));
const HistoryPage = lazy(() => import("./HistoryPage"));
const GeofencesPage = lazy(() => import("./GeofencesPage"));
const EventsPage = lazy(() => import("./EventsPage"));
const PositionsPage = lazy(() => import("./PositionsPage"));

export default function GpsTrackingHub() {
  const t = useT();
  return (
    <>
      <PageHeader title={t("gpsTracking.title")} description={t("gpsTracking.subtitle")} />
      <HubNav
        tabs={[
          { to: "/gps", labelKey: "gpsTracking.tab.live", end: true },
          { to: "/gps/history", labelKey: "gpsTracking.tab.history" },
          { to: "/gps/geofences", labelKey: "gpsTracking.tab.geofences" },
          { to: "/gps/events", labelKey: "gpsTracking.tab.events" },
          { to: "/gps/positions", labelKey: "gpsTracking.tab.positions" },
        ]}
      />
      <Suspense fallback={<LoadingState />}>
        <Routes>
          <Route index element={<LiveMapPage />} />
          <Route path="history" element={<HistoryPage />} />
          <Route path="geofences" element={<GeofencesPage />} />
          <Route path="events" element={<EventsPage />} />
          <Route path="positions" element={<PositionsPage />} />
          <Route path="*" element={<Navigate to="/gps" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}
