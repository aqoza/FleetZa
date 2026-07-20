import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { insertRow, listRows, updateRow } from "../../lib/db";
import { displayToKm, kmToDisplay } from "../../lib/format";
import { fuelTypes, vehicleStatus, vehicleTypes } from "../../lib/labels";
import type { Customer, Vehicle } from "../../lib/types";
import { useTenant } from "../../context/AuthContext";
import { useModules } from "../../context/ModulesContext";
import { useT } from "../../i18n";
import { Button, ErrorState, Field, Input, Select, Textarea } from "../../components/ui";

export function VehicleForm({
  vehicle,
  onDone,
}: {
  vehicle?: Vehicle;
  onDone: () => void;
}) {
  const t = useT();
  const tenant = useTenant();
  const qc = useQueryClient();
  const { isEnabled } = useModules();
  const customersEnabled = isEnabled("customers");

  // Picker lists active customers, plus the vehicle's current customer even if
  // since deactivated — otherwise editing such a vehicle is blocked by the
  // required select (and switching away would silently detach it).
  const currentCustomerId = vehicle?.customer_id ?? null;
  const { data: customers } = useQuery({
    queryKey: ["customers", "picker", currentCustomerId],
    queryFn: () =>
      listRows<Customer>("customers", (q) =>
        (currentCustomerId
          ? q.or(`status.eq.active,id.eq.${currentCustomerId}`)
          : q.eq("status", "active")
        ).order("name"),
      ),
    enabled: customersEnabled,
  });

  const [form, setForm] = useState({
    ownership: vehicle?.ownership ?? "company",
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
    customer_id: vehicle?.customer_id ?? "",
    chassis_number: vehicle?.chassis_number ?? "",
    engine_number: vehicle?.engine_number ?? "",
    fleet_number: vehicle?.fleet_number ?? "",
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
        chassis_number: form.chassis_number.trim() || null,
        engine_number: form.engine_number.trim() || null,
        fleet_number: form.fleet_number.trim() || null,
        notes: form.notes.trim() || null,
      };
      // Only touch ownership when the customers module (and thus the owner
      // control) is active, so a disabled module never silently unlinks a
      // vehicle from its customer.
      if (customersEnabled) {
        values.ownership = form.ownership;
        values.customer_id = form.ownership === "customer" ? form.customer_id || null : null;
      }
      return vehicle
        ? updateRow<Vehicle>("vehicles", vehicle.id, values)
        : insertRow<Vehicle>("vehicles", values);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["vehicles"] });
      onDone();
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("vehicles.saveFailed")),
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
        <Field label={t("vehicles.nameLabel")} required>
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} required />
        </Field>
        <Field label={t("vehicles.type")}>
          <Select value={form.vehicle_type} onChange={(e) => set("vehicle_type", e.target.value)}>
            {Object.entries(vehicleTypes).map(([v, labelKey]) => (
              <option key={v} value={v}>{t(labelKey)}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("field.status")}>
          <Select value={form.status} onChange={(e) => set("status", e.target.value)}>
            {Object.entries(vehicleStatus).map(([v, s]) => (
              <option key={v} value={v}>{t(s.labelKey)}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("vehicles.fuelType")}>
          <Select value={form.fuel_type} onChange={(e) => set("fuel_type", e.target.value)}>
            {Object.entries(fuelTypes).map(([v, labelKey]) => (
              <option key={v} value={v}>{t(labelKey)}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("field.make")}>
          <Input value={form.make} onChange={(e) => set("make", e.target.value)} />
        </Field>
        <Field label={t("field.model")}>
          <Input value={form.model} onChange={(e) => set("model", e.target.value)} />
        </Field>
        <Field label={t("field.year")}>
          <Input
            type="number" min={1900} max={2100}
            value={form.year} onChange={(e) => set("year", e.target.value)}
          />
        </Field>
        <Field label={t("vehicles.odometerUnit", { unit: tenant.distance_unit })}>
          <Input
            type="number" min={0} step="1"
            value={form.odometer} onChange={(e) => set("odometer", e.target.value)}
          />
        </Field>
        <Field label={t("field.licensePlate")}>
          <Input value={form.license_plate} onChange={(e) => set("license_plate", e.target.value)} />
        </Field>
        <Field label={t("field.vin")}>
          <Input value={form.vin} onChange={(e) => set("vin", e.target.value)} />
        </Field>
        {customersEnabled && (
          <Field label={t("vehicles.owner")}>
            <Select value={form.ownership} onChange={(e) => set("ownership", e.target.value)}>
              <option value="company">{t("vehicles.ownerCompany")}</option>
              <option value="customer">{t("vehicles.ownerCustomer")}</option>
            </Select>
          </Field>
        )}
        {customersEnabled && form.ownership === "customer" && (
          <Field label={t("vehicles.ownerCustomer")} required>
            <Select
              value={form.customer_id}
              onChange={(e) => set("customer_id", e.target.value)}
              required
            >
              <option value="">{t("vehicles.selectCustomer")}</option>
              {(customers ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </Field>
        )}
        <Field label={t("vehicles.chassisNumber")}>
          <Input
            value={form.chassis_number}
            onChange={(e) => set("chassis_number", e.target.value)}
          />
        </Field>
        <Field label={t("vehicles.engineNumber")}>
          <Input
            value={form.engine_number}
            onChange={(e) => set("engine_number", e.target.value)}
          />
        </Field>
        <Field label={t("vehicles.fleetNumber")}>
          <Input
            value={form.fleet_number}
            onChange={(e) => set("fleet_number", e.target.value)}
          />
        </Field>
        <Field label={t("vehicles.purchaseDate")}>
          <Input
            type="date"
            value={form.purchase_date} onChange={(e) => set("purchase_date", e.target.value)}
          />
        </Field>
        <Field label={t("vehicles.purchasePriceUnit", { currency: tenant.currency })}>
          <Input
            type="number" min={0} step="0.01"
            value={form.purchase_price} onChange={(e) => set("purchase_price", e.target.value)}
          />
        </Field>
      </div>
      <Field label={t("field.notes")}>
        <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>{t("action.cancel")}</Button>
        <Button type="submit" loading={mutation.isPending}>
          {vehicle ? t("action.saveChanges") : t("vehicles.add")}
        </Button>
      </div>
    </form>
  );
}
