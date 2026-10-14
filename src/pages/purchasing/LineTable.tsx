/**
 * Line items for purchase orders and vendor bills. Same posture as the sales
 * line editor: rows edit in place and save explicitly; amounts preview with
 * the rounding the database applies (computeLine). Lines can come from the
 * inventory catalog (prefilled with the item's cost) when that module is on.
 */
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Check, Plus, RotateCcw, Trash2 } from "lucide-react";
import { deleteRow, getRow, insertRow, updateRow, type TableName } from "../../lib/db";
import { bdiText, ltrText } from "../../lib/bidi";
import { formatMoney } from "../../lib/format";
import { computeLine } from "../../lib/sales";
import { useModules } from "../../context/ModulesContext";
import { useT } from "../../i18n";
import { Bdi, Button, ErrorState, Field, Input, Ltr } from "../../components/ui";
import { Combobox } from "../../components/Combobox";
import { useToast } from "../../components/Toast";
import { useInventoryItemPicker } from "../inventory/hooks";
import { useDefaultTaxRate } from "../sales/shared";
import type { InventoryItem } from "../inventory/types";

export interface LineRow {
  id: string;
  sort_order: number;
  item_id: string | null;
  description: string;
  quantity: number;
  unit: string | null;
  unit_price: number;
  discount_percent: number;
  tax_rate: number;
  line_total: number;
  received_qty?: number;
  item: { id: string; name: string; sku: string | null } | null;
}

interface Draft {
  description: string;
  quantity: string;
  unit: string;
  unit_price: string;
  discount_percent: string;
  tax_rate: string;
}

const draftOf = (l: LineRow): Draft => ({
  description: l.description,
  quantity: String(l.quantity),
  unit: l.unit ?? "",
  unit_price: String(l.unit_price),
  discount_percent: String(l.discount_percent),
  tax_rate: String(l.tax_rate),
});

const payload = (d: Draft) => ({
  description: d.description.trim(),
  quantity: Number(d.quantity) || 0,
  unit: d.unit.trim() || null,
  unit_price: Number(d.unit_price) || 0,
  discount_percent: Number(d.discount_percent) || 0,
  tax_rate: Number(d.tax_rate) || 0,
});

const num = (d: Draft) => ({
  quantity: Number(d.quantity) || 0,
  unit_price: Number(d.unit_price) || 0,
  discount_percent: Number(d.discount_percent) || 0,
  tax_rate: Number(d.tax_rate) || 0,
});

export function LineTable({
  table,
  parentColumn,
  parentId,
  lines,
  currency,
  decimals,
  editable,
  showReceived,
  queryKey,
}: {
  table: TableName;
  parentColumn: string;
  parentId: string;
  lines: LineRow[];
  currency: string;
  decimals: number;
  editable: boolean;
  showReceived?: boolean;
  queryKey: unknown[];
}) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const { isEnabled } = useModules();
  const inventory = isEnabled("inventory");
  const defaultTax = useDefaultTaxRate();
  const blank = (): Draft => ({
    description: "",
    quantity: "1",
    unit: "",
    unit_price: "",
    discount_percent: "0",
    tax_rate: String(defaultTax),
  });
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [adding, setAdding] = useState<Draft>(blank);
  const [itemId, setItemId] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState("");
  const itemPicker = useInventoryItemPicker(itemId, { enabled: editable && inventory });
  const money = (v: number) => formatMoney(v, currency);

  const sorted = useMemo(
    () => [...lines].sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id)),
    [lines],
  );
  const invalidate = () => void qc.invalidateQueries({ queryKey });
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  const save = useMutation({
    mutationFn: ({ id, d }: { id: string; d: Draft }) => updateRow(table, id, payload(d)),
    onSuccess: (_r, v) => {
      setError("");
      setDrafts((all) => {
        const next = { ...all };
        delete next[v.id];
        return next;
      });
      invalidate();
    },
    onError: fail,
  });
  const add = useMutation({
    mutationFn: () =>
      insertRow(table, { [parentColumn]: parentId, item_id: itemId || null, sort_order: sorted.length, ...payload(adding) }),
    onSuccess: () => {
      setError("");
      setAdding(blank());
      setItemId("");
      invalidate();
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteRow(table, id),
    onSuccess: () => {
      setError("");
      setDeleting(null);
      invalidate();
    },
    onError: (e) => {
      setDeleting(null);
      fail(e);
    },
  });
  const reorder = useMutation({
    mutationFn: async ({ a, b }: { a: LineRow; b: LineRow }) => {
      await updateRow(table, a.id, { sort_order: b.sort_order });
      await updateRow(table, b.id, { sort_order: a.sort_order });
    },
    onSuccess: invalidate,
    onError: fail,
  });

  async function pickItem(id: string) {
    setItemId(id);
    if (!id) return;
    try {
      const item = await getRow<InventoryItem>("inventory_items", id);
      if (!item) return;
      setAdding((a) => ({
        ...a,
        description: item.name,
        unit: item.uom && item.uom !== "unit" ? item.uom : a.unit,
        unit_price: Number(item.cost_price) > 0 ? String(Number(item.cost_price)) : a.unit_price,
      }));
    } catch (e) {
      toast.error(e instanceof Error ? e : String(e));
    }
  }

  const onAdd = (e: FormEvent) => {
    e.preventDefault();
    if (!adding.description.trim() || !(Number(adding.quantity) > 0)) return;
    add.mutate();
  };

  const headers = [
    t("sales.lines.description"),
    t("sales.lines.qty"),
    ...(showReceived ? [t("purchasing.col.received")] : []),
    t("purchasing.f.unitCost"),
    t("sales.lines.discountPercent"),
    t("sales.lines.taxPercent"),
    t("sales.lines.lineTotal"),
  ];

  return (
    <div>
      {error && (
        <div className="mb-3">
          <ErrorState message={error} />
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="min-w-full divide-y divide-line text-sm">
          <thead className="bg-canvas/60">
            <tr>
              {headers.map((h, i) => (
                <th
                  key={h}
                  className={`px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-3 rtl:tracking-normal ${
                    i === 0 ? "text-start" : "text-end"
                  }`}
                >
                  {h}
                </th>
              ))}
              {editable && <th className="w-24 px-3 py-2.5" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {sorted.map((line, index) => {
              const draft = drafts[line.id];
              const current = draft ?? draftOf(line);
              const set = (k: keyof Draft, v: string) => setDrafts((d) => ({ ...d, [line.id]: { ...current, [k]: v } }));
              if (!editable) {
                const done = showReceived && Number(line.received_qty ?? 0) >= Number(line.quantity);
                return (
                  <tr key={line.id}>
                    <td className="px-3 py-2.5 text-ink">
                      <Bdi>{line.description}</Bdi>
                      {line.item?.sku && <div className="text-xs text-ink-3"><Ltr>{line.item.sku}</Ltr></div>}
                    </td>
                    <td className="px-3 py-2.5 text-end text-ink-2 tabular-nums">
                      <Bdi>{Number(line.quantity)}{line.unit ? ` ${line.unit}` : ""}</Bdi>
                    </td>
                    {showReceived && (
                      <td className={`px-3 py-2.5 text-end tabular-nums ${done ? "text-good" : "text-ink-2"}`}>
                        <Ltr>{Number(line.received_qty ?? 0)}</Ltr>
                      </td>
                    )}
                    <td className="px-3 py-2.5 text-end text-ink-2 tabular-nums"><Ltr>{money(Number(line.unit_price))}</Ltr></td>
                    <td className="px-3 py-2.5 text-end text-ink-2 tabular-nums">
                      {Number(line.discount_percent) > 0 ? <Ltr>{`${Number(line.discount_percent)}%`}</Ltr> : t("common.dash")}
                    </td>
                    <td className="px-3 py-2.5 text-end text-ink-2 tabular-nums">
                      {Number(line.tax_rate) > 0 ? <Ltr>{`${Number(line.tax_rate)}%`}</Ltr> : t("common.dash")}
                    </td>
                    <td className="px-3 py-2.5 text-end font-medium text-ink tabular-nums"><Ltr>{money(Number(line.line_total))}</Ltr></td>
                  </tr>
                );
              }
              const preview = computeLine(num(current), decimals);
              return (
                <tr key={line.id} className={draft ? "bg-brand-50/40" : undefined}>
                  <td className="px-3 py-2">
                    <Input className="min-w-32" value={current.description} onChange={(e) => set("description", e.target.value)} aria-label={t("sales.lines.description")} />
                  </td>
                  <td className="px-3 py-2">
                    <Input type="number" min={0} step="0.001" className="min-w-20 text-end tabular-nums" value={current.quantity}
                      onChange={(e) => set("quantity", e.target.value)} aria-label={t("sales.lines.qty")} />
                  </td>
                  <td className="px-3 py-2">
                    <Input type="number" min={0} step="0.0001" className="min-w-24 text-end tabular-nums" value={current.unit_price}
                      onChange={(e) => set("unit_price", e.target.value)} aria-label={t("purchasing.f.unitCost")} />
                  </td>
                  <td className="px-3 py-2">
                    <Input type="number" min={0} max={100} step="0.01" className="min-w-16 text-end tabular-nums" value={current.discount_percent}
                      onChange={(e) => set("discount_percent", e.target.value)} aria-label={t("sales.lines.discountPercent")} />
                  </td>
                  <td className="px-3 py-2">
                    <Input type="number" min={0} max={100} step="0.01" className="min-w-16 text-end tabular-nums" value={current.tax_rate}
                      onChange={(e) => set("tax_rate", e.target.value)} aria-label={t("sales.lines.taxPercent")} />
                  </td>
                  <td className="px-3 py-2 text-end font-medium text-ink tabular-nums"><Ltr>{money(preview.total)}</Ltr></td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-0.5">
                      {draft ? (
                        <>
                          <IconButton label={t("action.saveChanges")} tone="brand" disabled={save.isPending}
                            onClick={() => save.mutate({ id: line.id, d: current })}>
                            <Check className="h-4 w-4" />
                          </IconButton>
                          <IconButton label={t("action.cancel")}
                            onClick={() => setDrafts((d) => { const n = { ...d }; delete n[line.id]; return n; })}>
                            <RotateCcw className="h-4 w-4 rtl:-scale-x-100" />
                          </IconButton>
                        </>
                      ) : (
                        <>
                          <IconButton label={t("sales.lines.moveUp")} disabled={index === 0 || reorder.isPending}
                            onClick={() => reorder.mutate({ a: line, b: sorted[index - 1] })}>
                            <ArrowUp className="h-4 w-4" />
                          </IconButton>
                          <IconButton label={t("sales.lines.moveDown")} disabled={index === sorted.length - 1 || reorder.isPending}
                            onClick={() => reorder.mutate({ a: line, b: sorted[index + 1] })}>
                            <ArrowDown className="h-4 w-4" />
                          </IconButton>
                          <IconButton label={t("sales.lines.delete")} tone="danger" disabled={remove.isPending}
                            onClick={() => setDeleting(line.id)}>
                            <Trash2 className="h-4 w-4" />
                          </IconButton>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={headers.length + (editable ? 1 : 0)} className="px-3 py-8 text-center text-sm text-ink-3">
                  {editable ? t("sales.lines.empty") : t("sales.lines.emptyReadOnly")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {deleting && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-serious/30 bg-serious-soft px-4 py-3">
          <span className="text-sm text-ink">
            {t("sales.lines.deleteConfirm", { description: bdiText(sorted.find((l) => l.id === deleting)?.description) })}
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setDeleting(null)}>{t("action.cancel")}</Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate(deleting)}>{t("action.delete")}</Button>
          </div>
        </div>
      )}

      {editable && (
        <form onSubmit={onAdd} className="mt-4 rounded-xl border border-dashed border-line p-4">
          <div className="grid gap-3 sm:grid-cols-6">
            {inventory && (
              <div className="sm:col-span-3">
                <Field label={t("purchasing.f.item")}>
                  <Combobox {...itemPicker} value={itemId} onChange={pickItem} placeholder={t("purchasing.f.customLine")} />
                </Field>
              </div>
            )}
            <div className={inventory ? "sm:col-span-3" : "sm:col-span-6"}>
              <Field label={t("sales.lines.description")} required>
                <Input value={adding.description} onChange={(e) => setAdding((a) => ({ ...a, description: e.target.value }))} required maxLength={500} />
              </Field>
            </div>
            <div className="sm:col-span-1">
              <Field label={t("sales.lines.qty")}>
                <Input type="number" min={0.001} step="0.001" required className="text-end tabular-nums" value={adding.quantity}
                  onChange={(e) => setAdding((a) => ({ ...a, quantity: e.target.value }))} />
              </Field>
            </div>
            <div className="sm:col-span-1">
              <Field label={t("sales.lines.unit")}>
                <Input value={adding.unit} onChange={(e) => setAdding((a) => ({ ...a, unit: e.target.value }))} maxLength={30} />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label={t("purchasing.f.unitCost")}>
                <Input type="number" min={0} step="0.0001" required className="text-end tabular-nums" value={adding.unit_price}
                  onChange={(e) => setAdding((a) => ({ ...a, unit_price: e.target.value }))} />
              </Field>
            </div>
            <div className="sm:col-span-1">
              <Field label={t("sales.lines.discountPercent")}>
                <Input type="number" min={0} max={100} step="0.01" className="text-end tabular-nums" value={adding.discount_percent}
                  onChange={(e) => setAdding((a) => ({ ...a, discount_percent: e.target.value }))} />
              </Field>
            </div>
            <div className="sm:col-span-1">
              <Field label={t("sales.lines.taxPercent")}>
                <Input type="number" min={0} max={100} step="0.01" className="text-end tabular-nums" value={adding.tax_rate}
                  onChange={(e) => setAdding((a) => ({ ...a, tax_rate: e.target.value }))} />
              </Field>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-ink-2 tabular-nums">
              {t("sales.lines.previewTotal", { amount: ltrText(money(computeLine(num(adding), decimals).total)) })}
            </span>
            <Button type="submit" loading={add.isPending}>
              <Plus className="h-4 w-4" /> {t("sales.lines.add")}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  tone = "muted",
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "muted" | "brand" | "danger";
  children: ReactNode;
}) {
  const tones = {
    muted: "text-ink-3 hover:bg-canvas hover:text-ink-2",
    brand: "text-brand-600 hover:bg-brand-50",
    danger: "text-ink-3 hover:bg-serious-soft hover:text-serious",
  };
  return (
    <button
      type="button"
      className={`rounded-md p-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${tones[tone]}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}
