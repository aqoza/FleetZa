import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { listRows, wrapDbError } from "../../lib/db";
import { formatQty } from "../../lib/inventory";
import { useTenant } from "../../context/AuthContext";
import { useT } from "../../i18n";
import { Button, ErrorState, Field, Input, Modal, Select, Textarea } from "../../components/ui";
import { Combobox } from "../../components/Combobox";
import { useToast } from "../../components/Toast";
import { useInventoryItemPicker, useWarehouses } from "./hooks";
import { opLabels } from "./labels";
import type { StockLevel, StockOp } from "./types";

/**
 * Receive / issue / transfer / count, each through its foundation RPC
 * (stock_receive, stock_issue, stock_transfer, stock_adjust) — the only way
 * stock changes. The server re-checks role, module, tenant and quantities;
 * this form only shapes the request.
 */
export function StockOpModal({
  op,
  itemId,
  onClose,
}: {
  op: StockOp | null;
  /** Fixed item (item page); omitted, the form asks for one. */
  itemId?: string;
  onClose: () => void;
}) {
  const t = useT();
  const tenant = useTenant();
  const qc = useQueryClient();
  const toast = useToast();
  const warehousesQ = useWarehouses();
  const warehouses = useMemo(() => (warehousesQ.data ?? []).filter((w) => w.active), [warehousesQ.data]);

  const [item, setItem] = useState(itemId ?? "");
  const [warehouse, setWarehouse] = useState("");
  const [toWarehouse, setToWarehouse] = useState("");
  const [qty, setQty] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const itemPicker = useInventoryItemPicker(item, { enabled: !itemId && op !== null });

  // Fresh form each time it opens; the default warehouse comes pre-selected.
  useEffect(() => {
    if (!op) return;
    setItem(itemId ?? "");
    setWarehouse(warehouses.find((w) => w.is_default)?.id ?? warehouses[0]?.id ?? "");
    setToWarehouse("");
    setQty("");
    setUnitCost("");
    setNotes("");
    setError("");
  }, [op, itemId, warehouses]);

  // What is on hand where the count happens, so the operator sees the delta.
  const levelQ = useQuery({
    queryKey: ["stock_levels", item, warehouse],
    queryFn: () =>
      listRows<StockLevel>("stock_levels", (q) => q.eq("item_id", item).eq("warehouse_id", warehouse).limit(1)),
    enabled: !!op && !!item && !!warehouse,
  });
  const currentOnHand = Number(levelQ.data?.[0]?.on_hand ?? 0);

  const mutation = useMutation({
    mutationFn: async () => {
      const notesValue = notes.trim() || null;
      const n = Number(qty);
      let res;
      if (op === "receive") {
        res = await supabase.rpc("stock_receive", {
          p_item: item, p_warehouse: warehouse, p_qty: n,
          ...(unitCost !== "" ? { p_unit_cost: Number(unitCost) } : {}),
          ...(notesValue ? { p_notes: notesValue } : {}),
        });
      } else if (op === "issue") {
        res = await supabase.rpc("stock_issue", {
          p_item: item, p_warehouse: warehouse, p_qty: n, ...(notesValue ? { p_notes: notesValue } : {}),
        });
      } else if (op === "transfer") {
        res = await supabase.rpc("stock_transfer", {
          p_item: item, p_from_warehouse: warehouse, p_to_warehouse: toWarehouse, p_qty: n,
          ...(notesValue ? { p_notes: notesValue } : {}),
        });
      } else {
        res = await supabase.rpc("stock_adjust", {
          p_item: item, p_warehouse: warehouse, p_new_on_hand: n, ...(notesValue ? { p_notes: notesValue } : {}),
        });
      }
      if (res.error) throw wrapDbError(res.error);
      return res.data as string | null;
    },
    onSuccess: (moveId) => {
      for (const key of ["stock_levels", "stock_moves", "inventory_items", "inventory_report"]) {
        void qc.invalidateQueries({ queryKey: [key] });
      }
      if (op === "adjust" && moveId == null) toast.success(t("inventory.opNoChange"));
      else if (op) toast.success(t(opLabels[op].done));
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("inventory.opFailed")),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    mutation.mutate();
  }

  const qtyLabel = op === "adjust" ? t("inventory.newOnHand") : t("inventory.quantity");

  return (
    <Modal title={op ? t(opLabels[op].title) : ""} open={op !== null} onClose={onClose}>
      {op && (
        <form onSubmit={onSubmit} className="space-y-4">
          {error && <ErrorState message={error} />}
          {warehouses.length === 0 && !warehousesQ.isLoading && (
            <ErrorState message={t("inventory.noWarehouseYet")} />
          )}
          {!itemId && (
            <Field label={t("inventory.pickItem")} required>
              <Combobox {...itemPicker} value={item} onChange={setItem} required clearable={false} />
            </Field>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={op === "transfer" ? t("inventory.fromWarehouse") : t("inventory.warehouse")} required>
              <Select value={warehouse} onChange={(e) => setWarehouse(e.target.value)} required>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </Select>
            </Field>
            {op === "transfer" && (
              <Field label={t("inventory.toWarehouse")} required>
                <Select value={toWarehouse} onChange={(e) => setToWarehouse(e.target.value)} required>
                  <option value="" disabled>{t("common.dash")}</option>
                  {warehouses
                    .filter((w) => w.id !== warehouse)
                    .map((w) => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                </Select>
              </Field>
            )}
            <Field
              label={qtyLabel}
              required
              hint={item && warehouse ? t("inventory.currentOnHand", { qty: formatQty(currentOnHand) }) : undefined}
            >
              <Input
                type="number" dir="ltr" required
                min={op === "adjust" ? 0 : 0.001} step="0.001"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
              />
            </Field>
            {op === "receive" && (
              <Field
                label={t("inventory.moneyUnit", { label: t("inventory.unitCost"), currency: tenant.currency })}
                hint={t("inventory.unitCostHint")}
              >
                <Input
                  type="number" dir="ltr" min={0} step="0.0001"
                  value={unitCost}
                  onChange={(e) => setUnitCost(e.target.value)}
                />
              </Field>
            )}
          </div>
          <Field label={t("inventory.notes")}>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>{t("action.cancel")}</Button>
            <Button
              type="submit"
              loading={mutation.isPending}
              disabled={!item || !warehouse || (op === "transfer" && !toWarehouse)}
            >
              {t(opLabels[op].button)}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
