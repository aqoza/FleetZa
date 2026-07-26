import { useState } from "react";
import { ClipboardList, Plus } from "lucide-react";
import { formatMoney } from "../../lib/format";
import { salesOrderStatus } from "../../lib/labels";
import type { SalesOrder } from "../../lib/types";
import { useAuth } from "../../context/AuthContext";
import { useT } from "../../i18n";
import { Button } from "../../components/ui";
import { DocumentListPage } from "./DocumentListPage";
import { NewDocumentModal } from "./NewDocumentModal";

export default function OrdersPage() {
  const t = useT();
  const { isManager } = useAuth();
  const [adding, setAdding] = useState(false);

  const newAction = isManager ? (
    <Button onClick={() => setAdding(true)}>
      <Plus className="h-4 w-4" /> {t("sales.orders.new")}
    </Button>
  ) : undefined;

  return (
    <>
      <DocumentListPage<SalesOrder>
        config={{
          table: "sales_orders",
          tableId: "sales_orders",
          routeBase: "/sales/orders",
          title: t("sales.orders.title"),
          subtitle: t("sales.orders.subtitle"),
          searchPlaceholder: t("sales.orders.searchPlaceholder"),
          allStatusesLabel: t("sales.quotes.allStatuses"),
          statusMeta: salesOrderStatus,
          primaryDate: {
            column: "order_date",
            header: t("sales.doc.orderDate"),
            value: (o) => o.order_date,
          },
          extraColumns: [
            {
              id: "invoiced",
              header: t("sales.orders.invoiced"),
              align: "end",
              minBreakpoint: "lg",
              cell: (o) => (
                <span className="text-ink-2">{formatMoney(o.invoiced_total, o.currency)}</span>
              ),
              sortValue: (o) => o.invoiced_total,
              exportValue: (o) => o.invoiced_total,
            },
          ],
          newAction,
          emptyIcon: <ClipboardList className="h-10 w-10" />,
          emptyTitle: t("sales.orders.emptyTitle"),
          emptyDesc: t("sales.orders.emptyDesc"),
          emptyFilteredTitle: t("sales.orders.emptyFilteredTitle"),
          emptyFilteredDesc: t("sales.orders.emptyFilteredDesc"),
        }}
      />
      <NewDocumentModal
        open={adding}
        onClose={() => setAdding(false)}
        table="sales_orders"
        routeBase="/sales/orders"
        title={t("sales.orders.new")}
        dateColumn="expected_date"
        dateLabel={t("sales.doc.expectedDate")}
      />
    </>
  );
}
