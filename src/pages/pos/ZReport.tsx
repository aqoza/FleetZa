import type { ReactNode } from "react";
import { formatMoney } from "../../lib/format";
import { useTenant } from "../../context/AuthContext";
import { useT, useTp } from "../../i18n";
import { ErrorState, LoadingState, Ltr } from "../../components/ui";
import { n, useSessionSummary, type PosSession } from "./types";

/** The end-of-day (Z) report of one session: what was sold, how it was paid, and the cash count. */
export function ZReport({ session }: { session: PosSession }) {
  const t = useT();
  const tp = useTp();
  const tenant = useTenant();
  const q = useSessionSummary(session.id);
  if (q.isLoading) return <LoadingState />;
  if (q.error) return <ErrorState message={(q.error as Error).message} />;
  const s = q.data;
  if (!s) return null;
  const money = (v: unknown) => <Ltr>{formatMoney(n(v), tenant.currency)}</Ltr>;
  const counted = session.closing_cash_counted;
  const diff = n(session.cash_difference);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Section title={t("pos.z.sales")}>
        <Row label={tp("pos.z.salesCount", n(s.sales_count))}>{money(s.gross_sales)}</Row>
        <Row label={tp("pos.z.refundCount", n(s.refund_count))}>{money(-n(s.refunds))}</Row>
        <Row label={t("pos.z.discounts")}>{money(s.discounts)}</Row>
        <Row label={t("pos.z.tax")}>{money(s.tax)}</Row>
        <Row label={t("pos.z.netSales")} strong>{money(s.net_sales)}</Row>
      </Section>
      <Section title={t("pos.z.payments")}>
        <Row label={t("pos.pay.cash")}>{money(s.cash)}</Row>
        <Row label={t("pos.pay.card")}>{money(s.card)}</Row>
        <Row label={t("pos.pay.other")}>{money(s.other)}</Row>
      </Section>
      <Section title={t("pos.z.cash")}>
        <Row label={t("pos.z.opening")}>{money(session.opening_cash)}</Row>
        <Row label={t("pos.z.cashSales")}>{money(s.cash)}</Row>
        <Row label={t("pos.z.expected")} strong>{money(session.expected_cash ?? s.expected_cash)}</Row>
        {counted !== null && (
          <>
            <Row label={t("pos.z.counted")}>{money(counted)}</Row>
            <Row label={t("pos.z.difference")} strong>
              <span className={diff === 0 ? "text-good" : "text-serious"}>{money(diff)}</span>
            </Row>
          </>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line p-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3 rtl:tracking-normal">{title}</h3>
      <dl className="space-y-1.5 text-sm">{children}</dl>
    </section>
  );
}

function Row({ label, children, strong }: { label: string; children: ReactNode; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 ${strong ? "border-t border-line pt-1.5 font-semibold text-ink" : "text-ink-2"}`}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{children}</dd>
    </div>
  );
}
