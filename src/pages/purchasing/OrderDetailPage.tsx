import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, PackageCheck, Pencil, Printer, ShoppingCart, Trash2 } from "lucide-react";
import { getCountry } from "../../../shared/countries";
import { deleteRow, listRows, updateRow, wrapDbError } from "../../lib/db";
import { supabase } from "../../lib/supabase";
import { ltrText } from "../../lib/bidi";
import { formatDate, formatDateTime, formatMoney } from "../../lib/format";
import {
  poBillable, poDeletable, poEditable, poMoves, poReceivable, receivedShare, type PoMove,
} from "../../lib/purchasing";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useI18n, useT } from "../../i18n";
import { Badge, Bdi, Button, Card, EmptyState, ErrorState, LoadingState, Ltr, Modal, PageHeader } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { BackLink, TotalsPanel, taxHeading } from "../sales/shared";
import { billStatus, poMove, poStatus, supplierName } from "./labels";
import { LineTable } from "./LineTable";
import { OrderForm } from "./OrderForm";
import { ReceiveForm } from "./ReceiveForm";
import {
  BILL_SELECT, LINE_SELECT, PO_SELECT, RECEIPT_SELECT, type PurchaseLine, type PurchaseOrder, type PurchaseReceipt,
  type VendorBill,
} from "./types";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
      <dt className="text-ink-3">{label}</dt>
      <dd className="text-end text-ink">{children}</dd>
    </div>
  );
}

export default function OrderDetailPage() {
  const { orderId = "" } = useParams();
  const t = useT();
  const { language } = useI18n();
  const tenant = useTenant();
  const { isManager } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [confirm, setConfirm] = useState<PoMove | "delete" | null>(null);
  const [actionError, setActionError] = useState("");

  const orderQ = useQuery({
    queryKey: ["purchase_orders", "one", orderId],
    queryFn: async () => (await listRows<PurchaseOrder>("purchase_orders", (q) => q.select(PO_SELECT).eq("id", orderId).limit(1)))[0] ?? null,
  });
  const linesKey = ["purchase_order_lines", orderId];
  const linesQ = useQuery({
    queryKey: linesKey,
    queryFn: () =>
      listRows<PurchaseLine>("purchase_order_lines", (q) =>
        q.select(LINE_SELECT).eq("purchase_order_id", orderId).order("sort_order").order("created_at").limit(500),
      ),
  });
  const receiptsQ = useQuery({
    queryKey: ["purchase_receipts", "po", orderId],
    queryFn: () =>
      listRows<PurchaseReceipt>("purchase_receipts", (q) =>
        q.select(RECEIPT_SELECT).eq("purchase_order_id", orderId).order("received_at", { ascending: false }).limit(100),
      ),
  });
  const billsQ = useQuery({
    queryKey: ["vendor_bills", "po", orderId],
    queryFn: () =>
      listRows<VendorBill>("vendor_bills", (q) =>
        q.select(BILL_SELECT).eq("purchase_order_id", orderId).order("bill_date", { ascending: false }).limit(100),
      ),
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["purchase_orders"] });
    void qc.invalidateQueries({ queryKey: ["vendor_bills"] });
  };
  const fail = (e: unknown) => {
    setConfirm(null);
    setActionError(e instanceof Error ? e.message : String(e));
  };

  const move = useMutation({
    mutationFn: (to: PoMove) => updateRow("purchase_orders", orderId, { status: to }),
    onSuccess: (_d, to) => {
      setActionError("");
      setConfirm(null);
      refresh();
      void qc.invalidateQueries({ queryKey: linesKey });
      toast.success(t(poMove[to].doneKey));
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: () => deleteRow("purchase_orders", orderId),
    onSuccess: () => {
      refresh();
      toast.success(t("toast.deleted"));
      navigate("/purchasing");
    },
    onError: fail,
  });
  const bill = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("vendor_bill_from_po", { p_po: orderId });
      if (error) throw wrapDbError(error);
      return data as unknown as VendorBill;
    },
    onSuccess: (b) => {
      refresh();
      toast.success(t("purchasing.billCreated", { number: ltrText(b?.doc_number ?? "") }));
      if (b?.id) navigate(`/purchasing/bills/${b.id}`);
    },
    onError: fail,
  });

  const back = <BackLink to="/purchasing" label={t("purchasing.tab.orders")} />;
  if (orderQ.isLoading) return <LoadingState />;
  if (orderQ.error) return <ErrorState message={(orderQ.error as Error).message} />;
  const order = orderQ.data;
  if (!order) {
    return (
      <>
        {back}
        <EmptyState icon={<ShoppingCart className="h-10 w-10" />} title={t("purchasing.orderNotFound")} />
      </>
    );
  }

  const lines = linesQ.data ?? [];
  const st = poStatus[order.status];
  const moves = isManager ? poMoves(order.status) : [];
  const draft = poEditable(order.status);
  const share = receivedShare(lines);
  const country = getCountry(tenant.country);
  const taxLabel = taxHeading(t, country.tax.label, lines.map((l) => Number(l.tax_rate)));
  const money = (v: number) => formatMoney(v, order.currency);
  const confirmText = (c: PoMove | "delete") =>
    c === "delete"
      ? t("purchasing.po.confirm.delete", { number: ltrText(order.doc_number ?? "") })
      : c === "closed"
        ? t("purchasing.po.confirm.closed")
        : t("purchasing.po.confirm.canceled");

  return (
    <>
      {back}
      <PageHeader
        title={order.doc_number ?? t("purchasing.order")}
        description={supplierName(order.supplier, language)}
        badge={<Badge tone={st.tone}>{t(st.labelKey)}</Badge>}
        actions={
          <div className="flex flex-wrap gap-2">
            {isManager && poReceivable(order.status) && (
              <Button onClick={() => setReceiving(true)}>
                <PackageCheck className="h-4 w-4" /> {t("purchasing.receive")}
              </Button>
            )}
            {moves.filter((m) => m === "sent" || m === "confirmed").map((m) => (
              <Button key={m} variant={m === "confirmed" && order.status === "sent" ? "primary" : "secondary"}
                loading={move.isPending && move.variables === m} onClick={() => move.mutate(m)}>
                {t(poMove[m].labelKey)}
              </Button>
            ))}
            {isManager && poBillable(order.status) && (
              <Button variant="secondary" loading={bill.isPending} onClick={() => bill.mutate()}>
                <FileText className="h-4 w-4" /> {t("purchasing.createBill")}
              </Button>
            )}
            {isManager && draft && (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                <Pencil className="h-4 w-4" /> {t("purchasing.edit")}
              </Button>
            )}
            <Link to={`/purchasing/orders/${order.id}/print`}
              className="inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium text-ink-2 hover:bg-canvas">
              <Printer className="h-4 w-4" /> {t("purchasing.print")}
            </Link>
            {moves.includes("draft") && (
              <Button variant="ghost" onClick={() => move.mutate("draft")}>{t(poMove.draft.labelKey)}</Button>
            )}
            {moves.includes("closed") && (
              <Button variant="ghost" onClick={() => setConfirm("closed")}>{t(poMove.closed.labelKey)}</Button>
            )}
            {moves.includes("canceled") && (
              <Button variant="ghost" onClick={() => setConfirm("canceled")}>{t(poMove.canceled.labelKey)}</Button>
            )}
            {isManager && poDeletable(order.status) && (
              <Button variant="ghost" onClick={() => setConfirm("delete")} aria-label={t("action.delete")} title={t("action.delete")}>
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        }
      />
      {actionError && (
        <div className="mb-4">
          <ErrorState message={actionError} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 lg:col-span-2">
          <Card className="p-4 sm:p-5">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-base font-semibold text-ink">{t("purchasing.lines")}</h2>
              {!draft && share > 0 && (
                <span className="text-sm text-ink-3 tabular-nums">{t("purchasing.receivedProgress", { percent: Math.round(share * 100) })}</span>
              )}
            </div>
            {linesQ.isLoading ? (
              <LoadingState />
            ) : (
              <LineTable
                table="purchase_order_lines"
                parentColumn="purchase_order_id"
                parentId={order.id}
                lines={lines}
                currency={order.currency}
                decimals={order.currency_decimals}
                editable={draft && isManager}
                showReceived={!draft}
                queryKey={linesKey}
              />
            )}
            {!draft && order.status !== "canceled" && (
              <p className="mt-3 text-xs text-ink-3">{t("purchasing.linesLocked")}</p>
            )}
            <div className="mt-4 flex justify-end">
              <div className="w-full max-w-xs">
                <TotalsPanel doc={{ ...order, subtotal: Number(order.subtotal), discount_total: Number(order.discount_total),
                  tax_total: Number(order.tax_total), total: Number(order.total) }} taxLabel={taxLabel} />
              </div>
            </div>
          </Card>

          <Card className="p-4 sm:p-5">
            <h2 className="mb-3 text-base font-semibold text-ink">{t("purchasing.receiptsOnOrder")}</h2>
            {(receiptsQ.data ?? []).length === 0 ? (
              <p className="text-sm text-ink-3">{t("purchasing.noReceipts")}</p>
            ) : (
              <ul className="divide-y divide-line">
                {(receiptsQ.data ?? []).map((r) => (
                  <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
                    <span className="font-medium text-ink"><Ltr>{r.doc_number ?? ""}</Ltr></span>
                    <span className="text-ink-3">
                      {r.warehouse && <><Bdi>{r.warehouse.name}</Bdi> · </>}
                      <span className="tabular-nums"><Ltr>{formatDateTime(r.received_at, tenant.timezone)}</Ltr></span>
                    </span>
                    {r.notes && <p className="w-full text-xs text-ink-2" dir="auto">{r.notes}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="p-4 sm:p-5">
            <h2 className="mb-2 text-base font-semibold text-ink">{t("purchasing.details")}</h2>
            <dl className="divide-y divide-line">
              <Row label={t("purchasing.f.supplier")}>
                {order.supplier ? (
                  <Link to={`/suppliers/${order.supplier.id}`} className="text-brand-700 hover:underline">
                    <Bdi>{supplierName(order.supplier, language)}</Bdi>
                  </Link>
                ) : t("common.dash")}
              </Row>
              <Row label={t("purchasing.f.orderDate")}><Ltr>{formatDate(order.order_date)}</Ltr></Row>
              <Row label={t("purchasing.f.expectedDate")}>
                {order.expected_date ? <Ltr>{formatDate(order.expected_date)}</Ltr> : t("common.dash")}
              </Row>
              {order.warehouse && <Row label={t("purchasing.col.warehouse")}><Bdi>{order.warehouse.name}</Bdi></Row>}
              {order.supplier_reference && <Row label={t("purchasing.f.reference")}><Ltr>{order.supplier_reference}</Ltr></Row>}
            </dl>
            {order.vendor_ack_at && (
              <p className="mt-3 rounded-lg bg-canvas px-3 py-2 text-xs text-ink-2">
                {t("purchasing.vendorAck", { date: ltrText(formatDateTime(order.vendor_ack_at, tenant.timezone)) })}
                {order.vendor_expected_date && (
                  <> · {t("purchasing.vendorExpected", { date: ltrText(formatDate(order.vendor_expected_date)) })}</>
                )}
                {order.vendor_ack_note && <span className="mt-1 block" dir="auto">{order.vendor_ack_note}</span>}
              </p>
            )}
            {order.notes && <p className="mt-3 whitespace-pre-line text-sm text-ink-2" dir="auto">{order.notes}</p>}
          </Card>

          <Card className="p-4 sm:p-5">
            <h2 className="mb-3 text-base font-semibold text-ink">{t("purchasing.billsOnOrder")}</h2>
            {(billsQ.data ?? []).length === 0 ? (
              <p className="text-sm text-ink-3">{t("purchasing.noBills")}</p>
            ) : (
              <ul className="divide-y divide-line">
                {(billsQ.data ?? []).map((b) => (
                  <li key={b.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <Link to={`/purchasing/bills/${b.id}`} className="font-medium text-brand-700 hover:underline">
                      <Ltr>{b.doc_number ?? ""}</Ltr>
                    </Link>
                    <span className="flex items-center gap-2">
                      <span className="tabular-nums text-ink-2"><Ltr>{money(Number(b.total))}</Ltr></span>
                      <Badge tone={billStatus[b.status].tone}>{t(billStatus[b.status].labelKey)}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <Modal title={t("purchasing.edit")} open={editing} onClose={() => setEditing(false)} wide>
        {editing && <OrderForm order={order} onDone={() => setEditing(false)} />}
      </Modal>
      <Modal title={t("purchasing.receiveTitle")} open={receiving} onClose={() => setReceiving(false)}>
        {receiving && <ReceiveForm order={order} lines={lines} onDone={() => setReceiving(false)} />}
      </Modal>
      <Modal title={t("action.confirm")} open={!!confirm} onClose={() => setConfirm(null)}>
        {confirm && (
          <div className="space-y-4">
            <p className="text-sm text-ink-2">{confirmText(confirm)}</p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirm(null)}>{t("action.cancel")}</Button>
              <Button variant="danger" loading={move.isPending || remove.isPending}
                onClick={() => (confirm === "delete" ? remove.mutate() : move.mutate(confirm))}>
                {t("action.confirm")}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
