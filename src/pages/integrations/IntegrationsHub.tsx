/**
 * Integrations — module `integrations`. API keys for the /api/v1 ingestion
 * endpoints, outbound webhooks (subscriptions + delivery log) and an in-app
 * API reference. Keys and webhooks are admin-only (RLS), the reference is
 * open to every member.
 */
import { Suspense, lazy, useEffect, type ReactElement } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import { HubNav } from "../../components/HubNav";
import { EmptyState, LoadingState, PageHeader } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { useT } from "../../i18n";
import { useDispatch } from "./hooks";

const WebhooksPage = lazy(() => import("./WebhooksPage"));
const DeliveriesPage = lazy(() => import("./DeliveriesPage"));
const ApiKeysPage = lazy(() => import("./ApiKeysPage"));
const ApiReferencePage = lazy(() => import("./ApiReferencePage"));

function AdminsOnly() {
  const t = useT();
  return (
    <EmptyState
      icon={<ShieldCheck className="h-10 w-10" />}
      title={t("integrations.adminsOnlyTitle")}
      description={t("integrations.adminsOnlyDesc")}
    />
  );
}

export default function IntegrationsHub() {
  const t = useT();
  const { isAdmin } = useAuth();
  const dispatch = useDispatch();
  const { mutate } = dispatch;

  // No cron: opening the page sends whatever deliveries are due.
  useEffect(() => {
    if (isAdmin) mutate();
  }, [isAdmin, mutate]);

  const guard = (el: ReactElement) => (isAdmin ? el : <AdminsOnly />);

  return (
    <>
      <PageHeader title={t("integrations.title")} description={t("integrations.subtitle")} />
      <HubNav
        tabs={[
          { to: "/integrations", labelKey: "integrations.tab.webhooks", end: true },
          { to: "/integrations/deliveries", labelKey: "integrations.tab.deliveries" },
          { to: "/integrations/api-keys", labelKey: "integrations.tab.apiKeys" },
          { to: "/integrations/api", labelKey: "integrations.tab.api" },
        ]}
      />
      <Suspense fallback={<LoadingState />}>
        <Routes>
          <Route index element={guard(<WebhooksPage />)} />
          <Route path="deliveries" element={guard(<DeliveriesPage />)} />
          <Route path="api-keys" element={guard(<ApiKeysPage />)} />
          <Route path="api" element={<ApiReferencePage />} />
          <Route path="*" element={<Navigate to="/integrations" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}
