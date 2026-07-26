import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, ClipboardList, FileText, Percent, Wallet,
} from "lucide-react";
import { listRows, wrapDbError } from "../../lib/db";
import { supabase } from "../../lib/supabase";
import { daysUntil, formatDate, formatMoney } from "../../lib/format";
import { quoteStatus } from "../../lib/labels";
import { balanceDue, effectiveQuoteStatus, winRate } from "../../lib/sales";
import type { Invoice, Quote, SalesOrder, SalesSummary } from "../../lib/types";
import { useTenant } from "../../context/AuthContext";
import { useModules } from "../../context/ModulesContext";
import { useT } from "../../i18n";
import { Badge, Card, ErrorState, LoadingState, StatCard } from "../../components/ui";
import { SectionCard } from "./shared";

/** Quotes inside this window are surfaced as "expiring soon". */
const EXPIRY_WINDOW_DAYS = 7;
const ATTENTION_LIMIT = 5;

export default function OverviewPage() {
  const t = useT();
  const tenant = useTenant();
  const { isEnabled } = useModules();
  const billingOn = isEnabled("billing");

  // One aggregate row, computed in SQL — KPI tiles never pull document tables
  // into the browser (docs/ARCHITECTURE_REVIEW.md §6.2).
  const summaryQ = useQuery({
    queryKey: ["sales_summary"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("sales_summary");
      if (error) throw wrapDbError(error);
      return (data as unknown as SalesSummary[])[0] ?? null;
    },
  });

  const expiringQ = useQuery({
    queryKey: ["quotes", "expiring"],
    queryFn: () =>
      listRows<Quote>("quotes", (q) =>
        q.eq("status", "sent").not("valid_until", "is", null)
          .order("valid_until")
          .limit(ATTENTION_LIMIT),
      ),
  });

  const overdueQ = useQuery({
    queryKey: ["invoices", "overdue"],
    queryFn: () =>
      listRows<Invoice>("invoices", (q) =>
        q.in("status", ["issued", "partially_paid"])
          .lt("due_date", new Date().toISOString().slice(0, 10))
          .order("due_date")
          .limit(ATTENTION_LIMIT),
      ),
    enabled: billingOn,
  });

  const invoiceableQ = useQuery({
    queryKey: ["sales_orders", "invoiceable"],
    queryFn: () =>
      listRows<SalesOrder>("sales_orders", (q) =>
        q.in("status", ["confirmed", "fulfilled"])
          .order("order_date", { ascending: false })
          .limit(ATTENTION_LIMIT * 2),
      ),
    enabled: billingOn,
  });

  if (summaryQ.isLoading) return <LoadingState />;
  if (summaryQ.error) return <ErrorState message={(summaryQ.error as Error).message} />;

  const s = summaryQ.data;
  if (!s) return null;

  const rate = winRate(s);
  const money = (v: number) => formatMoney(v, tenant.currency);

  const expiring = (expiringQ.data ?? []).filter((q) => {
    const days = q.valid_until ? daysUntil(q.valid_until) : null;
    return days !== null && days <= EXPIRY_WINDOW_DAYS;
  });
  const overdue = overdueQ.data ?? [];
  // "Ready to invoice" is a comparison of two stored amounts, so it filters
  // client-side over a bounded slice rather than needing its own RPC.
  const invoiceable = (invoiceableQ.data ?? [])
    .filter((o) => o.total - o.invoiced_total > 0)
    .slice(0, ATTENTION_LIMIT);

  const nothingPending =
    expiring.length === 0 && overdue.length === 0 && invoiceable.length === 0;

  return (
    <>
      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<FileText className="h-5 w-5" />}
          tone="blue"
          label={t("sales.kpi.openQuotes")}
          value={money(s.open_quote_value)}
          sub={t("sales.kpi.openQuotesSub", { count: s.open_quotes })}
        />
        <StatCard
          icon={<Percent className="h-5 w-5" />}
          tone="green"
          label={t("sales.kpi.winRate")}
          value={rate === null ? "—" : `${Math.round(rate * 100)}%`}
          sub={
            rate === null
              ? t("sales.overview.noWinRate")
              : t("sales.kpi.winRateSub", {
                  accepted: s.accepted_quotes_90d,
                  decided: s.decided_quotes_90d,
                })
          }
        />
        <StatCard
          icon={<ClipboardList className="h-5 w-5" />}
          tone="violet"
          label={t("sales.kpi.openOrders")}
          value={money(s.open_order_value)}
          sub={t("sales.kpi.unbilled", { amount: money(s.unbilled_order_value) })}
        />
        {billingOn && (
          <StatCard
            icon={<Wallet className="h-5 w-5" />}
            tone={s.overdue_amount > 0 ? "red" : "green"}
            label={t("sales.kpi.outstanding")}
            value={money(s.outstanding_amount)}
            sub={
              s.overdue_invoices > 0
                ? t("sales.kpi.overdueSub", {
                    amount: money(s.overdue_amount),
                    count: s.overdue_invoices,
                  })
                : t("sales.kpi.nothingOverdue")
            }
            subTone={s.overdue_invoices > 0 ? "serious" : "good"}
          />
        )}
      </div>

      {billingOn && (
        <Card className="mb-5 flex flex-wrap items-baseline justify-between gap-3 p-5">
          <span className="text-sm font-medium text-ink-2">{t("sales.kpi.collected")}</span>
          <span className="text-2xl font-bold tracking-tight text-ink tabular-nums">
            {money(s.collected_30d)}
          </span>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard title={t("sales.overview.expiringQuotes")}>
          {expiringQ.isLoading ? (
            <LoadingState />
          ) : expiring.length === 0 ? (
            <Empty label={t("sales.overview.allClear")} />
          ) : (
            <ul className="divide-y divide-line">
              {expiring.map((q) => {
                const meta = quoteStatus[effectiveQuoteStatus(q)];
                return (
                  <AttentionRow
                    key={q.id}
                    to={`/sales/quotes/${q.id}`}
                    primary={q.doc_number}
                    secondary={formatDate(q.valid_until)}
                    amount={formatMoney(q.total, q.currency)}
                    badge={<Badge tone={meta.tone}>{t(meta.labelKey)}</Badge>}
                  />
                );
              })}
            </ul>
          )}
        </SectionCard>

        {billingOn && (
          <SectionCard title={t("sales.overview.overdueInvoices")}>
            {overdueQ.isLoading ? (
              <LoadingState />
            ) : overdue.length === 0 ? (
              <Empty label={t("sales.kpi.nothingOverdue")} />
            ) : (
              <ul className="divide-y divide-line">
                {overdue.map((inv) => (
                  <AttentionRow
                    key={inv.id}
                    to={`/sales/invoices/${inv.id}`}
                    primary={inv.doc_number}
                    secondary={t("sales.invoices.overdueBy", {
                      days: Math.abs(daysUntil(inv.due_date!)),
                    })}
                    amount={formatMoney(balanceDue(inv), inv.currency)}
                    badge={
                      <Badge tone="red">{t("enum.invoiceStatus.overdue")}</Badge>
                    }
                  />
                ))}
              </ul>
            )}
          </SectionCard>
        )}

        {billingOn && (
          <SectionCard title={t("sales.overview.awaitingInvoice")}>
            {invoiceableQ.isLoading ? (
              <LoadingState />
            ) : invoiceable.length === 0 ? (
              <Empty label={t("sales.overview.allClear")} />
            ) : (
              <ul className="divide-y divide-line">
                {invoiceable.map((o) => (
                  <AttentionRow
                    key={o.id}
                    to={`/sales/orders/${o.id}`}
                    primary={o.doc_number}
                    secondary={formatDate(o.order_date)}
                    amount={formatMoney(o.total - o.invoiced_total, o.currency)}
                    badge={<Badge tone="blue">{t("sales.orders.unbilled")}</Badge>}
                  />
                ))}
              </ul>
            )}
          </SectionCard>
        )}
      </div>

      {nothingPending && !expiringQ.isLoading && (
        <p className="mt-5 text-center text-sm text-ink-3">{t("sales.overview.allClear")}</p>
      )}
    </>
  );
}

function AttentionRow({
  to,
  primary,
  secondary,
  amount,
  badge,
}: {
  to: string;
  primary: string;
  secondary: string;
  amount: string;
  badge: ReactNode;
}) {
  return (
    <li className="py-2.5">
      <div className="flex items-center justify-between gap-3">
        <Link
          to={to}
          className="text-sm font-medium text-brand-700 hover:underline tabular-nums"
        >
          {primary}
        </Link>
        <span className="text-sm font-medium text-ink tabular-nums">{amount}</span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        {badge}
        <span className="text-xs text-ink-3">{secondary}</span>
      </div>
    </li>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-6 text-sm text-ink-3">
      <AlertTriangle className="h-4 w-4 opacity-40" />
      {label}
    </div>
  );
}
