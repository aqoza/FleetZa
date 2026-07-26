import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getCountry } from "../../../shared/countries";
import { wrapDbError } from "../../lib/db";
import { supabase } from "../../lib/supabase";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useT } from "../../i18n";
import {
  Button, Card, ErrorState, Field, Input, LoadingState, PageHeader, Textarea,
} from "../../components/ui";
import { useSalesSettings } from "./shared";

const DEFAULTS = {
  quote_prefix: "QT",
  order_prefix: "SO",
  invoice_prefix: "INV",
  quote_valid_days: "30",
  payment_terms_days: "30",
  default_tax_rate: "",
  quote_terms: "",
  invoice_terms: "",
};

export default function SalesSettingsPage() {
  const t = useT();
  const tenant = useTenant();
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const { data: settings, isLoading, error } = useSalesSettings();
  const [form, setForm] = useState(DEFAULTS);
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState("");

  useEffect(() => {
    if (!settings) return;
    setForm({
      quote_prefix: settings.quote_prefix,
      order_prefix: settings.order_prefix,
      invoice_prefix: settings.invoice_prefix,
      quote_valid_days: String(settings.quote_valid_days),
      payment_terms_days: String(settings.payment_terms_days),
      default_tax_rate:
        settings.default_tax_rate === null ? "" : String(settings.default_tax_rate),
      quote_terms: settings.quote_terms ?? "",
      invoice_terms: settings.invoice_terms ?? "",
    });
  }, [settings]);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  }

  const save = useMutation({
    mutationFn: async () => {
      const values = {
        tenant_id: tenant.id,
        quote_prefix: form.quote_prefix.trim() || "QT",
        order_prefix: form.order_prefix.trim() || "SO",
        invoice_prefix: form.invoice_prefix.trim() || "INV",
        quote_valid_days: Number(form.quote_valid_days) || 30,
        payment_terms_days: Number(form.payment_terms_days) || 30,
        default_tax_rate: form.default_tax_rate === "" ? null : Number(form.default_tax_rate),
        quote_terms: form.quote_terms.trim() || null,
        invoice_terms: form.invoice_terms.trim() || null,
      };
      // sales_settings is keyed by tenant_id and may not exist until the first
      // document is created, so upsert rather than update.
      const { error: err } = await supabase
        .from("sales_settings")
        .upsert(values, { onConflict: "tenant_id" });
      if (err) throw wrapDbError(err);
    },
    onSuccess: () => {
      setFailure("");
      setSaved(true);
      void qc.invalidateQueries({ queryKey: ["sales_settings"] });
    },
    onError: (err) => setFailure(err instanceof Error ? err.message : t("sales.saveFailed")),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFailure("");
    save.mutate();
  }

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={(error as Error).message} />;

  const country = getCountry(tenant.country);

  return (
    <>
      <PageHeader title={t("sales.settings.title")} description={t("sales.settings.subtitle")} />

      {!isAdmin && (
        <div className="mb-4 rounded-xl border border-line bg-canvas px-4 py-3 text-sm text-ink-2">
          {t("sales.settings.adminOnly")}
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-4">
        {failure && <ErrorState message={failure} />}

        <Card className="p-5">
          <h3 className="mb-4 text-sm font-semibold text-ink">{t("sales.settings.numbering")}</h3>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label={t("sales.settings.quotePrefix")}
              hint={t("sales.settings.prefixHint", {
                example: `${form.quote_prefix || "QT"}-00001`,
              })}
            >
              <Input
                value={form.quote_prefix}
                onChange={(e) => set("quote_prefix", e.target.value)}
                disabled={!isAdmin}
                maxLength={12}
              />
            </Field>
            <Field
              label={t("sales.settings.orderPrefix")}
              hint={t("sales.settings.prefixHint", {
                example: `${form.order_prefix || "SO"}-00001`,
              })}
            >
              <Input
                value={form.order_prefix}
                onChange={(e) => set("order_prefix", e.target.value)}
                disabled={!isAdmin}
                maxLength={12}
              />
            </Field>
            <Field
              label={t("sales.settings.invoicePrefix")}
              hint={t("sales.settings.prefixHint", {
                example: `${form.invoice_prefix || "INV"}-00001`,
              })}
            >
              <Input
                value={form.invoice_prefix}
                onChange={(e) => set("invoice_prefix", e.target.value)}
                disabled={!isAdmin}
                maxLength={12}
              />
            </Field>
          </div>
        </Card>

        <Card className="p-5">
          <h3 className="mb-4 text-sm font-semibold text-ink">{t("sales.settings.defaults")}</h3>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t("sales.settings.quoteValidDays")}>
              <Input
                type="number" min={1} step="1"
                className="tabular-nums"
                value={form.quote_valid_days}
                onChange={(e) => set("quote_valid_days", e.target.value)}
                disabled={!isAdmin}
              />
            </Field>
            <Field label={t("sales.settings.paymentTermsDays")}>
              <Input
                type="number" min={0} step="1"
                className="tabular-nums"
                value={form.payment_terms_days}
                onChange={(e) => set("payment_terms_days", e.target.value)}
                disabled={!isAdmin}
              />
            </Field>
            <Field
              label={t("sales.settings.defaultTaxRate")}
              hint={t("sales.settings.defaultTaxHint", {
                label: country.tax.label,
                rate: country.tax.rate,
                country: country.name,
              })}
            >
              <Input
                type="number" min={0} max={100} step="0.01"
                className="tabular-nums"
                value={form.default_tax_rate}
                onChange={(e) => set("default_tax_rate", e.target.value)}
                disabled={!isAdmin}
              />
            </Field>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label={t("sales.settings.quoteTerms")}>
              <Textarea
                value={form.quote_terms}
                onChange={(e) => set("quote_terms", e.target.value)}
                disabled={!isAdmin}
              />
            </Field>
            <Field label={t("sales.settings.invoiceTerms")}>
              <Textarea
                value={form.invoice_terms}
                onChange={(e) => set("invoice_terms", e.target.value)}
                disabled={!isAdmin}
              />
            </Field>
          </div>
        </Card>

        {isAdmin && (
          <div className="flex items-center justify-end gap-3">
            {saved && <span className="text-sm text-good">{t("sales.settings.saved")}</span>}
            <Button type="submit" loading={save.isPending}>{t("action.saveChanges")}</Button>
          </div>
        )}
      </form>
    </>
  );
}
