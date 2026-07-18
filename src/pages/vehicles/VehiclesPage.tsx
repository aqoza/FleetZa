import { useState } from "react";
import { Link } from "react-router-dom";
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
  Select, Table,
} from "../../components/ui";
import { VehicleForm } from "./VehicleForm";

type VehicleRow = Vehicle & { customers?: { name: string } | null };

const PAGE_SIZE = 25;

export default function VehiclesPage() {
  const t = useT();
  const tenant = useTenant();
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

      {!isLoading && !error && total === 0 && (
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
      )}

      {!isLoading && !error && vehicles.length > 0 && (
        <Table
          headers={[
            t("field.vehicle"),
            t("vehicles.type"),
            ...(customersOn ? [t("vehicles.owner")] : []),
            t("field.licensePlate"),
            t("field.odometer"),
            t("field.status"),
          ]}
        >
          {vehicles.map((v) => (
            <tr key={v.id} className="hover:bg-slate-50">
              <td className="px-4 py-3">
                <Link to={`/vehicles/${v.id}`} className="font-medium text-brand-700 hover:underline">
                  {v.name}
                </Link>
                <div className="text-xs text-slate-500">
                  {[v.year, v.make, v.model].filter(Boolean).join(" ") || t("common.dash")}
                </div>
              </td>
              <td className="px-4 py-3 text-slate-600">{t(vehicleTypes[v.vehicle_type])}</td>
              {customersOn && (
                <td className="px-4 py-3 text-slate-600">
                  {v.ownership === "customer" && v.customer_id ? (
                    <Link
                      to={`/customers/${v.customer_id}`}
                      className="text-brand-700 hover:underline"
                    >
                      {v.customers?.name ?? t("common.dash")}
                    </Link>
                  ) : (
                    t("vehicles.ownerCompany")
                  )}
                </td>
              )}
              <td className="px-4 py-3 text-slate-600">{v.license_plate ?? t("common.dash")}</td>
              <td className="px-4 py-3 text-slate-600">
                {formatDistance(v.odometer, tenant.distance_unit)}
              </td>
              <td className="px-4 py-3">
                <Badge tone={vehicleStatus[v.status].tone}>{t(vehicleStatus[v.status].labelKey)}</Badge>
              </td>
            </tr>
          ))}
        </Table>
      )}

      {!isLoading && !error && (
        <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
      )}

      <Modal title={t("vehicles.add")} open={adding} onClose={() => setAdding(false)} wide>
        <VehicleForm onDone={() => setAdding(false)} />
      </Modal>
    </>
  );
}
