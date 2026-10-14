import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, CreditCard, Lock, Minus, Plus, Printer, ShoppingCart, Store, Trash2 } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { listRows, sanitizeSearch, wrapDbError } from "../../lib/db";
import { formatDateTime, formatMoney } from "../../lib/format";
import { useCustomerPicker } from "../../lib/pickers";
import {
  addToCart, cartTotals, checkTender, checkoutLines, clampPercent, lineAmounts, quickCash, roundTo, type CartLine, type Tender,
} from "../../../shared/pos";
import { useAuth, useTenant } from "../../context/AuthContext";
import { ltrText } from "../../lib/bidi";
import { useT } from "../../i18n";
import { Bdi, Button, Card, EmptyState, ErrorState, Field, Input, LoadingState, Ltr, Modal, Select, Textarea } from "../../components/ui";
import { Combobox } from "../../components/Combobox";
import { useToast } from "../../components/Toast";
import { FormActions, FormError, Notice, onSubmit, textOrNull, useSubmit } from "./forms";
import { ZReport } from "./ZReport";
import {
  POS_KEYS, SESSION_SELECT, currencyDecimals, n, useOpenSession, useRegisters, useSessionSummary, type PosProduct, type PosSession,
} from "./types";

const STORAGE_KEY = "fm.pos.register";
const KINDS = ["service", "part", "fee", "other"] as const;
type Kind = (typeof KINDS)[number];

function readStored(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}
function writeStored(id: string) {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Storage blocked: the choice simply is not remembered.
  }
}

export default function RegisterPage() {
  const t = useT();
  const { isManager } = useAuth();
  const registersQ = useRegisters(true);
  const [chosen, setChosen] = useState(readStored);
  const registers = registersQ.data ?? [];
  const registerId = registers.some((r) => r.id === chosen) ? chosen : registers[0]?.id ?? "";
  const sessionQ = useOpenSession(registerId);

  const choose = (id: string) => { setChosen(id); writeStored(id); };

  if (registersQ.isLoading) return <LoadingState />;
  if (registersQ.error) return <ErrorState message={(registersQ.error as Error).message} />;
  if (registers.length === 0) {
    return (
      <EmptyState
        icon={<Store className="h-10 w-10" />}
        title={t("pos.reg.noRegisters")}
        description={isManager ? t("pos.reg.noRegistersHint") : t("pos.reg.noRegistersViewer")}
        action={isManager ? <Link to="/pos/registers"><Button>{t("pos.registers.new")}</Button></Link> : undefined}
      />
    );
  }

  const session = sessionQ.data;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {registers.length > 1 && (
          <Select value={registerId} onChange={(e) => choose(e.target.value)} className="w-full sm:w-64" aria-label={t("pos.reg.register")}>
            {registers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Select>
        )}
        {registers.length === 1 && <span className="font-medium text-ink"><Bdi>{registers[0].name}</Bdi></span>}
        {session && (
          <span className="text-sm text-ink-2">
            {t("pos.reg.sessionOpen", { number: ltrText(session.doc_number), time: ltrText(formatDateTime(session.opened_at)) })}
          </span>
        )}
      </div>
      {!isManager && <Notice>{t("pos.reg.viewerNotice")}</Notice>}
      {sessionQ.isLoading && <LoadingState />}
      {sessionQ.error && <ErrorState message={(sessionQ.error as Error).message} />}
      {!sessionQ.isLoading && !session && <OpenSession registerId={registerId} />}
      {session && <Till key={session.id} session={session} />}
    </div>
  );
}

function OpenSession({ registerId }: { registerId: string }) {
  const t = useT();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [cash, setCash] = useState("");
  const [notes, setNotes] = useState("");
  const { error, saving, run } = useSubmit(() => {
    for (const k of POS_KEYS) void qc.invalidateQueries({ queryKey: [k] });
    toast.success(t("pos.reg.opened"));
  });
  const submit = onSubmit(() => run(async () => {
    const { error: e } = await supabase.rpc("pos_open_session", {
      p_register_id: registerId, p_opening_cash: Number(cash || 0), p_notes: textOrNull(notes) ?? undefined,
    });
    if (e) throw wrapDbError(e);
  }));

  return (
    <Card className="mx-auto max-w-md p-6">
      <div className="mb-4 flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-warn-soft text-warn"><Lock className="h-5 w-5" /></span>
        <div>
          <h2 className="font-semibold text-ink">{t("pos.reg.closedTitle")}</h2>
          <p className="text-sm text-ink-2">{isManager ? t("pos.reg.closedHint") : t("pos.reg.closedViewer")}</p>
        </div>
      </div>
      {isManager && (
        <form onSubmit={submit} className="space-y-4">
          <Field label={t("pos.reg.openingCash")} hint={t("pos.reg.openingCashHint")}>
            <Input type="number" min={0} step="any" inputMode="decimal" dir="ltr" value={cash} onChange={(e) => setCash(e.target.value)} />
          </Field>
          <Field label={t("pos.notes")}>
            <Textarea rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <FormError message={error} />
          <Button type="submit" loading={saving} className="w-full">{t("pos.reg.open")}</Button>
        </form>
      )}
    </Card>
  );
}

interface Sold { orderId: string; docNumber: string; total: number; change: number }

function Till({ session }: { session: PosSession }) {
  const t = useT();
  const tenant = useTenant();
  const { isManager } = useAuth();
  const decimals = currencyDecimals(tenant.currency);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [paying, setPaying] = useState(false);
  const [sold, setSold] = useState<Sold | null>(null);
  const [closing, setClosing] = useState(false);
  const totals = useMemo(() => cartTotals(lines, decimals), [lines, decimals]);
  const money = (v: number) => formatMoney(v, tenant.currency);

  const update = (i: number, patch: Partial<CartLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const remove = (i: number) => setLines((ls) => ls.filter((_, j) => j !== i));
  const step = (i: number, d: number) => {
    const q = roundTo((lines[i]?.quantity ?? 0) + d, 3);
    if (q <= 0) remove(i);
    else update(i, { quantity: q });
  };
  const reset = () => { setLines([]); setCustomerId(""); };

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <ProductGrid disabled={!isManager} onPick={(p) => setLines((ls) => addToCart(ls, p))} />
        <Card className="flex flex-col p-4 lg:sticky lg:top-4 lg:self-start">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-semibold text-ink"><ShoppingCart className="h-4 w-4" /> {t("pos.cart.title")}</h2>
            {lines.length > 0 && (
              <button type="button" onClick={reset} className="text-sm text-ink-3 hover:text-serious">{t("pos.cart.clear")}</button>
            )}
          </div>
          {lines.length === 0 ? (
            <p className="py-8 text-center text-sm text-ink-3">{isManager ? t("pos.cart.empty") : t("pos.cart.emptyViewer")}</p>
          ) : (
            <ul className="max-h-[50vh] divide-y divide-line overflow-y-auto">
              {lines.map((l, i) => {
                const a = lineAmounts(l, decimals);
                return (
                  <li key={l.productId} className="py-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-ink"><Bdi>{l.name}</Bdi></div>
                        <div className="text-xs text-ink-3"><Ltr>{money(l.unitPrice)}</Ltr></div>
                      </div>
                      <Ltr className="whitespace-nowrap text-sm font-medium text-ink">{money(a.total)}</Ltr>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="flex items-center rounded-lg border border-line" dir="ltr">
                        <button type="button" className="p-1.5 text-ink-2 hover:text-ink" onClick={() => step(i, -1)} aria-label={t("pos.cart.less")}>
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                        <input
                          type="number" min={0} step="any" inputMode="decimal" aria-label={t("pos.cart.qty")}
                          className="w-14 border-x border-line bg-transparent py-1 text-center text-sm text-ink tabular-nums"
                          value={l.quantity}
                          onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v > 0) update(i, { quantity: roundTo(v, 3) }); }}
                        />
                        <button type="button" className="p-1.5 text-ink-2 hover:text-ink" onClick={() => step(i, 1)} aria-label={t("pos.cart.more")}>
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <label className="flex items-center gap-1 text-xs text-ink-3">
                        {t("pos.cart.discount")}
                        <input
                          type="number" min={0} max={100} step="any" inputMode="decimal" dir="ltr"
                          className="w-14 rounded-lg border border-line bg-transparent px-1.5 py-1 text-center text-sm text-ink tabular-nums"
                          value={l.discountPercent || ""}
                          placeholder="0"
                          onChange={(e) => update(i, { discountPercent: clampPercent(Number(e.target.value)) })}
                        />
                        %
                      </label>
                      <button type="button" className="ms-auto p-1 text-ink-3 hover:text-serious" onClick={() => remove(i)} aria-label={t("pos.cart.remove")}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <dl className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
            <TotalRow label={t("pos.cart.subtotal")} value={money(totals.subtotal)} />
            {totals.discount > 0 && <TotalRow label={t("pos.cart.discount")} value={money(-totals.discount)} />}
            <TotalRow label={t("pos.cart.tax")} value={money(totals.tax)} />
            <TotalRow label={t("pos.cart.total")} value={money(totals.total)} strong />
          </dl>
          {isManager && (
            <>
              <CustomerField value={customerId} onChange={setCustomerId} />
              <Button className="mt-3 w-full py-3 text-base" disabled={lines.length === 0} onClick={() => setPaying(true)}>
                {t("pos.cart.pay", { total: ltrText(money(totals.total)) })}
              </Button>
              <Button variant="secondary" className="mt-2 w-full" onClick={() => setClosing(true)}>
                <Lock className="h-4 w-4" /> {t("pos.close.action")}
              </Button>
            </>
          )}
        </Card>
      </div>
      <Modal title={t("pos.pay.title")} open={paying} onClose={() => setPaying(false)}>
        {paying && (
          <PayForm
            sessionId={session.id}
            lines={lines}
            total={totals.total}
            decimals={decimals}
            customerId={customerId}
            onCancel={() => setPaying(false)}
            onDone={(s) => { setPaying(false); reset(); setSold(s); }}
          />
        )}
      </Modal>
      <Modal title={t("pos.done.title")} open={!!sold} onClose={() => setSold(null)}>
        {sold && (
          <div className="space-y-4 text-center">
            <div className="text-sm text-ink-2"><Ltr>{sold.docNumber}</Ltr> · <Ltr>{money(sold.total)}</Ltr></div>
            <div>
              <div className="text-sm text-ink-3">{t("pos.done.change")}</div>
              <Ltr className="text-4xl font-bold text-ink">{money(sold.change)}</Ltr>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              <Link to={`/pos/orders/${sold.orderId}/receipt`}>
                <Button variant="secondary"><Printer className="h-4 w-4" /> {t("pos.done.receipt")}</Button>
              </Link>
              <Button onClick={() => setSold(null)}>{t("pos.done.next")}</Button>
            </div>
          </div>
        )}
      </Modal>
      <CloseSession session={session} open={closing} onClose={() => setClosing(false)} cartHasItems={lines.length > 0} />
    </>
  );
}

function TotalRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? "pt-1 text-lg font-bold text-ink" : "text-ink-2"}`}>
      <dt>{label}</dt>
      <dd><Ltr>{value}</Ltr></dd>
    </div>
  );
}

function CustomerField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useT();
  const picker = useCustomerPicker(value, { activeOnly: true });
  return (
    <div className="mt-3">
      <Field label={t("pos.cart.customer")}>
        <Combobox {...picker} value={value} onChange={onChange} placeholder={t("pos.cart.walkIn")} />
      </Field>
    </div>
  );
}

function ProductGrid({ onPick, disabled }: { onPick: (p: PosProduct) => void; disabled: boolean }) {
  const t = useT();
  const tenant = useTenant();
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [kind, setKind] = useState<"all" | Kind>("all");
  useEffect(() => {
    const id = setTimeout(() => setTerm(sanitizeSearch(search)), 250);
    return () => clearTimeout(id);
  }, [search]);
  const q = useQuery({
    queryKey: ["products", "pos", { term, kind }],
    queryFn: () =>
      listRows<PosProduct>("products", (b) => {
        let f = b.select("id, name, sku, kind, unit_price, tax_rate").eq("active", true);
        if (kind !== "all") f = f.eq("kind", kind);
        if (term) f = f.or(`name.ilike.%${term}%,sku.ilike.%${term}%`);
        return f.order("name").limit(60);
      }),
  });
  const chip = (k: "all" | Kind, label: string) => (
    <button
      key={k}
      type="button"
      aria-pressed={kind === k}
      onClick={() => setKind(k)}
      className={`rounded-full border px-3 py-1 text-sm ${kind === k ? "border-brand-600 bg-brand-600 text-white" : "border-line bg-surface text-ink-2 hover:bg-canvas"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="min-w-0">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("pos.grid.search")} className="w-full sm:max-w-72" />
        <div className="flex flex-wrap gap-2">
          {chip("all", t("pos.grid.all"))}
          {KINDS.map((k) => chip(k, t(`pos.kind.${k}`)))}
        </div>
      </div>
      {q.isLoading && <LoadingState />}
      {q.error && <ErrorState message={(q.error as Error).message} />}
      {q.data && q.data.length === 0 && (
        <EmptyState icon={<Store className="h-10 w-10" />} title={t("pos.grid.empty")} description={t("pos.grid.emptyHint")} />
      )}
      {q.data && q.data.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
          {q.data.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={disabled}
              onClick={() => onPick(p)}
              className="flex min-h-24 flex-col justify-between rounded-xl border border-line bg-surface p-3 text-start shadow-card transition hover:border-brand-600 hover:bg-canvas disabled:cursor-default disabled:hover:border-line disabled:hover:bg-surface"
            >
              <span className="line-clamp-2 text-sm font-medium text-ink"><Bdi>{p.name}</Bdi></span>
              <span className="mt-2 flex items-end justify-between gap-2">
                <Ltr className="text-xs text-ink-3">{p.sku ?? ""}</Ltr>
                <Ltr className="text-sm font-semibold text-brand-700">{formatMoney(n(p.unit_price), tenant.currency)}</Ltr>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PayForm({ sessionId, lines, total, decimals, customerId, onCancel, onDone }: {
  sessionId: string; lines: CartLine[]; total: number; decimals: number; customerId: string;
  onCancel: () => void; onDone: (s: Sold) => void;
}) {
  const t = useT();
  const tenant = useTenant();
  const qc = useQueryClient();
  const [tender, setTender] = useState({ cash: String(total), card: "", other: "" });
  const nums: Tender = { cash: Number(tender.cash || 0), card: Number(tender.card || 0), other: Number(tender.other || 0) };
  const check = checkTender(total, nums, decimals);
  const money = (v: number) => formatMoney(v, tenant.currency);
  const { error, saving, run } = useSubmit<Sold>((s) => {
    for (const k of [...POS_KEYS, "products"]) void qc.invalidateQueries({ queryKey: [k] });
    onDone(s);
  });
  const submit = onSubmit(() => run(async () => {
    const { data, error: e } = await supabase.rpc("pos_checkout", {
      p_session_id: sessionId,
      p_lines: checkoutLines(lines),
      p_payments: { cash: nums.cash, card: nums.card, other: nums.other },
      p_customer_id: customerId || undefined,
    });
    if (e) throw wrapDbError(e);
    const r = data as { order_id: string; doc_number: string; total: number; change_due: number };
    return { orderId: r.order_id, docNumber: r.doc_number, total: n(r.total), change: n(r.change_due) };
  }));
  const set = (k: keyof typeof tender, v: string) => setTender((s) => ({ ...s, [k]: v }));
  const problem = check.problem === "underpaid"
    ? t("pos.pay.due", { amount: ltrText(money(check.due)) })
    : check.problem === "change_from_card" ? t("errors.posChangeFromCard")
    : check.problem === "negative" ? t("pos.pay.negative") : "";

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="rounded-xl bg-canvas p-4 text-center">
        <div className="text-sm text-ink-3">{t("pos.pay.total")}</div>
        <Ltr className="text-3xl font-bold text-ink">{money(total)}</Ltr>
      </div>
      <Field label={t("pos.pay.cash")}>
        <Input type="number" min={0} step="any" inputMode="decimal" dir="ltr" value={tender.cash} onChange={(e) => set("cash", e.target.value)} autoFocus />
      </Field>
      <div className="flex flex-wrap gap-2">
        {quickCash(total).map((v) => (
          <button key={v} type="button" onClick={() => setTender({ cash: String(v), card: "", other: "" })}
            className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink-2 hover:bg-canvas">
            <Banknote className="me-1 inline h-3.5 w-3.5" /><Ltr>{money(v)}</Ltr>
          </button>
        ))}
        <button type="button" onClick={() => setTender({ cash: "", card: String(total), other: "" })}
          className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink-2 hover:bg-canvas">
          <CreditCard className="me-1 inline h-3.5 w-3.5" />{t("pos.pay.allCard")}
        </button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("pos.pay.card")}>
          <Input type="number" min={0} step="any" inputMode="decimal" dir="ltr" value={tender.card} onChange={(e) => set("card", e.target.value)} />
        </Field>
        <Field label={t("pos.pay.other")}>
          <Input type="number" min={0} step="any" inputMode="decimal" dir="ltr" value={tender.other} onChange={(e) => set("other", e.target.value)} />
        </Field>
      </div>
      {problem ? (
        <p className="rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn">{problem}</p>
      ) : (
        <p className="rounded-xl bg-good-soft px-3 py-2 text-sm text-good">{t("pos.pay.change", { amount: ltrText(money(check.change)) })}</p>
      )}
      <FormError message={error} />
      <FormActions saving={saving} label={t("pos.pay.confirm")} onCancel={onCancel} disabled={!!check.problem} />
    </form>
  );
}

function CloseSession({ session, open, onClose, cartHasItems }: { session: PosSession; open: boolean; onClose: () => void; cartHasItems: boolean }) {
  const t = useT();
  const tenant = useTenant();
  const qc = useQueryClient();
  const toast = useToast();
  const [counted, setCounted] = useState("");
  const [notes, setNotes] = useState("");
  const [closed, setClosed] = useState<PosSession | null>(null);
  const summaryQ = useSessionSummary(open ? session.id : null);
  const { error, saving, run } = useSubmit<PosSession | null>((s) => { setClosed(s); toast.success(t("pos.close.done")); });
  const submit = onSubmit(() => run(async () => {
    const { error: e } = await supabase.rpc("pos_close_session", {
      p_session_id: session.id, p_counted_cash: Number(counted || 0), p_notes: textOrNull(notes) ?? undefined,
    });
    if (e) throw wrapDbError(e);
    return (await listRows<PosSession>("pos_sessions", (q) => q.select(SESSION_SELECT).eq("id", session.id).limit(1)))[0] ?? null;
  }));
  const finish = () => {
    const wasClosed = !!closed;
    setClosed(null);
    setCounted("");
    setNotes("");
    onClose();
    if (wasClosed) for (const k of POS_KEYS) void qc.invalidateQueries({ queryKey: [k] });
  };

  return (
    <Modal title={closed ? t("pos.z.title", { number: ltrText(closed.doc_number) }) : t("pos.close.title")} open={open} onClose={finish} wide={!!closed}>
      {closed ? (
        <div className="space-y-4">
          <ZReport session={closed} />
          <div className="flex justify-end"><Button onClick={finish}>{t("pos.close.finish")}</Button></div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {cartHasItems && <Notice>{t("pos.close.cartWarning")}</Notice>}
          <div className="flex items-center justify-between rounded-xl bg-canvas px-4 py-3 text-sm">
            <span className="text-ink-2">{t("pos.z.expected")}</span>
            <Ltr className="text-lg font-semibold text-ink">
              {summaryQ.data ? formatMoney(n(summaryQ.data.expected_cash), tenant.currency) : "…"}
            </Ltr>
          </div>
          <Field label={t("pos.close.counted")} required hint={t("pos.close.countedHint")}>
            <Input type="number" min={0} step="any" inputMode="decimal" dir="ltr" required value={counted} onChange={(e) => setCounted(e.target.value)} autoFocus />
          </Field>
          <Field label={t("pos.notes")}>
            <Textarea rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <FormError message={error} />
          <FormActions saving={saving} label={t("pos.close.confirm")} onCancel={finish} />
        </form>
      )}
    </Modal>
  );
}

