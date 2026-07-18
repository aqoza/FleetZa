import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Plus, Truck } from "lucide-react";
import { listPage, wrapDbError, sanitizeSearch } from "../../lib/db";
import { supabase } from "../../lib/supabase";
import { formatDistance } from "../../lib/format";
import { vehicleStatus, vehicleTypes } from "../../lib/labels";
import type { Vehicle } from "../../lib/types";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useModules } from "../../context/ModulesContext";
import { useT } from "../../i18n";
import {
  Badge, Button, EmptyState, ErrorState, Input, LoadingState, Modal, PageHeader, Pagination,
  Select,
} from "../../components/ui";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { VehicleForm } from "./VehicleForm";

type VehicleRow = Vehicle & { customers?: { name: string } | null };

const PAGE_SIZE = 25;

export default function VehiclesPage() {
  const t = useT();
  const tenant = useTenant();
  const navigate = useNavigate();
  const { isManager } = useAuth();
  const { isEnabled } = useModules();
  const customersOn = isEnabled("customers");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [owner, setOwner] = useState("company");
  const [page, setPage] = useState(0);
  const [adding, setAdding] = useState(false);

  // Server-side search term; % and , would break the .or(...) ilike pattern.
  const term = sanitizeSearch(search);

  const { data, isLoading, error } = useQuery({
    queryKey: ["vehicles", { withOwner: customersOn, page, term, status, owner }],
    queryFn: () =>
      listPage<VehicleRow>("vehicles", page, PAGE_SIZE, (q) => {
        let f = customersOn ? q.select("*, customers(name)") : q;
        if (status !== "all") f = f.eq("status", status);
        if (customersOn && owner !== "all") f = f.eq("ownership", owner);
        if (term) {
          f = f.or(
            `name.ilike.%${term}%,make.ilike.%${term}%,model.ilike.%${term}%,` +
              `license_plate.ilike.%${term}%,vin.ilike.%${term}%`,
          );
        }
        return f.order("name");
      }),
  });
  const vehicles = data?.rows ?? [];
  const total = data?.total ?? 0;

  // Cheap head-only counts, independent of the list filters: company-owned
  // for the header, and the unfiltered total so the empty state can tell a
  // truly empty tenant apart from "everything is filtered out".
  const { data: counts } = useQuery({
    queryKey: ["vehicles", "counts"],
    queryFn: async () => {
      const [company, all] = await Promise.all([
        supabase.from("vehicles").select("id", { count: "exact", head: true }).eq("ownership", "company"),
        supabase.from("vehicles").select("id", { count: "exact", head: true }),
      ]);
      if (company.error) throw wrapDbError(company.error);
      if (all.error) throw wrapDbError(all.error);
      return { company: company.count ?? 0, all: all.count ?? 0 };
    },
  });
  const companyCount = counts?.company;

  // "No vehicles yet" only when the tenant truly has none; a customer-only
  // fleet under the default company view gets the no-match state instead.
  const filtersOn =
    term !== "" || status !== "all" || (customersOn && owner !== "all" && (counts?.all ?? 0) > 0);

  const ownerColumn: DataTableColumn<VehicleRow> = {
    id: "owner",
    header: t("vehicles.owner"),
    minBreakpoint: "lg",
    cell: (v) =>
      v.ownership === "customer" && v.customer_id ? (
        <Link
          to={`/customers/${v.customer_id}`}
          className="text-brand-700 hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {v.customers?.name ?? t("common.dash")}
        </Link>
      ) : (
        <span className="text-slate-600">{t("vehicles.ownerCompany")}</span>
      ),
    sortValue: (v) =>
      v.ownership === "customer" && v.customer_id
        ? (v.customers?.name ?? t("common.dash"))
        : t("vehicles.ownerCompany"),
  };

  const columns: Array<DataTableColumn<VehicleRow>> = [
    {
      id: "vehicle",
      header: t("field.vehicle"),
      cell: (v) => (
        <>
          <Link to={`/vehicles/${v.id}`} className="font-medium text-brand-700 hover:underline">
            {v.name}
          </Link>
          <div className="text-xs text-slate-500">
            {[v.year, v.make, v.model].filter(Boolean).join(" ") || t("common.dash")}
          </div>
        </>
      ),
      sortValue: (v) => v.name,
      exportValue: (v) => v.name,
    },
    {
      id: "type",
      header: t("vehicles.type"),
      minBreakpoint: "md",
      cell: (v) => <span className="text-slate-600">{t(vehicleTypes[v.vehicle_type])}</span>,
      sortValue: (v) => t(vehicleTypes[v.vehicle_type]),
    },
    ...(customersOn ? [ownerColumn] : []),
    {
      id: "licensePlate",
      header: t("field.licensePlate"),
      cell: (v) => <span className="text-slate-600">{v.license_plate ?? t("common.dash")}</span>,
      sortValue: (v) => v.license_plate,
      exportValue: (v) => v.license_plate ?? "",
    },
    {
      id: "odometer",
      header: t("field.odometer"),
      align: "end",
      minBreakpoint: "md",
      cell: (v) => (
        <span className="text-slate-600">{formatDistance(v.odometer, tenant.distance_unit)}</span>
      ),
      sortValue: (v) => v.odometer,
      exportValue: (v) => formatDistance(v.odometer, tenant.distance_unit),
    },
    {
      id: "status",
      header: t("field.status"),
      cell: (v) => (
        <Badge tone={vehicleStatus[v.status].tone}>{t(vehicleStatus[v.status].labelKey)}</Badge>
      ),
      sortValue: (v) => t(vehicleStatus[v.status].labelKey),
    },
  ];

  return (
    <>
      <PageHeader
        title={t("vehicles.title")}
        description={t("vehicles.countInFleet", { count: companyCount ?? 0 })}
        actions={
          isManager && (
            <Button onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" /> {t("vehicles.add")}
            </Button>
          )
        }
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <Input
          placeholder={t("vehicles.searchPlaceholder")}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          className="max-w-xs"
        />
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(0);
          }}
          className="max-w-44"
        >
          <option value="all">{t("vehicles.allStatuses")}</option>
          {Object.entries(vehicleStatus).map(([v, s]) => (
            <option key={v} value={v}>{t(s.labelKey)}</option>
          ))}
        </Select>
        {customersOn && (
          <Select
            value={owner}
            onChange={(e) => {
              setOwner(e.target.value);
              setPage(0);
            }}
            className="max-w-44"
          >
            <option value="company">{t("vehicles.ownerCompany")}</option>
            <option value="customer">{t("vehicles.ownerCustomer")}</option>
            <option value="all">{t("vehicles.allOwners")}</option>
          </Select>
        )}
      </div>

      {isLoading && <LoadingState />}
      {error && <ErrorState message={(error as Error).message} />}

      {!isLoading && !error && (
        <DataTable
          tableId="vehicles"
          exportName="vehicles"
          columns={columns}
          rows={vehicles}
          rowKey={(v) => v.id}
          onRowClick={(v) => navigate(`/vehicles/${v.id}`)}
          empty={
            <EmptyState
              icon={<Truck className="h-10 w-10" />}
              title={filtersOn ? t("vehicles.noMatch") : t("vehicles.empty")}
              description={filtersOn ? t("vehicles.noMatchHint") : t("vehicles.emptyHint")}
              action={
                isManager && !filtersOn ? (
                  <Button onClick={() => setAdding(true)}>
                    <Plus className="h-4 w-4" /> {t("vehicles.add")}
                  </Button>
                ) : undefined
              }
            />
          }
          footer={<Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />}
        />
      )}

      <Modal title={t("vehicles.add")} open={adding} onClose={() => setAdding(false)} wide>
        <VehicleForm onDone={() => setAdding(false)} />
      </Modal>
    </>
  );
}
