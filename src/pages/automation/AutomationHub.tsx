/**
 * Workflow automation — module `workflow_automation`. Rules that react to
 * domain events (app.emit_event) with notifications, issues and webhooks.
 */
import { Suspense, lazy } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { HubNav } from "../../components/HubNav";
import { LoadingState, PageHeader } from "../../components/ui";
import { useT } from "../../i18n";

const RulesPage = lazy(() => import("./RulesPage"));
const RuleEditorPage = lazy(() => import("./RuleEditorPage"));
const RunsPage = lazy(() => import("./RunsTable"));

export default function AutomationHub() {
  const t = useT();
  const { pathname } = useLocation();
  // The rule editor carries its own header; the hub chrome is for the tabs.
  const onTab = !/^\/automation\/rules\/[^/]+/.test(pathname);

  return (
    <>
      {onTab && <PageHeader title={t("automation.title")} description={t("automation.subtitle")} />}
      {onTab && (
        <HubNav
          tabs={[
            { to: "/automation", labelKey: "automation.tab.rules", end: true },
            { to: "/automation/runs", labelKey: "automation.tab.runs" },
          ]}
        />
      )}
      <Suspense fallback={<LoadingState />}>
        <Routes>
          <Route index element={<RulesPage />} />
          <Route path="runs" element={<RunsPage />} />
          <Route path="rules/:ruleId" element={<RuleEditorPage />} />
          <Route path="*" element={<Navigate to="/automation" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}
