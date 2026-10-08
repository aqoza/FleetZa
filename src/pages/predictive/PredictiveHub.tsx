/**
 * Predictive maintenance — module `predictive_ai`. Rule-based, explainable
 * risk scores per vehicle (public.predictive_vehicle_health(), mirrored by
 * shared/predictive.ts), an odometer forecast, and saved predictions that end
 * as a work order or a dismissal (migration 20261008000017).
 */
import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { HubNav } from "../../components/HubNav";
import { LoadingState, PageHeader } from "../../components/ui";
import { useT } from "../../i18n";

const RiskPage = lazy(() => import("./RiskPage"));
const VehicleRiskPage = lazy(() => import("./VehicleRiskPage"));
const PredictionsPage = lazy(() => import("./PredictionsPage"));

export default function PredictiveHub() {
  const t = useT();
  return (
    <>
      <PageHeader title={t("predictive.title")} description={t("predictive.subtitle")} />
      <HubNav
        tabs={[
          { to: "/predictive", labelKey: "predictive.tab.risk", end: true },
          { to: "/predictive/predictions", labelKey: "predictive.tab.predictions" },
        ]}
      />
      <Suspense fallback={<LoadingState />}>
        <Routes>
          <Route index element={<RiskPage />} />
          <Route path="predictions" element={<PredictionsPage />} />
          <Route path="vehicles/:id" element={<VehicleRiskPage />} />
          <Route path="*" element={<Navigate to="/predictive" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}
