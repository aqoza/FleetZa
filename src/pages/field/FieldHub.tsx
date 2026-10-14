/**
 * Field workforce — module `mobile_workforce`. Members linked to an employee
 * record work their tasks on a phone (check in, accept, tick the checklist,
 * capture a signature); managers create and follow every task and check-in.
 */
import { Suspense, lazy } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { HubNav } from "../../components/HubNav";
import { LoadingState, PageHeader } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { useT } from "../../i18n";
import { useMyEmployee } from "./hooks";

const MyTasksPage = lazy(() => import("./MyTasksPage"));
const TasksPage = lazy(() => import("./TasksPage"));
const TaskDetailPage = lazy(() => import("./TaskDetailPage"));
const CheckinsPage = lazy(() => import("./CheckinsPage"));

export default function FieldHub() {
  const t = useT();
  const { isManager } = useAuth();
  const { pathname } = useLocation();
  const meQ = useMyEmployee();
  // A task carries its own header; the hub chrome is for the tabs.
  const onTab = !/^\/field\/tasks\/[^/]+/.test(pathname);
  const hasProfile = !!meQ.data;

  return (
    <>
      {onTab && <PageHeader title={t("field.title")} description={t("field.subtitle")} />}
      {onTab && (
        <HubNav
          tabs={[
            { to: "/field", labelKey: "field.tab.mine", end: true, hidden: isManager && !hasProfile },
            { to: "/field/tasks", labelKey: "field.tab.tasks", end: true, hidden: !isManager },
            { to: "/field/checkins", labelKey: "field.tab.checkins" },
          ]}
        />
      )}
      <Suspense fallback={<LoadingState />}>
        <Routes>
          <Route index element={<MyTasksPage />} />
          {isManager && <Route path="tasks" element={<TasksPage />} />}
          <Route path="tasks/:taskId" element={<TaskDetailPage />} />
          <Route path="checkins" element={<CheckinsPage />} />
          <Route path="*" element={<Navigate to="/field" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}
