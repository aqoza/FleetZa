/**
 * BI analytics — module `bi_analytics`. Custom dashboards of KPIs and charts
 * over the tenant's own data. Metrics come from the whitelisted catalog in
 * shared/bi.ts, computed by public.bi_metric in migration
 * 20261008000031_bi_analytics.sql.
 */
import { Suspense, lazy } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { LoadingState, PageHeader } from "../../components/ui";
import { useT } from "../../i18n";

const DashboardsPage = lazy(() => import("./DashboardsPage"));
const DashboardPage = lazy(() => import("./DashboardPage"));

export default function AnalyticsHub() {
  const t = useT();
  const { pathname } = useLocation();
  // A dashboard carries its own header.
  const onList = /^\/analytics\/?$/.test(pathname);
  return (
    <>
      {onList && <PageHeader title={t("analytics.title")} description={t("analytics.subtitle")} />}
      <Suspense fallback={<LoadingState />}>
        <Routes>
          <Route index element={<DashboardsPage />} />
          <Route path=":id" element={<DashboardPage />} />
          <Route path="*" element={<Navigate to="/analytics" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}
