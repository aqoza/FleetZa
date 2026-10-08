/**
 * Purchasing — module `purchasing`. Purchase orders to suppliers, goods
 * receipts against them (stock in when inventory is on) and the vendor bills
 * and payments that settle them. The PO print view drops the hub chrome.
 */
import { Suspense, lazy } from "react";
import { NavLink, Route, Routes, useMatch } from "react-router-dom";
import { LoadingState, PageHeader } from "../../components/ui";
import { useT, type MessageKey } from "../../i18n";

const OrdersPage = lazy(() => import("./OrdersPage"));
const OrderDetailPage = lazy(() => import("./OrderDetailPage"));
const OrderPrintPage = lazy(() => import("./OrderPrintPage"));
const ReceiptsPage = lazy(() => import("./ReceiptsPage"));
const BillsPage = lazy(() => import("./BillsPage"));
const BillDetailPage = lazy(() => import("./BillDetailPage"));

const TABS: Array<{ to: string; labelKey: MessageKey; end?: boolean }> = [
  { to: "/purchasing", labelKey: "purchasing.tab.orders", end: true },
  { to: "/purchasing/receipts", labelKey: "purchasing.tab.receipts" },
  { to: "/purchasing/bills", labelKey: "purchasing.tab.bills" },
];

export default function PurchasingHub() {
  const t = useT();
  const printing = useMatch("/purchasing/orders/:orderId/print");
  const onOrder = useMatch("/purchasing/orders/*");

  return (
    <>
      {!printing && (
        <>
          <div className="print:hidden">
            <PageHeader title={t("purchasing.title")} description={t("purchasing.subtitle")} />
          </div>
          <nav className="mb-4 flex flex-wrap gap-2 print:hidden">
            {TABS.map(({ to, labelKey, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  isActive || (end && onOrder)
                    ? "rounded-full bg-brand-600 px-4 py-1.5 text-sm font-medium text-white shadow-sm"
                    : "rounded-full border border-line bg-surface px-4 py-1.5 text-sm font-medium text-ink-2 hover:bg-canvas"
                }
              >
                {t(labelKey)}
              </NavLink>
            ))}
          </nav>
        </>
      )}

      <Suspense fallback={<LoadingState />}>
        <Routes>
          <Route index element={<OrdersPage />} />
          <Route path="orders/:orderId" element={<OrderDetailPage />} />
          <Route path="orders/:orderId/print" element={<OrderPrintPage />} />
          <Route path="receipts" element={<ReceiptsPage />} />
          <Route path="bills" element={<BillsPage />} />
          <Route path="bills/:billId" element={<BillDetailPage />} />
        </Routes>
      </Suspense>
    </>
  );
}
