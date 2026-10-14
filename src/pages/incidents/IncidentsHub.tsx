/**
 * Incidents — module `incidents`. Accidents and safety incidents from report
 * through investigation and repair to closure, with the parties involved, a
 * status timeline, repair work orders and insurance claims raised from them,
 * and per-driver history. Rules live in migration 20261008000024_incidents.sql.
 */
import { Suspense, lazy } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { HubNav } from "../../components/HubNav";
import { LoadingState, PageHeader } from "../../components/ui";
import { useT } from "../../i18n";

const OverviewPage = lazy(() => import("./OverviewPage"));
const IncidentsPage = lazy(() => import("./IncidentsPage"));
const IncidentDetailPage = lazy(() => import("./IncidentDetailPage"));
const DriversPage = lazy(() => import("./DriversPage"));

export default function IncidentsHub() {
  const t = useT();
  const { pathname } = useLocation();
  // The incident page carries its own header.
  const onTab = !/^\/incidents\/i\/[^/]+/.test(pathname);

  return (
    <>
      {onTab && <PageHeader title={t("incidents.title")} description={t("incidents.subtitle")} />}
      {onTab && (
        <HubNav
          tabs={[
            { to: "/incidents", labelKey: "incidents.tab.overview", end: true },
            { to: "/incidents/list", labelKey: "incidents.tab.list" },
            { to: "/incidents/drivers", labelKey: "incidents.tab.drivers" },
          ]}
        />
      )}
      <Suspense fallback={<LoadingState />}>
        <Routes>
          <Route index element={<OverviewPage />} />
          <Route path="list" element={<IncidentsPage />} />
          <Route path="i/:id" element={<IncidentDetailPage />} />
          <Route path="drivers" element={<DriversPage />} />
          <Route path="*" element={<Navigate to="/incidents" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}
