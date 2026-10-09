import { useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Printer, ReceiptText, Undo2 } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { listPage, listRows, sanitizeSearch, wrapDbError } from "../../lib/db";
import { formatDateTime, formatMoney } from "../../lib/format";
import { ORDER_STATUSES, type OrderStatus } from "../../../shared/pos";
import { useAuth } from "../../context/AuthContext";
import { useT } from "../../i18n";
import { Badge, Bdi, Button, EmptyState, ErrorState, Field, Input, LoadingState, Ltr, Modal, Pagination, Select, Textarea } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { FormActions, FormError, onSubmit, textOrNull, useSubmit } from "./forms";
import { ORDER_SELECT, POS_KEYS, n, orderTone, type PosOrder, type PosOrderLine } from "./types";

const PAGE_SIZE = 25;

export default function OrdersPage() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState<"all" | OrderStatus>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const term = sanitizeSearch(search);
  const openId = params.get("order");

  const listQ = useQuery({
    queryKey: ["pos_orders", "list", { page, status, term }],
    queryFn: () =>
      listPage<PosOrder>("pos_orders", page, PAGE_SIZE, (q) => {
        let f = q.select(ORDER_SELECT);
        if (status !== "all") f = f.eq("status", status);
        if (term) f = f.ilike("doc_number", `%${term}%`);
        return f.order("completed_at", { ascending: false });
      }),
  });

  const open = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("order", id);
    else next.delete("order");
    setParams(next, { replace: true });
  };

  const columns: Array<DataTableColumn<PosOrder>> = [
    {
      id: "number",
      header: t("pos.orders.number"),
      cell: (o) => <Ltr className="whitespace-nowrap font-medium text-brand-700">{o.doc_number}</Ltr>,
      exportValue: (o) => o.doc_number ?? "",
    },
    {
      id: "time",
      header: t("pos.orders.time"),
      minBreakpoint: "sm",
      cell: (o) => <span className="whitespace-nowrap text-ink-2">{formatDateTime(o.completed_at)}</span>,
      sortValue: (o) => o.completed_at,
      exportValue: (o) => o.completed_at,
    },
    {
      id: "register",
      header: t("pos.orders.register"),
      minBreakpoint: "md",
      cell: (o) => <Bdi>{o.register?.name ?? "—"}</Bdi>,
      exportValue: (o) => o.register?.name ?? "",
    },
    {
      id: "customer",
      header: t("pos.orders.customer"),
      minBreakpoint: "md",
      cell: (o) => <span className="text-ink-2"><Bdi>{o.customer?.name ?? t("pos.cart.walkIn")}</Bdi></span>,
      exportValue: (o) => o.customer?.name ?? "",
    },
    {
      id: "total",
      header: t("pos.orders.total"),
      align: "end",
      cell: (o) => <Ltr className="whitespace-nowrap text-ink">{formatMoney(n(o.total), o.currency)}</Ltr>,
      sortValue: (o) => n(o.total),
      exportValue: (o) => o.total,
    },
    {
      id: "status",
      header: t("pos.orders.status"),
      cell: (o) => (
        <span className="whitespace-nowrap">
          <Badge tone={o.refund_of ? "purple" : orderTone[o.status]}>{o.refund_of ? t("pos.orders.refund") : t(`pos.status.${o.status}`)}</Badge>
        </span>
      ),
      exportValue: (o) => (o.refund_of ? "refund" : o.status),
    },
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} placeholder={t("pos.orders.search")}
          className="w-full sm:max-w-64" />
        <Select value={status} onChange={(e) => { setStatus(e.target.value as "all" | OrderStatus); setPage(0); }} className="w-full sm:w-48"
          aria-label={t("pos.orders.status")}>
          <option value="all">{t("pos.orders.allStatuses")}</option>
          {ORDER_STATUSES.map((s) => <option key={s} value={s}>{t(`pos.status.${s}`)}</option>)}
        </Select>
      </div>
      {listQ.isLoading && <LoadingState />}
      {listQ.error && <ErrorState message={(listQ.error as Error).message} />}
      {listQ.data && (
        <DataTable<PosOrder>
          tableId="pos_orders"
          exportName="pos-orders"
          rows={listQ.data.rows}
          rowKey={(o) => o.id}
          columns={columns}
          onRowClick={(o) => open(o.id)}
          empty={<EmptyState icon={<ReceiptText className="h-10 w-10" />} title={t("pos.orders.empty")} description={t("pos.orders.emptyHint")} />}
          footer={<Pagination page={page} pageSize={PAGE_SIZE} total={listQ.data.total} onPage={setPage} />}
        />
      )}
      <OrderModal id={openId} onClose={() => open(null)} onOpen={open} />
    </div>
  );
}

export function OrderModal({ id, onClose, onOpen }: { id: string | null; onClose: () => void; onOpen?: (id: string) => void }) {
  const t = useT();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [refunding, setRefunding] = useState(false);
  const [reason, setReason] = useState("");
  const q = useQuery({
    queryKey: ["pos_orders", "one", id],
    enabled: !!id,
    queryFn: async () => (await listRows<PosOrder>("pos_orders", (b) => b.select(ORDER_SELECT).eq("id", id ?? "").limit(1)))[0] ?? null,
  });
  const linesQ = useQuery({
    queryKey: ["pos_orders", "lines", id],
    enabled: !!id,
    queryFn: () => listRows<PosOrderLine>("pos_order_lines", (b) =>
      b.select("id, sort_order, product_id, description, quantity, unit_price, discount_percent, tax_rate, line_discount, line_total")
        .eq("order_id", id ?? "").order("sort_order").limit(200)),
  });
  const refundOfQ = useQuery({
    queryKey: ["pos_orders", "refundOf", id],
    enabled: !!id,
    queryFn: async () => (await listRows<{ id: string; doc_number: string | null }>("pos_orders", (b) =>
      b.select("id, doc_number").eq("refund_of", id ?? "").limit(1)))[0] ?? null,
  });
  const o = q.data;
  const close = () => { setRefunding(false); setReason(""); onClose(); };
  const { error, saving, run } = useSubmit<string>((newId) => {
    for (const k of [...POS_KEYS, "products"]) void qc.invalidateQueries({ queryKey: [k] });
    setRefunding(false);
    setReason("");
    toast.success(t("pos.orders.refunded"));
    onOpen?.(newId);
  });
  const submit = onSubmit(() => run(async () => {
    const { data, error: e } = await supabase.rpc("pos_refund", { p_order_id: id ?? "", p_reason: textOrNull(reason) ?? undefined });
    if (e) throw wrapDbError(e);
    return data as string;
  }));
  const money = (v: unknown) => <Ltr>{formatMoney(n(v), o?.currency ?? "USD")}</Ltr>;
  const canRefund = isManager && o && o.status === "completed" && !o.refund_of;

  return (
    <Modal title={o?.doc_number ?? t("pos.orders.title")} open={!!id} onClose={close} wide busy={saving}>
      {q.isLoading && <LoadingState />}
      {q.error && <ErrorState message={(q.error as Error).message} />}
      {id && !q.isLoading && !o && <ErrorState message={t("pos.orders.notFound")} />}
      {o && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
            <Badge tone={o.refund_of ? "purple" : orderTone[o.status]}>{o.refund_of ? t("pos.orders.refund") : t(`pos.status.${o.status}`)}</Badge>
            <span>{formatDateTime(o.completed_at)}</span>
            <span>·</span>
            <Bdi>{o.register?.name ?? ""}</Bdi>
            {o.session?.doc_number && <><span>·</span><Ltr>{o.session.doc_number}</Ltr></>}
          </div>
          {o.customer && <p className="text-sm text-ink">{t("pos.orders.customer")}: <Bdi>{o.customer.name}</Bdi></p>}
          {o.refund_of && (
            <p className="text-sm text-ink-2">
              {t("pos.orders.refundOf")}{" "}
              <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => onOpen?.(o.refund_of ?? "")}>
                {t("pos.orders.viewOriginal")}
              </button>
            </p>
          )}
          {refundOfQ.data && (
            <p className="text-sm text-ink-2">
              {t("pos.orders.refundedBy")}{" "}
              <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => onOpen?.(refundOfQ.data?.id ?? "")}>
                <Ltr>{refundOfQ.data.doc_number}</Ltr>
              </button>
            </p>
          )}
          {linesQ.isLoading && <LoadingState />}
          {linesQ.data && (
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full text-sm">
                <thead className="bg-canvas text-xs text-ink-3">
                  <tr>
                    <th className="px-3 py-2 text-start font-medium">{t("pos.orders.item")}</th>
                    <th className="px-3 py-2 text-end font-medium">{t("pos.cart.qty")}</th>
                    <th className="px-3 py-2 text-end font-medium">{t("pos.orders.price")}</th>
                    <th className="px-3 py-2 text-end font-medium">{t("pos.orders.lineTotal")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {linesQ.data.map((l) => (
                    <tr key={l.id}>
                      <td className="px-3 py-2 text-ink">
                        <Bdi>{l.description}</Bdi>
                        {n(l.discount_percent) > 0 && <span className="ms-1 text-xs text-ink-3">(−<Ltr>{`${n(l.discount_percent)}%`}</Ltr>)</span>}
                      </td>
                      <td className="px-3 py-2 text-end tabular-nums"><Ltr>{String(n(l.quantity))}</Ltr></td>
                      <td className="px-3 py-2 text-end">{money(l.unit_price)}</td>
                      <td className="px-3 py-2 text-end">{money(l.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <dl className="ms-auto max-w-xs space-y-1 text-sm">
            <Sum label={t("pos.cart.subtotal")}>{money(o.subtotal)}</Sum>
            {n(o.discount_total) !== 0 && <Sum label={t("pos.cart.discount")}>{money(-n(o.discount_total))}</Sum>}
            <Sum label={t("pos.cart.tax")}>{money(o.tax_total)}</Sum>
            <Sum label={t("pos.cart.total")} strong>{money(o.total)}</Sum>
            {n(o.paid_cash) !== 0 && <Sum label={t("pos.pay.cash")}>{money(o.paid_cash)}</Sum>}
            {n(o.paid_card) !== 0 && <Sum label={t("pos.pay.card")}>{money(o.paid_card)}</Sum>}
            {n(o.paid_other) !== 0 && <Sum label={t("pos.pay.other")}>{money(o.paid_other)}</Sum>}
            {n(o.change_due) !== 0 && <Sum label={t("pos.done.change")}>{money(o.change_due)}</Sum>}
          </dl>
          {o.notes && <p className="text-sm text-ink-2"><Bdi>{o.notes}</Bdi></p>}
          {refunding ? (
            <form onSubmit={submit} className="space-y-3 rounded-xl border border-line p-3">
              <p className="text-sm text-ink-2">{t("pos.orders.refundHint")}</p>
              <Field label={t("pos.orders.reason")}>
                <Textarea rows={2} maxLength={400} value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
              <FormError message={error} />
              <FormActions saving={saving} label={t("pos.orders.confirmRefund")} onCancel={() => setRefunding(false)} />
            </form>
          ) : (
            <div className="flex flex-wrap justify-end gap-2">
              {canRefund && (
                <Button variant="secondary" onClick={() => setRefunding(true)}><Undo2 className="h-4 w-4 rtl:-scale-x-100" /> {t("pos.orders.refundAction")}</Button>
              )}
              <Link to={`/pos/orders/${o.id}/receipt`}>
                <Button><Printer className="h-4 w-4" /> {t("pos.done.receipt")}</Button>
              </Link>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function Sum({ label, children, strong }: { label: string; children: ReactNode; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? "border-t border-line pt-1 font-semibold text-ink" : "text-ink-2"}`}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
