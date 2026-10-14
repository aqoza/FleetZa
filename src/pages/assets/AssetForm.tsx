import { useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { insertRow, updateRow } from "../../lib/db";
import { useSupplierPicker } from "../../lib/pickers";
import type { DepreciationMethod } from "../../lib/depreciation";
import { useTenant } from "../../context/AuthContext";
import { useModules } from "../../context/ModulesContext";
import { useT } from "../../i18n";
import { Button, ErrorState, Field, Input, Select, Textarea } from "../../components/ui";
import { Combobox } from "../../components/Combobox";
import { useToast } from "../../components/Toast";
import { useWarehouses } from "../inventory/hooks";
import { useBranchPicker } from "../companies/hooks";
import { categories, editableStatuses, methods, statuses } from "./labels";
import type { Asset, AssetCategory, AssetStatus } from "./types";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-3">
      <legend className="mb-1 text-sm font-semibold text-ink">{title}</legend>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

export function AssetForm({
  asset,
  onDone,
  onCancel,
}: {
  asset?: Asset;
  onDone: (saved: Asset) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const tenant = useTenant();
  const qc = useQueryClient();
  const toast = useToast();
  const { isEnabled } = useModules();
  const inventoryOn = isEnabled("inventory");
  const companiesOn = isEnabled("companies");
  const suppliersOn = isEnabled("suppliers");
  const [form, setForm] = useState({
    name: asset?.name ?? "",
    category: asset?.category ?? ("equipment" as AssetCategory),
    status: asset?.status ?? ("in_service" as AssetStatus),
    serial_number: asset?.serial_number ?? "",
    model: asset?.model ?? "",
    manufacturer: asset?.manufacturer ?? "",
    location: asset?.location ?? "",
    warehouse_id: asset?.warehouse_id ?? "",
    branch_id: asset?.branch_id ?? "",
    supplier_id: asset?.supplier_id ?? "",
    purchase_date: asset?.purchase_date ?? "",
    purchase_cost: asset?.purchase_cost != null ? String(asset.purchase_cost) : "",
    warranty_expiry: asset?.warranty_expiry ?? "",
    depreciation_method: asset?.depreciation_method ?? ("straight_line" as DepreciationMethod),
    useful_life_months: asset?.useful_life_months != null ? String(asset.useful_life_months) : "",
    salvage_value: asset ? String(asset.salvage_value ?? 0) : "",
    notes: asset?.notes ?? "",
  });
  const [error, setError] = useState("");
  const warehousesQ = useWarehouses();
  const branchPicker = useBranchPicker(form.branch_id, companiesOn);
  const supplierPicker = useSupplierPicker(form.supplier_id, { enabled: suppliersOn });

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const num = (v: string) => (v === "" ? null : Number(v));

  const mutation = useMutation({
    mutationFn: () => {
      const values: Record<string, unknown> = {
        name: form.name.trim(),
        category: form.category,
        status: form.status,
        serial_number: form.serial_number.trim() || null,
        model: form.model.trim() || null,
        manufacturer: form.manufacturer.trim() || null,
        location: form.location.trim() || null,
        purchase_date: form.purchase_date || null,
        purchase_cost: num(form.purchase_cost),
        warranty_expiry: form.warranty_expiry || null,
        depreciation_method: form.depreciation_method,
        useful_life_months: form.depreciation_method === "none" ? null : num(form.useful_life_months),
        salvage_value: num(form.salvage_value) ?? 0,
        notes: form.notes.trim() || null,
      };
      // Module-gated links: never clear one the form could not show.
      if (inventoryOn) values.warehouse_id = form.warehouse_id || null;
      if (companiesOn) values.branch_id = form.branch_id || null;
      if (suppliersOn) values.supplier_id = form.supplier_id || null;
      return asset ? updateRow<Asset>("assets", asset.id, values) : insertRow<Asset>("assets", values);
    },
    onSuccess: (saved) => {
      void qc.invalidateQueries({ queryKey: ["assets"] });
      toast.success(asset ? t("assets.saved") : t("assets.created"));
      onDone(saved);
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("common.error")),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    mutation.mutate();
  }

  const money = (label: string) => `${label} (${tenant.currency})`;

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {error && <ErrorState message={error} />}
      <Section title={t("assets.sectionIdentity")}>
        <Field label={t("assets.f.name")} required>
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} required maxLength={200} />
        </Field>
        <Field label={t("assets.f.category")}>
          <Select value={form.category} onChange={(e) => set("category", e.target.value as AssetCategory)}>
            {Object.entries(categories).map(([v, k]) => (
              <option key={v} value={v}>{t(k)}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("assets.f.manufacturer")}>
          <Input value={form.manufacturer} onChange={(e) => set("manufacturer", e.target.value)} />
        </Field>
        <Field label={t("assets.f.model")}>
          <Input value={form.model} onChange={(e) => set("model", e.target.value)} />
        </Field>
        <Field label={t("assets.f.serial")}>
          <Input dir="ltr" value={form.serial_number} onChange={(e) => set("serial_number", e.target.value)} />
        </Field>
        <Field label={t("assets.f.status")}>
          <Select value={form.status} onChange={(e) => set("status", e.target.value as AssetStatus)}>
            {editableStatuses.map((s) => (
              <option key={s} value={s}>{t(statuses[s].labelKey)}</option>
            ))}
          </Select>
        </Field>
      </Section>

      <Section title={t("assets.sectionWhere")}>
        <Field label={t("assets.f.location")} hint={t("assets.f.locationHint")}>
          <Input value={form.location} onChange={(e) => set("location", e.target.value)} />
        </Field>
        {inventoryOn && (
          <Field label={t("assets.f.warehouse")}>
            <Select value={form.warehouse_id} onChange={(e) => set("warehouse_id", e.target.value)}>
              <option value="">{t("assets.f.none")}</option>
              {(warehousesQ.data ?? []).map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </Select>
          </Field>
        )}
        {companiesOn && (
          <Field label={t("assets.f.branch")}>
            <Combobox {...branchPicker} value={form.branch_id} onChange={(v) => set("branch_id", v)} />
          </Field>
        )}
      </Section>

      <Section title={t("assets.sectionValue")}>
        <Field label={t("assets.f.purchaseDate")}>
          <Input type="date" dir="ltr" value={form.purchase_date} onChange={(e) => set("purchase_date", e.target.value)} />
        </Field>
        <Field label={money(t("assets.f.purchaseCost"))}>
          <Input
            type="number" dir="ltr" min={0} step="0.001"
            value={form.purchase_cost}
            onChange={(e) => set("purchase_cost", e.target.value)}
          />
        </Field>
        {suppliersOn && (
          <Field label={t("assets.f.supplier")}>
            <Combobox {...supplierPicker} value={form.supplier_id} onChange={(v) => set("supplier_id", v)} />
          </Field>
        )}
        <Field label={t("assets.f.warrantyExpiry")}>
          <Input type="date" dir="ltr" value={form.warranty_expiry} onChange={(e) => set("warranty_expiry", e.target.value)} />
        </Field>
        <Field label={t("assets.f.method")}>
          <Select
            value={form.depreciation_method}
            onChange={(e) => set("depreciation_method", e.target.value as DepreciationMethod)}
          >
            {Object.entries(methods).map(([v, k]) => (
              <option key={v} value={v}>{t(k)}</option>
            ))}
          </Select>
        </Field>
        {form.depreciation_method !== "none" && (
          <>
            <Field label={t("assets.f.lifeMonths")} hint={t("assets.f.lifeHint")}>
              <Input
                type="number" dir="ltr" min={1} max={1200} step={1}
                value={form.useful_life_months}
                onChange={(e) => set("useful_life_months", e.target.value)}
              />
            </Field>
            <Field label={money(t("assets.f.salvage"))} hint={t("assets.f.salvageHint")}>
              <Input
                type="number" dir="ltr" min={0} step="0.001"
                value={form.salvage_value}
                onChange={(e) => set("salvage_value", e.target.value)}
              />
            </Field>
          </>
        )}
      </Section>

      <Field label={t("assets.f.notes")}>
        <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>{t("action.cancel")}</Button>
        <Button type="submit" loading={mutation.isPending}>
          {asset ? t("action.saveChanges") : t("action.create")}
        </Button>
      </div>
    </form>
  );
}
