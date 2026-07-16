import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Plus, Truck } from "lucide-react";
import { listRows } from "../../lib/db";
import { formatDistance } from "../../lib/format";
import { vehicleStatus, vehicleTypes } from "../../lib/labels";
import type { Vehicle } from "../../lib/types";
import { useAuth, useTenant } from "../../context/AuthContext";
import {
  Badge, Button, EmptyState, ErrorState, Input, LoadingState, Modal, PageHeader, Select, Table,
} from "../../components/ui";
import { VehicleForm } from "./VehicleForm";

export default function VehiclesPage() {
  const tenant = useTenant();
  const { isManager } = useAuth();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [adding, setAdding] = useState(false);

  const { data: vehicles, isLoading, error } = useQuery({
    queryKey: ["vehicles"],
    queryFn: () => listRows<Vehicle>("vehicles", (q) => q.order("name")),
  });

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (vehicles ?? []).filter((v) => {
      if (status !== "all" && v.status !== status) return false;
      if (!term) return true;
      return [v.name, v.make, v.model, v.license_plate, v.vin]
        .filter(Boolean)
        .some((f) => (f as string).toLowerCase().includes(term));
    });
  }, [vehicles, search, status]);

  return (
    <>
      <PageHeader
        title="Vehicles"
        description={`${vehicles?.length ?? 0} vehicles in your fleet`}
        actions={
          isManager && (
            <Button onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" /> Add vehicle
            </Button>
          )
        }
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <Input
          placeholder="Search name, plate, VIN…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="max-w-44">
          <option value="all">All statuses</option>
          {Object.entries(vehicleStatus).map(([v, s]) => (
            <option key={v} value={v}>{s.label}</option>
          ))}
        </Select>
      </div>

      {isLoading && <LoadingState />}
      {error && <ErrorState message={(error as Error).message} />}

      {!isLoading && !error && filtered.length === 0 && (
        <EmptyState
          icon={<Truck className="h-10 w-10" />}
          title={vehicles?.length ? "No vehicles match your filters" : "No vehicles yet"}
          description={
            vehicles?.length
              ? "Try a different search or status filter."
              : "Add your first vehicle to start tracking maintenance, fuel and costs."
          }
          action={
            isManager && !vehicles?.length ? (
              <Button onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4" /> Add vehicle
              </Button>
            ) : undefined
          }
        />
      )}

      {!isLoading && !error && filtered.length > 0 && (
        <Table headers={["Vehicle", "Type", "License plate", "Odometer", "Status"]}>
          {filtered.map((v) => (
            <tr key={v.id} className="hover:bg-slate-50">
              <td className="px-4 py-3">
                <Link to={`/vehicles/${v.id}`} className="font-medium text-brand-700 hover:underline">
                  {v.name}
                </Link>
                <div className="text-xs text-slate-500">
                  {[v.year, v.make, v.model].filter(Boolean).join(" ") || "—"}
                </div>
              </td>
              <td className="px-4 py-3 text-slate-600">{vehicleTypes[v.vehicle_type]}</td>
              <td className="px-4 py-3 text-slate-600">{v.license_plate ?? "—"}</td>
              <td className="px-4 py-3 text-slate-600">
                {formatDistance(v.odometer, tenant.distance_unit)}
              </td>
              <td className="px-4 py-3">
                <Badge tone={vehicleStatus[v.status].tone}>{vehicleStatus[v.status].label}</Badge>
              </td>
            </tr>
          ))}
        </Table>
      )}

      <Modal title="Add vehicle" open={adding} onClose={() => setAdding(false)} wide>
        <VehicleForm onDone={() => setAdding(false)} />
      </Modal>
    </>
  );
}
