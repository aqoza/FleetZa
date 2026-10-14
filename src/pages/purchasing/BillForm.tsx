import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { insertRow, updateRow } from "../../lib/db";
import { useSupplierPicker } from "../../lib/pickers";
import { useT } from "../../i18n";
import { Button, ErrorState, Field, Input, Textarea } from "../../components/ui";
import { Combobox } from "../../components/Combobox";
import { useToast } from "../../components/Toast";
import { todayIso } from "../employees/shared";
import type { VendorBill } from "./types";

/** Record a supplier's invoice by hand, or edit a draft bill's header. */
export function BillForm({ bill, onDone }: { bill?: VendorBill; onDone: (id?: string) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [supplierId, setSupplierId] = useState(bill?.supplier_id ?? "");
  const [invoiceNo, setInvoiceNo] = useState(bill?.supplier_invoice_number ?? "");
  const [billDate, setBillDate] = useState(bill?.bill_date ?? todayIso());
  const [dueDate, setDueDate] = useState(bill?.due_date ?? "");
  const [notes, setNotes] = useState(bill?.notes ?? "");
  const [error, setError] = useState("");
  const supplierPicker = useSupplierPicker(supplierId, { activeOnly: !bill });
  // A bill made from a PO keeps that PO's supplier.
  const supplierLocked = !!bill?.purchase_order_id;

  const save = useMutation({
    mutationFn: async () => {
      const values: Record<string, unknown> = {
        supplier_invoice_number: invoiceNo.trim() || null,
        bill_date: billDate,
        due_date: dueDate || null,
        notes: notes.trim() || null,
      };
      if (!supplierLocked) values.supplier_id = supplierId;
      if (bill) return updateRow<VendorBill>("vendor_bills", bill.id, values);
      return insertRow<VendorBill>("vendor_bills", values);
    },
    onSuccess: (row) => {
      void qc.invalidateQueries({ queryKey: ["vendor_bills"] });
      toast.success(t(bill ? "purchasing.saved" : "purchasing.created"));
      onDone(row?.id);
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!supplierId || !billDate) return;
    save.mutate();
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label={t("purchasing.f.supplier")} required>
        <Combobox {...supplierPicker} value={supplierId} onChange={setSupplierId} required disabled={supplierLocked} />
      </Field>
      <Field label={t("purchasing.f.supplierInvoice")}>
        <Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} maxLength={100} dir="auto" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("purchasing.f.billDate")} required>
          <Input type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} required dir="ltr" />
        </Field>
        <Field label={t("purchasing.f.dueDate")} hint={bill ? undefined : t("purchasing.f.dueHint")}>
          <Input type="date" value={dueDate} min={billDate} onChange={(e) => setDueDate(e.target.value)} dir="ltr" />
        </Field>
      </div>
      <Field label={t("purchasing.f.notes")}>
        <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} />
      </Field>
      {error && <ErrorState message={error} />}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => onDone()}>{t("action.cancel")}</Button>
        <Button type="submit" loading={save.isPending} disabled={!supplierId || !billDate}>{t("action.save")}</Button>
      </div>
    </form>
  );
}
