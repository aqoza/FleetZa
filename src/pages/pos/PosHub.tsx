/**
 * Point of sale — module `pos`. A counter till: registers, cash sessions with
 * an opening float and a Z-report on close, checkout from the product catalog
 * with cash/card/other tender, refunds and 80 mm receipts. Stock moves post to
 * the register's warehouse when Inventory is on. Rules live in migration
 * 20261008000030_pos.sql.
 */
import { Suspense, lazy } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { HubNav } from "../../components/HubNav";
import { LoadingState, PageHeader } from "../../components/ui";
import { useT } from "../../i18n";

const RegisterPage = lazy(() => import("./RegisterPage"));
const OrdersPage = lazy(() => import("./OrdersPage"));
const SessionsPage = lazy(() => import("./SessionsPage"));
const RegistersPage = lazy(() => import("./RegistersPage"));
const ReceiptPage = lazy(() => import("./ReceiptPage"));

export default function PosHub() {
  const t = useT();
  const { pathname } = useLocation();
  // The receipt prints alone.
  const onTab = !/\/receipt$/.test(pathname);

  return (
    <>
      {onTab && <PageHeader title={t("pos.title")} description={t("pos.subtitle")} />}
      {onTab && (
        <HubNav
          tabs={[
            { to: "/pos", labelKey: "pos.tab.register", end: true },
            { to: "/pos/orders", labelKey: "pos.tab.orders" },
            { to: "/pos/sessions", labelKey: "pos.tab.sessions" },
            { to: "/pos/registers", labelKey: "pos.tab.registers" },
          ]}
        />
      )}
      <Suspense fallback={<LoadingState />}>
        <Routes>
          <Route index element={<RegisterPage />} />
          <Route path="orders" element={<OrdersPage />} />
          <Route path="orders/:id/receipt" element={<ReceiptPage />} />
          <Route path="sessions" element={<SessionsPage />} />
          <Route path="registers" element={<RegistersPage />} />
          <Route path="*" element={<Navigate to="/pos" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}
