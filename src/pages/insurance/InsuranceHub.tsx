/**
 * Insurance — module `insurance_mgmt`. Policies with their covered vehicles,
 * claims through settlement, premium spend against claims paid, and the
 * company vehicles nothing covers. Rules live in migration
 * 20261008000023_insurance.sql; shared/insurance.ts derives policy status.
 */
import { Suspense, lazy } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { HubNav } from "../../components/HubNav";
import { LoadingState, PageHeader } from "../../components/ui";
import { useT } from "../../i18n";

const OverviewPage = lazy(() => import("./OverviewPage"));
const PoliciesPage = lazy(() => import("./PoliciesPage"));
const PolicyDetailPage = lazy(() => import("./PolicyDetailPage"));
const ClaimsPage = lazy(() => import("./ClaimsPage"));
const ClaimDetailPage = lazy(() => import("./ClaimDetailPage"));

export default function InsuranceHub() {
  const t = useT();
  const { pathname } = useLocation();
  // Policy and claim pages carry their own header.
  const onTab = !/^\/insurance\/(policies|claims)\/[^/]+/.test(pathname);

  return (
    <>
      {onTab && <PageHeader title={t("insurance.title")} description={t("insurance.subtitle")} />}
      {onTab && (
        <HubNav
          tabs={[
            { to: "/insurance", labelKey: "insurance.tab.overview", end: true },
            { to: "/insurance/policies", labelKey: "insurance.tab.policies" },
            { to: "/insurance/claims", labelKey: "insurance.tab.claims" },
          ]}
        />
      )}
      <Suspense fallback={<LoadingState />}>
        <Routes>
          <Route index element={<OverviewPage />} />
          <Route path="policies" element={<PoliciesPage />} />
          <Route path="policies/:id" element={<PolicyDetailPage />} />
          <Route path="claims" element={<ClaimsPage />} />
          <Route path="claims/:id" element={<ClaimDetailPage />} />
          <Route path="*" element={<Navigate to="/insurance" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}
