import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, Trash2, Undo2 } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { deleteRow, getRow, insertRow, listRows, updateRow, wrapDbError } from "../../lib/db";
import { ltrText } from "../../lib/bidi";
import { formatDate, formatDateTime, formatMoney } from "../../lib/format";
import { lineTotals } from "../../../shared/finance";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useI18n, useT } from "../../i18n";
import { Badge, Bdi, Button, Card, ErrorState, Field, Input, LoadingState, Ltr, Modal, PageHeader } from "../../components/ui";
import { Combobox } from "../../components/Combobox";
import { useToast } from "../../components/Toast";
import { FormActions, FormError, onSubmit, textOrNull, useSubmit } from "./forms";
import {
  ENTRY_SELECT, accountName, accountOptions, entryTone, sourceLink, todayIn, useAccounts, type JournalEntry, type JournalLine,
} from "./types";

interface EditLine {
  key: string;
  id?: string;
  account_id: string;
  description: string;
  debit: string;
  credit: string;
}

let keySeq = 0;
const blank = (): EditLine => ({ key: `n${++keySeq}`, account_id: "", description: "", debit: "", credit: "" });
const amount = (v: string) => (v.trim() === "" ? 0 : Number(v));

export default function EntryDetailPage() {
  const { id = "" } = useParams();
  const t = useT();
  const { language } = useI18n();
  const tenant = useTenant();
  const { isManager } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [lines, setLines] = useState<EditLine[] | null>(null);
  const [header, setHeader] = useState<{ entry_date: string; memo: string } | null>(null);
  const [lineError, setLineError] = useState("");
  const [modal, setModal] = useState<"reverse" | "delete" | null>(null);

  const entryQ = useQuery({
    queryKey: ["journal_entries", "one", id],
    queryFn: async () => {
      const rows = await listRows<JournalEntry>("journal_entries", (q) => q.select(ENTRY_SELECT).eq("id", id).limit(1));
      return rows[0] ?? null;
    },
  });
  const linesQ = useQuery({
    queryKey: ["journal_lines", id],
    queryFn: () => listRows<JournalLine>("journal_lines", (q) => q.select("*").eq("entry_id", id).order("sort_order").limit(500)),
  });
  const accountsQ = useAccounts();
  const e = entryQ.data;
  const linkedId = e?.reversal_of ?? e?.reversed_by ?? "";
  const linkedQ = useQuery({
    queryKey: ["journal_entries", "one", linkedId, "number"],
    enabled: !!linkedId,
    queryFn: () => getRow<JournalEntry>("journal_entries", linkedId),
  });

  const editable = !!e && e.status === "draft" && isManager;
  // Seed the editor from the server once per load.
  useEffect(() => {
    if (!e || !linesQ.data) return;
    setHeader({ entry_date: e.entry_date, memo: e.memo ?? "" });
    setLines(linesQ.data.length
      ? linesQ.data.map((l) => ({
          key: l.id, id: l.id, account_id: l.account_id, description: l.description ?? "",
          debit: l.debit ? String(l.debit) : "", credit: l.credit ? String(l.credit) : "",
        }))
      : [blank(), blank()]);
  }, [e, linesQ.data]);

  const totals = useMemo(() => lineTotals((lines ?? []).map((l) => ({ debit: l.debit, credit: l.credit }))), [lines]);
  const accountById = useMemo(() => new Map((accountsQ.data ?? []).map((a) => [a.id, a])), [accountsQ.data]);
  const options = useMemo(() => accountOptions(accountsQ.data ?? [], language), [accountsQ.data, language]);

  const refresh = () => {
    for (const k of ["journal_entries", "journal_lines", "finance_balances", "finance_monthly", "finance_pending", "expenses"]) {
      void qc.invalidateQueries({ queryKey: [k] });
    }
  };
  const fail = (err: unknown) => toast.error(err instanceof Error ? err.message : t("common.error"));

  /** Writes the editor back: deletes removed lines, updates changed ones, inserts new ones. */
  async function saveDraft() {
    if (!e || !lines || !header) return;
    const filled = lines.filter((l) => l.account_id || amount(l.debit) || amount(l.credit));
    if (filled.some((l) => !l.account_id)) throw new Error(t("finance.je.needAccount"));
    if (filled.some((l) => (amount(l.debit) > 0) === (amount(l.credit) > 0))) throw new Error(t("finance.je.oneSide"));
    if (header.entry_date !== e.entry_date || (header.memo || null) !== (e.memo || null)) {
      await updateRow("journal_entries", e.id, { entry_date: header.entry_date, memo: textOrNull(header.memo) });
    }
    const keep = new Set(filled.map((l) => l.id).filter(Boolean));
    for (const old of linesQ.data ?? []) if (!keep.has(old.id)) await deleteRow("journal_lines", old.id);
    const byId = new Map((linesQ.data ?? []).map((l) => [l.id, l]));
    for (const [i, l] of filled.entries()) {
      const values = {
        account_id: l.account_id, sort_order: i + 1, description: textOrNull(l.description),
        debit: amount(l.debit), credit: amount(l.credit),
      };
      const old = l.id ? byId.get(l.id) : undefined;
      if (!old) await insertRow("journal_lines", { entry_id: e.id, ...values });
      else if (old.account_id !== values.account_id || old.sort_order !== values.sort_order || (old.description ?? null) !== values.description
        || Number(old.debit) !== values.debit || Number(old.credit) !== values.credit) {
        await updateRow("journal_lines", old.id, values);
      }
    }
  }

  const save = useMutation({
    mutationFn: saveDraft,
    onSuccess: () => { setLineError(""); refresh(); toast.success(t("finance.saved")); },
    onError: (err) => setLineError(err instanceof Error ? err.message : t("common.error")),
  });
  const post = useMutation({
    mutationFn: async () => {
      await saveDraft();
      const { error } = await supabase.rpc("finance_post_entry", { p_entry_id: id });
      if (error) throw wrapDbError(error);
    },
    onSuccess: () => { setLineError(""); refresh(); toast.success(t("finance.je.posted")); },
    onError: (err) => { refresh(); setLineError(err instanceof Error ? err.message : t("common.error")); },
  });
  const remove = useMutation({
    mutationFn: () => deleteRow("journal_entries", id),
    onSuccess: () => { refresh(); toast.success(t("finance.je.deleted")); navigate("/finance/journal"); },
    onError: fail,
  });

  if (entryQ.isLoading || linesQ.isLoading || accountsQ.isLoading) return <LoadingState />;
  const err = entryQ.error ?? linesQ.error ?? accountsQ.error;
  if (err) return <ErrorState message={(err as Error).message} />;
  if (!e) return <ErrorState message={t("finance.je.notFound")} />;

  const money = (n: number) => formatMoney(n, tenant.currency);
  const src = sourceLink(e);
  const setLine = (key: string, patch: Partial<EditLine>) =>
    setLines((ls) => (ls ?? []).map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const busy = save.isPending || post.isPending;

  return (
    <div className="space-y-4">
      <Link to="/finance/journal" className="inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink">
        <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" /> {t("finance.tab.journal")}
      </Link>
      <PageHeader
        title={e.doc_number ?? t("finance.je.title")}
        description={e.memo ?? undefined}
        badge={<Badge tone={entryTone[e.status]}>{t(`finance.entryStatus.${e.status}`)}</Badge>}
        actions={isManager ? (
          <>
            {e.status === "draft" && (
              <Button variant="ghost" className="text-serious" onClick={() => setModal("delete")}>
                <Trash2 className="h-4 w-4" /> {t("action.delete")}
              </Button>
            )}
            {e.status === "posted" && !e.reversal_of && (
              <Button variant="secondary" onClick={() => setModal("reverse")}>
                <Undo2 className="h-4 w-4 rtl:-scale-x-100" /> {t("finance.je.reverse")}
              </Button>
            )}
          </>
        ) : undefined}
      />

      <Card className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Info label={t("finance.je.date")}>
          {editable && header ? (
            <Input type="date" value={header.entry_date} onChange={(ev) => setHeader({ ...header, entry_date: ev.target.value })} />
          ) : formatDate(e.entry_date)}
        </Info>
        <Info label={t("finance.je.source")}>
          {src ? <Link to={src} className="text-brand-700 hover:underline">{t(`finance.source.${e.source_type}`)}</Link> : t(`finance.source.${e.source_type}`)}
        </Info>
        <Info label={t("finance.je.total")}><Ltr>{money(e.status === "draft" ? totals.debit : e.total)}</Ltr></Info>
        <Info label={t("finance.je.postedAt")}>{e.posted_at ? formatDateTime(e.posted_at, tenant.timezone) : "—"}</Info>
        {editable && header && (
          <div className="sm:col-span-2 lg:col-span-4">
            <Field label={t("finance.je.memo")}>
              <Input value={header.memo} onChange={(ev) => setHeader({ ...header, memo: ev.target.value })} maxLength={500} />
            </Field>
          </div>
        )}
        {linkedQ.data && (
          <p className="text-sm text-ink-2 sm:col-span-2 lg:col-span-4">
            {e.reversal_of ? t("finance.je.reverses") : t("finance.je.reversedBy")}{" "}
            <Link to={`/finance/journal/${linkedQ.data.id}`} className="font-medium text-brand-700 hover:underline">
              <Ltr>{linkedQ.data.doc_number}</Ltr>
            </Link>
          </p>
        )}
      </Card>

      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink">{t("finance.je.lines")}</h2>
        {editable && lines ? (
          <div className="space-y-2">
            <div className="hidden grid-cols-12 gap-2 px-1 text-xs font-medium text-ink-3 md:grid">
              <span className="col-span-4">{t("finance.je.account")}</span>
              <span className="col-span-3">{t("finance.je.description")}</span>
              <span className="col-span-2 text-end">{t("finance.je.debit")}</span>
              <span className="col-span-2 text-end">{t("finance.je.credit")}</span>
            </div>
            {lines.map((l) => (
              <div key={l.key} className="grid grid-cols-12 items-center gap-2 rounded-xl border border-line p-2 md:border-0 md:p-0">
                <div className="col-span-12 md:col-span-4">
                  <Combobox options={options} value={l.account_id} onChange={(v) => setLine(l.key, { account_id: v })}
                    placeholder={t("finance.je.account")} />
                </div>
                <Input className="col-span-12 md:col-span-3" value={l.description} maxLength={300} placeholder={t("finance.je.description")}
                  onChange={(ev) => setLine(l.key, { description: ev.target.value })} />
                <Input className="col-span-5 text-end md:col-span-2" type="number" min="0" step="any" inputMode="decimal" dir="ltr"
                  value={l.debit} placeholder={t("finance.je.debit")} aria-label={t("finance.je.debit")}
                  onChange={(ev) => setLine(l.key, { debit: ev.target.value, credit: ev.target.value ? "" : l.credit })} />
                <Input className="col-span-5 text-end md:col-span-2" type="number" min="0" step="any" inputMode="decimal" dir="ltr"
                  value={l.credit} placeholder={t("finance.je.credit")} aria-label={t("finance.je.credit")}
                  onChange={(ev) => setLine(l.key, { credit: ev.target.value, debit: ev.target.value ? "" : l.debit })} />
                <Button variant="ghost" className="col-span-2 justify-self-end px-2 md:col-span-1" aria-label={t("finance.je.removeLine")}
                  onClick={() => setLines((ls) => (ls ?? []).filter((x) => x.key !== l.key))}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <Button variant="ghost" onClick={() => setLines((ls) => [...(ls ?? []), blank()])}>
                <Plus className="h-4 w-4" /> {t("finance.je.addLine")}
              </Button>
              <Totals debit={totals.debit} credit={totals.credit} difference={totals.difference} money={money} />
            </div>
            <FormError message={lineError} />
            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <Button variant="secondary" loading={save.isPending} disabled={busy} onClick={() => save.mutate()}>{t("finance.je.saveDraft")}</Button>
              <Button loading={post.isPending} disabled={busy || !totals.balanced} onClick={() => post.mutate()}>{t("finance.je.post")}</Button>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-xs text-ink-3">
                  <th className="py-2 text-start font-medium">{t("finance.je.account")}</th>
                  <th className="hidden py-2 text-start font-medium sm:table-cell">{t("finance.je.description")}</th>
                  <th className="py-2 text-end font-medium">{t("finance.je.debit")}</th>
                  <th className="py-2 text-end font-medium">{t("finance.je.credit")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {(linesQ.data ?? []).map((l) => {
                  const a = accountById.get(l.account_id);
                  return (
                    <tr key={l.id}>
                      <td className="py-2 pe-3">
                        <Ltr className="text-ink-3">{a?.code ?? ""}</Ltr>{" "}
                        <Bdi className="text-ink">{a ? accountName(a, language) : "—"}</Bdi>
                        {l.description && <span className="block text-xs text-ink-3 sm:hidden"><Bdi>{l.description}</Bdi></span>}
                      </td>
                      <td className="hidden py-2 pe-3 text-ink-2 sm:table-cell"><Bdi>{l.description ?? ""}</Bdi></td>
                      <td className="whitespace-nowrap py-2 text-end"><Ltr>{l.debit ? money(l.debit) : ""}</Ltr></td>
                      <td className="whitespace-nowrap py-2 text-end"><Ltr>{l.credit ? money(l.credit) : ""}</Ltr></td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-line font-medium">
                  <td className="py-2" colSpan={2}>{t("finance.je.totals")}</td>
                  <td className="whitespace-nowrap py-2 text-end sm:table-cell"><Ltr>{money(totals.debit)}</Ltr></td>
                  <td className="whitespace-nowrap py-2 text-end"><Ltr>{money(totals.credit)}</Ltr></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      <Modal title={t("finance.je.reverseTitle")} open={modal === "reverse"} onClose={() => setModal(null)}>
        {modal === "reverse" && (
          <ReverseForm
            entry={e}
            today={todayIn(tenant.timezone)}
            onCancel={() => setModal(null)}
            onDone={(newId) => { setModal(null); refresh(); toast.success(t("finance.je.reversed")); navigate(`/finance/journal/${newId}`); }}
          />
        )}
      </Modal>
      <Modal title={t("finance.je.deleteTitle")} open={modal === "delete"} onClose={() => setModal(null)}>
        <p className="text-sm text-ink-2">{t("finance.je.deleteConfirm", { number: ltrText(e.doc_number ?? "") })}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setModal(null)}>{t("action.cancel")}</Button>
          <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>{t("action.delete")}</Button>
        </div>
      </Modal>
    </div>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-medium text-ink-3">{label}</div>
      <div className="mt-1 text-sm text-ink">{children}</div>
    </div>
  );
}

function Totals({ debit, credit, difference, money }: { debit: number; credit: number; difference: number; money: (n: number) => string }) {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
      <span className="text-ink-2">{t("finance.je.debit")}: <Ltr className="font-medium text-ink">{money(debit)}</Ltr></span>
      <span className="text-ink-2">{t("finance.je.credit")}: <Ltr className="font-medium text-ink">{money(credit)}</Ltr></span>
      {difference === 0 && debit > 0 ? (
        <Badge tone="green">{t("finance.je.balanced")}</Badge>
      ) : (
        <Badge tone="yellow">{t("finance.je.outBy", { amount: ltrText(money(Math.abs(difference))) })}</Badge>
      )}
    </div>
  );
}

function ReverseForm({ entry, today, onDone, onCancel }: {
  entry: JournalEntry; today: string; onDone: (id: string) => void; onCancel: () => void;
}) {
  const t = useT();
  const [date, setDate] = useState(today);
  const [memo, setMemo] = useState("");
  const { error, saving, run } = useSubmit(onDone);
  const submit = onSubmit(() => void run(async () => {
    const { data, error: e } = await supabase.rpc("finance_reverse_entry", {
      p_entry_id: entry.id, p_date: date, p_memo: textOrNull(memo) ?? undefined,
    });
    if (e) throw wrapDbError(e);
    return data as string;
  }));
  return (
    <form className="space-y-4" onSubmit={submit}>
      <p className="text-sm text-ink-2">{t("finance.je.reverseHint", { number: ltrText(entry.doc_number ?? "") })}</p>
      <Field label={t("finance.je.reverseDate")} required>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
      </Field>
      <Field label={t("finance.je.memo")}>
        <Input value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={500}
          placeholder={t("finance.je.reverseMemo", { number: ltrText(entry.doc_number ?? "") })} />
      </Field>
      <FormError message={error} />
      <FormActions saving={saving} label={t("finance.je.reverse")} onCancel={onCancel} />
    </form>
  );
}
