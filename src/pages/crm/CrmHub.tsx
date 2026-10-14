/**
 * CRM — module `crm`. Leads, a pipeline of opportunities with a weighted
 * forecast, and the calls, meetings and tasks around them. Converting a lead
 * creates the customer (and its first opportunity); an opportunity can raise
 * its quotation when Sales is on. Rules live in migration
 * 20261008000026_crm.sql.
 */
import { Suspense, lazy } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { HubNav } from "../../components/HubNav";
import { LoadingState, PageHeader } from "../../components/ui";
import { useT } from "../../i18n";

const PipelinePage = lazy(() => import("./PipelinePage"));
const LeadsPage = lazy(() => import("./LeadsPage"));
const LeadDetailPage = lazy(() => import("./LeadDetailPage"));
const OpportunitiesPage = lazy(() => import("./OpportunitiesPage"));
const OpportunityDetailPage = lazy(() => import("./OpportunityDetailPage"));
const ActivitiesPage = lazy(() => import("./ActivitiesPage"));

export default function CrmHub() {
  const t = useT();
  const { pathname } = useLocation();
  // Lead and opportunity pages carry their own header.
  const onTab = !/^\/crm\/(leads|o)\/[^/]+/.test(pathname);

  return (
    <>
      {onTab && <PageHeader title={t("crm.title")} description={t("crm.subtitle")} />}
      {onTab && (
        <HubNav
          tabs={[
            { to: "/crm", labelKey: "crm.tab.pipeline", end: true },
            { to: "/crm/leads", labelKey: "crm.tab.leads" },
            { to: "/crm/opportunities", labelKey: "crm.tab.opportunities" },
            { to: "/crm/activities", labelKey: "crm.tab.activities" },
          ]}
        />
      )}
      <Suspense fallback={<LoadingState />}>
        <Routes>
          <Route index element={<PipelinePage />} />
          <Route path="leads" element={<LeadsPage />} />
          <Route path="leads/:id" element={<LeadDetailPage />} />
          <Route path="opportunities" element={<OpportunitiesPage />} />
          <Route path="o/:id" element={<OpportunityDetailPage />} />
          <Route path="activities" element={<ActivitiesPage />} />
          <Route path="*" element={<Navigate to="/crm" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}
