import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { wrapDbError } from "../../lib/db";
import { supabase } from "../../lib/supabase";
import { remainingQty } from "../../lib/purchasing";
import { useModules } from "../../context/ModulesContext";
import { useI18n, useT } from "../../i18n";
import { Bdi, Button, ErrorState, Field, Input, Ltr, Select, Textarea } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { useWarehouses } from "../inventory/hooks";
import type { PurchaseLine, PurchaseOrder } from "./types";

export function ReceiveForm({ order, lines, onDone }: { order: PurchaseOrder; lines: PurchaseLine[]; onDone: () => void }) {
  const t = useT();
  const { language } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const { isEnabled } = useModules();
  const inventory = isEnabled("inventory");
  const warehousesQ = useWarehouses();
  const open = lines.filter((l) => remainingQty(l) > 0).sort((a, b) => a.sort_order - b.sort_order);
  const [qty, setQty] = useState<Record<string, string>>(() =>
    Object.fromEntries(open.map((l) => [l.id, String(remainingQty(l))])),
  );
  const [warehouseId, setWarehouseId] = useState(order.warehouse_id ?? "");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const needsWarehouse = inventory && open.some((l) => l.item_id && Number(qty[l.id]) > 0);
  const anyQty = open.some((l) => Number(qty[l.id]) > 0);
  const tooMuch = open.some((l) => Number(qty[l.id]) > remainingQty(l) || Number(qty[l.id]) < 0);

  const post = useMutation({
    mutationFn: async () => {
      const { data, error: e } = await supabase.rpc("purchase_receive", {
        p_po: order.id,
        p_lines: open.filter((l) => Number(qty[l.id]) > 0).map((l) => ({ line_id: l.id, quantity: Number(qty[l.id]) })),
        p_warehouse: warehouseId || null,
        p_notes: notes.trim() || null,
      });
      if (e) throw wrapDbError(e);
      return data as unknown as { doc_number: string | null };
    },
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ["purchase_orders"] });
      void qc.invalidateQueries({ queryKey: ["purchase_order_lines"] });
      void qc.invalidateQueries({ queryKey: ["purchase_receipts"] });
      toast.success(t("purchasing.received", { number: r?.doc_number ?? "" }));
      onDone();
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-2">{t("purchasing.receiveHint")}</p>
      <div className="flex gap-2">
        <Button type="button" variant="secondary" className="px-2.5 py-1 text-xs"
          onClick={() => setQty(Object.fromEntries(open.map((l) => [l.id, String(remainingQty(l))])))}>
          {t("purchasing.receiveAll")}
        </Button>
        <Button type="button" variant="ghost" className="px-2.5 py-1 text-xs"
          onClick={() => setQty(Object.fromEntries(open.map((l) => [l.id, "0"])))}>
          {t("purchasing.receiveClear")}
        </Button>
      </div>
      <ul className="divide-y divide-line rounded-xl border border-line">
        {open.map((l) => {
          const over = Number(qty[l.id]) > remainingQty(l);
          return (
            <li key={l.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <div className="truncate text-sm text-ink"><Bdi>{l.description}</Bdi></div>
                <div className="text-xs text-ink-3">
                  {t("purchasing.col.remaining")}: <Ltr>{remainingQty(l)}</Ltr>{l.unit ? <> <Bdi>{l.unit}</Bdi></> : null}
                </div>
              </div>
              <Input
                type="number" min={0} max={remainingQty(l)} step="0.001"
                className={`w-28 shrink-0 text-end tabular-nums ${over ? "border-serious" : ""}`}
                value={qty[l.id] ?? ""}
                onChange={(e) => setQty((q) => ({ ...q, [l.id]: e.target.value }))}
                aria-label={l.description}
                dir="ltr"
              />
            </li>
          );
        })}
      </ul>
      {inventory && (
        <Field label={t("purchasing.f.warehouse")} required={needsWarehouse} hint={t("purchasing.stockNote")}>
          <Select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} required={needsWarehouse}>
            <option value="">{t("purchasing.f.noWarehouse")}</option>
            {(warehousesQ.data ?? []).filter((w) => w.active).map((w) => (
              <option key={w.id} value={w.id}>{language === "ar" && w.name_ar ? w.name_ar : w.name}</option>
            ))}
          </Select>
        </Field>
      )}
      <Field label={t("purchasing.receiveNotes")}>
        <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
      </Field>
      {error && <ErrorState message={error} />}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>{t("action.cancel")}</Button>
        <Button loading={post.isPending} disabled={!anyQty || tooMuch || (needsWarehouse && !warehouseId)} onClick={() => post.mutate()}>
          {t("purchasing.receiveSave")}
        </Button>
      </div>
    </div>
  );
}
