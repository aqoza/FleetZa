/**
 * The printable / PDF-able face of a sales document — the thing the customer
 * actually receives. One component for all three types: a quotation, a sales
 * order and a tax invoice differ in their heading and a couple of date rows,
 * not in their anatomy.
 *
 * Print is the export path: browsers "Save as PDF" from here, which is why the
 * layout is print-first (`print:` utilities strip the app chrome) rather than a
 * separate generator.
 */
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { getCountry } from "../../../shared/countries";
import { getRow, listRows, type TableName } from "../../lib/db";
import { formatDate, formatMoney } from "../../lib/format";
import { balanceDue } from "../../lib/sales";
import type { Customer, Invoice, Quote, SalesOrder } from "../../lib/types";
import { useTenant } from "../../context/AuthContext";
import { useT, type MessageKey } from "../../i18n";
import { Button, Card, ErrorState, LoadingState } from "../../components/ui";
import { BackLink, taxHeading, type EditableLine } from "./shared";

type DocKind = "quote" | "order" | "invoice";

const CONFIG: Record<
  DocKind,
  {
    table: TableName;
    linesTable: TableName;
    parentColumn: string;
    routeBase: string;
    headingKey: MessageKey;
    backKey: MessageKey;
    notFoundKey: MessageKey;
  }
> = {
  quote: {
    table: "quotes",
    linesTable: "quote_lines",
    parentColumn: "quote_id",
    routeBase: "/sales/quotes",
    headingKey: "sales.print.quote",
    backKey: "sales.quotes.title",
    notFoundKey: "sales.quotes.notFound",
  },
  order: {
    table: "sales_orders",
    linesTable: "sales_order_lines",
    parentColumn: "sales_order_id",
    routeBase: "/sales/orders",
    headingKey: "sales.print.order",
    backKey: "sales.orders.title",
    notFoundKey: "sales.orders.notFound",
  },
  invoice: {
    table: "invoices",
    linesTable: "invoice_lines",
    parentColumn: "invoice_id",
    routeBase: "/sales/invoices",
    headingKey: "sales.print.invoice",
    backKey: "sales.invoices.title",
    notFoundKey: "sales.invoices.notFound",
  },
};

type AnyDoc = Quote & SalesOrder & Invoice;

export default function DocumentPrintPage({ kind }: { kind: DocKind }) {
  const t = useT();
  const tenant = useTenant();
  const params = useParams();
  const config = CONFIG[kind];
  const id = params.quoteId ?? params.orderId ?? params.invoiceId ?? "";

  const docQ = useQuery({
    queryKey: [config.table, id],
    queryFn: () => getRow<AnyDoc>(config.table, id),
  });
  const linesQ = useQuery({
    queryKey: [config.linesTable, id],
    queryFn: () =>
      listRows<EditableLine>(config.linesTable, (q) =>
        q.eq(config.parentColumn, id).order("sort_order").order("created_at"),
      ),
  });
  const customerQ = useQuery({
    queryKey: ["customers", docQ.data?.customer_id],
    queryFn: () => getRow<Customer>("customers", docQ.data!.customer_id),
    enabled: Boolean(docQ.data?.customer_id),
  });

  if (docQ.isLoading || linesQ.isLoading) return <LoadingState />;
  if (docQ.error) return <ErrorState message={(docQ.error as Error).message} />;
  const doc = docQ.data;
  if (!doc) return <ErrorState message={t(config.notFoundKey)} />;

  const lines = linesQ.data ?? [];
  const customer = customerQ.data;
  const country = getCountry(tenant.country);
  const money = (v: number) => formatMoney(v, doc.currency);
  const taxLabel = taxHeading(t, country.tax.label, lines.map((l) => l.tax_rate));

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <BackLink to={`${config.routeBase}/${doc.id}`} label={t(config.backKey)} />
        <Button onClick={() => window.print()}>
          <Printer className="h-4 w-4" /> {t("sales.print.action")}
        </Button>
      </div>

      <Card className="mx-auto max-w-3xl px-10 py-8 print:border-0 print:shadow-none">
        <header className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <h1 className="text-2xl font-bold tracking-wide text-brand-700 rtl:tracking-normal">
              {tenant.name}
            </h1>
            <div className="mt-1 space-y-0.5 text-xs text-ink-3">
              {tenant.address && <div>{tenant.address}</div>}
              {tenant.phone && <div dir="ltr">{tenant.phone}</div>}
              {tenant.tax_registration_number && (
                <div>
                  {t("sales.print.taxNumber")}: {tenant.tax_registration_number}
                </div>
              )}
            </div>
          </div>
          <div className="text-end">
            <div className="text-sm font-semibold uppercase tracking-wide text-ink rtl:tracking-normal">
              {t(config.headingKey)}
            </div>
            <div className="mt-1 text-lg font-bold text-ink tabular-nums">{doc.doc_number}</div>
          </div>
        </header>

        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-3 rtl:tracking-normal">
              {t("sales.print.billTo")}
            </div>
            <div className="mt-1.5 text-sm text-ink">
              <div className="font-semibold">{customer?.name ?? "—"}</div>
              {customer?.address && <div className="text-ink-2">{customer.address}</div>}
              {(customer?.city || customer?.country) && (
                <div className="text-ink-2">
                  {[customer.city, customer.country].filter(Boolean).join(", ")}
                </div>
              )}
              {customer?.tax_number && (
                <div className="text-ink-2">
                  {t("sales.print.taxNumber")}: {customer.tax_number}
                </div>
              )}
              {customer?.cr_number && (
                <div className="text-ink-2">
                  {t("sales.print.crNumber")}: {customer.cr_number}
                </div>
              )}
            </div>
          </div>
          <dl className="space-y-1 text-sm">
            <PrintRow label={t("sales.doc.issueDate")} value={formatDate(doc.issue_date ?? doc.order_date)} />
            {kind === "quote" && doc.valid_until && (
              <PrintRow label={t("sales.doc.validUntil")} value={formatDate(doc.valid_until)} />
            )}
            {kind === "order" && doc.expected_date && (
              <PrintRow label={t("sales.doc.expectedDate")} value={formatDate(doc.expected_date)} />
            )}
            {kind === "invoice" && doc.due_date && (
              <PrintRow label={t("sales.doc.dueDate")} value={formatDate(doc.due_date)} />
            )}
            {doc.customer_reference && (
              <PrintRow label={t("sales.doc.reference")} value={doc.customer_reference} />
            )}
            {doc.title && <PrintRow label={t("sales.doc.title")} value={doc.title} />}
          </dl>
        </div>

        <table className="mt-8 w-full text-sm">
          <thead>
            <tr className="border-b-2 border-ink/80">
              <th className="py-2 text-start text-[11px] font-semibold uppercase tracking-wider text-ink-3 rtl:tracking-normal">
                {t("sales.print.item")}
              </th>
              <th className="py-2 text-end text-[11px] font-semibold uppercase tracking-wider text-ink-3 rtl:tracking-normal">
                {t("sales.lines.qty")}
              </th>
              <th className="py-2 text-end text-[11px] font-semibold uppercase tracking-wider text-ink-3 rtl:tracking-normal">
                {t("sales.lines.unitPrice")}
              </th>
              <th className="py-2 text-end text-[11px] font-semibold uppercase tracking-wider text-ink-3 rtl:tracking-normal">
                {t("sales.lines.lineTotal")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {lines.map((line) => (
              <tr key={line.id}>
                <td className="py-2.5 text-ink">
                  {line.description}
                  {line.discount_percent > 0 && (
                    <span className="ms-2 text-xs text-ink-3">
                      −{line.discount_percent}%
                    </span>
                  )}
                </td>
                <td className="py-2.5 text-end text-ink-2 tabular-nums">
                  {line.quantity}{line.unit ? ` ${line.unit}` : ""}
                </td>
                <td className="py-2.5 text-end text-ink-2 tabular-nums">
                  {money(line.unit_price)}
                </td>
                <td className="py-2.5 text-end font-medium text-ink tabular-nums">
                  {money(line.line_total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-6 flex justify-end">
          <dl className="w-64 space-y-1.5 text-sm tabular-nums">
            <PrintRow label={t("sales.doc.subtotal")} value={money(doc.subtotal)} />
            {doc.discount_total > 0 && (
              <PrintRow label={t("sales.doc.discount")} value={`− ${money(doc.discount_total)}`} />
            )}
            {doc.tax_total > 0 && <PrintRow label={taxLabel} value={money(doc.tax_total)} />}
            <div className="border-t border-ink/70 pt-1.5">
              <PrintRow label={t("sales.doc.total")} value={money(doc.total)} strong />
            </div>
            {kind === "invoice" && doc.amount_paid > 0 && (
              <>
                <PrintRow label={t("sales.doc.amountPaid")} value={money(doc.amount_paid)} />
                <PrintRow
                  label={t("sales.doc.balanceDue")}
                  value={money(balanceDue(doc))}
                  strong
                />
              </>
            )}
          </dl>
        </div>

        {doc.notes && (
          <p className="mt-6 whitespace-pre-line text-sm text-ink-2">{doc.notes}</p>
        )}
        {doc.terms && (
          <div className="mt-6 border-t border-line pt-4">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-3 rtl:tracking-normal">
              {t("sales.doc.terms")}
            </div>
            <p className="mt-1.5 whitespace-pre-line text-xs text-ink-2">{doc.terms}</p>
          </div>
        )}

        <footer className="mt-8 border-t border-line pt-3 text-center text-[11px] text-ink-3">
          <p>{t("sales.print.thankYou")}</p>
          <p className="mt-0.5">{t("sales.print.generatedBy")}</p>
        </footer>
      </Card>
    </>
  );
}

function PrintRow({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className={strong ? "font-semibold text-ink" : "text-ink-3"}>{label}</dt>
      <dd className={strong ? "text-base font-semibold text-ink" : "text-ink"}>{value}</dd>
    </div>
  );
}
