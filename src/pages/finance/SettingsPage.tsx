import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { updateRow } from "../../lib/db";
import { ACCOUNT_MAPPING_KEYS, MAPPING_ACCOUNT_TYPES } from "../../../shared/finance";
import { useAuth } from "../../context/AuthContext";
import { useI18n, useT } from "../../i18n";
import { Card, ErrorState, Field, Input, LoadingState, Select } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { FormActions, FormError, onSubmit, useSubmit } from "./forms";
import { accountName, useAccounts, useFinanceSettings } from "./types";

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

export default function SettingsPage() {
  const t = useT();
  const { language } = useI18n();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const settingsQ = useFinanceSettings();
  const accountsQ = useAccounts();
  const s = settingsQ.data;
  const [f, setF] = useState({ lock_date: "", fiscal_year_start_month: 1, accounts: {} as Record<string, string> });
  useEffect(() => {
    if (s) setF({ lock_date: s.lock_date ?? "", fiscal_year_start_month: s.fiscal_year_start_month, accounts: { ...s.accounts } });
  }, [s]);
  const { error, saving, run } = useSubmit(() => {
    void qc.invalidateQueries({ queryKey: ["finance_settings"] });
    toast.success(t("finance.saved"));
  });

  if (settingsQ.isLoading || accountsQ.isLoading) return <LoadingState />;
  const err = settingsQ.error ?? accountsQ.error;
  if (err) return <ErrorState message={(err as Error).message} />;
  if (!s) return <Card className="p-8 text-center text-sm text-ink-3">{t("finance.set.notSetUp")}</Card>;

  const locale = language === "ar" ? "ar" : "en";
  const monthName = (m: number) => new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, m - 1, 1)));
  const accounts = accountsQ.data ?? [];
  const submit = onSubmit(() => void run(async () => {
    const mapping = Object.fromEntries(Object.entries(f.accounts).filter(([, v]) => v));
    await updateRow("finance_settings", s.id, {
      lock_date: f.lock_date || null,
      fiscal_year_start_month: f.fiscal_year_start_month,
      accounts: mapping,
    });
  }));

  return (
    <form className="space-y-4" onSubmit={submit}>
      <Card className="space-y-4 p-4">
        <div>
          <h2 className="text-sm font-semibold text-ink">{t("finance.set.periods")}</h2>
          <p className="text-xs text-ink-3">{t("finance.set.periodsHint")}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("finance.set.lockDate")} hint={t("finance.set.lockDateHint")}>
            <Input type="date" value={f.lock_date} disabled={!isManager} onChange={(e) => setF({ ...f, lock_date: e.target.value })} />
          </Field>
          <Field label={t("finance.set.fiscalStart")}>
            <Select value={String(f.fiscal_year_start_month)} disabled={!isManager}
              onChange={(e) => setF({ ...f, fiscal_year_start_month: Number(e.target.value) })}>
              {MONTHS.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
            </Select>
          </Field>
        </div>
      </Card>
      <Card className="space-y-4 p-4">
        <div>
          <h2 className="text-sm font-semibold text-ink">{t("finance.set.mapping")}</h2>
          <p className="text-xs text-ink-3">{t("finance.set.mappingHint")}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {ACCOUNT_MAPPING_KEYS.map((k) => (
            <Field key={k} label={t(`finance.map.${k}`)}>
              <Select value={f.accounts[k] ?? ""} disabled={!isManager}
                onChange={(e) => setF({ ...f, accounts: { ...f.accounts, [k]: e.target.value } })}>
                <option value="">{t("finance.set.unmapped")}</option>
                {accounts
                  .filter((a) => MAPPING_ACCOUNT_TYPES[k].includes(a.account_type) && (a.active || a.id === f.accounts[k]))
                  .map((a) => <option key={a.id} value={a.id}>{`${a.code} · ${accountName(a, language)}`}</option>)}
              </Select>
            </Field>
          ))}
        </div>
      </Card>
      <FormError message={error} />
      {isManager && (
        <FormActions saving={saving} label={t("action.save")} onCancel={() => setF({
          lock_date: s.lock_date ?? "", fiscal_year_start_month: s.fiscal_year_start_month, accounts: { ...s.accounts },
        })} />
      )}
    </form>
  );
}
