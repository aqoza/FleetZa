/**
 * The sales + billing contribution to the customer 360 page. Modules
 * contribute panels to entity pages rather than entity pages knowing about
 * every module (docs/ARCHITECTURE_REVIEW.md §9.1) — so this lives here, with
 * the module that owns the data, and CustomerDetailPage only mounts it when
 * `sales` is enabled.
 */
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { countRows, listRows } from "../../lib/db";
import { formatDate, formatMoney } from "../../lib/format";
import { invoiceStatus, quoteStatus } from "../../lib/labels";
import { balanceDue, effectiveInvoiceStatus, effectiveQuoteStatus } from "../../lib/sales";
import type { Invoice, Quote } from "../../lib/types";
import { useTenant } from "../../context/AuthContext";
import { useModules } from "../../context/ModulesContext";
import { useT } from "../../i18n";
import { Badge, Card, ErrorState, LoadingState } from "../../components/ui";

const RECENT_LIMIT = 5;

export default function CustomerSalesPanel({ customerId }: { customerId: string }) {
  const t = useT();
  const tenant = useTenant();
  const { isEnabled } = useModules();
  const billingOn = isEnabled("billing");

  const quotesQ = useQuery({
    queryKey: ["quotes", "customer", customerId],
    queryFn: () =>
      listRows<Quote>("quotes", (q) =>
        q.eq("customer_id", customerId)
          .order("issue_date", { ascending: false })
          .limit(RECENT_LIMIT),
      ),
  });

  const openQuotesQ = useQuery({
    queryKey: ["quotes", "customer", customerId, "openCount"],
    queryFn: () =>
      countRows("quotes", (q) =>
        q.eq("customer_id", customerId).in("status", ["draft", "sent"]),
      ),
  });

  const invoicesQ = useQuery({
    queryKey: ["invoices", "customer", customerId],
    queryFn: () =>
      listRows<Invoice>("invoices", (q) =>
        q.eq("customer_id", customerId)
          .order("issue_date", { ascending: false })
          .limit(RECENT_LIMIT),
      ),
    enabled: billingOn,
  });

  // Receivables need every unsettled invoice, not just the recent slice —
  // bounded by "unsettled", which is a small set by construction.
  const outstandingQ = useQuery({
    queryKey: ["invoices", "customer", customerId, "outstanding"],
    queryFn: () =>
      listRows<Pick<Invoice, "total" | "amount_paid">>("invoices", (q) =>
        q.select("total, amount_paid")
          .eq("customer_id", customerId)
          .in("status", ["issued", "partially_paid"]),
      ),
    enabled: billingOn,
  });

  const outstanding = (outstandingQ.data ?? []).reduce(
    (sum, inv) => sum + (inv.total - inv.amount_paid),
    0,
  );

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-ink">{t("sales.customer.panel")}</h3>
        <Link to="/sales/quotes" className="text-xs font-medium text-brand-700 hover:underline">
          {t("sales.customer.viewAllQuotes")}
        </Link>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3">
        <Metric
          label={t("sales.customer.openQuotes")}
          value={String(openQuotesQ.data ?? 0)}
        />
        {billingOn && (
          <Metric
            label={t("sales.customer.outstanding")}
            value={formatMoney(outstanding, tenant.currency)}
            tone={outstanding > 0 ? "warn" : "muted"}
          />
        )}
      </div>

      <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-3 rtl:tracking-normal">
        {t("sales.quotes.title")}
      </h4>
      {quotesQ.isLoading ? (
        <LoadingState />
      ) : quotesQ.error ? (
        <ErrorState message={(quotesQ.error as Error).message} />
      ) : (quotesQ.data ?? []).length === 0 ? (
        <p className="py-3 text-sm text-ink-3">{t("sales.customer.noQuotes")}</p>
      ) : (
        <ul className="divide-y divide-line">
          {(quotesQ.data ?? []).map((q) => {
            const meta = quoteStatus[effectiveQuoteStatus(q)];
            return (
              <DocRow
                key={q.id}
                to={`/sales/quotes/${q.id}`}
                number={q.doc_number}
                date={q.issue_date}
                amount={formatMoney(q.total, q.currency)}
                badge={<Badge tone={meta.tone}>{t(meta.labelKey)}</Badge>}
              />
            );
          })}
        </ul>
      )}

      {billingOn && (
        <>
          <div className="mb-1.5 mt-4 flex items-center justify-between">
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-ink-3 rtl:tracking-normal">
              {t("sales.invoices.title")}
            </h4>
            <Link
              to="/sales/invoices"
              className="text-xs font-medium text-brand-700 hover:underline"
            >
              {t("sales.customer.viewAllInvoices")}
            </Link>
          </div>
          {invoicesQ.isLoading ? (
            <LoadingState />
          ) : invoicesQ.error ? (
            <ErrorState message={(invoicesQ.error as Error).message} />
          ) : (invoicesQ.data ?? []).length === 0 ? (
            <p className="py-3 text-sm text-ink-3">{t("sales.customer.noInvoices")}</p>
          ) : (
            <ul className="divide-y divide-line">
              {(invoicesQ.data ?? []).map((inv) => {
                const shown = effectiveInvoiceStatus(inv);
                const meta =
                  shown === "overdue"
                    ? { labelKey: "enum.invoiceStatus.overdue" as const, tone: "red" as const }
                    : invoiceStatus[shown];
                return (
                  <DocRow
                    key={inv.id}
                    to={`/sales/invoices/${inv.id}`}
                    number={inv.doc_number}
                    date={inv.issue_date}
                    amount={formatMoney(balanceDue(inv), inv.currency)}
                    badge={<Badge tone={meta.tone}>{t(meta.labelKey)}</Badge>}
                  />
                );
              })}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}

function Metric({
  label,
  value,
  tone = "muted",
}: {
  label: string;
  value: string;
  tone?: "muted" | "warn";
}) {
  return (
    <div className="rounded-xl border border-line p-3">
      <div className="text-xs font-medium text-ink-3">{label}</div>
      <div
        className={`mt-1 text-lg font-semibold tabular-nums ${
          tone === "warn" ? "text-warn" : "text-ink"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function DocRow({
  to,
  number,
  date,
  amount,
  badge,
}: {
  to: string;
  number: string;
  date: string;
  amount: string;
  badge: React.ReactNode;
}) {
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <Link to={to} className="text-sm font-medium text-brand-700 hover:underline tabular-nums">
          {number}
        </Link>
        <div className="text-xs text-ink-3">{formatDate(date)}</div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {badge}
        <span className="text-sm text-ink tabular-nums">{amount}</span>
      </div>
    </li>
  );
}
