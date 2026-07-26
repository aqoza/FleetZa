import { useState } from "react";
import { FileText, Plus } from "lucide-react";
import { formatDate } from "../../lib/format";
import { quoteStatus } from "../../lib/labels";
import { effectiveQuoteStatus } from "../../lib/sales";
import type { Quote } from "../../lib/types";
import { useAuth } from "../../context/AuthContext";
import { useT } from "../../i18n";
import { Button } from "../../components/ui";
import { DocumentListPage } from "./DocumentListPage";
import { NewDocumentModal } from "./NewDocumentModal";
import { useSalesSettings } from "./shared";

export default function QuotesPage() {
  const t = useT();
  const { isManager } = useAuth();
  const [adding, setAdding] = useState(false);
  useSalesSettings(); // warm the cache so the modal seeds its dates immediately

  const newAction = isManager ? (
    <Button onClick={() => setAdding(true)}>
      <Plus className="h-4 w-4" /> {t("sales.quotes.new")}
    </Button>
  ) : undefined;

  return (
    <>
      <DocumentListPage<Quote>
        config={{
          table: "quotes",
          tableId: "quotes",
          routeBase: "/sales/quotes",
          title: t("sales.quotes.title"),
          subtitle: t("sales.quotes.subtitle"),
          searchPlaceholder: t("sales.quotes.searchPlaceholder"),
          allStatusesLabel: t("sales.quotes.allStatuses"),
          statusMeta: quoteStatus,
          primaryDate: {
            column: "issue_date",
            header: t("sales.doc.issueDate"),
            value: (q) => q.issue_date,
          },
          extraColumns: [
            {
              id: "validUntil",
              header: t("sales.doc.validUntil"),
              minBreakpoint: "lg",
              cell: (q) => <span className="text-ink-2">{formatDate(q.valid_until)}</span>,
              sortValue: (q) => q.valid_until,
              exportValue: (q) => q.valid_until ?? "",
            },
          ],
          // A sent quote past its validity date reads as expired without a
          // scheduler ever touching the row.
          effectiveStatus: (q) => effectiveQuoteStatus(q),
          newAction,
          emptyIcon: <FileText className="h-10 w-10" />,
          emptyTitle: t("sales.quotes.emptyTitle"),
          emptyDesc: t("sales.quotes.emptyDesc"),
          emptyFilteredTitle: t("sales.quotes.emptyFilteredTitle"),
          emptyFilteredDesc: t("sales.quotes.emptyFilteredDesc"),
        }}
      />
      <NewDocumentModal
        open={adding}
        onClose={() => setAdding(false)}
        table="quotes"
        routeBase="/sales/quotes"
        title={t("sales.quotes.new")}
        dateColumn="valid_until"
        dateLabel={t("sales.doc.validUntil")}
        defaultDays="quote_valid_days"
      />
    </>
  );
}
