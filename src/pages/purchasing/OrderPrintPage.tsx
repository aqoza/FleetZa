/**
 * The printable purchase order — what the supplier receives. Same print-first
 * anatomy as the sales documents (sales/DocumentPrintPage), addressed to the
 * supplier and with the delivery warehouse in place of a bill-to block.
 */
import type { ReactNode } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { getCountry } from "../../../shared/countries";
import { getRow, listRows } from "../../lib/db";
import { formatDate, formatMoney } from "../../lib/format";
import type { Tables } from "../../lib/database.types";
import { useTenant } from "../../context/AuthContext";
import { useI18n, useT } from "../../i18n";
import { Bdi, Button, Card, ErrorState, LoadingState, Ltr } from "../../components/ui";
import { BackLink, taxHeading } from "../sales/shared";
import { supplierName } from "./labels";
import { PO_SELECT, type PurchaseOrder } from "./types";

type Line = Tables<"purchase_order_lines">;

export default function OrderPrintPage() {
  const t = useT();
  const { language } = useI18n();
  const tenant = useTenant();
  const { orderId = "" } = useParams();

  const orderQ = useQuery({
    queryKey: ["purchase_orders", "one", orderId],
    queryFn: async () => (await listRows<PurchaseOrder>("purchase_orders", (q) => q.select(PO_SELECT).eq("id", orderId).limit(1)))[0] ?? null,
  });
  const linesQ = useQuery({
    queryKey: ["purchase_order_lines", orderId, "print"],
    queryFn: () => listRows<Line>("purchase_order_lines", (q) => q.eq("purchase_order_id", orderId).order("sort_order").order("created_at").limit(500)),
  });
  const supplierQ = useQuery({
    queryKey: ["suppliers", orderQ.data?.supplier_id],
    queryFn: () => getRow<Tables<"suppliers">>("suppliers", orderQ.data!.supplier_id),
    enabled: Boolean(orderQ.data?.supplier_id),
  });

  if (orderQ.isLoading || linesQ.isLoading) return <LoadingState />;
  if (orderQ.error) return <ErrorState message={(orderQ.error as Error).message} />;
  const order = orderQ.data;
  if (!order) return <ErrorState message={t("purchasing.orderNotFound")} />;

  const lines = linesQ.data ?? [];
  const supplier = supplierQ.data;
  const country = getCountry(tenant.country);
  const money = (v: number) => formatMoney(v, order.currency);
  const taxLabel = taxHeading(t, country.tax.label, lines.map((l) => Number(l.tax_rate)));
  const th = "py-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3 rtl:tracking-normal";

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <BackLink to={`/purchasing/orders/${order.id}`} label={t("purchasing.order")} />
        <Button onClick={() => window.print()}>
          <Printer className="h-4 w-4" /> {t("purchasing.printAction")}
        </Button>
      </div>

      <Card className="mx-auto max-w-3xl px-6 py-8 sm:px-10 print:border-0 print:shadow-none">
        <header className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <h1 className="text-2xl font-bold tracking-wide text-brand-700 rtl:tracking-normal"><Bdi>{tenant.name}</Bdi></h1>
            <div className="mt-1 space-y-0.5 text-xs text-ink-3">
              {tenant.address && <div><Bdi>{tenant.address}</Bdi></div>}
              {tenant.phone && <div><Ltr>{tenant.phone}</Ltr></div>}
              {tenant.tax_registration_number && (
                <div>{t("purchasing.printTaxNumber")}: <Ltr>{tenant.tax_registration_number}</Ltr></div>
              )}
            </div>
          </div>
          <div className="text-end">
            <div className="text-sm font-semibold uppercase tracking-wide text-ink rtl:tracking-normal">{t("purchasing.printHeading")}</div>
            <div className="mt-1 text-lg font-bold text-ink tabular-nums"><Ltr>{order.doc_number}</Ltr></div>
          </div>
        </header>

        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-3 rtl:tracking-normal">{t("purchasing.printSupplier")}</div>
            <div className="mt-1.5 text-sm text-ink">
              <div className="font-semibold"><Bdi>{supplierName(supplier ?? order.supplier, language) || "—"}</Bdi></div>
              {supplier?.address && <div className="text-ink-2"><Bdi>{supplier.address}</Bdi></div>}
              {(supplier?.city || supplier?.country) && (
                <div className="text-ink-2"><Bdi>{[supplier.city, supplier.country].filter(Boolean).join(", ")}</Bdi></div>
              )}
              {supplier?.phone && <div className="text-ink-2"><Ltr>{supplier.phone}</Ltr></div>}
              {supplier?.tax_number && (
                <div className="text-ink-2">{t("purchasing.printTaxNumber")}: <Ltr>{supplier.tax_number}</Ltr></div>
              )}
            </div>
            {order.warehouse && (
              <div className="mt-4">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-3 rtl:tracking-normal">{t("purchasing.printDeliverTo")}</div>
                <div className="mt-1.5 text-sm text-ink"><Bdi>{order.warehouse.name}</Bdi></div>
              </div>
            )}
          </div>
          <dl className="space-y-1 text-sm">
            <PrintRow label={t("purchasing.f.orderDate")} value={<Ltr>{formatDate(order.order_date)}</Ltr>} />
            {order.expected_date && <PrintRow label={t("purchasing.f.expectedDate")} value={<Ltr>{formatDate(order.expected_date)}</Ltr>} />}
            {order.supplier_reference && <PrintRow label={t("purchasing.f.reference")} value={<Ltr>{order.supplier_reference}</Ltr>} />}
          </dl>
        </div>

        <table className="mt-8 w-full text-sm">
          <thead>
            <tr className="border-b-2 border-ink/80">
              <th className={`${th} text-start`}>{t("sales.print.item")}</th>
              <th className={`${th} ps-3 text-end`}>{t("sales.lines.qty")}</th>
              <th className={`${th} ps-3 text-end`}>{t("purchasing.f.unitCost")}</th>
              <th className={`${th} ps-3 text-end`}>{t("sales.lines.lineTotal")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {lines.map((line) => (
              <tr key={line.id}>
                <td className="py-2.5 text-ink">
                  <Bdi>{line.description}</Bdi>
                  {Number(line.discount_percent) > 0 && <span className="ms-2 text-xs text-ink-3"><Ltr>−{line.discount_percent}%</Ltr></span>}
                </td>
                <td className="whitespace-nowrap py-2.5 ps-3 text-end text-ink-2 tabular-nums"><Bdi>{line.quantity}{line.unit ? ` ${line.unit}` : ""}</Bdi></td>
                <td className="whitespace-nowrap py-2.5 ps-3 text-end text-ink-2 tabular-nums"><Ltr>{money(Number(line.unit_price))}</Ltr></td>
                <td className="whitespace-nowrap py-2.5 ps-3 text-end font-medium text-ink tabular-nums"><Ltr>{money(Number(line.line_total))}</Ltr></td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-6 flex justify-end">
          <dl className="w-64 space-y-1.5 text-sm tabular-nums">
            <PrintRow label={t("sales.doc.subtotal")} value={<Ltr>{money(Number(order.subtotal))}</Ltr>} />
            {Number(order.discount_total) > 0 && (
              <PrintRow label={t("sales.doc.discount")} value={<Ltr>{`− ${money(Number(order.discount_total))}`}</Ltr>} />
            )}
            {Number(order.tax_total) > 0 && <PrintRow label={taxLabel} value={<Ltr>{money(Number(order.tax_total))}</Ltr>} />}
            <div className="border-t border-ink/70 pt-1.5">
              <PrintRow label={t("sales.doc.total")} value={<Ltr>{money(Number(order.total))}</Ltr>} strong />
            </div>
          </dl>
        </div>

        {order.notes && <p className="mt-6 whitespace-pre-line text-sm text-ink-2"><Bdi>{order.notes}</Bdi></p>}
        {order.terms && (
          <div className="mt-6 border-t border-line pt-4">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-3 rtl:tracking-normal">{t("purchasing.f.terms")}</div>
            <p className="mt-1.5 whitespace-pre-line text-xs text-ink-2"><Bdi>{order.terms}</Bdi></p>
          </div>
        )}
        <footer className="mt-8 border-t border-line pt-3 text-center text-[11px] text-ink-3">
          <p>{t("sales.print.generatedBy")}</p>
        </footer>
      </Card>
    </>
  );
}

function PrintRow({ label, value, strong }: { label: string; value: ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className={strong ? "font-semibold text-ink" : "text-ink-3"}>{label}</dt>
      <dd className={strong ? "text-base font-semibold text-ink" : "text-ink"}>{value}</dd>
    </div>
  );
}
