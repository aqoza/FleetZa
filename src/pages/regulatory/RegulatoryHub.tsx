/**
 * Regulatory compliance — module `regulatory`. A register of the permits,
 * licenses, inspections and filings that apply to the company, its vehicles,
 * drivers and employees (with starter templates per GCC country), the dated
 * obligations that track them, and compliance figures. Rules live in
 * migration 20261008000025_regulatory.sql; shared/regulatory.ts derives states.
 */
import { Suspense, lazy } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { HubNav } from "../../components/HubNav";
import { LoadingState, PageHeader } from "../../components/ui";
import { useT } from "../../i18n";

const OverviewPage = lazy(() => import("./OverviewPage"));
const ObligationsPage = lazy(() => import("./ObligationsPage"));
const RequirementsPage = lazy(() => import("./RequirementsPage"));
const RequirementDetailPage = lazy(() => import("./RequirementDetailPage"));

export default function RegulatoryHub() {
  const t = useT();
  const { pathname } = useLocation();
  // The requirement page carries its own header.
  const onTab = !/^\/regulatory\/requirements\/[^/]+/.test(pathname);

  return (
    <>
      {onTab && <PageHeader title={t("regulatory.title")} description={t("regulatory.subtitle")} />}
      {onTab && (
        <HubNav
          tabs={[
            { to: "/regulatory", labelKey: "regulatory.tab.overview", end: true },
            { to: "/regulatory/obligations", labelKey: "regulatory.tab.obligations" },
            { to: "/regulatory/requirements", labelKey: "regulatory.tab.requirements" },
          ]}
        />
      )}
      <Suspense fallback={<LoadingState />}>
        <Routes>
          <Route index element={<OverviewPage />} />
          <Route path="obligations" element={<ObligationsPage />} />
          <Route path="requirements" element={<RequirementsPage />} />
          <Route path="requirements/:id" element={<RequirementDetailPage />} />
          <Route path="*" element={<Navigate to="/regulatory" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}
