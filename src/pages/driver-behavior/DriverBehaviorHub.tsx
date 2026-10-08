/**
 * Driver behavior — module `driver_behavior`. Safety events (from telematics
 * through POST /api/v1/driving-events, or logged by a manager), a scoreboard
 * computed by public.driver_scores (penalty points per 100 km, mirrored in
 * shared/driverScore.ts), per-driver detail and coaching sessions
 * (migration 20261008000015).
 */
import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { HubNav } from "../../components/HubNav";
import { LoadingState, PageHeader } from "../../components/ui";
import { useT } from "../../i18n";

const ScoreboardPage = lazy(() => import("./ScoreboardPage"));
const EventsPage = lazy(() => import("./EventsPage"));
const CoachingPage = lazy(() => import("./CoachingPage"));
const DriverPage = lazy(() => import("./DriverPage"));

export default function DriverBehaviorHub() {
  const t = useT();
  return (
    <>
      <PageHeader title={t("driverBehavior.title")} description={t("driverBehavior.subtitle")} />
      <HubNav
        tabs={[
          { to: "/driver-behavior", labelKey: "driverBehavior.tab.scoreboard", end: true },
          { to: "/driver-behavior/events", labelKey: "driverBehavior.tab.events" },
          { to: "/driver-behavior/coaching", labelKey: "driverBehavior.tab.coaching" },
        ]}
      />
      <Suspense fallback={<LoadingState />}>
        <Routes>
          <Route index element={<ScoreboardPage />} />
          <Route path="events" element={<EventsPage />} />
          <Route path="coaching" element={<CoachingPage />} />
          <Route path="drivers/:id" element={<DriverPage />} />
          <Route path="*" element={<Navigate to="/driver-behavior" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}
