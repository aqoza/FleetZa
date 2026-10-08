import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, ShieldCheck } from "lucide-react";
import { listPage, sanitizeSearch, type DbFilter } from "../../lib/db";
import { formatDate, formatMoney } from "../../lib/format";
import { ltrText } from "../../lib/bidi";
import { EXPIRING_DAYS, POLICY_STATUSES, annualPremium, policyStatus } from "../../../shared/insurance";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useT } from "../../i18n";
import { Badge, Bdi, Button, EmptyState, ErrorState, Input, LoadingState, Ltr, Modal, Pagination, Select } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { PolicyForm } from "./forms";
import { addDays, insurerName, policyTone, todayInTz } from "./labels";
import { POLICY_SELECT, type Policy } from "./types";

const PAGE_SIZE = 25;

/** Server-side filter for a derived status (see policyStatus). */
export function filterByStatus(q: DbFilter, status: string, today: string): DbFilter {
  const soon = addDays(today, EXPIRING_DAYS);
  switch (status) {
    case "live":
      return q.is("canceled_at", null).gte("end_date", today);
    case "active":
      return q.is("canceled_at", null).lte("start_date", today).gt("end_date", soon);
    case "expiring":
      return q.is("canceled_at", null).lte("start_date", today).gte("end_date", today).lte("end_date", soon);
    case "expired":
      return q.is("canceled_at", null).lt("end_date", today);
    case "upcoming":
      return q.is("canceled_at", null).gt("start_date", today);
    case "canceled":
      return q.not("canceled_at", "is", null);
    default:
      return q;
  }
}

export default function PoliciesPage() {
  const t = useT();
  const tenant = useTenant();
  const navigate = useNavigate();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const today = todayInTz(tenant.timezone);
  const [status, setStatus] = useState("live");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [creating, setCreating] = useState(false);
  const term = sanitizeSearch(search);

  const listQ = useQuery({
    queryKey: ["insurance_policies", "list", { page, status, term, today }],
    queryFn: () =>
      listPage<Policy>("insurance_policies", page, PAGE_SIZE, (q) => {
        let f = filterByStatus(q.select(POLICY_SELECT), status, today);
        if (term) f = f.or(`policy_number.ilike.%${term}%,insurer_name.ilike.%${term}%,broker.ilike.%${term}%`);
        return f.order("end_date").order("policy_number");
      }),
  });

  const columns: Array<DataTableColumn<Policy>> = [
    {
      id: "number",
      header: t("insurance.col.number"),
      cell: (p) => (
        <div className="min-w-0">
          <Ltr className="whitespace-nowrap font-medium text-brand-700">{p.policy_number}</Ltr>
          {p.broker && <div className="text-xs text-ink-3"><Bdi>{p.broker}</Bdi></div>}
        </div>
      ),
      sortValue: (p) => p.policy_number,
      exportValue: (p) => p.policy_number,
    },
    {
      id: "insurer",
      header: t("insurance.col.insurer"),
      cell: (p) => <Bdi className="text-ink">{insurerName(p)}</Bdi>,
      sortValue: (p) => insurerName(p),
      exportValue: (p) => insurerName(p),
    },
    {
      id: "type",
      header: t("insurance.col.type"),
      minBreakpoint: "md",
      cell: (p) => <span className="text-ink-2">{t(`insurance.type.${p.policy_type}`)}</span>,
      exportValue: (p) => p.policy_type,
    },
    {
      id: "term",
      header: t("insurance.col.term"),
      minBreakpoint: "lg",
      cell: (p) => (
        <span className="whitespace-nowrap text-ink-2">
          {t("insurance.range", { from: ltrText(formatDate(p.start_date)), to: ltrText(formatDate(p.end_date)) })}
        </span>
      ),
      sortValue: (p) => p.end_date,
      exportValue: (p) => `${p.start_date} - ${p.end_date}`,
    },
    {
      id: "premium",
      header: t("insurance.col.premium"),
      minBreakpoint: "sm",
      align: "end",
      cell: (p) => <span className="whitespace-nowrap text-ink">{formatMoney(annualPremium(p.premium, p.premium_frequency), p.currency)}</span>,
      sortValue: (p) => annualPremium(p.premium, p.premium_frequency),
      exportValue: (p) => annualPremium(p.premium, p.premium_frequency),
    },
    {
      id: "status",
      header: t("insurance.col.status"),
      cell: (p) => {
        const s = policyStatus(p, today);
        return <Badge tone={policyTone[s]}>{t(`insurance.status.${s}`)}</Badge>;
      },
      sortValue: (p) => POLICY_STATUSES.indexOf(policyStatus(p, today)),
      exportValue: (p) => policyStatus(p, today),
    },
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} placeholder={t("insurance.search")} className="w-full sm:max-w-80" />
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }} className="max-w-48">
          <option value="live">{t("insurance.filter.live")}</option>
          <option value="all">{t("insurance.filter.all")}</option>
          {POLICY_STATUSES.map((s) => <option key={s} value={s}>{t(`insurance.status.${s}`)}</option>)}
        </Select>
        {isManager && (
          <Button className="ms-auto" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> {t("insurance.new")}
          </Button>
        )}
      </div>
      {listQ.isLoading && <LoadingState />}
      {listQ.error && <ErrorState message={(listQ.error as Error).message} />}
      {listQ.data && (
        <DataTable<Policy>
          tableId="insurance_policies"
          exportName="insurance-policies"
          rows={listQ.data.rows}
          rowKey={(p) => p.id}
          columns={columns}
          onRowClick={(p) => navigate(`/insurance/policies/${p.id}`)}
          empty={<EmptyState icon={<ShieldCheck className="h-10 w-10" />} title={t("insurance.empty")} description={t("insurance.emptyHint")} />}
          footer={<Pagination page={page} pageSize={PAGE_SIZE} total={listQ.data.total} onPage={setPage} />}
        />
      )}
      <Modal title={t("insurance.newTitle")} open={creating} onClose={() => setCreating(false)} wide>
        {creating && (
          <PolicyForm
            onCancel={() => setCreating(false)}
            onDone={(id) => {
              setCreating(false);
              void qc.invalidateQueries({ queryKey: ["insurance_policies"] });
              toast.success(t("insurance.saved"));
              navigate(`/insurance/policies/${id}`);
            }}
          />
        )}
      </Modal>
    </div>
  );
}
