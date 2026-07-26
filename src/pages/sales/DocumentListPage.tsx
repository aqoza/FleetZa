/**
 * The list surface shared by quotes, sales orders and invoices. All three are
 * the same table — number, customer, dates, status, total — so they are one
 * component parameterised by the columns that actually differ, rather than
 * three near-identical files (docs/ARCHITECTURE_REVIEW.md §5-F).
 */
import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { listPage, listRows, sanitizeSearch, type TableName } from "../../lib/db";
import { formatDate, formatMoney } from "../../lib/format";
import type { Customer } from "../../lib/types";
import { useT, type MessageKey } from "../../i18n";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  PageHeader,
  Pagination,
  Select,
  type BadgeTone,
} from "../../components/ui";
import { DataTable, type DataTableColumn } from "../../components/DataTable";

const PAGE_SIZE = 25;

/** The document columns every sales list reads. */
export interface ListedDocument {
  id: string;
  doc_number: string;
  customer_id: string;
  title: string | null;
  customer_reference: string | null;
  status: string;
  currency: string;
  total: number;
}

export interface DocumentListConfig<T extends ListedDocument> {
  table: TableName;
  /** Persisted column-chooser + CSV name. */
  tableId: string;
  /** Detail route prefix, e.g. "/sales/quotes". */
  routeBase: string;
  title: string;
  subtitle: string;
  searchPlaceholder: string;
  allStatusesLabel: string;
  statusMeta: Record<string, { labelKey: MessageKey; tone: BadgeTone }>;
  /** Primary date column: DB column + header + accessor. */
  primaryDate: { column: string; header: string; value: (row: T) => string };
  /** Type-specific columns appended before status/total. */
  extraColumns?: Array<DataTableColumn<T>>;
  /** Rendered in the toolbar, e.g. the invoice "overdue only" toggle. */
  extraFilters?: ReactNode;
  /** Additional PostgREST predicate (already-applied filters compose). */
  extraFilter?: (q: never) => never;
  newAction?: ReactNode;
  emptyIcon: ReactNode;
  emptyTitle: string;
  emptyDesc: string;
  emptyFilteredTitle: string;
  emptyFilteredDesc: string;
  /** Row-level status override, e.g. expired quotes / overdue invoices. */
  effectiveStatus?: (row: T) => string;
}

export function DocumentListPage<T extends ListedDocument>({
  config,
}: {
  config: DocumentListConfig<T>;
}) {
  const t = useT();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(0);

  const term = sanitizeSearch(search);

  const { data, isLoading, error } = useQuery({
    queryKey: [config.table, "list", { page, term, status: statusFilter }],
    queryFn: () =>
      listPage<T>(config.table, page, PAGE_SIZE, (q) => {
        let f = q;
        if (statusFilter !== "all") f = f.eq("status", statusFilter);
        if (term) {
          f = f.or(
            `doc_number.ilike.%${term}%,title.ilike.%${term}%,` +
              `customer_reference.ilike.%${term}%`,
          );
        }
        return f.order(config.primaryDate.column, { ascending: false }).order("number", {
          ascending: false,
        });
      }),
  });

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const total = data?.total ?? 0;

  // Customer names for the current page only — same bounded join the
  // customers list uses for its contact preview.
  const customerIds = useMemo(
    () => [...new Set(rows.map((r) => r.customer_id))],
    [rows],
  );
  const { data: customers } = useQuery({
    queryKey: ["customers", "names", customerIds],
    queryFn: () =>
      listRows<Pick<Customer, "id" | "name">>("customers", (q) =>
        q.select("id, name").in("id", customerIds),
      ),
    enabled: customerIds.length > 0,
  });
  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of customers ?? []) map.set(c.id, c.name);
    return map;
  }, [customers]);

  const filtersOn = term !== "" || statusFilter !== "all";

  const statusOf = (row: T) => config.effectiveStatus?.(row) ?? row.status;
  const statusLabel = (row: T) => {
    const meta = config.statusMeta[statusOf(row)];
    return meta ? t(meta.labelKey) : statusOf(row);
  };

  const columns: Array<DataTableColumn<T>> = [
    {
      id: "number",
      header: t("sales.doc.number"),
      cell: (row) => (
        <>
          <Link
            to={`${config.routeBase}/${row.id}`}
            className="font-medium text-brand-700 hover:underline tabular-nums"
          >
            {row.doc_number}
          </Link>
          {row.title && <div className="text-xs text-ink-3">{row.title}</div>}
        </>
      ),
      sortValue: (row) => row.doc_number,
      exportValue: (row) => row.doc_number,
    },
    {
      id: "customer",
      header: t("sales.doc.customer"),
      cell: (row) => (
        <Link
          to={`/customers/${row.customer_id}`}
          className="text-ink-2 hover:text-brand-700 hover:underline"
        >
          {nameById.get(row.customer_id) ?? "—"}
        </Link>
      ),
      sortValue: (row) => nameById.get(row.customer_id) ?? null,
      exportValue: (row) => nameById.get(row.customer_id) ?? "",
    },
    {
      id: "primaryDate",
      header: config.primaryDate.header,
      minBreakpoint: "sm",
      cell: (row) => (
        <span className="text-ink-2">{formatDate(config.primaryDate.value(row))}</span>
      ),
      sortValue: (row) => config.primaryDate.value(row),
      exportValue: (row) => config.primaryDate.value(row),
    },
    ...(config.extraColumns ?? []),
    {
      id: "status",
      header: t("common.status"),
      cell: (row) => {
        const meta = config.statusMeta[statusOf(row)];
        return <Badge tone={meta?.tone ?? "slate"}>{statusLabel(row)}</Badge>;
      },
      sortValue: (row) => statusLabel(row),
      exportValue: (row) => statusLabel(row),
    },
    {
      id: "total",
      header: t("sales.doc.total"),
      align: "end",
      cell: (row) => (
        <span className="font-medium text-ink">{formatMoney(row.total, row.currency)}</span>
      ),
      sortValue: (row) => row.total,
      exportValue: (row) => row.total,
    },
  ];

  return (
    <>
      <PageHeader title={config.title} description={config.subtitle} actions={config.newAction} />

      <div className="mb-4 flex flex-wrap gap-3">
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          placeholder={config.searchPlaceholder}
          className="max-w-80"
        />
        <Select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(0);
          }}
          className="max-w-48"
        >
          <option value="all">{config.allStatusesLabel}</option>
          {Object.entries(config.statusMeta)
            // Derived states (expired / overdue) aren't stored, so they can't
            // be a server-side filter — they only decorate the badge.
            .filter(([value]) => value !== "expired_derived" && value !== "overdue")
            .map(([value, meta]) => (
              <option key={value} value={value}>{t(meta.labelKey)}</option>
            ))}
        </Select>
        {config.extraFilters}
      </div>

      {isLoading && <LoadingState />}
      {error && <ErrorState message={(error as Error).message} />}

      {!isLoading && !error && (
        <DataTable<T>
          tableId={config.tableId}
          exportName={config.tableId}
          rows={rows}
          rowKey={(row) => row.id}
          onRowClick={(row) => navigate(`${config.routeBase}/${row.id}`)}
          columns={columns}
          empty={
            <EmptyState
              icon={config.emptyIcon}
              title={filtersOn ? config.emptyFilteredTitle : config.emptyTitle}
              description={filtersOn ? config.emptyFilteredDesc : config.emptyDesc}
              action={filtersOn ? undefined : config.newAction}
            />
          }
          footer={<Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />}
        />
      )}
    </>
  );
}

/** Shared "create document" button — kept here so all three read the same. */
export function NewDocumentButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <Button onClick={onClick}>{label}</Button>;
}
