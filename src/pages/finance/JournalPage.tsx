import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { NotebookPen, Plus } from "lucide-react";
import { insertRow, listPage, sanitizeSearch } from "../../lib/db";
import { formatDate, formatMoney } from "../../lib/format";
import { ENTRY_STATUSES, SOURCE_TYPES, type EntryStatus, type SourceType } from "../../../shared/finance";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useT } from "../../i18n";
import { Badge, Bdi, Button, EmptyState, ErrorState, Field, Input, LoadingState, Ltr, Modal, Pagination, Select } from "../../components/ui";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { FormActions, FormError, onSubmit, textOrNull, useSubmit } from "./forms";
import { ENTRY_SELECT, entryTone, todayIn, type JournalEntry } from "./types";

const PAGE_SIZE = 25;

export default function JournalPage() {
  const t = useT();
  const navigate = useNavigate();
  const tenant = useTenant();
  const { isManager } = useAuth();
  const [status, setStatus] = useState<"" | EntryStatus>("");
  const [source, setSource] = useState<"" | SourceType>("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [creating, setCreating] = useState(false);
  const term = sanitizeSearch(search);

  const listQ = useQuery({
    queryKey: ["journal_entries", "list", { page, status, source, term }],
    queryFn: () =>
      listPage<JournalEntry>("journal_entries", page, PAGE_SIZE, (q) => {
        let f = q.select(ENTRY_SELECT);
        if (status) f = f.eq("status", status);
        if (source) f = f.eq("source_type", source);
        if (term) f = f.or(`doc_number.ilike.%${term}%,memo.ilike.%${term}%`);
        return f.order("entry_date", { ascending: false }).order("number", { ascending: false });
      }),
  });

  const columns: Array<DataTableColumn<JournalEntry>> = [
    {
      id: "number",
      header: t("finance.je.number"),
      cell: (e) => <Ltr className="whitespace-nowrap font-medium text-brand-700">{e.doc_number}</Ltr>,
      exportValue: (e) => e.doc_number ?? "",
    },
    {
      id: "date",
      header: t("finance.je.date"),
      cell: (e) => <span className="whitespace-nowrap text-ink-2">{formatDate(e.entry_date)}</span>,
      sortValue: (e) => e.entry_date,
      exportValue: (e) => e.entry_date,
    },
    {
      id: "memo",
      header: t("finance.je.memo"),
      cell: (e) => <span className="block max-w-80 truncate text-ink"><Bdi>{e.memo || "—"}</Bdi></span>,
      exportValue: (e) => e.memo ?? "",
    },
    {
      id: "source",
      header: t("finance.je.source"),
      minBreakpoint: "md",
      cell: (e) => (
        <span className="whitespace-nowrap text-ink-2">
          {t(`finance.source.${e.source_type}`)}
          {e.reversal_of && <span className="text-ink-3"> · {t("finance.je.reversal")}</span>}
        </span>
      ),
      exportValue: (e) => e.source_type,
    },
    {
      id: "total",
      header: t("finance.je.total"),
      align: "end",
      minBreakpoint: "sm",
      cell: (e) => <Ltr className="whitespace-nowrap text-ink">{formatMoney(e.total, tenant.currency)}</Ltr>,
      sortValue: (e) => e.total,
      exportValue: (e) => e.total,
    },
    {
      id: "status",
      header: t("finance.je.status"),
      cell: (e) => <span className="whitespace-nowrap"><Badge tone={entryTone[e.status]}>{t(`finance.entryStatus.${e.status}`)}</Badge></span>,
      exportValue: (e) => e.status,
    },
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} placeholder={t("finance.je.search")}
          className="w-full sm:max-w-64" />
        <div className="w-[calc(50%-0.375rem)] sm:w-40">
          <Select value={status} onChange={(e) => { setStatus(e.target.value as "" | EntryStatus); setPage(0); }} aria-label={t("finance.je.status")}>
            <option value="">{t("finance.je.anyStatus")}</option>
            {ENTRY_STATUSES.map((s) => <option key={s} value={s}>{t(`finance.entryStatus.${s}`)}</option>)}
          </Select>
        </div>
        <div className="w-[calc(50%-0.375rem)] sm:w-44">
          <Select value={source} onChange={(e) => { setSource(e.target.value as "" | SourceType); setPage(0); }} aria-label={t("finance.je.source")}>
            <option value="">{t("finance.je.anySource")}</option>
            {SOURCE_TYPES.map((s) => <option key={s} value={s}>{t(`finance.source.${s}`)}</option>)}
          </Select>
        </div>
        {isManager && (
          <Button className="ms-auto" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> {t("finance.je.new")}
          </Button>
        )}
      </div>
      {listQ.isLoading && <LoadingState />}
      {listQ.error && <ErrorState message={(listQ.error as Error).message} />}
      {listQ.data && (
        <DataTable<JournalEntry>
          tableId="journal_entries"
          exportName="journal"
          rows={listQ.data.rows}
          rowKey={(e) => e.id}
          columns={columns}
          onRowClick={(e) => navigate(`/finance/journal/${e.id}`)}
          empty={<EmptyState icon={<NotebookPen className="h-10 w-10" />} title={t("finance.journal.empty")} description={t("finance.journal.emptyHint")} />}
          footer={<Pagination page={page} pageSize={PAGE_SIZE} total={listQ.data.total} onPage={setPage} />}
        />
      )}
      <Modal title={t("finance.je.newTitle")} open={creating} onClose={() => setCreating(false)}>
        {creating && (
          <NewEntryForm
            today={todayIn(tenant.timezone)}
            onCancel={() => setCreating(false)}
            onDone={(id) => { setCreating(false); navigate(`/finance/journal/${id}`); }}
          />
        )}
      </Modal>
    </div>
  );
}

function NewEntryForm({ today, onDone, onCancel }: { today: string; onDone: (id: string) => void; onCancel: () => void }) {
  const t = useT();
  const [date, setDate] = useState(today);
  const [memo, setMemo] = useState("");
  const { error, saving, run } = useSubmit(onDone);
  const submit = onSubmit(() => void run(async () =>
    (await insertRow<{ id: string }>("journal_entries", { entry_date: date, memo: textOrNull(memo) })).id));
  return (
    <form className="space-y-4" onSubmit={submit}>
      <p className="text-sm text-ink-2">{t("finance.je.newHint")}</p>
      <Field label={t("finance.je.date")} required>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
      </Field>
      <Field label={t("finance.je.memo")}>
        <Input value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={500} />
      </Field>
      <FormError message={error} />
      <FormActions saving={saving} label={t("finance.je.create")} onCancel={onCancel} />
    </form>
  );
}
