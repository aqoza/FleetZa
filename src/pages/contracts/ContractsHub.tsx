/**
 * Contracts — module `contracts`. Customer contracts with a term, covered
 * vehicles and recurring billing: each due period becomes a draft invoice
 * (Billing on), and contracts renew or expire at their end. Rules live in
 * migration 20261008000027_contracts.sql.
 */
import { Suspense, lazy } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { HubNav } from "../../components/HubNav";
import { LoadingState, PageHeader } from "../../components/ui";
import { useT } from "../../i18n";

const OverviewPage = lazy(() => import("./OverviewPage"));
const ContractsPage = lazy(() => import("./ContractsPage"));
const ContractDetailPage = lazy(() => import("./ContractDetailPage"));

export default function ContractsHub() {
  const t = useT();
  const { pathname } = useLocation();
  // The contract page carries its own header.
  const onTab = !/^\/contracts\/c\/[^/]+/.test(pathname);

  return (
    <>
      {onTab && <PageHeader title={t("contracts.title")} description={t("contracts.subtitle")} />}
      {onTab && (
        <HubNav
          tabs={[
            { to: "/contracts", labelKey: "contracts.tab.overview", end: true },
            { to: "/contracts/list", labelKey: "contracts.tab.list" },
          ]}
        />
      )}
      <Suspense fallback={<LoadingState />}>
        <Routes>
          <Route index element={<OverviewPage />} />
          <Route path="list" element={<ContractsPage />} />
          <Route path="c/:id" element={<ContractDetailPage />} />
          <Route path="*" element={<Navigate to="/contracts" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}
