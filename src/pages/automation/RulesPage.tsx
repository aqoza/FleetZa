import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pause, Pencil, Play, Plus, Trash2, Workflow } from "lucide-react";
import { deleteRow, listPage, sanitizeSearch, updateRow } from "../../lib/db";
import { bdiText } from "../../lib/bidi";
import { formatDateTime } from "../../lib/format";
import { EVENT_CATALOG } from "../../lib/automation";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useT, useTp } from "../../i18n";
import {
  Badge, Bdi, Button, EmptyState, ErrorState, Input, LoadingState, Ltr, Modal, Pagination, Select,
} from "../../components/ui";
import { useToast } from "../../components/Toast";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { actionKey, eventKey } from "./labels";
import type { AutomationRule } from "./types";

const PAGE_SIZE = 25;

export default function RulesPage() {
  const t = useT();
  const tp = useTp();
  const tenant = useTenant();
  const navigate = useNavigate();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [event, setEvent] = useState("all");
  const [state, setState] = useState<"all" | "active" | "paused">("all");
  const [page, setPage] = useState(0);
  const [deleting, setDeleting] = useState<AutomationRule | null>(null);
  const [actionError, setActionError] = useState("");
  const term = sanitizeSearch(search);

  const { data, isLoading, error } = useQuery({
    queryKey: ["automation_rules", "list", { page, term, event, state }],
    queryFn: () =>
      listPage<AutomationRule>("automation_rules", page, PAGE_SIZE, (q) => {
        let f = q;
        if (event !== "all") f = f.eq("event", event);
        if (state !== "all") f = f.eq("active", state === "active");
        if (term) f = f.or(`name.ilike.%${term}%,description.ilike.%${term}%`);
        return f.order("name");
      }),
  });
  const rows = data?.rows ?? [];
  const filtersOn = term !== "" || event !== "all" || state !== "all";

  const onError = (err: unknown) => setActionError(err instanceof Error ? err.message : t("automation.saveFailed"));
  const toggle = useMutation({
    mutationFn: (r: AutomationRule) => updateRow("automation_rules", r.id, { active: !r.active }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["automation_rules"] });
      setActionError("");
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteRow("automation_rules", id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["automation_rules"] });
      void qc.invalidateQueries({ queryKey: ["automation_runs"] });
      setDeleting(null);
      setActionError("");
      toast.success(t("toast.deleted"));
    },
    onError: (err) => {
      onError(err);
      setDeleting(null);
    },
  });

  const columns: Array<DataTableColumn<AutomationRule>> = [
    {
      id: "name",
      header: t("automation.rule"),
      cell: (r) => (
        <div className="min-w-0">
          <Link to={`/automation/rules/${r.id}`} className="font-medium text-brand-700 hover:underline">
            <Bdi>{r.name}</Bdi>
          </Link>
          <div className="text-xs text-ink-3 md:hidden">{t(eventKey(r.event))}</div>
          {r.description && <div className="hidden truncate text-xs text-ink-3 md:block"><Bdi>{r.description}</Bdi></div>}
        </div>
      ),
      sortValue: (r) => r.name,
      exportValue: (r) => r.name,
    },
    {
      id: "event",
      header: t("automation.event"),
      minBreakpoint: "md",
      cell: (r) => (
        <div className="text-ink-2">
          <div>{t(eventKey(r.event))}</div>
          <div className="text-xs text-ink-3">
            {r.conditions.length === 0 ? t("automation.noConditions") : tp("automation.conditionCount", r.conditions.length)}
          </div>
        </div>
      ),
      sortValue: (r) => r.event,
      exportValue: (r) => r.event,
    },
    {
      id: "does",
      header: t("automation.does"),
      minBreakpoint: "lg",
      cell: (r) => (
        <div className="flex flex-wrap gap-1">
          {[...new Set(r.actions.map((a) => a.type))].map((type) => (
            <Badge key={type} tone="blue">{t(actionKey(type))}</Badge>
          ))}
        </div>
      ),
      exportValue: (r) => r.actions.map((a) => a.type).join(", "),
    },
    {
      id: "runs",
      header: t("automation.runs"),
      align: "end",
      minBreakpoint: "md",
      cell: (r) => <span className="tabular-nums text-ink-2"><Ltr>{r.run_count}</Ltr></span>,
      sortValue: (r) => r.run_count,
      exportValue: (r) => r.run_count,
    },
    {
      id: "last_run",
      header: t("automation.lastRun"),
      minBreakpoint: "xl",
      cell: (r) => (
        <span className="whitespace-nowrap text-ink-2">
          {r.last_run_at ? <Ltr>{formatDateTime(r.last_run_at, tenant.timezone)}</Ltr> : t("automation.never")}
        </span>
      ),
      sortValue: (r) => r.last_run_at ?? "",
      exportValue: (r) => r.last_run_at ?? "",
    },
    {
      id: "status",
      header: t("common.status"),
      cell: (r) =>
        r.active ? <Badge tone="green">{t("automation.active")}</Badge> : <Badge tone="slate">{t("automation.paused")}</Badge>,
      sortValue: (r) => (r.active ? 1 : 0),
      exportValue: (r) => (r.active ? t("automation.active") : t("automation.paused")),
    },
    ...(isManager
      ? [
          {
            id: "actions",
            header: "",
            align: "end",
            cell: (r) => (
              <div className="flex justify-end gap-1">
                <button
                  className="rounded p-1.5 text-ink-3 hover:bg-canvas hover:text-ink-2"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle.mutate(r);
                  }}
                  aria-label={r.active ? t("automation.pause") : t("automation.resume")}
                  title={r.active ? t("automation.pause") : t("automation.resume")}
                  disabled={toggle.isPending}
                >
                  {r.active ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </button>
                <button
                  className="rounded p-1.5 text-ink-3 hover:bg-canvas hover:text-ink-2"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/automation/rules/${r.id}`);
                  }}
                  aria-label={t("automation.editRule")}
                  title={t("action.edit")}
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  className="rounded p-1.5 text-ink-3 hover:bg-serious-soft hover:text-serious"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleting(r);
                  }}
                  aria-label={t("automation.deleteRule")}
                  title={t("action.delete")}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ),
          } satisfies DataTableColumn<AutomationRule>,
        ]
      : []),
  ];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          placeholder={t("automation.searchRules")}
          className="w-full sm:max-w-72"
        />
        <Select
          value={event}
          onChange={(e) => {
            setEvent(e.target.value);
            setPage(0);
          }}
          className="w-full sm:w-auto sm:max-w-72"
          aria-label={t("automation.event")}
        >
          <option value="all">{t("automation.allEvents")}</option>
          {EVENT_CATALOG.map((e) => (
            <option key={e.event} value={e.event}>{t(eventKey(e.event))}</option>
          ))}
        </Select>
        <Select
          value={state}
          onChange={(e) => {
            setState(e.target.value as "all" | "active" | "paused");
            setPage(0);
          }}
          className="w-full sm:w-auto sm:max-w-44"
          aria-label={t("common.status")}
        >
          <option value="all">{t("automation.allStates")}</option>
          <option value="active">{t("automation.activeOnly")}</option>
          <option value="paused">{t("automation.pausedOnly")}</option>
        </Select>
        {isManager && (
          <div className="ms-auto">
            <Button onClick={() => navigate("/automation/rules/new")}>
              <Plus className="h-4 w-4" /> {t("automation.newRule")}
            </Button>
          </div>
        )}
      </div>

      {isLoading && <LoadingState />}
      {error && <ErrorState message={(error as Error).message} />}
      {actionError && (
        <div className="mb-4">
          <ErrorState message={actionError} />
        </div>
      )}
      {!isLoading && !error && (
        <DataTable<AutomationRule>
          tableId="automation-rules"
          exportName="automation-rules"
          rows={rows}
          rowKey={(r) => r.id}
          onRowClick={(r) => navigate(`/automation/rules/${r.id}`)}
          columns={columns}
          empty={
            <EmptyState
              icon={<Workflow className="h-10 w-10" />}
              title={filtersOn ? t("automation.rulesEmptyFilteredTitle") : t("automation.rulesEmptyTitle")}
              description={filtersOn ? t("automation.rulesEmptyFilteredDesc") : t("automation.rulesEmptyDesc")}
              action={
                isManager && !filtersOn ? (
                  <Button onClick={() => navigate("/automation/rules/new")}>
                    <Plus className="h-4 w-4" /> {t("automation.newRule")}
                  </Button>
                ) : undefined
              }
            />
          }
          footer={<Pagination page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onPage={setPage} />}
        />
      )}

      <Modal title={t("automation.deleteRule")} open={!!deleting} onClose={() => setDeleting(null)}>
        {deleting && (
          <>
            <p className="text-sm text-ink-2">{t("automation.deleteConfirm", { name: bdiText(deleting.name) })}</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeleting(null)}>{t("action.cancel")}</Button>
              <Button variant="danger" onClick={() => remove.mutate(deleting.id)} loading={remove.isPending}>
                {t("automation.deleteRule")}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
