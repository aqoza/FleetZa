/**
 * Trip planning — module `trip_planning`. Multi-stop trips per vehicle and
 * driver (numbered TRP), a week view, double-booking warnings and a hard block
 * on dispatch, start/complete flows with plan-versus-actual figures
 * (migration 20261008000018; pure helpers in shared/trips.ts).
 */
import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { HubNav } from "../../components/HubNav";
import { LoadingState, PageHeader } from "../../components/ui";
import { useT } from "../../i18n";

const OverviewPage = lazy(() => import("./OverviewPage"));
const TripsPage = lazy(() => import("./TripsPage"));
const WeekPage = lazy(() => import("./WeekPage"));
const TripDetailPage = lazy(() => import("./TripDetailPage"));

export default function TripsHub() {
  const t = useT();
  return (
    <>
      <PageHeader title={t("trips.title")} description={t("trips.subtitle")} />
      <HubNav
        tabs={[
          { to: "/trips", labelKey: "trips.tab.overview", end: true },
          { to: "/trips/list", labelKey: "trips.tab.trips" },
          { to: "/trips/week", labelKey: "trips.tab.week" },
        ]}
      />
      <Suspense fallback={<LoadingState />}>
        <Routes>
          <Route index element={<OverviewPage />} />
          <Route path="list" element={<TripsPage />} />
          <Route path="week" element={<WeekPage />} />
          <Route path=":id" element={<TripDetailPage />} />
          <Route path="*" element={<Navigate to="/trips" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}
