/**
 * Public, no-auth page at /vendor/:token — a supplier's view of the purchase
 * orders sent to them and their bills, with a way to confirm a sent order.
 * Same posture as /q/:token: the API (worker/vendorPortal.ts → the
 * vendor_portal_* RPCs) decides what is visible; this page renders it.
 */
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle2, ChevronDown, Loader2, SearchX } from "lucide-react";
import { bdiText, ltrText } from "../../lib/bidi";
import { formatDate, formatMoney } from "../../lib/format";
import type { BillStatus, PoStatus } from "../../lib/purchasing";
import { LANGUAGES, useI18n, useTp } from "../../i18n";
import { Badge, Bdi, Button, Card, ErrorState, Field, Input, Ltr, Textarea } from "../../components/ui";
import { billStatus, poStatus } from "../purchasing/labels";
import { outstandingByCurrency } from "./links";

interface PortalLine {
  id: string;
  description: string;
  quantity: number;
  unit: string | null;
  unit_price: number;
  discount_percent: number;
  tax_rate: number;
  line_total: number;
  received_qty: number;
}

interface PortalOrder {
  id: string;
  doc_number: string;
  status: PoStatus;
  order_date: string;
  expected_date: string | null;
  currency: string;
  subtotal: number;
  discount_total: number;
  tax_total: number;
  total: number;
  terms: string | null;
  supplier_reference: string | null;
  deliver_to: string | null;
  vendor_ack_at: string | null;
  vendor_ack_note: string | null;
  vendor_expected_date: string | null;
  lines: PortalLine[];
}

interface PortalBill {
  id: string;
  doc_number: string;
  status: BillStatus;
  supplier_invoice_number: string | null;
  bill_date: string;
  due_date: string | null;
  currency: string;
  total: number;
  amount_paid: number;
  balance: number;
  order_number: string | null;
}

interface PortalData {
  status: "ok";
  company: { name: string; address: string | null; phone: string | null } | null;
  supplier: { name: string; name_ar: string | null } | null;
  orders: PortalOrder[];
  bills: PortalBill[];
}

type LoadState = { kind: "loading" } | { kind: "not_found" } | { kind: "failed" } | { kind: "ok"; data: PortalData };

export default function PublicVendorPage() {
  const { token = "" } = useParams();
  const { t, language } = useI18n();
  const tp = useTp();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [thanks, setThanks] = useState("");

  async function load() {
    try {
      const res = await fetch(`/api/vendor-portal/${encodeURIComponent(token)}`);
      if (res.status === 404) return setState({ kind: "not_found" });
      if (!res.ok) return setState({ kind: "failed" });
      setState({ kind: "ok", data: (await res.json()) as PortalData });
    } catch {
      setState({ kind: "failed" });
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (state.kind === "loading") {
    return (
      <Shell>
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-ink-3">
          <Loader2 className="h-5 w-5 animate-spin" />
          {t("vendorPortal.public.loading")}
        </div>
      </Shell>
    );
  }
  if (state.kind !== "ok") {
    return (
      <Shell>
        <Card className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <SearchX className="h-10 w-10 text-ink-3" />
          <p className="max-w-md text-sm text-ink-2">
            {t(state.kind === "not_found" ? "vendorPortal.public.notFound" : "vendorPortal.public.failed")}
          </p>
        </Card>
      </Shell>
    );
  }

  const { company, supplier, orders, bills } = state.data;
  const supplierName = supplier ? (language === "ar" && supplier.name_ar ? supplier.name_ar : supplier.name) : "";
  const companyName = company?.name ?? "";
  const toConfirm = orders.filter((o) => o.status === "sent").length;
  const owed = outstandingByCurrency(bills);

  return (
    <Shell>
      <Card className="px-5 py-6 sm:px-8">
        <h1 className="text-xl font-bold text-brand-700">
          {t("vendorPortal.public.heading", { supplier: bdiText(supplierName) })}
        </h1>
        {companyName && (
          <p className="mt-1 text-sm text-ink-2">{t("vendorPortal.public.from", { company: bdiText(companyName) })}</p>
        )}
        {(company?.address || company?.phone) && (
          <p className="mt-0.5 text-xs text-ink-3">
            {company?.address && <Bdi>{company.address}</Bdi>}
            {company?.address && company?.phone && " · "}
            {company?.phone && <Ltr>{company.phone}</Ltr>}
          </p>
        )}
        {(toConfirm > 0 || owed.length > 0) && (
          <div className="mt-4 flex flex-wrap gap-2 text-sm">
            {toConfirm > 0 && (
              <span className="rounded-lg bg-warn-soft px-3 py-1.5 font-medium text-warn">
                {tp("vendorPortal.public.toConfirm", toConfirm)}
              </span>
            )}
            {owed.map(([currency, amount]) => (
              <span key={currency} className="rounded-lg bg-canvas px-3 py-1.5 text-ink-2">
                {t("vendorPortal.public.outstanding", { amount: ltrText(formatMoney(amount, currency)) })}
              </span>
            ))}
          </div>
        )}
      </Card>

      {thanks && (
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-good/30 bg-good-soft px-4 py-3 text-sm text-good" role="status">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          <span>{thanks}</span>
        </div>
      )}

      <section className="mt-6">
        <h2 className="mb-3 text-base font-semibold text-ink">{t("vendorPortal.public.orders")}</h2>
        {orders.length === 0 ? (
          <Card className="px-5 py-8 text-center text-sm text-ink-3">{t("vendorPortal.public.noOrders")}</Card>
        ) : (
          <div className="space-y-3">
            {orders.map((o) => (
              <OrderCard key={o.id} order={o} token={token} company={companyName}
                onAcknowledged={() => {
                  setThanks(t("vendorPortal.public.ackThanks", { number: ltrText(o.doc_number) }));
                  void load();
                }} />
            ))}
          </div>
        )}
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-base font-semibold text-ink">{t("vendorPortal.public.bills")}</h2>
        {bills.length === 0 ? (
          <Card className="px-5 py-8 text-center text-sm text-ink-3">{t("vendorPortal.public.noBills")}</Card>
        ) : (
          <Card className="overflow-x-auto">
            <table className="min-w-full divide-y divide-line text-sm">
              <thead className="bg-canvas/60">
                <tr>
                  <Th>{t("vendorPortal.public.billNumber")}</Th>
                  <Th className="hidden sm:table-cell">{t("vendorPortal.public.billDate")}</Th>
                  <Th className="hidden sm:table-cell">{t("vendorPortal.public.due")}</Th>
                  <Th end>{t("vendorPortal.public.balance")}</Th>
                  <Th>{t("vendorPortal.public.status")}</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {bills.map((b) => (
                  <tr key={b.id}>
                    <td className="px-3 py-2.5">
                      <div className="whitespace-nowrap font-medium text-ink"><Ltr>{b.supplier_invoice_number ?? b.doc_number}</Ltr></div>
                      <div className="text-xs text-ink-3">
                        {b.supplier_invoice_number && <span className="whitespace-nowrap"><Ltr>{b.doc_number}</Ltr></span>}
                        {b.order_number && <>{b.supplier_invoice_number && " · "}<span className="whitespace-nowrap"><Ltr>{b.order_number}</Ltr></span></>}
                      </div>
                      {b.due_date && (
                        <div className="whitespace-nowrap text-xs text-ink-3 sm:hidden">
                          {t("vendorPortal.public.due")}: <Ltr>{formatDate(b.due_date)}</Ltr>
                        </div>
                      )}
                    </td>
                    <td className="hidden whitespace-nowrap px-3 py-2.5 text-ink-2 tabular-nums sm:table-cell"><Ltr>{formatDate(b.bill_date)}</Ltr></td>
                    <td className="hidden whitespace-nowrap px-3 py-2.5 text-ink-2 tabular-nums sm:table-cell">{b.due_date ? <Ltr>{formatDate(b.due_date)}</Ltr> : "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-end tabular-nums">
                      <div className="font-medium text-ink"><Ltr>{formatMoney(Number(b.balance), b.currency)}</Ltr></div>
                      <div className="text-xs text-ink-3"><Ltr>{formatMoney(Number(b.total), b.currency)}</Ltr></div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      <Badge tone={billStatus[b.status].tone}>{t(billStatus[b.status].labelKey)}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </section>

      {companyName && (
        <p className="mt-8 text-center text-xs text-ink-3">{t("vendorPortal.public.footer", { company: bdiText(companyName) })}</p>
      )}
    </Shell>
  );
}

function OrderCard({ order, token, company, onAcknowledged }: {
  order: PortalOrder;
  token: string;
  company: string;
  onAcknowledged: () => void;
}) {
  const { t } = useI18n();
  const canConfirm = order.status === "sent";
  const [open, setOpen] = useState(canConfirm);
  const [expected, setExpected] = useState(order.expected_date ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const st = poStatus[order.status];
  const money = (v: number) => formatMoney(Number(v), order.currency);
  const showReceived = order.lines.some((l) => Number(l.received_qty) > 0);

  async function confirm(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFailure("");
    try {
      const res = await fetch(
        `/api/vendor-portal/${encodeURIComponent(token)}/po/${encodeURIComponent(order.id)}/acknowledge`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expected_date: expected || null, note: note.trim() || null }),
        },
      );
      if (res.ok) return onAcknowledged();
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setFailure(
        body.error === "already_acknowledged"
          ? t("vendorPortal.public.ackAlready")
          : body.error === "invalid_expected_date"
            ? t("vendorPortal.public.ackBadDate")
            : t("vendorPortal.public.ackFailed"),
      );
    } catch {
      setFailure(t("vendorPortal.public.ackFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="px-4 py-4 sm:px-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold text-ink"><Ltr>{order.doc_number}</Ltr></span>
            <Badge tone={st.tone}>{t(st.labelKey)}</Badge>
          </div>
          <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-ink-3">
            <div>{t("vendorPortal.public.orderDate")}: <Ltr>{formatDate(order.order_date)}</Ltr></div>
            {order.expected_date && <div>{t("vendorPortal.public.expected")}: <Ltr>{formatDate(order.expected_date)}</Ltr></div>}
            {order.deliver_to && <div>{t("vendorPortal.public.deliverTo")}: <Bdi>{order.deliver_to}</Bdi></div>}
            {order.supplier_reference && <div>{t("vendorPortal.public.yourReference")}: <Ltr>{order.supplier_reference}</Ltr></div>}
          </dl>
        </div>
        <div className="shrink-0 text-end">
          <div className="whitespace-nowrap text-lg font-semibold text-ink tabular-nums"><Ltr>{money(order.total)}</Ltr></div>
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
            className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
            {t(open ? "vendorPortal.public.hideLines" : "vendorPortal.public.showLines")}
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      {order.vendor_ack_at && (
        <p className="mt-3 rounded-lg bg-good-soft px-3 py-2 text-xs text-good">
          {t("vendorPortal.public.ackDone", { date: ltrText(formatDate(order.vendor_ack_at)) })}
          {order.vendor_expected_date && (
            <> {t("vendorPortal.public.ackExpectedOn", { date: ltrText(formatDate(order.vendor_expected_date)) })}</>
          )}
        </p>
      )}

      {open && (
        <>
          <div className="mt-4 overflow-x-auto rounded-xl border border-line">
            <table className="min-w-full divide-y divide-line text-sm">
              <thead className="bg-canvas/60">
                <tr>
                  <Th>{t("vendorPortal.public.description")}</Th>
                  <Th end>{t("vendorPortal.public.qty")}</Th>
                  {showReceived && <Th end>{t("vendorPortal.public.received")}</Th>}
                  <Th end>{t("vendorPortal.public.unitCost")}</Th>
                  <Th end>{t("vendorPortal.public.amount")}</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {order.lines.map((l) => (
                  <tr key={l.id}>
                    <td className="px-3 py-2.5 text-ink">
                      <Bdi>{l.description}</Bdi>
                      {Number(l.discount_percent) > 0 && <span className="ms-2 text-xs text-ink-3"><Ltr>−{Number(l.discount_percent)}%</Ltr></span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-end text-ink-2 tabular-nums">
                      <Bdi>{Number(l.quantity)}{l.unit ? ` ${l.unit}` : ""}</Bdi>
                    </td>
                    {showReceived && <td className="px-3 py-2.5 text-end text-ink-2 tabular-nums"><Ltr>{Number(l.received_qty)}</Ltr></td>}
                    <td className="whitespace-nowrap px-3 py-2.5 text-end text-ink-2 tabular-nums"><Ltr>{money(l.unit_price)}</Ltr></td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-end font-medium text-ink tabular-nums"><Ltr>{money(l.line_total)}</Ltr></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className="ms-auto mt-3 w-full max-w-xs space-y-1 text-sm tabular-nums">
            <Sum label={t("vendorPortal.public.subtotal")} value={money(order.subtotal)} />
            {Number(order.discount_total) > 0 && <Sum label={t("vendorPortal.public.discount")} value={`− ${money(order.discount_total)}`} />}
            {Number(order.tax_total) > 0 && <Sum label={t("vendorPortal.public.tax")} value={money(order.tax_total)} />}
            <div className="border-t border-line pt-1"><Sum label={t("vendorPortal.public.total")} value={money(order.total)} strong /></div>
          </dl>
          {order.terms && (
            <div className="mt-3 text-xs text-ink-2">
              <span className="font-semibold text-ink-3">{t("vendorPortal.public.terms")}: </span>
              <span className="whitespace-pre-line" dir="auto">{order.terms}</span>
            </div>
          )}
        </>
      )}

      {canConfirm && (
        <form onSubmit={confirm} className="mt-4 space-y-3 rounded-xl border border-dashed border-line p-4">
          <div>
            <h3 className="text-sm font-semibold text-ink">{t("vendorPortal.public.ackTitle")}</h3>
            {company && <p className="text-xs text-ink-3">{t("vendorPortal.public.ackHint", { company: bdiText(company) })}</p>}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("vendorPortal.public.ackExpected")}>
              <Input type="date" value={expected} min={order.order_date} onChange={(e) => setExpected(e.target.value)} dir="ltr" />
            </Field>
            <Field label={t("vendorPortal.public.ackNote")}>
              <Textarea rows={1} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
            </Field>
          </div>
          {failure && <ErrorState message={failure} />}
          <div className="flex justify-end">
            <Button type="submit" loading={busy}>
              <CheckCircle2 className="h-4 w-4" /> {t("vendorPortal.public.ackSubmit")}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

function Th({ children, end, className = "" }: { children: ReactNode; end?: boolean; className?: string }) {
  return (
    <th className={`px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3 rtl:tracking-normal ${end ? "text-end" : "text-start"} ${className}`}>
      {children}
    </th>
  );
}

function Sum({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className={strong ? "font-semibold text-ink" : "text-ink-3"}>{label}</dt>
      <dd className={strong ? "font-semibold text-ink" : "text-ink"}><Ltr>{value}</Ltr></dd>
    </div>
  );
}

function LanguageSwitcher() {
  const { language, setLanguage, t } = useI18n();
  return (
    <div className="flex gap-1">
      {LANGUAGES.map((l) => (
        <button key={l.code} type="button" onClick={() => setLanguage(l.code)}
          className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
            language === l.code ? "bg-brand-50 text-brand-700" : "text-ink-3 hover:bg-canvas hover:text-ink-2"
          }`}>
          {t(l.labelKey)}
        </button>
      ))}
    </div>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas px-4 py-8">
      <div className="mx-auto max-w-3xl">
        <div className="mb-4 flex justify-end">
          <LanguageSwitcher />
        </div>
        {children}
      </div>
    </div>
  );
}
