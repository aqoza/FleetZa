import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { insertRow, updateRow } from "../../lib/db";
import { useProductPicker } from "../../lib/pickers";
import { useTenant } from "../../context/AuthContext";
import { useModules } from "../../context/ModulesContext";
import { useT } from "../../i18n";
import { Button, ErrorState, Field, Input, Select, Textarea } from "../../components/ui";
import { Combobox } from "../../components/Combobox";
import { useToast } from "../../components/Toast";
import { usePreferredSupplierPicker } from "./hooks";
import { itemTypes } from "./labels";
import type { InventoryItem, ItemType } from "./types";

export function ItemForm({
  item,
  onDone,
  onCancel,
}: {
  item?: InventoryItem;
  onDone: (saved: InventoryItem) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const tenant = useTenant();
  const qc = useQueryClient();
  const toast = useToast();
  const { isEnabled } = useModules();
  const salesOn = isEnabled("sales");
  const suppliersOn = isEnabled("suppliers");
  const [form, setForm] = useState({
    sku: item?.sku ?? "",
    name: item?.name ?? "",
    name_ar: item?.name_ar ?? "",
    description: item?.description ?? "",
    category: item?.category ?? "",
    item_type: item?.item_type ?? ("part" as ItemType),
    uom: item?.uom ?? "unit",
    barcode: item?.barcode ?? "",
    cost_price: "",
    sale_price: item?.sale_price != null ? String(item.sale_price) : "",
    product_id: item?.product_id ?? "",
    preferred_supplier_id: item?.preferred_supplier_id ?? "",
    reorder_point: item?.reorder_point != null ? String(item.reorder_point) : "",
    reorder_qty: item?.reorder_qty != null ? String(item.reorder_qty) : "",
    track_stock: item?.track_stock ?? true,
    active: item?.active ?? true,
  });
  const [error, setError] = useState("");
  const productPicker = useProductPicker(form.product_id);
  const supplierPicker = usePreferredSupplierPicker(form.preferred_supplier_id, suppliersOn);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const num = (v: string) => (v === "" ? null : Number(v));

  const mutation = useMutation({
    mutationFn: () => {
      const values: Record<string, unknown> = {
        sku: form.sku.trim() || null,
        name: form.name.trim(),
        name_ar: form.name_ar.trim() || null,
        description: form.description.trim() || null,
        category: form.category.trim() || null,
        item_type: form.item_type,
        uom: form.uom.trim() || "unit",
        barcode: form.barcode.trim() || null,
        sale_price: num(form.sale_price),
        reorder_point: num(form.reorder_point),
        reorder_qty: num(form.reorder_qty),
        track_stock: form.track_stock,
        active: form.active,
      };
      // Module-gated links: never clear one the form could not show.
      if (salesOn) values.product_id = form.product_id || null;
      if (suppliersOn) values.preferred_supplier_id = form.preferred_supplier_id || null;
      // The average cost is the ledger's; only a brand-new item takes an opening value.
      if (!item && form.cost_price !== "") values.cost_price = Number(form.cost_price);
      return item
        ? updateRow<InventoryItem>("inventory_items", item.id, values)
        : insertRow<InventoryItem>("inventory_items", values);
    },
    onSuccess: (saved) => {
      void qc.invalidateQueries({ queryKey: ["inventory_items"] });
      void qc.invalidateQueries({ queryKey: ["inventory_report"] });
      void qc.invalidateQueries({ queryKey: ["picker", "inventory_items"] });
      toast.success(item ? t("toast.saved") : t("toast.created"));
      onDone(saved);
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("inventory.itemSaveFailed")),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    mutation.mutate();
  }

  const money = (label: string) => t("inventory.moneyUnit", { label, currency: tenant.currency });

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && <ErrorState message={error} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("inventory.name")} required>
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} required maxLength={200} />
        </Field>
        <Field label={t("inventory.nameAr")}>
          <Input dir="rtl" lang="ar" value={form.name_ar} onChange={(e) => set("name_ar", e.target.value)} />
        </Field>
        <Field label={t("inventory.sku")}>
          <Input dir="ltr" value={form.sku} onChange={(e) => set("sku", e.target.value)} />
        </Field>
        <Field label={t("inventory.barcode")}>
          <Input dir="ltr" value={form.barcode} onChange={(e) => set("barcode", e.target.value)} />
        </Field>
        <Field label={t("inventory.itemTypeLabel")}>
          <Select value={form.item_type} onChange={(e) => set("item_type", e.target.value as ItemType)}>
            {Object.entries(itemTypes).map(([v, k]) => (
              <option key={v} value={v}>{t(k)}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("inventory.category")} hint={t("inventory.categoryHint")}>
          <Input value={form.category} onChange={(e) => set("category", e.target.value)} />
        </Field>
        <Field label={t("inventory.uom")} hint={t("inventory.uomHint")}>
          <Input value={form.uom} onChange={(e) => set("uom", e.target.value)} />
        </Field>
        {!item && (
          <Field label={money(t("inventory.openingCost"))} hint={t("inventory.openingCostHint")}>
            <Input
              type="number" dir="ltr" min={0} step="0.0001"
              value={form.cost_price}
              onChange={(e) => set("cost_price", e.target.value)}
            />
          </Field>
        )}
        <Field label={money(t("inventory.salePrice"))}>
          <Input
            type="number" dir="ltr" min={0} step="0.0001"
            value={form.sale_price}
            onChange={(e) => set("sale_price", e.target.value)}
          />
        </Field>
        <Field label={t("inventory.reorderPoint")}>
          <Input
            type="number" dir="ltr" min={0} step="0.001"
            value={form.reorder_point}
            onChange={(e) => set("reorder_point", e.target.value)}
          />
        </Field>
        <Field label={t("inventory.reorderQty")}>
          <Input
            type="number" dir="ltr" min={0} step="0.001"
            value={form.reorder_qty}
            onChange={(e) => set("reorder_qty", e.target.value)}
          />
        </Field>
        {suppliersOn && (
          <Field label={t("inventory.preferredSupplier")}>
            <Combobox
              {...supplierPicker}
              value={form.preferred_supplier_id}
              onChange={(v) => set("preferred_supplier_id", v)}
            />
          </Field>
        )}
        {salesOn && (
          <Field label={t("inventory.product")} hint={t("inventory.productHint")}>
            <Combobox {...productPicker} value={form.product_id} onChange={(v) => set("product_id", v)} />
          </Field>
        )}
      </div>
      <Field label={t("inventory.description")}>
        <Textarea value={form.description} onChange={(e) => set("description", e.target.value)} />
      </Field>
      <div className="space-y-2">
        <label className="flex items-start gap-2 text-sm text-ink-2">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-line"
            checked={form.track_stock}
            onChange={(e) => set("track_stock", e.target.checked)}
          />
          <span>
            <span className="font-medium">{t("inventory.trackStock")}</span>
            <span className="block text-xs text-ink-3">{t("inventory.trackStockHint")}</span>
          </span>
        </label>
        <label className="flex items-center gap-2 text-sm font-medium text-ink-2">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-line"
            checked={form.active}
            onChange={(e) => set("active", e.target.checked)}
          />
          {t("inventory.active")}
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>{t("action.cancel")}</Button>
        <Button type="submit" loading={mutation.isPending}>
          {item ? t("action.saveChanges") : t("action.create")}
        </Button>
      </div>
    </form>
  );
}
