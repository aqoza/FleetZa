/**
 * Transport management — module `tms`. Freight shipments for customers with
 * tracking, charges and margin, proof of delivery, lane rate cards and a draft
 * invoice when billing is on. Rules live in migration 20261008000021_tms.sql;
 * shared/tms.ts mirrors the status table and the rate lookup.
 */
import { Suspense, lazy } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { HubNav } from "../../components/HubNav";
import { LoadingState, PageHeader } from "../../components/ui";
import { useT } from "../../i18n";

const OverviewPage = lazy(() => import("./OverviewPage"));
const ShipmentsPage = lazy(() => import("./ShipmentsPage"));
const ShipmentDetailPage = lazy(() => import("./ShipmentDetailPage"));
const RatesPage = lazy(() => import("./RatesPage"));

export default function TmsHub() {
  const t = useT();
  const { pathname } = useLocation();
  // The shipment page carries its own header.
  const onTab = !/^\/tms\/s\/[^/]+/.test(pathname);

  return (
    <>
      {onTab && <PageHeader title={t("tms.title")} description={t("tms.subtitle")} />}
      {onTab && (
        <HubNav
          tabs={[
            { to: "/tms", labelKey: "tms.tab.overview", end: true },
            { to: "/tms/shipments", labelKey: "tms.tab.shipments" },
            { to: "/tms/rates", labelKey: "tms.tab.rates" },
          ]}
        />
      )}
      <Suspense fallback={<LoadingState />}>
        <Routes>
          <Route index element={<OverviewPage />} />
          <Route path="shipments" element={<ShipmentsPage />} />
          <Route path="s/:id" element={<ShipmentDetailPage />} />
          <Route path="rates" element={<RatesPage />} />
          <Route path="*" element={<Navigate to="/tms" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}
