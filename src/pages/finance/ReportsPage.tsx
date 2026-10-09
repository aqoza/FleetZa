import { useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { wrapDbError } from "../../lib/db";
import { ltrText } from "../../lib/bidi";
import { formatDate, formatMoney } from "../../lib/format";
import {
  accountBalances, balanceSheet, fiscalYearStart, profitAndLoss, trialBalance, type StatementLine,
} from "../../../shared/finance";
import { useTenant } from "../../context/AuthContext";
import { useI18n, useT } from "../../i18n";
import { Badge, Bdi, Card, ErrorState, Field, Input, LoadingState, Ltr } from "../../components/ui";
import { Combobox } from "../../components/Combobox";
import { accountName, accountOptions, todayIn, useAccounts, useBalances, useFinanceSettings, type GlAccount } from "./types";

const REPORTS = ["trial", "pl", "bs", "ledger"] as const;
type Report = (typeof REPORTS)[number];

export default function ReportsPage() {
  const t = useT();
  const tenant = useTenant();
  const [params, setParams] = useSearchParams();
  const report = (REPORTS as readonly string[]).includes(params.get("report") ?? "") ? (params.get("report") as Report) : "trial";
  const today = todayIn(tenant.timezone);
  const settingsQ = useFinanceSettings();
  const [asOf, setAsOf] = useState(today);
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState(today);
  const periodFrom = from ?? fiscalYearStart(today, settingsQ.data?.fiscal_year_start_month ?? 1);
  const [accountId, setAccountId] = useState(params.get("account") ?? "");

  const pick = (r: Report) => {
    const next = new URLSearchParams(params);
    next.set("report", r);
    setParams(next, { replace: true });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="tablist">
        {REPORTS.map((r) => (
          <button
            key={r}
            type="button"
            role="tab"
            aria-selected={report === r}
            onClick={() => pick(r)}
            className={`rounded-full border px-3 py-1 text-sm ${
              report === r ? "border-brand-600 bg-brand-600 text-white" : "border-line bg-surface text-ink-2 hover:bg-canvas"
            }`}
          >
            {t(`finance.rep.${r}`)}
          </button>
        ))}
      </div>
      <Card className="flex flex-wrap items-end gap-3 p-4">
        {(report === "trial" || report === "bs") && (
          <Field label={t("finance.rep.asOf")}>
            <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value || today)} />
          </Field>
        )}
        {(report === "pl" || report === "ledger") && (
          <>
            {report === "ledger" && (
              <div className="w-full sm:w-72">
                <LedgerAccountPicker value={accountId} onChange={setAccountId} />
              </div>
            )}
            <Field label={t("finance.rep.from")}>
              <Input type="date" value={periodFrom} onChange={(e) => setFrom(e.target.value || null)} />
            </Field>
            <Field label={t("finance.rep.to")}>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value || today)} />
            </Field>
          </>
        )}
      </Card>
      {report === "trial" && <TrialBalance asOf={asOf} />}
      {report === "pl" && <ProfitLoss from={periodFrom} to={to} />}
      {report === "bs" && <BalanceSheet asOf={asOf} />}
      {report === "ledger" && <Ledger accountId={accountId} from={periodFrom} to={to} />}
    </div>
  );
}

function LedgerAccountPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useT();
  const { language } = useI18n();
  const accountsQ = useAccounts();
  const options = useMemo(() => accountOptions(accountsQ.data ?? [], language, () => true), [accountsQ.data, language]);
  return (
    <Field label={t("finance.rep.account")}>
      <Combobox options={options} value={value} onChange={onChange} placeholder={t("finance.rep.pickAccount")} />
    </Field>
  );
}

function useStatementData(from: string | null, to: string) {
  const accountsQ = useAccounts();
  const balancesQ = useBalances(from, to);
  const balances = useMemo(() => accountBalances(accountsQ.data ?? [], balancesQ.data ?? []), [accountsQ.data, balancesQ.data]);
  return {
    balances,
    loading: accountsQ.isLoading || balancesQ.isLoading,
    error: (accountsQ.error ?? balancesQ.error) as Error | null,
  };
}

function useMoney() {
  const tenant = useTenant();
  return (n: number) => formatMoney(n, tenant.currency);
}

function AccountCell({ account }: { account: GlAccount | { id: string; code: string; name: string; name_ar?: string | null } }) {
  const { language } = useI18n();
  return (
    <Link to={`/finance/reports?report=ledger&account=${account.id}`} className="hover:underline">
      <Ltr className="text-ink-3">{account.code}</Ltr>{" "}
      <Bdi className="text-ink">{accountName({ name: account.name, name_ar: account.name_ar ?? null }, language)}</Bdi>
    </Link>
  );
}

function TrialBalance({ asOf }: { asOf: string }) {
  const t = useT();
  const money = useMoney();
  const { balances, loading, error } = useStatementData(null, asOf);
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error.message} />;
  const tb = trialBalance(balances);
  return (
    <Card className="overflow-x-auto p-4">
      <ReportTitle title={t("finance.rep.trial")} sub={t("finance.rep.asOfDate", { date: ltrText(formatDate(asOf)) })}
        badge={<Badge tone={tb.balanced ? "green" : "red"}>{tb.balanced ? t("finance.je.balanced") : t("finance.rep.unbalanced")}</Badge>} />
      {tb.rows.length === 0 ? <Empty /> : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-xs text-ink-3">
              <th className="py-2 text-start font-medium">{t("finance.je.account")}</th>
              <th className="py-2 text-end font-medium">{t("finance.je.debit")}</th>
              <th className="py-2 text-end font-medium">{t("finance.je.credit")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {tb.rows.map((r) => (
              <tr key={r.account.id}>
                <td className="py-2 pe-3"><AccountCell account={r.account} /></td>
                <td className="whitespace-nowrap py-2 text-end"><Ltr>{r.debit ? money(r.debit) : ""}</Ltr></td>
                <td className="whitespace-nowrap py-2 text-end"><Ltr>{r.credit ? money(r.credit) : ""}</Ltr></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-line font-semibold">
              <td className="py-2">{t("finance.je.totals")}</td>
              <td className="whitespace-nowrap py-2 text-end"><Ltr>{money(tb.debit)}</Ltr></td>
              <td className="whitespace-nowrap py-2 text-end"><Ltr>{money(tb.credit)}</Ltr></td>
            </tr>
          </tfoot>
        </table>
      )}
    </Card>
  );
}

function Section({ title, lines, total, totalLabel }: { title: string; lines: StatementLine[]; total: number; totalLabel: string }) {
  const money = useMoney();
  return (
    <section className="mb-5">
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">{title}</h3>
      <ul className="divide-y divide-line text-sm">
        {lines.map((l) => (
          <li key={l.account.id} className="flex justify-between gap-3 py-1.5">
            <span className="min-w-0 truncate"><AccountCell account={l.account} /></span>
            <Ltr className="whitespace-nowrap text-ink">{money(l.amount)}</Ltr>
          </li>
        ))}
        <li className="flex justify-between gap-3 py-2 font-semibold">
          <span>{totalLabel}</span>
          <Ltr className="whitespace-nowrap">{money(total)}</Ltr>
        </li>
      </ul>
    </section>
  );
}

function ProfitLoss({ from, to }: { from: string; to: string }) {
  const t = useT();
  const money = useMoney();
  const { balances, loading, error } = useStatementData(from, to);
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error.message} />;
  const pl = profitAndLoss(balances);
  return (
    <Card className="p-4">
      <ReportTitle title={t("finance.rep.pl")} sub={t("finance.rep.period", { from: ltrText(formatDate(from)), to: ltrText(formatDate(to)) })} />
      {pl.income.length === 0 && pl.expense.length === 0 ? <Empty /> : (
        <>
          <Section title={t("finance.rep.income")} lines={pl.income} total={pl.totalIncome} totalLabel={t("finance.rep.totalIncome")} />
          <Section title={t("finance.rep.expenses")} lines={pl.expense} total={pl.totalExpense} totalLabel={t("finance.rep.totalExpense")} />
          <div className={`flex justify-between gap-3 rounded-xl px-3 py-2 font-semibold ${pl.net >= 0 ? "bg-good-soft text-good" : "bg-serious-soft text-serious"}`}>
            <span>{pl.net >= 0 ? t("finance.rep.netProfit") : t("finance.rep.netLoss")}</span>
            <Ltr>{money(pl.net)}</Ltr>
          </div>
        </>
      )}
    </Card>
  );
}

function BalanceSheet({ asOf }: { asOf: string }) {
  const t = useT();
  const money = useMoney();
  const { balances, loading, error } = useStatementData(null, asOf);
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error.message} />;
  const bs = balanceSheet(balances);
  const empty = bs.assets.length === 0 && bs.liabilities.length === 0 && bs.equity.length === 0 && bs.currentEarnings === 0;
  return (
    <Card className="p-4">
      <ReportTitle title={t("finance.rep.bs")} sub={t("finance.rep.asOfDate", { date: ltrText(formatDate(asOf)) })}
        badge={<Badge tone={bs.balanced ? "green" : "red"}>{bs.balanced ? t("finance.je.balanced") : t("finance.rep.unbalanced")}</Badge>} />
      {empty ? <Empty /> : (
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <Section title={t("finance.rep.assets")} lines={bs.assets} total={bs.totalAssets} totalLabel={t("finance.rep.totalAssets")} />
          </div>
          <div>
            <Section title={t("finance.rep.liabilities")} lines={bs.liabilities} total={bs.totalLiabilities} totalLabel={t("finance.rep.totalLiabilities")} />
            <section className="mb-5">
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">{t("finance.rep.equity")}</h3>
              <ul className="divide-y divide-line text-sm">
                {bs.equity.map((l) => (
                  <li key={l.account.id} className="flex justify-between gap-3 py-1.5">
                    <span className="min-w-0 truncate"><AccountCell account={l.account} /></span>
                    <Ltr className="whitespace-nowrap text-ink">{money(l.amount)}</Ltr>
                  </li>
                ))}
                <li className="flex justify-between gap-3 py-1.5">
                  <span className="text-ink-2">{t("finance.rep.currentEarnings")}</span>
                  <Ltr className="whitespace-nowrap text-ink">{money(bs.currentEarnings)}</Ltr>
                </li>
                <li className="flex justify-between gap-3 py-2 font-semibold">
                  <span>{t("finance.rep.totalEquity")}</span>
                  <Ltr className="whitespace-nowrap">{money(bs.totalEquity)}</Ltr>
                </li>
              </ul>
            </section>
            <div className="flex justify-between gap-3 border-t-2 border-line pt-2 text-sm font-semibold">
              <span>{t("finance.rep.totalLiabilitiesEquity")}</span>
              <Ltr>{money(bs.totalLiabilities + bs.totalEquity)}</Ltr>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

interface LedgerRow {
  line_id: string;
  entry_id: string;
  doc_number: string;
  entry_date: string;
  memo: string;
  description: string;
  source_type: string;
  debit: number;
  credit: number;
  balance: number;
}

function Ledger({ accountId, from, to }: { accountId: string; from: string; to: string }) {
  const t = useT();
  const { language } = useI18n();
  const money = useMoney();
  const accountsQ = useAccounts();
  const account = (accountsQ.data ?? []).find((a) => a.id === accountId);
  const q = useQuery({
    queryKey: ["finance_ledger", accountId, from, to],
    enabled: !!accountId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("finance_ledger", { p_account_id: accountId, p_from: from, p_to: to, p_limit: 2000 });
      if (error) throw wrapDbError(error);
      return (data ?? []) as LedgerRow[];
    },
  });
  if (!accountId) return <Card className="p-8 text-center text-sm text-ink-3">{t("finance.rep.pickAccountHint")}</Card>;
  if (q.isLoading) return <LoadingState />;
  if (q.error) return <ErrorState message={(q.error as Error).message} />;
  const rows = q.data ?? [];
  // Running balances are debit-positive; show them in the account's natural sign.
  const sign = account && (account.account_type === "asset" || account.account_type === "expense") ? 1 : -1;
  return (
    <Card className="overflow-x-auto p-4">
      <ReportTitle title={account ? `${account.code} · ${accountName(account, language)}` : t("finance.rep.ledger")}
        sub={t("finance.rep.period", { from: ltrText(formatDate(from)), to: ltrText(formatDate(to)) })} />
      {rows.length === 0 ? <Empty /> : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-xs text-ink-3">
              <th className="py-2 text-start font-medium">{t("finance.je.date")}</th>
              <th className="py-2 text-start font-medium">{t("finance.je.number")}</th>
              <th className="hidden py-2 text-start font-medium md:table-cell">{t("finance.je.memo")}</th>
              <th className="py-2 text-end font-medium">{t("finance.je.debit")}</th>
              <th className="py-2 text-end font-medium">{t("finance.je.credit")}</th>
              <th className="py-2 text-end font-medium">{t("finance.acc.balance")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.line_id}>
                <td className="whitespace-nowrap py-2 pe-3 text-ink-2">{formatDate(r.entry_date)}</td>
                <td className="whitespace-nowrap py-2 pe-3">
                  <Link to={`/finance/journal/${r.entry_id}`} className="text-brand-700 hover:underline"><Ltr>{r.doc_number}</Ltr></Link>
                </td>
                <td className="hidden max-w-72 truncate py-2 pe-3 text-ink-2 md:table-cell"><Bdi>{r.description || r.memo || ""}</Bdi></td>
                <td className="whitespace-nowrap py-2 text-end"><Ltr>{Number(r.debit) ? money(Number(r.debit)) : ""}</Ltr></td>
                <td className="whitespace-nowrap py-2 text-end"><Ltr>{Number(r.credit) ? money(Number(r.credit)) : ""}</Ltr></td>
                <td className="whitespace-nowrap py-2 text-end font-medium"><Ltr>{money(sign * Number(r.balance))}</Ltr></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function ReportTitle({ title, sub, badge }: { title: string; sub: string; badge?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
      <div>
        <h2 className="font-semibold text-ink"><Bdi>{title}</Bdi></h2>
        <p className="text-xs text-ink-3">{sub}</p>
      </div>
      {badge}
    </div>
  );
}

function Empty() {
  const t = useT();
  return <p className="py-8 text-center text-sm text-ink-3">{t("finance.rep.empty")}</p>;
}
