/**
 * Commercial reporting: where every document stands, who owes what and how
 * late, and what the month actually earned.
 *
 * Every number comes from an RLS-scoped SQL function
 * (`sales_report_*`, supabase/migrations) rather than from documents pulled
 * into the browser — the same rule the overview KPIs follow. A tenant with
 * tens of thousands of invoices pays for one row, not for the table.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  AlertTriangle, Banknote, ClipboardList, FileText, Receipt, Wallet,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { wrapDbError } from "../../lib/db";
import { formatDate, formatMoney } from "../../lib/format";
import { useTenant } from "../../context/AuthContext";
import { useT } from "../../i18n";
import {
  Card, EmptyState, ErrorState, Field, LoadingState, StatCard, Table,
} from "../../components/ui";
import { Combobox } from "../../components/Combobox";
import { useCustomerPicker } from "../../lib/pickers";
import { paymentMethods } from "../../lib/labels";
import type { PaymentMethod } from "../../lib/types";
import { SectionCard } from "./shared";

interface PipelineRow {
  pending_quotes: number; pending_quote_value: number;
  accepted_quotes: number; accepted_quote_value: number;
  declined_quotes: number;
  pos_received: number; pos_received_value: number;
  jobs_pending_invoice: number;
  invoices_generated: number; invoiced_value: number;
  partially_paid_invoices: number; partially_paid_outstanding: number;
  paid_invoices: number; paid_value: number;
  outstanding_amount: number;
  overdue_invoices: number; overdue_amount: number;
}

interface ReceivableRow {
  customer_id: string;
  customer_name: string;
  open_invoices: number;
  outstanding: number;
  not_yet_due: number;
  overdue_1_30: number;
  overdue_31_60: number;
  overdue_61_90: number;
  overdue_90_plus: number;
  oldest_due_date: string | null;
}

interface RevenueRow {
  month: string;
  invoiced: number;
  collected: number;
  invoice_count: number;
}

interface PaymentRow {
  payment_id: string;
  paid_at: string;
  amount: number;
  method: string;
  reference: string | null;
  invoice_id: string;
  invoice_number: string | null;
  customer_id: string;
  customer_name: string;
}

interface PendingJobRow {
  job_id: string;
  job_number: number;
  job_type: string;
  status: string;
  completed_at: string | null;
  customer_id: string | null;
  customer_name: string | null;
  vehicle_name: string | null;
}

/** The report functions this page reads; named so the client keeps its typed
 *  RPC surface rather than falling back to a bare string. */
type ReportFn =
  | "sales_report_pipeline"
  | "sales_report_receivables"
  | "sales_report_revenue"
  | "sales_report_jobs_pending_invoice"
  | "sales_report_payments";

/** Every report is one RPC; the generic keeps the row shape at the call site. */
function useReport<T>(fn: ReportFn, args?: Record<string, unknown>) {
  return useQuery({
    queryKey: ["sales_report", fn, args ?? null],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- args shape varies per report
      const { data, error } = await supabase.rpc(fn, args as any);
      if (error) throw wrapDbError(error);
      return (data ?? []) as unknown as T[];
    },
  });
}

/** How many months of history the revenue table shows. */
const REVENUE_MONTHS = 12;
/** Receipts shown in the ledger. A statement, not an export. */
const PAYMENT_ROWS = 200;

/** The RPC returns `method` as plain text; fall back rather than crash if a
 *  method is ever added in SQL before it is added to the label map. */
function paymentMethodKey(method: string) {
  return paymentMethods[method as PaymentMethod] ?? "enum.paymentMethod.other";
}

export default function ReportsPage() {
  const t = useT();
  const { currency } = useTenant();

  const pipelineQ = useReport<PipelineRow>("sales_report_pipeline");
  const receivablesQ = useReport<ReceivableRow>("sales_report_receivables");
  const revenueQ = useReport<RevenueRow>("sales_report_revenue", {
    p_months: REVENUE_MONTHS,
  });
  const pendingJobsQ = useReport<PendingJobRow>("sales_report_jobs_pending_invoice");

  // Payment history is the one report with a filter: "what has THIS customer
  // paid us" is the question asked when a balance is disputed.
  const [payerId, setPayerId] = useState("");
  const payerPicker = useCustomerPicker(payerId);
  const paymentsQ = useReport<PaymentRow>("sales_report_payments", {
    p_customer_id: payerId || null,
    p_limit: PAYMENT_ROWS,
  });

  const p = pipelineQ.data?.[0] ?? null;
  const money = (n: number) => formatMoney(n, currency);

  // Aging totals are the receivables columns summed, not a second query — one
  // definition of "31-60 days" for both the per-customer table and the totals.
  const rows = receivablesQ.data ?? [];
  const aging = rows.reduce(
    (acc, r) => ({
      notYetDue: acc.notYetDue + Number(r.not_yet_due),
      d30: acc.d30 + Number(r.overdue_1_30),
      d60: acc.d60 + Number(r.overdue_31_60),
      d90: acc.d90 + Number(r.overdue_61_90),
      d90plus: acc.d90plus + Number(r.overdue_90_plus),
    }),
    { notYetDue: 0, d30: 0, d60: 0, d90: 0, d90plus: 0 },
  );

  if (pipelineQ.isLoading) return <LoadingState />;
  if (pipelineQ.error) return <ErrorState message={(pipelineQ.error as Error).message} />;

  return (
    <div className="space-y-6">
      {/* Where the money is */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<Wallet className="h-5 w-5" />}
          tone="blue"
          label={t("sales.reports.outstanding")}
          value={money(Number(p?.outstanding_amount ?? 0))}
          sub={t("sales.reports.outstandingHint", {
            count: String(p?.partially_paid_invoices ?? 0),
          })}
        />
        <StatCard
          icon={<AlertTriangle className="h-5 w-5" />}
          tone={Number(p?.overdue_amount ?? 0) > 0 ? "red" : "slate"}
          label={t("sales.reports.overdue")}
          value={money(Number(p?.overdue_amount ?? 0))}
          sub={t("sales.reports.invoiceCount", {
            count: String(p?.overdue_invoices ?? 0),
          })}
        />
        <StatCard
          icon={<Receipt className="h-5 w-5" />}
          tone="green"
          label={t("sales.reports.paid")}
          value={money(Number(p?.paid_value ?? 0))}
          sub={t("sales.reports.invoiceCount", {
            count: String(p?.paid_invoices ?? 0),
          })}
        />
        <StatCard
          icon={<FileText className="h-5 w-5" />}
          tone="violet"
          label={t("sales.reports.invoiced")}
          value={money(Number(p?.invoiced_value ?? 0))}
          sub={t("sales.reports.invoiceCount", {
            count: String(p?.invoices_generated ?? 0),
          })}
        />
      </div>

      {/* Where the work is */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<ClipboardList className="h-5 w-5" />}
          tone="amber"
          label={t("sales.reports.pendingQuotes")}
          value={String(p?.pending_quotes ?? 0)}
          sub={money(Number(p?.pending_quote_value ?? 0))}
        />
        <StatCard
          icon={<ClipboardList className="h-5 w-5" />}
          tone="green"
          label={t("sales.reports.acceptedQuotes")}
          value={String(p?.accepted_quotes ?? 0)}
          sub={money(Number(p?.accepted_quote_value ?? 0))}
        />
        <StatCard
          icon={<ClipboardList className="h-5 w-5" />}
          tone="slate"
          label={t("sales.reports.declinedQuotes")}
          value={String(p?.declined_quotes ?? 0)}
        />
        <StatCard
          icon={<FileText className="h-5 w-5" />}
          tone="blue"
          label={t("sales.reports.posReceived")}
          value={String(p?.pos_received ?? 0)}
          sub={money(Number(p?.pos_received_value ?? 0))}
        />
      </div>

      {/* Aging — the receivables columns, summed */}
      <SectionCard title={t("sales.reports.aging")}>
        {receivablesQ.isLoading ? (
          <LoadingState />
        ) : receivablesQ.error ? (
          <ErrorState message={(receivablesQ.error as Error).message} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-5">
            {[
              ["sales.reports.notYetDue", aging.notYetDue, "text-ink"],
              ["sales.reports.d30", aging.d30, "text-amber-700"],
              ["sales.reports.d60", aging.d60, "text-amber-700"],
              ["sales.reports.d90", aging.d90, "text-red-700"],
              ["sales.reports.d90plus", aging.d90plus, "text-red-700"],
            ].map(([key, value, tone]) => (
              <div key={key as string} className="rounded-lg border border-line p-3">
                <p className="text-xs text-ink-3">{t(key as never)}</p>
                <p className={`mt-1 text-sm font-semibold tabular-nums ${tone as string}`}>
                  {money(Number(value))}
                </p>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Outstanding balance by customer */}
      <SectionCard title={t("sales.reports.byCustomer")}>
        {receivablesQ.isLoading ? (
          <LoadingState />
        ) : receivablesQ.error ? (
          <ErrorState message={(receivablesQ.error as Error).message} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Wallet className="h-5 w-5" />}
            title={t("sales.reports.noReceivables")}
            description={t("sales.reports.noReceivablesDesc")}
          />
        ) : (
          <Table
            headers={[t("sales.doc.customer"), t("sales.reports.openInvoices"), t("sales.reports.notYetDue"), t("sales.reports.d30"), t("sales.reports.d60"), t("sales.reports.d90"), t("sales.reports.d90plus"), t("sales.reports.outstanding")]}
          >
            {rows.map((r) => (
              <tr key={r.customer_id} className="border-t border-line">
                <td className="px-4 py-2">
                  <Link
                    to={`/customers/${r.customer_id}`}
                    className="text-brand-700 hover:underline"
                  >
                    {r.customer_name}
                  </Link>
                </td>
                <td className="px-4 py-2 text-end tabular-nums">{r.open_invoices}</td>
                <td className="px-4 py-2 text-end tabular-nums">{money(Number(r.not_yet_due))}</td>
                <td className="px-4 py-2 text-end tabular-nums">{money(Number(r.overdue_1_30))}</td>
                <td className="px-4 py-2 text-end tabular-nums">{money(Number(r.overdue_31_60))}</td>
                <td className="px-4 py-2 text-end tabular-nums">{money(Number(r.overdue_61_90))}</td>
                <td className="px-4 py-2 text-end tabular-nums text-red-700">
                  {money(Number(r.overdue_90_plus))}
                </td>
                <td className="px-4 py-2 text-end font-medium tabular-nums">
                  {money(Number(r.outstanding))}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </SectionCard>

      {/* Revenue: invoiced vs actually collected — not the same number */}
      <SectionCard title={t("sales.reports.revenue")}>
        {revenueQ.isLoading ? (
          <LoadingState />
        ) : revenueQ.error ? (
          <ErrorState message={(revenueQ.error as Error).message} />
        ) : (
          <Table
            headers={[t("sales.reports.month"), t("sales.reports.invoiceCountShort"), t("sales.reports.invoiced"), t("sales.reports.collected")]}
          >
            {(revenueQ.data ?? []).map((r) => (
              <tr key={r.month} className="border-t border-line">
                <td className="px-4 py-2">{formatDate(r.month)}</td>
                <td className="px-4 py-2 text-end tabular-nums">{r.invoice_count}</td>
                <td className="px-4 py-2 text-end tabular-nums">{money(Number(r.invoiced))}</td>
                <td className="px-4 py-2 text-end tabular-nums">{money(Number(r.collected))}</td>
              </tr>
            ))}
          </Table>
        )}
      </SectionCard>

      {/* Work done but not billed — the list behind the count, so it is actionable */}
      <SectionCard
        title={t("sales.reports.jobsPendingInvoice")}
      >
        {pendingJobsQ.isLoading ? (
          <LoadingState />
        ) : pendingJobsQ.error ? (
          <ErrorState message={(pendingJobsQ.error as Error).message} />
        ) : (pendingJobsQ.data ?? []).length === 0 ? (
          <EmptyState
            icon={<ClipboardList className="h-5 w-5" />}
            title={t("sales.reports.noPendingJobs")}
            description={t("sales.reports.noPendingJobsDesc")}
          />
        ) : (
          <>
            <Table
              headers={[t("sales.reports.job"), t("sales.doc.customer"), t("sales.doc.vehicle"), t("sales.reports.completed")]}
            >
              {/* Capped: this is a worklist to act on, not an export. The count
                  above is the true total. */}
              {(pendingJobsQ.data ?? []).slice(0, 50).map((j) => (
                <tr key={j.job_id} className="border-t border-line">
                  <td className="px-4 py-2">
                    <Link
                      to={`/speed-limiters/jobs/${j.job_id}`}
                      className="text-brand-700 hover:underline"
                    >
                      #{j.job_number}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{j.customer_name ?? "—"}</td>
                  <td className="px-4 py-2">{j.vehicle_name ?? "—"}</td>
                  <td className="px-4 py-2">
                    {j.completed_at ? formatDate(j.completed_at) : "—"}
                  </td>
                </tr>
              ))}
            </Table>
            {(pendingJobsQ.data ?? []).length > 50 && (
              <p className="mt-3 text-center text-xs text-ink-3">
                {t("sales.reports.showingFirst", {
                  shown: "50",
                  total: String((pendingJobsQ.data ?? []).length),
                })}
              </p>
            )}
          </>
        )}
      </SectionCard>

      {/* Customer payment history — every receipt, across invoices */}
      <SectionCard
        title={t("sales.reports.paymentHistory")}
        actions={
          <div className="w-56">
            <Field label="">
              <Combobox
                {...payerPicker}
                value={payerId}
                onChange={setPayerId}
                placeholder={t("sales.reports.allCustomers")}
              />
            </Field>
          </div>
        }
      >
        {paymentsQ.isLoading ? (
          <LoadingState />
        ) : paymentsQ.error ? (
          <ErrorState message={(paymentsQ.error as Error).message} />
        ) : (paymentsQ.data ?? []).length === 0 ? (
          <EmptyState
            icon={<Banknote className="h-6 w-6" />}
            title={t("sales.reports.noPayments")}
            description={t("sales.reports.noPaymentsDesc")}
          />
        ) : (
          <>
            <Table
              headers={[
                t("sales.reports.paidOn"),
                t("sales.doc.customer"),
                t("sales.invoices.title"),
                t("sales.reports.method"),
                t("sales.reports.reference"),
                t("sales.reports.amount"),
              ]}
            >
              {(paymentsQ.data ?? []).map((pmt) => (
                <tr key={pmt.payment_id} className="border-t border-line">
                  <td className="px-4 py-2">{formatDate(pmt.paid_at)}</td>
                  <td className="px-4 py-2">
                    <Link
                      to={`/customers/${pmt.customer_id}`}
                      className="text-brand-700 hover:underline"
                    >
                      {pmt.customer_name}
                    </Link>
                  </td>
                  <td className="px-4 py-2">
                    <Link
                      to={`/sales/invoices/${pmt.invoice_id}`}
                      className="text-brand-700 hover:underline"
                    >
                      {pmt.invoice_number ?? "—"}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{t(paymentMethodKey(pmt.method))}</td>
                  <td className="px-4 py-2 text-ink-2">{pmt.reference ?? "—"}</td>
                  <td className="px-4 py-2 text-end font-medium tabular-nums">
                    {money(Number(pmt.amount))}
                  </td>
                </tr>
              ))}
            </Table>
            <p className="mt-3 text-end text-sm text-ink-2">
              {t("sales.reports.paymentsTotal", {
                amount: money(
                  (paymentsQ.data ?? []).reduce((sum, x) => sum + Number(x.amount), 0),
                ),
              })}
            </p>
          </>
        )}
      </SectionCard>

      <Card className="p-4">
        <p className="text-xs text-ink-3">{t("sales.reports.footnote")}</p>
      </Card>
    </div>
  );
}
