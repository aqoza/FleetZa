import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { insertRow, updateRow } from "../../lib/db";
import { useSupplierPicker } from "../../lib/pickers";
import { useModules } from "../../context/ModulesContext";
import { useI18n, useT } from "../../i18n";
import { Button, ErrorState, Field, Input, Select, Textarea } from "../../components/ui";
import { Combobox } from "../../components/Combobox";
import { useToast } from "../../components/Toast";
import { useWarehouses } from "../inventory/hooks";
import { todayIso } from "../employees/shared";
import type { PurchaseOrder } from "./types";

/** Create a PO, or edit its header. Supplier is fixed once the order leaves draft. */
export function OrderForm({ order, onDone }: { order?: PurchaseOrder; onDone: (id?: string) => void }) {
  const t = useT();
  const { language } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const { isEnabled } = useModules();
  const inventory = isEnabled("inventory");
  const warehousesQ = useWarehouses();
  const [supplierId, setSupplierId] = useState(order?.supplier_id ?? "");
  const [warehouseId, setWarehouseId] = useState(order?.warehouse_id ?? "");
  const [orderDate, setOrderDate] = useState(order?.order_date ?? todayIso());
  const [expected, setExpected] = useState(order?.expected_date ?? "");
  const [reference, setReference] = useState(order?.supplier_reference ?? "");
  const [terms, setTerms] = useState(order?.terms ?? "");
  const [notes, setNotes] = useState(order?.notes ?? "");
  const [error, setError] = useState("");
  const supplierPicker = useSupplierPicker(supplierId, { activeOnly: true });
  const supplierLocked = !!order && order.status !== "draft";

  // Default the warehouse for a new PO once the list arrives.
  const defaultWarehouse = (warehousesQ.data ?? []).find((w) => w.is_default)?.id ?? "";
  const effectiveWarehouse = order || warehouseId ? warehouseId : defaultWarehouse;

  const save = useMutation({
    mutationFn: async () => {
      const values: Record<string, unknown> = {
        warehouse_id: effectiveWarehouse || null,
        order_date: orderDate,
        expected_date: expected || null,
        supplier_reference: reference.trim() || null,
        terms: terms.trim() || null,
        notes: notes.trim() || null,
      };
      if (!supplierLocked) values.supplier_id = supplierId;
      if (order) return updateRow<PurchaseOrder>("purchase_orders", order.id, values);
      return insertRow<PurchaseOrder>("purchase_orders", values);
    },
    onSuccess: (row) => {
      void qc.invalidateQueries({ queryKey: ["purchase_orders"] });
      toast.success(t(order ? "purchasing.saved" : "purchasing.created"));
      onDone(row?.id);
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!supplierId || !orderDate) return;
    save.mutate();
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label={t("purchasing.f.supplier")} required>
        <Combobox {...supplierPicker} value={supplierId} onChange={setSupplierId} required disabled={supplierLocked} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("purchasing.f.orderDate")} required>
          <Input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} required dir="ltr" />
        </Field>
        <Field label={t("purchasing.f.expectedDate")}>
          <Input type="date" value={expected} min={orderDate} onChange={(e) => setExpected(e.target.value)} dir="ltr" />
        </Field>
        {inventory && (
          <Field label={t("purchasing.f.warehouse")}>
            <Select value={effectiveWarehouse} onChange={(e) => setWarehouseId(e.target.value)}>
              <option value="">{t("purchasing.f.noWarehouse")}</option>
              {(warehousesQ.data ?? []).filter((w) => w.active || w.id === effectiveWarehouse).map((w) => (
                <option key={w.id} value={w.id}>{language === "ar" && w.name_ar ? w.name_ar : w.name}</option>
              ))}
            </Select>
          </Field>
        )}
        <Field label={t("purchasing.f.reference")} hint={t("purchasing.f.referenceHint")}>
          <Input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} />
        </Field>
      </div>
      <Field label={t("purchasing.f.terms")}>
        <Textarea rows={2} value={terms} onChange={(e) => setTerms(e.target.value)} maxLength={4000} />
      </Field>
      <Field label={t("purchasing.f.notes")}>
        <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} />
      </Field>
      {error && <ErrorState message={error} />}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => onDone()}>{t("action.cancel")}</Button>
        <Button type="submit" loading={save.isPending} disabled={!supplierId || !orderDate}>{t("action.save")}</Button>
      </div>
    </form>
  );
}
