import type { ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, FileText, Printer } from "lucide-react";
import { getRow } from "../../lib/db";
import { formatDate, formatMoney } from "../../lib/format";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useT } from "../../i18n";
import { Bdi, Button, Card, EmptyState, ErrorState, LoadingState, Ltr } from "../../components/ui";
import type { Payslip } from "./types";

function Line({ label, amount, money, note, strong }: {
  label: string;
  amount: number;
  money: (n: number) => string;
  note?: ReactNode;
  strong?: boolean;
}) {
  return (
    <div className={`flex items-baseline justify-between gap-4 py-1.5 text-sm ${strong ? "font-semibold text-ink" : "text-ink-2"}`}>
      <span>
        {label}
        {note && <span className="ms-1 text-xs text-ink-3">{note}</span>}
      </span>
      <span className="tabular-nums">{money(amount)}</span>
    </div>
  );
}

/** The payslip print view: managers from a run, employees from "My payslips". */
export default function PayslipPage() {
  const t = useT();
  const tenant = useTenant();
  const { isManager } = useAuth();
  const { payslipId = "" } = useParams();
  const q = useQuery({ queryKey: ["payslips", "one", payslipId], queryFn: () => getRow<Payslip>("payslips", payslipId) });

  const back = (to: string) => (
    <Link to={to} className="inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink">
      <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" /> {isManager ? t("hr.backToRun") : t("hr.tab.myPayslips")}
    </Link>
  );

  if (q.isLoading) return <LoadingState />;
  if (q.error) return <ErrorState message={(q.error as Error).message} />;
  const p = q.data;
  if (!p) {
    return (
      <EmptyState
        icon={<FileText className="h-10 w-10" />}
        title={t("hr.slipNotFound")}
        action={back(isManager ? "/hr/payroll" : "/hr/payslips")}
      />
    );
  }

  const money = (n: number) => formatMoney(n, p.currency ?? tenant.currency);
  const n = (v: number | string) => Number(v);
  const deductions = n(p.unpaid_leave_deduction) + n(p.social_insurance_employee) + n(p.deductions);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        {back(isManager ? `/hr/payroll/${p.run_id}` : "/hr/payslips")}
        <Button onClick={() => window.print()}>
          <Printer className="h-4 w-4" /> {t("hr.print")}
        </Button>
      </div>

      <Card className="mx-auto max-w-2xl px-6 py-6 sm:px-10 sm:py-8 print:border-0 print:shadow-none">
        <header className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <h1 className="text-xl font-bold text-brand-700"><Bdi>{tenant.name}</Bdi></h1>
            {tenant.address && <div className="mt-1 text-xs text-ink-3"><Bdi>{tenant.address}</Bdi></div>}
          </div>
          <div className="text-end">
            <div className="text-sm font-semibold text-ink">{t("hr.payslip")}</div>
            <div className="mt-1 text-sm text-ink-2 tabular-nums">
              {formatDate(p.period_start)} – {formatDate(p.period_end)}
            </div>
            {p.run_number && <div className="text-xs text-ink-3"><Ltr>{p.run_number}</Ltr></div>}
          </div>
        </header>

        <dl className="mt-6 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-3"><dt className="text-ink-3">{t("hr.employee")}</dt><dd className="font-medium text-ink"><Bdi>{p.employee_name}</Bdi></dd></div>
          {p.employee_number && <div className="flex justify-between gap-3"><dt className="text-ink-3">{t("hr.employeeNumber")}</dt><dd><Ltr>{p.employee_number}</Ltr></dd></div>}
          {p.job_title && <div className="flex justify-between gap-3"><dt className="text-ink-3">{t("hr.jobTitle")}</dt><dd><Bdi>{p.job_title}</Bdi></dd></div>}
          {p.pay_date && <div className="flex justify-between gap-3"><dt className="text-ink-3">{t("hr.payDate")}</dt><dd className="tabular-nums">{formatDate(p.pay_date)}</dd></div>}
          {p.bank_name && <div className="flex justify-between gap-3"><dt className="text-ink-3">{t("hr.bank")}</dt><dd><Bdi>{p.bank_name}</Bdi></dd></div>}
          {p.iban && <div className="flex justify-between gap-3"><dt className="text-ink-3">{t("hr.iban")}</dt><dd><Ltr className="font-mono text-xs">{p.iban}</Ltr></dd></div>}
          <div className="flex justify-between gap-3">
            <dt className="text-ink-3">{t("hr.daysPaid")}</dt>
            <dd className="tabular-nums"><Ltr>{`${p.paid_days} / ${p.period_days}`}</Ltr></dd>
          </div>
        </dl>

        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <section>
            <h2 className="mb-1 border-b border-line pb-1 text-xs font-semibold text-ink-3">{t("hr.earnings")}</h2>
            <Line label={t("hr.basic")} amount={n(p.basic)} money={money} />
            {n(p.housing) > 0 && <Line label={t("hr.housing")} amount={n(p.housing)} money={money} />}
            {n(p.transport) > 0 && <Line label={t("hr.transport")} amount={n(p.transport)} money={money} />}
            {n(p.other_allowances) > 0 && <Line label={t("hr.otherAllowances")} amount={n(p.other_allowances)} money={money} />}
            {n(p.overtime_amount) > 0 && (
              <Line
                label={t("hr.overtime")}
                note={<Ltr>{t("hr.hoursShort", { hours: n(p.overtime_hours) })}</Ltr>}
                amount={n(p.overtime_amount)}
                money={money}
              />
            )}
            {n(p.bonus) > 0 && <Line label={t("hr.bonus")} amount={n(p.bonus)} money={money} />}
            <div className="mt-1 border-t border-line">
              <Line label={t("hr.gross")} amount={n(p.gross)} money={money} strong />
            </div>
          </section>
          <section>
            <h2 className="mb-1 border-b border-line pb-1 text-xs font-semibold text-ink-3">{t("hr.deductions")}</h2>
            {n(p.unpaid_leave_deduction) > 0 && (
              <Line
                label={t("hr.unpaidLeave")}
                note={<Ltr>{t("hr.daysShort", { days: n(p.unpaid_leave_days) })}</Ltr>}
                amount={n(p.unpaid_leave_deduction)}
                money={money}
              />
            )}
            {n(p.social_insurance_employee) > 0 && (
              <Line label={t("hr.socialInsurance")} amount={n(p.social_insurance_employee)} money={money} />
            )}
            {n(p.deductions) > 0 && (
              <Line
                label={t("hr.otherDeductions")}
                note={p.deduction_note ? <Bdi>{p.deduction_note}</Bdi> : undefined}
                amount={n(p.deductions)}
                money={money}
              />
            )}
            {deductions === 0 && <p className="py-1.5 text-sm text-ink-3">{t("hr.noDeductions")}</p>}
            <div className="mt-1 border-t border-line">
              <Line label={t("hr.totalDeductions")} amount={deductions} money={money} strong />
            </div>
          </section>
        </div>

        <div className="mt-6 flex items-baseline justify-between rounded-xl bg-canvas px-4 py-3">
          <span className="text-sm font-semibold text-ink">{t("hr.netPay")}</span>
          <span className="text-xl font-bold text-ink tabular-nums">{money(n(p.net))}</span>
        </div>
        {isManager && n(p.social_insurance_employer) > 0 && (
          <p className="mt-3 text-xs text-ink-3">
            {t("hr.employerContribution", { amount: money(n(p.social_insurance_employer)) })}
          </p>
        )}
      </Card>
    </>
  );
}
