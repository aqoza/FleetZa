/**
 * The 80 mm till receipt of one POS order (or refund). Print is the output:
 * the app chrome and the hub header carry print:hidden, so the browser prints
 * this card alone, sized for a thermal printer.
 */
import type { ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Printer } from "lucide-react";
import { listRows } from "../../lib/db";
import { formatDateTime, formatMoney } from "../../lib/format";
import { useTenant } from "../../context/AuthContext";
import { useT } from "../../i18n";
import { Bdi, Button, ErrorState, LoadingState, Ltr } from "../../components/ui";
import { ORDER_SELECT, n, type PosOrder, type PosOrderLine } from "./types";

export default function ReceiptPage() {
  const t = useT();
  const tenant = useTenant();
  const { id = "" } = useParams();
  const q = useQuery({
    queryKey: ["pos_orders", "one", id],
    queryFn: async () => (await listRows<PosOrder>("pos_orders", (b) => b.select(ORDER_SELECT).eq("id", id).limit(1)))[0] ?? null,
  });
  const linesQ = useQuery({
    queryKey: ["pos_orders", "lines", id],
    queryFn: () => listRows<PosOrderLine>("pos_order_lines", (b) =>
      b.select("id, sort_order, product_id, description, quantity, unit_price, discount_percent, tax_rate, line_discount, line_total")
        .eq("order_id", id).order("sort_order").limit(200)),
  });

  if (q.isLoading || linesQ.isLoading) return <LoadingState />;
  if (q.error) return <ErrorState message={(q.error as Error).message} />;
  const o = q.data;
  if (!o) return <ErrorState message={t("pos.orders.notFound")} />;
  const money = (v: unknown) => <Ltr>{formatMoney(n(v), o.currency)}</Ltr>;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link to={`/pos/orders?order=${o.id}`} className="inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink">
          <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" /> {t("pos.receipt.back")}
        </Link>
        <Button onClick={() => window.print()}><Printer className="h-4 w-4" /> {t("pos.receipt.print")}</Button>
      </div>
      <div className="mx-auto w-full max-w-[80mm] rounded-lg border border-line bg-surface p-4 text-[12px] tabular-nums leading-snug text-ink print:max-w-none print:border-0 print:p-0">
        <header className="text-center">
          <div className="text-sm font-bold"><Bdi>{tenant.name}</Bdi></div>
          {tenant.address && <div><Bdi>{tenant.address}</Bdi></div>}
          {tenant.phone && <div><Ltr>{tenant.phone}</Ltr></div>}
          {tenant.tax_registration_number && <div>{t("pos.receipt.taxNumber")}: <Ltr>{tenant.tax_registration_number}</Ltr></div>}
        </header>
        <Rule />
        <div className="text-center font-bold">{o.refund_of ? t("pos.receipt.refundTitle") : t("pos.receipt.title")}</div>
        <Line label={t("pos.receipt.number")}><Ltr>{o.doc_number}</Ltr></Line>
        <Line label={t("pos.receipt.date")}>{formatDateTime(o.completed_at, tenant.timezone)}</Line>
        {o.register && <Line label={t("pos.orders.register")}><Bdi>{o.register.name}</Bdi></Line>}
        {o.customer && <Line label={t("pos.orders.customer")}><Bdi>{o.customer.name}</Bdi></Line>}
        <Rule />
        {(linesQ.data ?? []).map((l) => (
          <div key={l.id} className="mb-1">
            <div><Bdi>{l.description}</Bdi></div>
            <div className="flex justify-between gap-2">
              <Ltr>{`${n(l.quantity)} × ${formatMoney(n(l.unit_price), o.currency)}`}{n(l.discount_percent) > 0 && ` −${n(l.discount_percent)}%`}</Ltr>
              {money(l.line_total)}
            </div>
          </div>
        ))}
        <Rule />
        <Line label={t("pos.cart.subtotal")}>{money(o.subtotal)}</Line>
        {n(o.discount_total) !== 0 && <Line label={t("pos.cart.discount")}>{money(-n(o.discount_total))}</Line>}
        <Line label={t("pos.cart.tax")}>{money(o.tax_total)}</Line>
        <div className="flex justify-between gap-2 text-sm font-bold"><span>{t("pos.cart.total")}</span>{money(o.total)}</div>
        <Rule />
        {n(o.paid_cash) !== 0 && <Line label={t("pos.pay.cash")}>{money(o.paid_cash)}</Line>}
        {n(o.paid_card) !== 0 && <Line label={t("pos.pay.card")}>{money(o.paid_card)}</Line>}
        {n(o.paid_other) !== 0 && <Line label={t("pos.pay.other")}>{money(o.paid_other)}</Line>}
        {n(o.change_due) !== 0 && <Line label={t("pos.done.change")}>{money(o.change_due)}</Line>}
        <Rule />
        <p className="text-center">{t("pos.receipt.thanks")}</p>
      </div>
    </>
  );
}

function Rule() {
  return <div className="my-2 border-t border-dashed border-line" />;
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-2">
      <span>{label}</span>
      <span className="text-end">{children}</span>
    </div>
  );
}
