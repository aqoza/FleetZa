import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { insertRow, updateRow } from "../../lib/db";
import { displayToKm, kmToDisplay } from "../../lib/format";
import { fuelTypes, vehicleStatus, vehicleTypes } from "../../lib/labels";
import type { Vehicle } from "../../lib/types";
import { useTenant } from "../../context/AuthContext";
import { Button, ErrorState, Field, Input, Select, Textarea } from "../../components/ui";

export function VehicleForm({
  vehicle,
  onDone,
}: {
  vehicle?: Vehicle;
  onDone: () => void;
}) {
  const tenant = useTenant();
  const qc = useQueryClient();

  const [form, setForm] = useState({
    name: vehicle?.name ?? "",
    vehicle_type: vehicle?.vehicle_type ?? "car",
    status: vehicle?.status ?? "active",
    make: vehicle?.make ?? "",
    model: vehicle?.model ?? "",
    year: vehicle?.year?.toString() ?? "",
    license_plate: vehicle?.license_plate ?? "",
    vin: vehicle?.vin ?? "",
    fuel_type: vehicle?.fuel_type ?? "gasoline",
    odometer: vehicle
      ? Math.round(kmToDisplay(vehicle.odometer, tenant.distance_unit)).toString()
      : "0",
    purchase_date: vehicle?.purchase_date ?? "",
    purchase_price: vehicle?.purchase_price?.toString() ?? "",
    notes: vehicle?.notes ?? "",
  });
  const [error, setError] = useState("");

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const values: Record<string, unknown> = {
        name: form.name.trim(),
        vehicle_type: form.vehicle_type,
        status: form.status,
        make: form.make.trim() || null,
        model: form.model.trim() || null,
        year: form.year ? Number(form.year) : null,
        license_plate: form.license_plate.trim() || null,
        vin: form.vin.trim() || null,
        fuel_type: form.fuel_type,
        odometer: displayToKm(Number(form.odometer) || 0, tenant.distance_unit),
        purchase_date: form.purchase_date || null,
        purchase_price: form.purchase_price ? Number(form.purchase_price) : null,
        notes: form.notes.trim() || null,
      };
      return vehicle
        ? updateRow<Vehicle>("vehicles", vehicle.id, values)
        : insertRow<Vehicle>("vehicles", values);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["vehicles"] });
      onDone();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Save failed"),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    mutation.mutate();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && <ErrorState message={error} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name / unit number" required>
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} required />
        </Field>
        <Field label="Type">
          <Select value={form.vehicle_type} onChange={(e) => set("vehicle_type", e.target.value)}>
            {Object.entries(vehicleTypes).map(([v, label]) => (
              <option key={v} value={v}>{label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Status">
          <Select value={form.status} onChange={(e) => set("status", e.target.value)}>
            {Object.entries(vehicleStatus).map(([v, s]) => (
              <option key={v} value={v}>{s.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Fuel type">
          <Select value={form.fuel_type} onChange={(e) => set("fuel_type", e.target.value)}>
            {Object.entries(fuelTypes).map(([v, label]) => (
              <option key={v} value={v}>{label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Make">
          <Input value={form.make} onChange={(e) => set("make", e.target.value)} />
        </Field>
        <Field label="Model">
          <Input value={form.model} onChange={(e) => set("model", e.target.value)} />
        </Field>
        <Field label="Year">
          <Input
            type="number" min={1900} max={2100}
            value={form.year} onChange={(e) => set("year", e.target.value)}
          />
        </Field>
        <Field label={`Odometer (${tenant.distance_unit})`}>
          <Input
            type="number" min={0} step="1"
            value={form.odometer} onChange={(e) => set("odometer", e.target.value)}
          />
        </Field>
        <Field label="License plate">
          <Input value={form.license_plate} onChange={(e) => set("license_plate", e.target.value)} />
        </Field>
        <Field label="VIN">
          <Input value={form.vin} onChange={(e) => set("vin", e.target.value)} />
        </Field>
        <Field label="Purchase date">
          <Input
            type="date"
            value={form.purchase_date} onChange={(e) => set("purchase_date", e.target.value)}
          />
        </Field>
        <Field label={`Purchase price (${tenant.currency})`}>
          <Input
            type="number" min={0} step="0.01"
            value={form.purchase_price} onChange={(e) => set("purchase_price", e.target.value)}
          />
        </Field>
      </div>
      <Field label="Notes">
        <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>
        <Button type="submit" loading={mutation.isPending}>
          {vehicle ? "Save changes" : "Add vehicle"}
        </Button>
      </div>
    </form>
  );
}
