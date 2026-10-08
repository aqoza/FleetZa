import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import { listPage, wrapDbError } from "../../lib/db";
import { supabase } from "../../lib/supabase";
import { formatDateTime } from "../../lib/format";
import { useTenant } from "../../context/AuthContext";
import { useT, useTp, type MessageKey } from "../../i18n";
import {
  Badge, Bdi, Button, EmptyState, ErrorState, Input, LoadingState, Ltr, Modal, Pagination, Select, type BadgeTone,
} from "../../components/ui";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { memberName, tableLabel, useSecurityMembers } from "./hooks";
import type { AuditAction, AuditEvent } from "./types";

const PAGE_SIZE = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIONS: AuditAction[] = ["insert", "update", "delete"];
const ACTION_TONE: Record<AuditAction, BadgeTone> = { insert: "green", update: "blue", delete: "red" };
const actionKey = (a: AuditAction) => `security.action.${a}` as MessageKey;

/** Fields an update touched (bookkeeping columns left out). */
const NOISE = new Set(["updated_at", "updated_by"]);
function changedFields(e: AuditEvent): string[] {
  if (!e.diff) return [];
  return Object.keys(e.diff).filter((k) => !NOISE.has(k)).sort();
}

function display(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export default function AuditLogPage() {
  const t = useT();
  const tp = useTp();
  const tenant = useTenant();
  const members = useSecurityMembers();
  const [table, setTable] = useState("all");
  const [action, setAction] = useState<"all" | AuditAction>("all");
  const [actor, setActor] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [entity, setEntity] = useState("");
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<AuditEvent | null>(null);
  const entityId = entity.trim();
  const entityOk = entityId === "" || UUID.test(entityId);

  const tablesQ = useQuery({
    queryKey: ["audit_tables"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("audit_tables");
      if (error) throw wrapDbError(error);
      return (data ?? []) as string[];
    },
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ["audit_events", "list", { table, action, actor, from, to, entityId: entityOk ? entityId : "", page }],
    queryFn: () =>
      listPage<AuditEvent>("audit_events", page, PAGE_SIZE, (q) => {
        let f = q;
        if (table !== "all") f = f.eq("table_name", table);
        if (action !== "all") f = f.eq("action", action);
        if (actor === "system") f = f.is("actor", null);
        else if (actor !== "all") f = f.eq("actor", actor);
        if (from) f = f.gte("at", new Date(`${from}T00:00:00`).toISOString());
        if (to) f = f.lt("at", new Date(new Date(`${to}T00:00:00`).getTime() + 86_400_000).toISOString());
        if (entityOk && entityId) f = f.eq("row_id", entityId);
        return f.order("at", { ascending: false }).order("id", { ascending: false });
      }),
  });
  const rows = data?.rows ?? [];
  const filtersOn = table !== "all" || action !== "all" || actor !== "all" || !!from || !!to || !!entityId;

  const who = (id: string | null) => {
    if (!id) return t("security.system");
    const m = members.byId.get(id);
    return m ? memberName(m) : id.slice(0, 8);
  };
  const reset = (fn: () => void) => {
    fn();
    setPage(0);
  };
  const clear = () =>
    reset(() => {
      setTable("all");
      setAction("all");
      setActor("all");
      setFrom("");
      setTo("");
      setEntity("");
    });

  const columns: Array<DataTableColumn<AuditEvent>> = [
    {
      id: "at",
      header: t("security.when"),
      cell: (e) => <span className="whitespace-nowrap text-ink-2"><Ltr>{formatDateTime(e.at, tenant.timezone)}</Ltr></span>,
      sortValue: (e) => e.at,
      exportValue: (e) => e.at,
    },
    {
      id: "who",
      header: t("security.who"),
      minBreakpoint: "md",
      cell: (e) => <span className="text-ink-2"><Bdi>{who(e.actor)}</Bdi></span>,
      sortValue: (e) => who(e.actor),
      exportValue: (e) => who(e.actor),
    },
    {
      id: "what",
      header: t("security.what"),
      cell: (e) => (
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={ACTION_TONE[e.action]}>{t(actionKey(e.action))}</Badge>
            <span className="text-ink">{tableLabel(t, e.table_name)}</span>
          </div>
          <div className="mt-0.5 text-xs text-ink-3 md:hidden"><Bdi>{who(e.actor)}</Bdi></div>
        </div>
      ),
      sortValue: (e) => `${e.table_name}:${e.action}`,
      exportValue: (e) => `${e.action} ${e.table_name}`,
    },
    {
      id: "record",
      header: t("security.record"),
      minBreakpoint: "lg",
      cell: (e) =>
        e.row_id ? (
          <button
            type="button"
            className="font-mono text-xs text-brand-700 hover:underline"
            title={t("security.showRecordHistory")}
            onClick={(ev) => {
              ev.stopPropagation();
              reset(() => setEntity(e.row_id ?? ""));
            }}
          >
            <Ltr>{e.row_id.slice(0, 8)}</Ltr>
          </button>
        ) : (
          <span className="text-ink-3">—</span>
        ),
      exportValue: (e) => e.row_id ?? "",
    },
    {
      id: "changes",
      header: t("security.changes"),
      minBreakpoint: "md",
      cell: (e) => {
        if (e.action !== "update") return <span className="text-ink-3">—</span>;
        const fields = changedFields(e);
        return (
          <span className="text-xs text-ink-2" title={fields.join(", ")}>
            {fields.length <= 3 ? <Ltr>{fields.join(", ")}</Ltr> : tp("security.fieldCount", fields.length)}
          </span>
        );
      },
      exportValue: (e) => changedFields(e).join(" "),
    },
  ];

  return (
    <>
      <div className="mb-4 grid grid-cols-2 items-end gap-3 sm:flex sm:flex-wrap">
        <Select
          value={table}
          onChange={(e) => reset(() => setTable(e.target.value))}
          className="col-span-2 w-full sm:w-auto sm:max-w-52"
          aria-label={t("security.record")}
        >
          <option value="all">{t("security.allTables")}</option>
          {(tablesQ.data ?? []).map((name) => (
            <option key={name} value={name}>{tableLabel(t, name)}</option>
          ))}
        </Select>
        <Select
          value={action}
          onChange={(e) => reset(() => setAction(e.target.value as "all" | AuditAction))}
          className="w-full sm:w-auto sm:max-w-40"
          aria-label={t("security.what")}
        >
          <option value="all">{t("security.allActions")}</option>
          {ACTIONS.map((a) => (
            <option key={a} value={a}>{t(actionKey(a))}</option>
          ))}
        </Select>
        <Select
          value={actor}
          onChange={(e) => reset(() => setActor(e.target.value))}
          className="w-full sm:w-auto sm:max-w-52"
          aria-label={t("security.who")}
        >
          <option value="all">{t("security.allActors")}</option>
          <option value="system">{t("security.system")}</option>
          {(members.data ?? []).map((m) => (
            <option key={m.id} value={m.id}>{memberName(m)}</option>
          ))}
        </Select>
        <label className="flex w-full flex-col gap-1 text-xs text-ink-3 sm:w-auto sm:flex-row sm:items-center sm:gap-2 sm:text-sm">
          <span>{t("security.from")}</span>
          <Input type="date" value={from} max={to || undefined} onChange={(e) => reset(() => setFrom(e.target.value))} dir="ltr" className="sm:w-40" />
        </label>
        <label className="flex w-full flex-col gap-1 text-xs text-ink-3 sm:w-auto sm:flex-row sm:items-center sm:gap-2 sm:text-sm">
          <span>{t("security.to")}</span>
          <Input type="date" value={to} min={from || undefined} onChange={(e) => reset(() => setTo(e.target.value))} dir="ltr" className="sm:w-40" />
        </label>
        <Input
          value={entity}
          onChange={(e) => reset(() => setEntity(e.target.value))}
          placeholder={t("security.entityIdPlaceholder")}
          aria-label={t("security.entityId")}
          dir="ltr"
          className={`col-span-2 w-full text-xs sm:w-80 ${entityOk ? "" : "border-serious"}`}
        />
        {filtersOn && (
          <Button variant="ghost" className="col-span-2" onClick={clear}>{t("security.clearFilters")}</Button>
        )}
      </div>

      {isLoading && <LoadingState />}
      {error && <ErrorState message={(error as Error).message} />}
      {!isLoading && !error && (
        <DataTable<AuditEvent>
          tableId="audit-log"
          exportName="audit-log"
          rows={rows}
          rowKey={(e) => String(e.id)}
          onRowClick={(e) => setOpen(e)}
          columns={columns}
          empty={
            <EmptyState
              icon={<History className="h-10 w-10" />}
              title={filtersOn ? t("security.auditEmptyFilteredTitle") : t("security.auditEmptyTitle")}
              description={filtersOn ? t("security.auditEmptyFilteredDesc") : t("security.auditEmptyDesc")}
            />
          }
          footer={<Pagination page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onPage={setPage} />}
        />
      )}

      <Modal title={t("security.diffTitle")} open={!!open} onClose={() => setOpen(null)} wide>
        {open && <AuditDiff event={open} who={who(open.actor)} />}
      </Modal>
    </>
  );
}

function AuditDiff({ event, who }: { event: AuditEvent; who: string }) {
  const t = useT();
  const tenant = useTenant();
  const isUpdate = event.action === "update";
  const entries = Object.entries(event.diff ?? {}).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-ink-3">{t("security.when")}</dt>
        <dd className="text-ink"><Ltr>{formatDateTime(event.at, tenant.timezone)}</Ltr></dd>
        <dt className="text-ink-3">{t("security.who")}</dt>
        <dd className="text-ink"><Bdi>{who}</Bdi></dd>
        <dt className="text-ink-3">{t("security.what")}</dt>
        <dd className="text-ink">
          {t(actionKey(event.action))} · {tableLabel(t, event.table_name)}
        </dd>
        {event.row_id && (
          <>
            <dt className="text-ink-3">{t("security.entityId")}</dt>
            <dd className="break-all font-mono text-xs text-ink-2"><Ltr>{event.row_id}</Ltr></dd>
          </>
        )}
      </dl>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-sm">
          <thead className="bg-canvas text-xs uppercase text-ink-3">
            <tr>
              <th className="px-3 py-2 text-start font-medium">{t("security.field")}</th>
              {isUpdate ? (
                <>
                  <th className="px-3 py-2 text-start font-medium">{t("security.before")}</th>
                  <th className="px-3 py-2 text-start font-medium">{t("security.after")}</th>
                </>
              ) : (
                <th className="px-3 py-2 text-start font-medium">{t("security.value")}</th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {entries.map(([field, value]) => {
              const pair = (isUpdate ? value : null) as { old?: unknown; new?: unknown } | null;
              return (
                <tr key={field} className="align-top">
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-ink-2"><Ltr>{field}</Ltr></td>
                  {isUpdate ? (
                    <>
                      <td className="max-w-xs break-words px-3 py-2 text-serious"><Bdi>{display(pair?.old)}</Bdi></td>
                      <td className="max-w-xs break-words px-3 py-2 text-good"><Bdi>{display(pair?.new)}</Bdi></td>
                    </>
                  ) : (
                    <td className="max-w-md break-words px-3 py-2 text-ink"><Bdi>{display(value)}</Bdi></td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
