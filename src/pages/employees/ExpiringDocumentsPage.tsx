import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { FileCheck2 } from "lucide-react";
import { listPage } from "../../lib/db";
import { formatDate } from "../../lib/format";
import {
  DOCUMENT_WINDOW_DAYS, employeeDocuments, employeeName, type EmployeeDocument,
} from "../../lib/employees";
import { useTenant } from "../../context/AuthContext";
import { useI18n, useT } from "../../i18n";
import { Bdi, EmptyState, ErrorState, LoadingState, Pagination } from "../../components/ui";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { DocumentBadge, todayIso } from "./shared";
import { documentKinds } from "./labels";
import type { Employee } from "./types";

const PAGE_SIZE = 25;

type Row = { employee: Employee; doc: EmployeeDocument };

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function ExpiringDocumentsPage() {
  const t = useT();
  const { language } = useI18n();
  const tenant = useTenant();
  const [page, setPage] = useState(0);
  const today = todayIso();
  const horizon = addDays(today, DOCUMENT_WINDOW_DAYS);

  // Server-side: employees with at least one document inside the window.
  // The page then lists each qualifying document as its own row.
  const { data, isLoading, error } = useQuery({
    queryKey: ["employees", "expiring-documents", { page, horizon }],
    queryFn: () =>
      listPage<Employee>("employees", page, PAGE_SIZE, (q) =>
        q
          .neq("status", "terminated")
          .or(
            `passport_expiry.lte.${horizon},residence_permit_expiry.lte.${horizon},` +
              `work_permit_expiry.lte.${horizon}`,
          )
          .order("first_name"),
      ),
  });

  const rows = useMemo<Row[]>(
    () =>
      (data?.rows ?? [])
        .flatMap((employee) =>
          employeeDocuments(employee, today)
            .filter((doc) => doc.days <= DOCUMENT_WINDOW_DAYS)
            .map((doc) => ({ employee, doc })),
        )
        .sort((a, b) => a.doc.days - b.doc.days),
    [data, today],
  );

  const columns: Array<DataTableColumn<Row>> = [
    {
      id: "employee",
      header: t("employees.employee"),
      cell: ({ employee: e }) => (
        <Link to={`/employees/${e.id}`} className="font-medium text-brand-700 hover:underline">
          <Bdi>{employeeName(e, language)}</Bdi>
        </Link>
      ),
      sortValue: ({ employee: e }) => employeeName(e, language),
      exportValue: ({ employee: e }) => employeeName(e),
    },
    {
      id: "document",
      header: t("employees.document"),
      cell: ({ doc }) => <span className="text-ink-2">{t(documentKinds[doc.kind])}</span>,
      sortValue: ({ doc }) => t(documentKinds[doc.kind]),
      exportValue: ({ doc }) => t(documentKinds[doc.kind]),
    },
    {
      id: "expiry",
      header: t("employees.expiry"),
      minBreakpoint: "md",
      cell: ({ doc }) => <span className="text-ink-2 tabular-nums">{formatDate(doc.expiry, tenant.timezone)}</span>,
      sortValue: ({ doc }) => doc.expiry,
      exportValue: ({ doc }) => doc.expiry,
    },
    {
      id: "state",
      header: t("common.status"),
      cell: ({ doc }) => <DocumentBadge doc={doc} />,
      sortValue: ({ doc }) => doc.days,
      exportValue: ({ doc }) => doc.days,
    },
  ];

  return (
    <>
      <p className="mb-4 text-sm text-ink-2">{t("employees.docsHint", { count: DOCUMENT_WINDOW_DAYS })}</p>
      {isLoading && <LoadingState />}
      {error && <ErrorState message={(error as Error).message} />}
      {!isLoading && !error && (
        <DataTable<Row>
          tableId="employee-documents"
          exportName="expiring-documents"
          rows={rows}
          rowKey={(r) => `${r.employee.id}:${r.doc.kind}`}
          columns={columns}
          empty={
            <EmptyState
              icon={<FileCheck2 className="h-10 w-10" />}
              title={t("employees.docsEmptyTitle")}
              description={t("employees.docsEmpty", { count: DOCUMENT_WINDOW_DAYS })}
            />
          }
          footer={<Pagination page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onPage={setPage} />}
        />
      )}
    </>
  );
}
