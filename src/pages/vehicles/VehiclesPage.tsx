import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Plus, Truck } from "lucide-react";
import { listRows } from "../../lib/db";
import { formatDistance } from "../../lib/format";
import { vehicleStatus, vehicleTypes } from "../../lib/labels";
import type { Vehicle } from "../../lib/types";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useModules } from "../../context/ModulesContext";
import { useT } from "../../i18n";
import {
  Badge, Button, EmptyState, ErrorState, Input, LoadingState, Modal, PageHeader, Select, Table,
} from "../../components/ui";
import { VehicleForm } from "./VehicleForm";

type VehicleRow = Vehicle & { customers?: { name: string } | null };

export default function VehiclesPage() {
  const t = useT();
  const tenant = useTenant();
  const { isManager } = useAuth();
  const { isEnabled } = useModules();
  const customersOn = isEnabled("customers");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [owner, setOwner] = useState("company");
  const [adding, setAdding] = useState(false);

  const { data: vehicles, isLoading, error } = useQuery({
    queryKey: ["vehicles", { withOwner: customersOn }],
    queryFn: () =>
      customersOn
        ? listRows<VehicleRow>("vehicles", (q) => q.select("*, customers(name)").order("name"))
        : listRows<VehicleRow>("vehicles", (q) => q.order("name")),
  });

  const fleetCount = customersOn
    ? (vehicles ?? []).filter((v) => v.ownership === "company").length
    : vehicles?.length ?? 0;

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (vehicles ?? []).filter((v) => {
      if (customersOn && owner !== "all" && v.ownership !== owner) return false;
      if (status !== "all" && v.status !== status) return false;
      if (!term) return true;
      return [v.name, v.make, v.model, v.license_plate, v.vin]
        .filter(Boolean)
        .some((f) => (f as string).toLowerCase().includes(term));
    });
  }, [vehicles, search, status, owner, customersOn]);

  return (
    <>
      <PageHeader
        title={t("vehicles.title")}
        description={t("vehicles.countInFleet", { count: fleetCount })}
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
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="max-w-44">
          <option value="all">{t("vehicles.allStatuses")}</option>
          {Object.entries(vehicleStatus).map(([v, s]) => (
            <option key={v} value={v}>{t(s.labelKey)}</option>
          ))}
        </Select>
        {customersOn && (
          <Select value={owner} onChange={(e) => setOwner(e.target.value)} className="max-w-44">
            <option value="company">{t("vehicles.ownerCompany")}</option>
            <option value="customer">{t("vehicles.ownerCustomer")}</option>
            <option value="all">{t("vehicles.allOwners")}</option>
          </Select>
        )}
      </div>

      {isLoading && <LoadingState />}
      {error && <ErrorState message={(error as Error).message} />}

      {!isLoading && !error && filtered.length === 0 && (
        <EmptyState
          icon={<Truck className="h-10 w-10" />}
          title={vehicles?.length ? t("vehicles.noMatch") : t("vehicles.empty")}
          description={
            vehicles?.length ? t("vehicles.noMatchHint") : t("vehicles.emptyHint")
          }
          action={
            isManager && !vehicles?.length ? (
              <Button onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4" /> {t("vehicles.add")}
              </Button>
            ) : undefined
          }
        />
      )}

      {!isLoading && !error && filtered.length > 0 && (
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
          {filtered.map((v) => (
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

      <Modal title={t("vehicles.add")} open={adding} onClose={() => setAdding(false)} wide>
        <VehicleForm onDone={() => setAdding(false)} />
      </Modal>
    </>
  );
}
