/**
 * Companies & branches — module `multi_company`. Legal entities and the
 * branches vehicles, drivers, employees and warehouses are assigned to.
 */
import { Suspense, lazy } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { HubNav } from "../../components/HubNav";
import { LoadingState, PageHeader } from "../../components/ui";
import { useT } from "../../i18n";

const BranchesPage = lazy(() => import("./BranchesPage"));
const BranchDetailPage = lazy(() => import("./BranchDetailPage"));
const CompaniesPage = lazy(() => import("./CompaniesPage"));

export default function CompaniesHub() {
  const t = useT();
  const { pathname } = useLocation();
  // A branch page carries its own header; the hub chrome is for the tabs.
  const onTab = !/^\/companies\/branches\/[^/]+/.test(pathname);

  return (
    <>
      {onTab && <PageHeader title={t("companies.title")} description={t("companies.subtitle")} />}
      {onTab && (
        <HubNav
          tabs={[
            { to: "/companies", labelKey: "companies.tab.companies", end: true },
            { to: "/companies/branches", labelKey: "companies.tab.branches" },
          ]}
        />
      )}
      <Suspense fallback={<LoadingState />}>
        <Routes>
          <Route index element={<CompaniesPage />} />
          <Route path="branches" element={<BranchesPage />} />
          <Route path="branches/:branchId" element={<BranchDetailPage />} />
          <Route path="*" element={<Navigate to="/companies" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}
