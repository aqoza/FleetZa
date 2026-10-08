/**
 * Deliveries — module `logistics_delivery`. Last-mile deliveries grouped into
 * daily routes, with proof of delivery and cash on delivery. Rules live in
 * migration 20261008000020_deliveries.sql; shared/deliveries.ts mirrors them.
 * The public tracking page is PublicTrackingPage (/track/:token).
 */
import { Suspense, lazy } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { HubNav } from "../../components/HubNav";
import { LoadingState, PageHeader } from "../../components/ui";
import { useT } from "../../i18n";

const OverviewPage = lazy(() => import("./OverviewPage"));
const DeliveriesPage = lazy(() => import("./DeliveriesPage"));
const DeliveryDetailPage = lazy(() => import("./DeliveryDetailPage"));
const RoutesPage = lazy(() => import("./RoutesPage"));
const RouteDetailPage = lazy(() => import("./RouteDetailPage"));
const RunSheetPage = lazy(() => import("./RunSheetPage"));

export default function DeliveriesHub() {
  const t = useT();
  const { pathname } = useLocation();
  // Detail pages and the run sheet carry their own header.
  const onTab = !/^\/deliveries\/(d|routes)\/[^/]+/.test(pathname);

  return (
    <>
      {onTab && <PageHeader title={t("deliveries.title")} description={t("deliveries.subtitle")} />}
      {onTab && (
        <HubNav
          tabs={[
            { to: "/deliveries", labelKey: "deliveries.tab.overview", end: true },
            { to: "/deliveries/list", labelKey: "deliveries.tab.list" },
            { to: "/deliveries/routes", labelKey: "deliveries.tab.routes" },
          ]}
        />
      )}
      <Suspense fallback={<LoadingState />}>
        <Routes>
          <Route index element={<OverviewPage />} />
          <Route path="list" element={<DeliveriesPage />} />
          <Route path="d/:id" element={<DeliveryDetailPage />} />
          <Route path="routes" element={<RoutesPage />} />
          <Route path="routes/:id" element={<RouteDetailPage />} />
          <Route path="routes/:id/run" element={<RunSheetPage />} />
          <Route path="*" element={<Navigate to="/deliveries" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}
