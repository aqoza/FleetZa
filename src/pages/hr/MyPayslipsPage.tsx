import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { listPage } from "../../lib/db";
import { formatDate, formatMoney } from "../../lib/format";
import { useTenant } from "../../context/AuthContext";
import { useT } from "../../i18n";
import { EmptyState, ErrorState, LoadingState, Ltr, Pagination } from "../../components/ui";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import type { Payslip } from "./types";

const PAGE_SIZE = 25;

/** A member's own payslips; RLS releases them once their run is approved. */
export default function MyPayslipsPage() {
  const t = useT();
  const tenant = useTenant();
  const navigate = useNavigate();
  const [page, setPage] = useState(0);
  const { data, isLoading, error } = useQuery({
    queryKey: ["payslips", "mine", page],
    queryFn: () =>
      listPage<Payslip>("payslips", page, PAGE_SIZE, (q) => q.select("*").order("period_start", { ascending: false })),
  });
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;

  const columns: Array<DataTableColumn<Payslip>> = [
    {
      id: "period",
      header: t("hr.period"),
      cell: (p) => (
        <Link to={`/hr/payslips/${p.id}`} className="font-medium text-brand-700 hover:underline">
          {formatDate(p.period_start, tenant.timezone)} – {formatDate(p.period_end, tenant.timezone)}
        </Link>
      ),
      sortValue: (p) => p.period_start,
      exportValue: (p) => `${p.period_start} – ${p.period_end}`,
    },
    {
      id: "run",
      header: t("hr.run"),
      minBreakpoint: "md",
      cell: (p) => <span className="text-ink-2"><Ltr>{p.run_number ?? "—"}</Ltr></span>,
      exportValue: (p) => p.run_number ?? "",
    },
    {
      id: "payDate",
      header: t("hr.payDate"),
      minBreakpoint: "sm",
      cell: (p) => <span className="text-ink-2 tabular-nums">{p.pay_date ? formatDate(p.pay_date, tenant.timezone) : "—"}</span>,
      sortValue: (p) => p.pay_date,
    },
    {
      id: "net",
      header: t("hr.netPay"),
      align: "end",
      cell: (p) => <span className="font-semibold tabular-nums">{formatMoney(Number(p.net), p.currency ?? tenant.currency)}</span>,
      sortValue: (p) => Number(p.net),
      exportValue: (p) => Number(p.net),
    },
  ];

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={(error as Error).message} />;
  return (
    <DataTable<Payslip>
      tableId="hr-my-payslips"
      exportName="payslips"
      rows={rows}
      rowKey={(p) => p.id}
      onRowClick={(p) => navigate(`/hr/payslips/${p.id}`)}
      columns={columns}
      empty={<EmptyState icon={<FileText className="h-10 w-10" />} title={t("hr.noMySlipsTitle")} description={t("hr.noMySlipsDesc")} />}
      footer={<Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />}
    />
  );
}
