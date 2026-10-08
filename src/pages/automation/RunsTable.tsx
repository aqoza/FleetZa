import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import { listPage } from "../../lib/db";
import { formatDateTime } from "../../lib/format";
import { useTenant } from "../../context/AuthContext";
import { useT } from "../../i18n";
import { Badge, Bdi, EmptyState, ErrorState, LoadingState, Ltr, Pagination, Select } from "../../components/ui";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { EVENT_CATALOG } from "../../lib/automation";
import { STATUS_TONE, eventKey, statusKey } from "./labels";
import type { AutomationRun, RunStatus } from "./types";

const PAGE_SIZE = 25;

type RunRow = AutomationRun & { rule: { name: string } | null };

/** The run log: every rule's, or one rule's when `ruleId` is set. */
export function RunsTable({ ruleId, pageSize = PAGE_SIZE }: { ruleId?: string; pageSize?: number }) {
  const t = useT();
  const tenant = useTenant();
  const [status, setStatus] = useState<"all" | RunStatus>("all");
  const [event, setEvent] = useState("all");
  const [page, setPage] = useState(0);

  const { data, isLoading, error } = useQuery({
    queryKey: ["automation_runs", "list", { ruleId, status, event, page, pageSize }],
    queryFn: () =>
      listPage<RunRow>("automation_runs", page, pageSize, (q) => {
        let f = q.select("*, rule:automation_rules(name)");
        if (ruleId) f = f.eq("rule_id", ruleId);
        if (status !== "all") f = f.eq("status", status);
        if (event !== "all") f = f.eq("event", event);
        return f.order("created_at", { ascending: false });
      }),
  });
  const rows = data?.rows ?? [];
  const filtersOn = status !== "all" || event !== "all";

  const columns: Array<DataTableColumn<RunRow>> = [
    {
      id: "when",
      header: t("automation.when"),
      cell: (r) => (
        <span className="whitespace-nowrap text-ink-2"><Ltr>{formatDateTime(r.created_at, tenant.timezone)}</Ltr></span>
      ),
      sortValue: (r) => r.created_at,
      exportValue: (r) => r.created_at,
    },
    ...(ruleId
      ? []
      : [
          {
            id: "rule",
            header: t("automation.rule"),
            cell: (r) =>
              r.rule ? (
                <Link
                  to={`/automation/rules/${r.rule_id}`}
                  className="font-medium text-brand-700 hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Bdi>{r.rule.name}</Bdi>
                </Link>
              ) : (
                <span className="text-ink-3">{t("automation.deletedRule")}</span>
              ),
            sortValue: (r) => r.rule?.name ?? "",
            exportValue: (r) => r.rule?.name ?? "",
          } satisfies DataTableColumn<RunRow>,
        ]),
    {
      id: "event",
      header: t("automation.event"),
      minBreakpoint: "md",
      cell: (r) => <span className="text-ink-2">{t(eventKey(r.event))}</span>,
      sortValue: (r) => r.event,
      exportValue: (r) => r.event,
    },
    {
      id: "status",
      header: t("automation.result"),
      cell: (r) => <Badge tone={STATUS_TONE[r.status]}>{t(statusKey(r.status))}</Badge>,
      sortValue: (r) => r.status,
      exportValue: (r) => r.status,
    },
    {
      id: "actions_run",
      header: t("automation.actionsRun"),
      align: "end",
      minBreakpoint: "md",
      cell: (r) => <span className="tabular-nums text-ink-2"><Ltr>{r.actions_run}</Ltr></span>,
      sortValue: (r) => r.actions_run,
      exportValue: (r) => r.actions_run,
    },
    {
      id: "detail",
      header: t("automation.detail"),
      minBreakpoint: "lg",
      // Engine text (an error message or a skip reason) is English from Postgres.
      cell: (r) => <span className="text-xs text-ink-3"><Ltr>{r.detail ?? "—"}</Ltr></span>,
      exportValue: (r) => r.detail ?? "",
    },
  ];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as "all" | RunStatus);
            setPage(0);
          }}
          className="w-full sm:w-auto sm:max-w-44"
          aria-label={t("automation.result")}
        >
          <option value="all">{t("automation.allStatuses")}</option>
          {(["success", "skipped", "failed"] as const).map((s) => (
            <option key={s} value={s}>{t(statusKey(s))}</option>
          ))}
        </Select>
        {!ruleId && (
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
        )}
      </div>
      {isLoading && <LoadingState />}
      {error && <ErrorState message={(error as Error).message} />}
      {!isLoading && !error && (
        <DataTable<RunRow>
          tableId={ruleId ? "automation-rule-runs" : "automation-runs"}
          exportName="automation-runs"
          rows={rows}
          rowKey={(r) => r.id}
          columns={columns}
          empty={
            <EmptyState
              icon={<History className="h-10 w-10" />}
              title={t(filtersOn ? "automation.runsEmptyFilteredTitle" : "automation.runsEmptyTitle")}
              description={t(filtersOn ? "automation.runsEmptyFilteredDesc" : "automation.runsEmptyDesc")}
            />
          }
          footer={<Pagination page={page} pageSize={pageSize} total={data?.total ?? 0} onPage={setPage} />}
        />
      )}
    </>
  );
}

export default function RunsPage() {
  return <RunsTable />;
}
