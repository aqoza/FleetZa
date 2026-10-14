import { useState } from "react";
import { computeGratuity, schemeForCountry, type GratuityScheme, type SeparationReason } from "../../../shared/gratuity";
import { formatMoney } from "../../lib/format";
import { useTenant } from "../../context/AuthContext";
import { useT, useTp } from "../../i18n";
import { Card, Field, Input, Select } from "../../components/ui";
import { todayIso } from "../employees/shared";

interface Props {
  hireDate: string | null;
  terminationDate: string | null;
  basicSalary: number | null;
  housingAllowance: number | null;
}

/** End-of-service estimate on the employee page (managers, payroll_hr on). */
export function GratuityCard({ hireDate, terminationDate, basicSalary, housingAllowance }: Props) {
  const t = useT();
  const tp = useTp();
  const tenant = useTenant();
  const [scheme, setScheme] = useState<GratuityScheme>(schemeForCountry(tenant.country));
  const [reason, setReason] = useState<SeparationReason>("termination");
  const [endDate, setEndDate] = useState(terminationDate ?? todayIso());

  if (!hireDate || basicSalary == null) {
    return (
      <Card className="p-5">
        <h3 className="mb-2 text-sm font-semibold text-ink">{t("hr.gratuity")}</h3>
        <p className="text-sm text-ink-3">{t("hr.gratuityNeeds")}</p>
      </Card>
    );
  }

  const wage = scheme === "uae" ? basicSalary : basicSalary + (housingAllowance ?? 0);
  const r = computeGratuity({ scheme, monthlyWage: wage, startDate: hireDate, endDate, reason });
  const years = Math.floor(r.years);
  const months = Math.floor((r.years - years) * 12);
  const money = (n: number) => formatMoney(n, tenant.currency);

  return (
    <Card className="p-5">
      <h3 className="mb-3 text-sm font-semibold text-ink">{t("hr.gratuity")}</h3>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("hr.gratuityRules")}>
          <Select value={scheme} onChange={(e) => setScheme(e.target.value as GratuityScheme)}>
            <option value="ksa">{t("hr.scheme.ksa")}</option>
            <option value="uae">{t("hr.scheme.uae")}</option>
          </Select>
        </Field>
        <Field label={t("hr.separation")}>
          <Select value={reason} onChange={(e) => setReason(e.target.value as SeparationReason)}>
            <option value="termination">{t("hr.reason.termination")}</option>
            <option value="resignation">{t("hr.reason.resignation")}</option>
          </Select>
        </Field>
        <Field label={t("hr.lastDay")}>
          <Input type="date" value={endDate} min={hireDate} onChange={(e) => e.target.value && setEndDate(e.target.value)} dir="ltr" />
        </Field>
      </div>
      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2 rounded-xl bg-canvas px-4 py-3">
        <span className="text-sm text-ink-2">
          {tp("hr.serviceYears", years)} {months > 0 && tp("hr.serviceMonths", months)}
        </span>
        <span className="text-xl font-bold text-ink tabular-nums">{money(r.amount)}</span>
      </div>
      <ul className="mt-2 space-y-0.5 text-xs text-ink-3">
        <li>{t(scheme === "uae" ? "hr.wageBasisUae" : "hr.wageBasisKsa", { wage: money(wage) })}</li>
        {r.factor < 1 && (
          <li>{t("hr.resignationCut", { full: money(r.fullAmount), share: Math.round(r.factor * 100) })}</li>
        )}
        {scheme === "uae" && r.years < 1 && <li>{t("hr.uaeUnderOneYear")}</li>}
        {r.capped && <li>{t("hr.uaeCapped")}</li>}
        <li>{t("hr.gratuityEstimate")}</li>
      </ul>
    </Card>
  );
}
