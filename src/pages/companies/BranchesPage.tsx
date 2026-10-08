import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPin, Pencil, Plus, Trash2 } from "lucide-react";
import { deleteRow, listPage, sanitizeSearch } from "../../lib/db";
import { bdiText } from "../../lib/bidi";
import { useAuth } from "../../context/AuthContext";
import { useModules } from "../../context/ModulesContext";
import { useI18n, useT } from "../../i18n";
import {
  Badge, Bdi, Button, EmptyState, ErrorState, Input, LoadingState, Ltr, Modal, Pagination, Select,
} from "../../components/ui";
import { useToast } from "../../components/Toast";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { BranchForm } from "./BranchForm";
import { useBranchStats, useCompanies } from "./hooks";
import type { Branch } from "./types";

const PAGE_SIZE = 25;

type BranchRow = Branch & { manager: { first_name: string; last_name: string | null } | null };

export function branchLabel(b: Pick<Branch, "name" | "name_ar">, language: string): string {
  return language === "ar" && b.name_ar ? b.name_ar : b.name;
}

export default function BranchesPage() {
  const t = useT();
  const { language } = useI18n();
  const navigate = useNavigate();
  const { isManager } = useAuth();
  const { isEnabled } = useModules();
  const qc = useQueryClient();
  const toast = useToast();
  const employeesOn = isEnabled("employees");
  const inventoryOn = isEnabled("inventory");
  const [search, setSearch] = useState("");
  const [company, setCompany] = useState("all");
  const [activeOnly, setActiveOnly] = useState(true);
  const [page, setPage] = useState(0);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [deleting, setDeleting] = useState<Branch | null>(null);
  const [actionError, setActionError] = useState("");
  const companiesQ = useCompanies();
  const statsQ = useBranchStats();
  const companyName = useMemo(() => {
    const m = new Map((companiesQ.data ?? []).map((c) => [c.id, c.legal_name]));
    return (id: string | null) => (id ? m.get(id) ?? "—" : "—");
  }, [companiesQ.data]);
  const term = sanitizeSearch(search);

  const { data, isLoading, error } = useQuery({
    queryKey: ["branches", "list", { page, term, company, activeOnly, employeesOn }],
    queryFn: () =>
      listPage<BranchRow>("branches", page, PAGE_SIZE, (q) => {
        let f = employeesOn
          ? q.select("*, manager:employees!branches_manager_employee_id_fkey(first_name, last_name)")
          : q;
        if (company === "none") f = f.is("company_id", null);
        else if (company !== "all") f = f.eq("company_id", company);
        if (activeOnly) f = f.eq("active", true);
        if (term) f = f.or(`name.ilike.%${term}%,name_ar.ilike.%${term}%,code.ilike.%${term}%,city.ilike.%${term}%`);
        return f.order("name");
      }),
  });
  const rows = data?.rows ?? [];

  const remove = useMutation({
    mutationFn: (id: string) => deleteRow("branches", id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["branches"] });
      void qc.invalidateQueries({ queryKey: ["picker", "branches"] });
      setDeleting(null);
      setActionError("");
      toast.success(t("toast.deleted"));
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : t("companies.branchSaveFailed"));
      setDeleting(null);
    },
  });

  const stat = (id: string, key: "vehicle_count" | "driver_count" | "employee_count" | "warehouse_count") =>
    statsQ.data?.get(id)?.[key] ?? 0;
  const countColumn = (
    id: string,
    header: string,
    key: "vehicle_count" | "driver_count" | "employee_count" | "warehouse_count",
    minBreakpoint: "md" | "lg" | "xl",
  ): DataTableColumn<BranchRow> => ({
    id,
    header,
    align: "end",
    minBreakpoint,
    cell: (b) => <span className="tabular-nums text-ink-2"><Ltr>{stat(b.id, key)}</Ltr></span>,
    sortValue: (b) => stat(b.id, key),
    exportValue: (b) => stat(b.id, key),
  });

  const filtersOn = term !== "" || company !== "all" || !activeOnly;

  const columns: Array<DataTableColumn<BranchRow>> = [
    {
      id: "name",
      header: t("companies.branchName"),
      cell: (b) => (
        <div>
          <Link to={`/companies/branches/${b.id}`} className="font-medium text-brand-700 hover:underline">
            <Bdi>{branchLabel(b, language)}</Bdi>
          </Link>
          {b.code && <div className="text-xs text-ink-3"><Ltr>{b.code}</Ltr></div>}
        </div>
      ),
      sortValue: (b) => branchLabel(b, language),
      exportValue: (b) => b.name,
    },
    {
      id: "company",
      header: t("companies.company"),
      minBreakpoint: "lg",
      cell: (b) => <span className="text-ink-2"><Bdi>{companyName(b.company_id)}</Bdi></span>,
      sortValue: (b) => companyName(b.company_id),
      exportValue: (b) => companyName(b.company_id),
    },
    {
      id: "city",
      header: t("companies.city"),
      minBreakpoint: "md",
      cell: (b) => <span className="text-ink-2"><Bdi>{b.city ?? "—"}</Bdi></span>,
      sortValue: (b) => b.city,
      exportValue: (b) => b.city ?? "",
    },
    ...(employeesOn
      ? [
          {
            id: "manager",
            header: t("companies.manager"),
            minBreakpoint: "xl",
            cell: (b) => (
              <span className="text-ink-2">
                <Bdi>{b.manager ? `${b.manager.first_name} ${b.manager.last_name ?? ""}`.trim() : "—"}</Bdi>
              </span>
            ),
            exportValue: (b) => (b.manager ? `${b.manager.first_name} ${b.manager.last_name ?? ""}`.trim() : ""),
          } satisfies DataTableColumn<BranchRow>,
        ]
      : []),
    countColumn("vehicles", t("companies.vehicles"), "vehicle_count", "md"),
    ...(isEnabled("drivers") ? [countColumn("drivers", t("companies.drivers"), "driver_count", "lg")] : []),
    ...(employeesOn ? [countColumn("employees", t("companies.employees"), "employee_count", "lg")] : []),
    ...(inventoryOn ? [countColumn("warehouses", t("companies.warehouses"), "warehouse_count", "xl")] : []),
    {
      id: "status",
      header: t("common.status"),
      minBreakpoint: "md",
      cell: (b) =>
        b.active ? <Badge tone="green">{t("companies.active")}</Badge> : <Badge tone="slate">{t("companies.inactive")}</Badge>,
      sortValue: (b) => (b.active ? 1 : 0),
      exportValue: (b) => (b.active ? t("companies.active") : t("companies.inactive")),
    },
    ...(isManager
      ? [
          {
            id: "actions",
            header: "",
            align: "end",
            cell: (b) => (
              <div className="flex justify-end gap-1">
                <button
                  className="rounded p-1.5 text-ink-3 hover:bg-canvas hover:text-ink-2"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditing(b);
                  }}
                  aria-label={t("companies.editBranch")}
                  title={t("action.edit")}
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  className="rounded p-1.5 text-ink-3 hover:bg-serious-soft hover:text-serious"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleting(b);
                  }}
                  aria-label={t("companies.deleteBranch")}
                  title={t("action.delete")}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ),
          } satisfies DataTableColumn<BranchRow>,
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
          placeholder={t("companies.searchBranches")}
          className="w-full sm:max-w-80"
        />
        {(companiesQ.data ?? []).length > 0 && (
          <Select
            value={company}
            onChange={(e) => {
              setCompany(e.target.value);
              setPage(0);
            }}
            className="w-full sm:w-auto sm:max-w-52"
          >
            <option value="all">{t("companies.allCompanies")}</option>
            <option value="none">{t("companies.noCompany")}</option>
            {(companiesQ.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.legal_name}</option>
            ))}
          </Select>
        )}
        <Select
          value={activeOnly ? "active" : "all"}
          onChange={(e) => {
            setActiveOnly(e.target.value === "active");
            setPage(0);
          }}
          className="w-full sm:w-auto sm:max-w-44"
        >
          <option value="active">{t("companies.activeOnly")}</option>
          <option value="all">{t("companies.allStatuses")}</option>
        </Select>
        {isManager && (
          <div className="ms-auto">
            <Button onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" /> {t("companies.newBranch")}
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
        <DataTable<BranchRow>
          tableId="branches"
          exportName="branches"
          rows={rows}
          rowKey={(b) => b.id}
          onRowClick={(b) => navigate(`/companies/branches/${b.id}`)}
          columns={columns}
          empty={
            <EmptyState
              icon={<MapPin className="h-10 w-10" />}
              title={filtersOn ? t("companies.branchesEmptyFilteredTitle") : t("companies.branchesEmptyTitle")}
              description={filtersOn ? t("companies.branchesEmptyFilteredDesc") : t("companies.branchesEmptyDesc")}
              action={
                isManager && !filtersOn ? (
                  <Button onClick={() => setAdding(true)}>
                    <Plus className="h-4 w-4" /> {t("companies.newBranch")}
                  </Button>
                ) : undefined
              }
            />
          }
          footer={<Pagination page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onPage={setPage} />}
        />
      )}

      <Modal title={t("companies.newBranch")} open={adding} onClose={() => setAdding(false)} wide>
        {adding && (
          <BranchForm
            onDone={(saved) => {
              setAdding(false);
              if (saved) navigate(`/companies/branches/${saved.id}`);
            }}
          />
        )}
      </Modal>
      <Modal title={t("companies.editBranch")} open={!!editing} onClose={() => setEditing(null)} wide>
        {editing && <BranchForm branch={editing} onDone={() => setEditing(null)} />}
      </Modal>
      <Modal title={t("companies.deleteBranch")} open={!!deleting} onClose={() => setDeleting(null)}>
        {deleting && (
          <>
            <p className="text-sm text-ink-2">{t("companies.deleteBranchConfirm", { name: bdiText(deleting.name) })}</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeleting(null)}>{t("action.cancel")}</Button>
              <Button variant="danger" onClick={() => remove.mutate(deleting.id)} loading={remove.isPending}>
                {t("companies.deleteBranch")}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
