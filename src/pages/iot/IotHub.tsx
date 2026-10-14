/**
 * IoT devices — module `iot_devices`. Sensors (serial per tenant, optionally
 * on a vehicle), their readings with a metric history chart, alert rules and
 * the alerts inbox (migration 20261008000016). Readings arrive through
 * POST /api/v1/iot/readings (worker/v1/iot.ts) or by hand on a device page.
 */
import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { HubNav } from "../../components/HubNav";
import { LoadingState, PageHeader } from "../../components/ui";
import { useT } from "../../i18n";

const DevicesPage = lazy(() => import("./DevicesPage"));
const DevicePage = lazy(() => import("./DevicePage"));
const AlertsPage = lazy(() => import("./AlertsPage"));
const RulesPage = lazy(() => import("./RulesPage"));

export default function IotHub() {
  const t = useT();
  return (
    <>
      <PageHeader title={t("iot.title")} description={t("iot.subtitle")} />
      <HubNav
        tabs={[
          { to: "/iot", labelKey: "iot.tab.devices", end: true },
          { to: "/iot/alerts", labelKey: "iot.tab.alerts" },
          { to: "/iot/rules", labelKey: "iot.tab.rules" },
        ]}
      />
      <Suspense fallback={<LoadingState />}>
        <Routes>
          <Route index element={<DevicesPage />} />
          <Route path="devices/:id" element={<DevicePage />} />
          <Route path="alerts" element={<AlertsPage />} />
          <Route path="rules" element={<RulesPage />} />
          <Route path="*" element={<Navigate to="/iot" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}
