import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { MapPinned } from "lucide-react";
import { listPage } from "../../lib/db";
import { formatDateTime } from "../../lib/format";
import { employeeName } from "../../lib/employees";
import { mapsUrl } from "../../lib/field";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useI18n, useT, useTp } from "../../i18n";
import { Badge, Bdi, EmptyState, ErrorState, Input, LoadingState, Ltr, Pagination } from "../../components/ui";
import { Combobox } from "../../components/Combobox";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { useEmployeePicker } from "../employees/pickers";
import { CHECKIN_SELECT, type FieldCheckin } from "./types";

const PAGE_SIZE = 50;

/** Managers see everyone's check-ins; other members see their own (RLS). */
export default function CheckinsPage() {
  const t = useT();
  const tp = useTp();
  const { language } = useI18n();
  const tenant = useTenant();
  const { isManager } = useAuth();
  const [employee, setEmployee] = useState("");
  const [day, setDay] = useState("");
  const [page, setPage] = useState(0);
  const picker = useEmployeePicker(employee, { enabled: isManager });

  const { data, isLoading, error } = useQuery({
    queryKey: ["field_checkins", "list", { employee, day, page }],
    queryFn: () =>
      listPage<FieldCheckin>("field_checkins", page, PAGE_SIZE, (q) => {
        let f = q.select(CHECKIN_SELECT);
        if (employee) f = f.eq("employee_id", employee);
        if (day) {
          const start = new Date(`${day}T00:00`);
          const end = new Date(start.getTime() + 24 * 3600 * 1000);
          f = f.gte("at", start.toISOString()).lt("at", end.toISOString());
        }
        return f.order("at", { ascending: false });
      }),
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;

  const columns: Array<DataTableColumn<FieldCheckin>> = [
    ...(isManager
      ? [
          {
            id: "employee",
            header: t("field.col.assignee"),
            cell: (c: FieldCheckin) => (
              <>
                <span className="font-medium text-ink">{c.employee ? <Bdi>{employeeName(c.employee, language)}</Bdi> : t("common.dash")}</span>
                <div className="text-xs text-ink-3 tabular-nums sm:hidden"><Ltr>{formatDateTime(c.at, tenant.timezone)}</Ltr></div>
              </>
            ),
            sortValue: (c: FieldCheckin) => (c.employee ? employeeName(c.employee, language) : null),
            exportValue: (c: FieldCheckin) => (c.employee ? employeeName(c.employee) : ""),
          },
        ]
      : []),
    {
      id: "kind",
      header: t("field.col.kind"),
      cell: (c) => (
        <span className="whitespace-nowrap">
          <Badge tone={c.kind === "check_in" ? "green" : "slate"}>{t(`field.kind.${c.kind}`)}</Badge>
        </span>
      ),
      sortValue: (c) => c.kind,
      exportValue: (c) => c.kind,
    },
    {
      id: "time",
      header: t("field.col.time"),
      minBreakpoint: isManager ? "sm" : undefined,
      cell: (c) => <span className="whitespace-nowrap text-ink-2 tabular-nums"><Ltr>{formatDateTime(c.at, tenant.timezone)}</Ltr></span>,
      sortValue: (c) => c.at,
      exportValue: (c) => c.at,
    },
    {
      id: "task",
      header: t("field.col.task"),
      minBreakpoint: "md",
      cell: (c) =>
        c.task ? (
          <Link to={`/field/tasks/${c.task.id}`} className="text-brand-700 hover:underline">
            <Ltr>{c.task.doc_number ?? ""}</Ltr> <Bdi>{c.task.title}</Bdi>
          </Link>
        ) : (
          t("common.dash")
        ),
      exportValue: (c) => c.task?.doc_number ?? "",
    },
    {
      id: "location",
      header: t("field.col.location"),
      cell: (c) => {
        const link = mapsUrl(c.lat, c.lng);
        return link ? (
          <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 whitespace-nowrap text-brand-700 hover:underline">
            <MapPinned className="h-4 w-4" />
            <span className="hidden lg:inline"><Ltr>{`${Number(c.lat).toFixed(4)}, ${Number(c.lng).toFixed(4)}`}</Ltr></span>
          </a>
        ) : (
          t("common.dash")
        );
      },
      exportValue: (c) => (c.lat != null ? `${c.lat},${c.lng}` : ""),
    },
    {
      id: "accuracy",
      header: t("field.col.accuracy"),
      align: "end",
      minBreakpoint: "lg",
      cell: (c) => (c.accuracy_m != null ? <span className="tabular-nums text-ink-3"><Ltr>{`±${Math.round(Number(c.accuracy_m))} m`}</Ltr></span> : t("common.dash")),
      sortValue: (c) => (c.accuracy_m != null ? Number(c.accuracy_m) : null),
    },
    {
      id: "note",
      header: t("field.col.note"),
      minBreakpoint: "xl",
      cell: (c) => <span className="text-ink-2" dir="auto">{c.note ?? t("common.dash")}</span>,
      exportValue: (c) => c.note ?? "",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {isManager && (
          <div className="w-full sm:w-64">
            <Combobox
              {...picker}
              value={employee}
              onChange={(v) => {
                setEmployee(v);
                setPage(0);
              }}
              placeholder={t("field.filter.allEmployees")}
            />
          </div>
        )}
        <Input
          type="date"
          value={day}
          onChange={(e) => {
            setDay(e.target.value);
            setPage(0);
          }}
          className="max-w-44"
          dir="ltr"
          aria-label={t("field.col.time")}
        />
      </div>
      {isLoading && <LoadingState />}
      {error && <ErrorState message={(error as Error).message} />}
      {!isLoading && !error && (
        <DataTable<FieldCheckin>
          tableId="field-checkins"
          exportName="field-checkins"
          rows={rows}
          rowKey={(c) => c.id}
          columns={columns}
          toolbar={total > 0 ? <span className="text-sm text-ink-3 tabular-nums">{tp("field.checkinCount", total)}</span> : undefined}
          empty={<EmptyState icon={<MapPinned className="h-10 w-10" />} title={t("field.emptyCheckinsTitle")} />}
          footer={<Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />}
        />
      )}
    </div>
  );
}
