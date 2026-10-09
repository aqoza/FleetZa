/**
 * Customer portal — module `customer_portal`. Staff triage the service
 * requests customers send from their portal; managers create, change, revoke
 * and delete the capability links customers open at /portal/:token (the token
 * is a secret, so only managers read links). The public side is
 * worker/customerPortal.ts; rules live in migration
 * 20261008000028_customer_portal.sql.
 */
import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { HubNav } from "../../components/HubNav";
import { LoadingState, PageHeader } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { useT } from "../../i18n";

const RequestsPage = lazy(() => import("./RequestsPage"));
const LinksPage = lazy(() => import("./LinksPage"));

export default function CustomerPortalHub() {
  const t = useT();
  const { isManager } = useAuth();

  return (
    <>
      <PageHeader title={t("customerPortal.title")} description={t("customerPortal.subtitle")} />
      <HubNav
        tabs={[
          { to: "/customer-portal", labelKey: "customerPortal.tab.requests", end: true },
          { to: "/customer-portal/links", labelKey: "customerPortal.tab.links", hidden: !isManager },
        ]}
      />
      <Suspense fallback={<LoadingState />}>
        <Routes>
          <Route index element={<RequestsPage />} />
          {isManager && <Route path="links" element={<LinksPage />} />}
          <Route path="*" element={<Navigate to="/customer-portal" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}
