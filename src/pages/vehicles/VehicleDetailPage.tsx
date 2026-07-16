import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Pencil, Trash2, UserCheck } from "lucide-react";
import { deleteRow, getRow, insertRow, listRows, updateRow } from "../../lib/db";
import { formatDate, formatDistance, formatMoney } from "../../lib/format";
import { fuelTypes, vehicleStatus, vehicleTypes, workOrderStatus, issueStatus } from "../../lib/labels";
import type {
  Driver, FuelLog, Issue, Vehicle, VehicleAssignment, WorkOrder,
} from "../../lib/types";
import { useAuth, useTenant } from "../../context/AuthContext";
import {
  Badge, Button, Card, ErrorState, Field, LoadingState, Modal, PageHeader, Select,
} from "../../components/ui";
import { VehicleForm } from "./VehicleForm";

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium text-slate-800">{value}</span>
    </div>
  );
}

export default function VehicleDetailPage() {
  const { id = "" } = useParams();
  const tenant = useTenant();
  const { isManager } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [selectedDriver, setSelectedDriver] = useState("");

  const { data: vehicle, isLoading } = useQuery({
    queryKey: ["vehicles", id],
    queryFn: () => getRow<Vehicle>("vehicles", id),
  });

  const { data: assignment } = useQuery({
    queryKey: ["assignments", "open", id],
    queryFn: async () => {
      const rows = await listRows<VehicleAssignment & { drivers: Driver }>(
        "vehicle_assignments",
        (q) => q.select("*, drivers(*)").eq("vehicle_id", id).is("ended_at", null).limit(1),
      );
      return rows[0] ?? null;
    },
  });

  const { data: drivers } = useQuery({
    queryKey: ["drivers"],
    queryFn: () => listRows<Driver>("drivers", (q) => q.eq("status", "active").order("first_name")),
  });

  const { data: recentFuel } = useQuery({
    queryKey: ["fuel_logs", "vehicle", id],
    queryFn: () =>
      listRows<FuelLog>("fuel_logs", (q) =>
        q.eq("vehicle_id", id).order("filled_at", { ascending: false }).limit(5),
      ),
  });

  const { data: openWork } = useQuery({
    queryKey: ["work_orders", "vehicle", id],
    queryFn: () =>
      listRows<WorkOrder>("work_orders", (q) =>
        q.eq("vehicle_id", id).order("created_at", { ascending: false }).limit(5),
      ),
  });

  const { data: openIssues } = useQuery({
    queryKey: ["issues", "vehicle", id],
    queryFn: () =>
      listRows<Issue>("issues", (q) =>
        q.eq("vehicle_id", id).in("status", ["open", "in_progress"]).limit(5),
      ),
  });

  const assign = useMutation({
    mutationFn: async () => {
      if (assignment) {
        await updateRow("vehicle_assignments", assignment.id, {
          ended_at: new Date().toISOString(),
        });
      }
      if (selectedDriver) {
        await insertRow("vehicle_assignments", { vehicle_id: id, driver_id: selectedDriver });
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["assignments"] });
      setAssigning(false);
    },
  });

  const remove = useMutation({
    mutationFn: () => deleteRow("vehicles", id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["vehicles"] });
      navigate("/vehicles");
    },
  });

  if (isLoading) return <LoadingState />;
  if (!vehicle) return <ErrorState message="Vehicle not found." />;

  const st = vehicleStatus[vehicle.status];
  const currentDriver = assignment?.drivers;

  return (
    <>
      <Link to="/vehicles" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft className="h-4 w-4" /> Vehicles
      </Link>
      <PageHeader
        title={vehicle.name}
        description={[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || undefined}
        actions={
          isManager && (
            <>
              <Button variant="secondary" onClick={() => setEditing(true)}>
                <Pencil className="h-4 w-4" /> Edit
              </Button>
              <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="h-4 w-4" /> Delete
              </Button>
            </>
          )
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5">
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Details</h3>
          <InfoRow label="Status" value={st.label} />
          <InfoRow label="Type" value={vehicleTypes[vehicle.vehicle_type]} />
          <InfoRow label="Fuel" value={fuelTypes[vehicle.fuel_type]} />
          <InfoRow label="Odometer" value={formatDistance(vehicle.odometer, tenant.distance_unit)} />
          <InfoRow label="License plate" value={vehicle.license_plate ?? "—"} />
          <InfoRow label="VIN" value={vehicle.vin ?? "—"} />
          <InfoRow label="Purchased" value={formatDate(vehicle.purchase_date)} />
          <InfoRow label="Purchase price" value={formatMoney(vehicle.purchase_price, tenant.currency)} />
          {vehicle.notes && (
            <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">{vehicle.notes}</p>
          )}
        </Card>

        <Card className="p-5">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">Assigned driver</h3>
            {isManager && (
              <Button variant="ghost" onClick={() => { setSelectedDriver(assignment?.driver_id ?? ""); setAssigning(true); }}>
                <UserCheck className="h-4 w-4" /> {assignment ? "Change" : "Assign"}
              </Button>
            )}
          </div>
          {currentDriver ? (
            <div>
              <div className="text-sm font-medium text-slate-800">
                {currentDriver.first_name} {currentDriver.last_name}
              </div>
              <div className="text-xs text-slate-500">
                since {formatDate(assignment!.started_at)}
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">No driver assigned.</p>
          )}

          <h3 className="mb-2 mt-6 text-sm font-semibold text-slate-900">Open issues</h3>
          {openIssues?.length ? (
            <ul className="space-y-1.5">
              {openIssues.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate text-slate-700">{i.title}</span>
                  <Badge tone={issueStatus[i.status].tone}>{issueStatus[i.status].label}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No open issues.</p>
          )}
        </Card>

        <Card className="p-5">
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Recent work orders</h3>
          {openWork?.length ? (
            <ul className="space-y-1.5">
              {openWork.map((w) => (
                <li key={w.id} className="flex items-center justify-between gap-2 text-sm">
                  <Link to={`/maintenance/work-orders/${w.id}`} className="truncate text-brand-700 hover:underline">
                    #{w.number} {w.title}
                  </Link>
                  <Badge tone={workOrderStatus[w.status].tone}>{workOrderStatus[w.status].label}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No work orders yet.</p>
          )}

          <h3 className="mb-2 mt-6 text-sm font-semibold text-slate-900">Recent fuel</h3>
          {recentFuel?.length ? (
            <ul className="space-y-1.5">
              {recentFuel.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-slate-600">{formatDate(f.filled_at, tenant.timezone)}</span>
                  <span className="font-medium text-slate-800">
                    {formatMoney(f.total_cost, tenant.currency)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No fuel logs yet.</p>
          )}
        </Card>
      </div>

      <Modal title="Edit vehicle" open={editing} onClose={() => setEditing(false)} wide>
        <VehicleForm vehicle={vehicle} onDone={() => { setEditing(false); void qc.invalidateQueries({ queryKey: ["vehicles", id] }); }} />
      </Modal>

      <Modal title="Assign driver" open={assigning} onClose={() => setAssigning(false)}>
        <div className="space-y-4">
          <Field label="Driver" hint="Leave empty to unassign">
            <Select value={selectedDriver} onChange={(e) => setSelectedDriver(e.target.value)}>
              <option value="">— Unassigned —</option>
              {drivers?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.first_name} {d.last_name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAssigning(false)}>Cancel</Button>
            <Button onClick={() => assign.mutate()} loading={assign.isPending}>Save</Button>
          </div>
        </div>
      </Modal>

      <Modal title="Delete vehicle" open={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <p className="text-sm text-slate-600">
          Delete <span className="font-semibold">{vehicle.name}</span> and all of its history
          (fuel, work orders, inspections)? This cannot be undone.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmDelete(false)}>Cancel</Button>
          <Button variant="danger" onClick={() => remove.mutate()} loading={remove.isPending}>
            Delete vehicle
          </Button>
        </div>
      </Modal>
    </>
  );
}
