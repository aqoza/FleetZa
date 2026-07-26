import { useState } from "react";
import { Plus, ReceiptText } from "lucide-react";
import { formatDate, formatMoney } from "../../lib/format";
import { invoiceStatus } from "../../lib/labels";
import { balanceDue, effectiveInvoiceStatus } from "../../lib/sales";
import type { Invoice } from "../../lib/types";
import { useAuth } from "../../context/AuthContext";
import { useT, type MessageKey } from "../../i18n";
import { Button, type BadgeTone } from "../../components/ui";
import { DocumentListPage } from "./DocumentListPage";
import { NewDocumentModal } from "./NewDocumentModal";

/** Stored statuses plus the derived "overdue" badge (see lib/sales.ts). */
const invoiceStatusWithOverdue: Record<string, { labelKey: MessageKey; tone: BadgeTone }> = {
  ...invoiceStatus,
  overdue: { labelKey: "enum.invoiceStatus.overdue", tone: "red" },
};

export default function InvoicesPage() {
  const t = useT();
  const { isManager } = useAuth();
  const [adding, setAdding] = useState(false);

  const newAction = isManager ? (
    <Button onClick={() => setAdding(true)}>
      <Plus className="h-4 w-4" /> {t("sales.invoices.new")}
    </Button>
  ) : undefined;

  return (
    <>
      <DocumentListPage<Invoice>
        config={{
          table: "invoices",
          tableId: "invoices",
          routeBase: "/sales/invoices",
          title: t("sales.invoices.title"),
          subtitle: t("sales.invoices.subtitle"),
          searchPlaceholder: t("sales.invoices.searchPlaceholder"),
          allStatusesLabel: t("sales.invoices.allStatuses"),
          statusMeta: invoiceStatusWithOverdue,
          primaryDate: {
            column: "issue_date",
            header: t("sales.doc.issueDate"),
            value: (i) => i.issue_date,
          },
          extraColumns: [
            {
              id: "dueDate",
              header: t("sales.doc.dueDate"),
              minBreakpoint: "lg",
              cell: (i) => <span className="text-ink-2">{formatDate(i.due_date)}</span>,
              sortValue: (i) => i.due_date,
              exportValue: (i) => i.due_date ?? "",
            },
            {
              id: "balance",
              header: t("sales.doc.balanceDue"),
              align: "end",
              minBreakpoint: "md",
              cell: (i) => {
                const balance = balanceDue(i);
                return (
                  <span className={balance > 0 ? "font-medium text-ink" : "text-ink-3"}>
                    {formatMoney(balance, i.currency)}
                  </span>
                );
              },
              sortValue: (i) => balanceDue(i),
              exportValue: (i) => balanceDue(i),
            },
          ],
          effectiveStatus: (i) => effectiveInvoiceStatus(i),
          newAction,
          emptyIcon: <ReceiptText className="h-10 w-10" />,
          emptyTitle: t("sales.invoices.emptyTitle"),
          emptyDesc: t("sales.invoices.emptyDesc"),
          emptyFilteredTitle: t("sales.invoices.emptyFilteredTitle"),
          emptyFilteredDesc: t("sales.invoices.emptyFilteredDesc"),
        }}
      />
      <NewDocumentModal
        open={adding}
        onClose={() => setAdding(false)}
        table="invoices"
        routeBase="/sales/invoices"
        title={t("sales.invoices.new")}
        dateColumn="due_date"
        dateLabel={t("sales.doc.dueDate")}
        defaultDays="payment_terms_days"
      />
    </>
  );
}
