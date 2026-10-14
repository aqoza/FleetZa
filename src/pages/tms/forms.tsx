import { useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { insertRow, updateRow, wrapDbError } from "../../lib/db";
import { formatMoney } from "../../lib/format";
import { ltrText } from "../../lib/bidi";
import { useCustomerPicker, useDriverPicker, useEntityPicker, useSupplierPicker } from "../../lib/pickers";
import { isLocked, SERVICE_LEVELS, SHIPMENT_MODES, type CarrierType, type ShipmentMode } from "../../../shared/tms";
import type { Vehicle } from "../../lib/types";
import { useTenant } from "../../context/AuthContext";
import { useT } from "../../i18n";
import { Button, Field, Input, Select, Textarea } from "../../components/ui";
import { Combobox } from "../../components/Combobox";
import { useToast } from "../../components/Toast";
import { fromLocalInput, toLocalInput } from "./labels";
import type { FreightRateRow, Shipment } from "./types";

function useSubmit<T>(onDone: (v: T) => void) {
  const t = useT();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const run = async (fn: () => Promise<T>) => {
    setSaving(true);
    setError("");
    try {
      onDone(await fn());
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setSaving(false);
    }
  };
  return { error, saving, run };
}

function FormActions({ saving, label, onCancel, disabled }: { saving: boolean; label: string; onCancel: () => void; disabled?: boolean }) {
  const t = useT();
  return (
    <div className="flex justify-end gap-2">
      <Button type="button" variant="secondary" onClick={onCancel}>{t("action.cancel")}</Button>
      <Button type="submit" loading={saving} disabled={disabled}>{label}</Button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-3">
      <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">{title}</legend>
      {children}
    </fieldset>
  );
}

const num = (v: string) => (v.trim() === "" ? null : Number(v));
const windowBad = (from: string, to: string) => !!from && !!to && to < from;

export function ShipmentForm({ shipment, onDone, onCancel }: { shipment?: Shipment; onDone: (id: string) => void; onCancel: () => void }) {
  const t = useT();
  const tenant = useTenant();
  const s = shipment;
  const locked = s != null && isLocked(s.status);
  // Once dispatched, the carrier and route are history; charges stay editable until closed.
  const onTheRoad = s != null && !["draft", "booked"].includes(s.status);
  const [f, setF] = useState({
    customer_id: s?.customer_id ?? "", mode: (s?.mode ?? "road_ftl") as ShipmentMode, service_level: s?.service_level ?? "standard",
    customer_ref: s?.customer_ref ?? "", bol_number: s?.bol_number ?? "",
    origin_name: s?.origin_name ?? "", origin_address: s?.origin_address ?? "", origin_city: s?.origin_city ?? "",
    origin_country: s?.origin_country ?? "", destination_name: s?.destination_name ?? "",
    destination_address: s?.destination_address ?? "", destination_city: s?.destination_city ?? "",
    destination_country: s?.destination_country ?? "",
    pickup_window_start: toLocalInput(s?.pickup_window_start ?? null), pickup_window_end: toLocalInput(s?.pickup_window_end ?? null),
    delivery_window_start: toLocalInput(s?.delivery_window_start ?? null),
    delivery_window_end: toLocalInput(s?.delivery_window_end ?? null),
    cargo_description: s?.cargo_description ?? "", pieces: s?.pieces?.toString() ?? "", weight_kg: s?.weight_kg?.toString() ?? "",
    volume_m3: s?.volume_m3?.toString() ?? "", hazardous: s?.hazardous ?? false,
    carrier_type: (s?.carrier_type ?? "own") as CarrierType, vehicle_id: s?.vehicle_id ?? "", driver_id: s?.driver_id ?? "",
    carrier_supplier_id: s?.carrier_supplier_id ?? "",
    freight_charge: s ? String(s.freight_charge) : "", fuel_surcharge: s && s.fuel_surcharge ? String(s.fuel_surcharge) : "",
    other_charges: s && s.other_charges ? String(s.other_charges) : "", carrier_cost: s?.carrier_cost?.toString() ?? "",
    notes: s?.notes ?? "",
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const customers = useCustomerPicker(f.customer_id, { activeOnly: true });
  const vehicles = useEntityPicker<Vehicle>({
    table: "vehicles",
    selectedId: f.vehicle_id,
    searchColumns: ["name", "license_plate", "fleet_number"],
    orderBy: "name",
    toOption: (v) => ({ value: v.id, label: v.name, meta: v.license_plate ?? undefined }),
    filter: (q) => q.eq("status", "active"),
    scope: ["tms-vehicles"],
  });
  const drivers = useDriverPicker(f.driver_id, { activeOnly: true });
  const carriers = useSupplierPicker(f.carrier_supplier_id, { activeOnly: true });
  const { error, saving, run } = useSubmit(onDone);
  const [rateMsg, setRateMsg] = useState<{ text: string; tone: "good" | "muted" } | null>(null);
  const [quoting, setQuoting] = useState(false);
  const badPickup = windowBad(f.pickup_window_start, f.pickup_window_end);
  const badDelivery = windowBad(f.delivery_window_start, f.delivery_window_end);

  async function applyRate() {
    if (!f.origin_city.trim() || !f.destination_city.trim()) {
      setRateMsg({ text: t("tms.f.rateNeedsLane"), tone: "muted" });
      return;
    }
    setQuoting(true);
    try {
      const { data, error: err } = await supabase.rpc("quote_freight", {
        p_origin_city: f.origin_city, p_destination_city: f.destination_city, p_mode: f.mode,
        p_weight_kg: num(f.weight_kg) ?? 0, ...(f.customer_id ? { p_customer_id: f.customer_id } : {}),
      });
      if (err) throw wrapDbError(err);
      const q = data?.[0];
      if (!q) {
        setRateMsg({ text: t("tms.f.noRate"), tone: "muted" });
        return;
      }
      set("freight_charge", String(q.price));
      const price = ltrText(formatMoney(q.price, tenant.currency));
      setRateMsg({ text: q.customer_specific ? t("tms.f.rateCustomer", { price }) : t("tms.f.rateApplied", { price }), tone: "good" });
    } catch (e) {
      setRateMsg({ text: e instanceof Error ? e.message : t("common.error"), tone: "muted" });
    } finally {
      setQuoting(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (badPickup || badDelivery || !f.customer_id) return;
    const row: Record<string, unknown> = locked
      ? { notes: f.notes.trim() || null }
      : {
          customer_id: f.customer_id, mode: f.mode, service_level: f.service_level,
          customer_ref: f.customer_ref.trim() || null, bol_number: f.bol_number.trim() || null,
          origin_name: f.origin_name.trim() || null, origin_address: f.origin_address.trim() || null, origin_city: f.origin_city.trim(),
          origin_country: f.origin_country.trim().toUpperCase() || null,
          destination_name: f.destination_name.trim() || null, destination_address: f.destination_address.trim() || null,
          destination_city: f.destination_city.trim(), destination_country: f.destination_country.trim().toUpperCase() || null,
          pickup_window_start: fromLocalInput(f.pickup_window_start), pickup_window_end: fromLocalInput(f.pickup_window_end),
          delivery_window_start: fromLocalInput(f.delivery_window_start), delivery_window_end: fromLocalInput(f.delivery_window_end),
          cargo_description: f.cargo_description.trim() || null, pieces: num(f.pieces), weight_kg: num(f.weight_kg),
          volume_m3: num(f.volume_m3), hazardous: f.hazardous, carrier_type: f.carrier_type,
          vehicle_id: f.carrier_type === "own" ? f.vehicle_id || null : null,
          driver_id: f.carrier_type === "own" ? f.driver_id || null : null,
          carrier_supplier_id: f.carrier_type === "third_party" ? f.carrier_supplier_id || null : null,
          freight_charge: num(f.freight_charge) ?? 0, fuel_surcharge: num(f.fuel_surcharge) ?? 0,
          other_charges: num(f.other_charges) ?? 0, carrier_cost: num(f.carrier_cost), notes: f.notes.trim() || null,
        };
    void run(async () => {
      if (s) {
        await updateRow("shipments", s.id, row);
        return s.id;
      }
      return (await insertRow<{ id: string }>("shipments", row)).id;
    });
  }

  const dis = locked;
  const routeDis = locked || onTheRoad;

  return (
    <form className="space-y-5" onSubmit={submit}>
      {locked && (
        <p className="rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn">
          {t("tms.f.lockedHint", { status: t(`tms.status.${s!.status}`) })}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("tms.f.customer")} required>
          <Combobox {...customers} value={f.customer_id} onChange={(v) => set("customer_id", v)} required clearable={false}
            disabled={routeDis} placeholder={t("tms.f.selectCustomer")} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("tms.f.mode")}>
            <Select value={f.mode} onChange={(e) => set("mode", e.target.value as ShipmentMode)} disabled={routeDis}>
              {SHIPMENT_MODES.map((m) => <option key={m} value={m}>{t(`tms.mode.${m}`)}</option>)}
            </Select>
          </Field>
          <Field label={t("tms.f.service")}>
            <Select value={f.service_level} onChange={(e) => set("service_level", e.target.value as typeof f.service_level)} disabled={dis}>
              {SERVICE_LEVELS.map((m) => <option key={m} value={m}>{t(`tms.service.${m}`)}</option>)}
            </Select>
          </Field>
        </div>
        <Field label={t("tms.f.customerRef")}>
          <Input value={f.customer_ref} onChange={(e) => set("customer_ref", e.target.value)} maxLength={100}
            placeholder={t("tms.f.customerRefPlaceholder")} disabled={dis} />
        </Field>
        <Field label={t("tms.f.bol")}>
          <Input dir="ltr" value={f.bol_number} onChange={(e) => set("bol_number", e.target.value)} maxLength={100} disabled={dis} />
        </Field>
      </div>

      <Section title={t("tms.f.sectionRoute")}>
        <div className="grid gap-4 md:grid-cols-2">
          {(["origin", "destination"] as const).map((side) => {
            const w = side === "origin" ? "pickup" : "delivery";
            const bad = side === "origin" ? badPickup : badDelivery;
            return (
              <div key={side} className="space-y-3 rounded-xl border border-line p-3">
                <p className="text-sm font-medium text-ink">{t(`tms.f.${side}`)}</p>
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2">
                    <Field label={t("tms.f.city")} required>
                      <Input value={f[`${side}_city`]} onChange={(e) => set(`${side}_city`, e.target.value)} required maxLength={100} disabled={routeDis} />
                    </Field>
                  </div>
                  <Field label={t("tms.f.country")}>
                    <Input dir="ltr" value={f[`${side}_country`]} onChange={(e) => set(`${side}_country`, e.target.value)} maxLength={2}
                      placeholder="OM" disabled={routeDis} />
                  </Field>
                </div>
                <Field label={t("tms.f.name")}>
                  <Input value={f[`${side}_name`]} onChange={(e) => set(`${side}_name`, e.target.value)} maxLength={200} disabled={dis} />
                </Field>
                <Field label={t("tms.f.address")}>
                  <Input value={f[`${side}_address`]} onChange={(e) => set(`${side}_address`, e.target.value)} maxLength={500} disabled={dis} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t("tms.f.windowFrom")} error={bad ? t("tms.f.windowOrder") : undefined}>
                    <Input type="datetime-local" value={f[`${w}_window_start`]} onChange={(e) => set(`${w}_window_start`, e.target.value)} disabled={dis} />
                  </Field>
                  <Field label={t("tms.f.windowTo")}>
                    <Input type="datetime-local" value={f[`${w}_window_end`]} onChange={(e) => set(`${w}_window_end`, e.target.value)} disabled={dis} />
                  </Field>
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      <Section title={t("tms.f.sectionCargo")}>
        <Field label={t("tms.f.cargo")}>
          <Input value={f.cargo_description} onChange={(e) => set("cargo_description", e.target.value)} maxLength={1000} disabled={dis} />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label={t("tms.f.pieces")}>
            <Input type="number" min={0} step={1} value={f.pieces} onChange={(e) => set("pieces", e.target.value)} disabled={dis} />
          </Field>
          <Field label={t("tms.f.weight")}>
            <Input type="number" min={0} step="0.01" value={f.weight_kg} onChange={(e) => set("weight_kg", e.target.value)} disabled={dis} />
          </Field>
          <Field label={t("tms.f.volume")}>
            <Input type="number" min={0} step="0.001" value={f.volume_m3} onChange={(e) => set("volume_m3", e.target.value)} disabled={dis} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <input type="checkbox" className="h-4 w-4 rounded border-line" checked={f.hazardous}
            onChange={(e) => set("hazardous", e.target.checked)} disabled={dis} />
          {t("tms.f.hazardous")}
        </label>
      </Section>

      <Section title={t("tms.f.sectionCarrier")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("tms.f.carrierType")}>
            <Select value={f.carrier_type} onChange={(e) => set("carrier_type", e.target.value as CarrierType)} disabled={routeDis}>
              <option value="own">{t("tms.carrier.own")}</option>
              <option value="third_party">{t("tms.carrier.third_party")}</option>
            </Select>
          </Field>
          {f.carrier_type === "own" ? (
            <Field label={t("tms.f.vehicle")} hint={t("tms.f.carrierHint")}>
              <Combobox {...vehicles} value={f.vehicle_id} onChange={(v) => set("vehicle_id", v)} disabled={routeDis}
                placeholder={t("tms.f.selectVehicle")} />
            </Field>
          ) : (
            <Field label={t("tms.f.carrierSupplier")} hint={t("tms.f.carrierHint")}>
              <Combobox {...carriers} value={f.carrier_supplier_id} onChange={(v) => set("carrier_supplier_id", v)} disabled={routeDis}
                placeholder={t("tms.f.selectCarrier")} />
            </Field>
          )}
          {f.carrier_type === "own" && (
            <Field label={t("tms.f.driver")}>
              <Combobox {...drivers} value={f.driver_id} onChange={(v) => set("driver_id", v)} disabled={dis}
                placeholder={t("tms.f.noDriver")} />
            </Field>
          )}
        </div>
      </Section>

      <Section title={t("tms.f.sectionCharges")}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t("tms.f.freight")}>
            <Input type="number" min={0} step="0.001" value={f.freight_charge} onChange={(e) => set("freight_charge", e.target.value)} placeholder="0" disabled={dis} />
          </Field>
          <Field label={t("tms.f.fuel")}>
            <Input type="number" min={0} step="0.001" value={f.fuel_surcharge} onChange={(e) => set("fuel_surcharge", e.target.value)} placeholder="0" disabled={dis} />
          </Field>
          <Field label={t("tms.f.other")}>
            <Input type="number" min={0} step="0.001" value={f.other_charges} onChange={(e) => set("other_charges", e.target.value)} placeholder="0" disabled={dis} />
          </Field>
        </div>
        {!dis && (
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="secondary" loading={quoting} onClick={() => void applyRate()}>{t("tms.f.useRate")}</Button>
            {rateMsg && <span className={`text-sm ${rateMsg.tone === "good" ? "text-good" : "text-ink-3"}`}>{rateMsg.text}</span>}
          </div>
        )}
        <div className="sm:w-1/3">
          <Field label={t("tms.f.carrierCost")} hint={t("tms.f.carrierCostHint")}>
            <Input type="number" min={0} step="0.001" value={f.carrier_cost} onChange={(e) => set("carrier_cost", e.target.value)} disabled={dis} />
          </Field>
        </div>
      </Section>

      <Field label={t("tms.f.notes")}>
        <Textarea rows={2} maxLength={4000} value={f.notes} onChange={(e) => set("notes", e.target.value)} />
      </Field>
      {error && <p className="text-sm text-serious">{error}</p>}
      <FormActions saving={saving} disabled={badPickup || badDelivery} label={s ? t("action.save") : t("tms.new")} onCancel={onCancel} />
    </form>
  );
}

/** Status changes that need input: deliver (proof), exception (what happened), cancel (reason). */
export function StepForm({ shipment, step, onDone, onCancel }: {
  shipment: Pick<Shipment, "id" | "dispatched_at">;
  step: "delivered" | "exception" | "canceled";
  onDone: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [receivedBy, setReceivedBy] = useState("");
  const [deliveredAt, setDeliveredAt] = useState(toLocalInput(new Date().toISOString()));
  const [text, setText] = useState("");
  const [location, setLocation] = useState("");
  const [error, setError] = useState("");

  const save = useMutation({
    mutationFn: async () => {
      if (step === "delivered") {
        await updateRow("shipments", shipment.id, {
          status: "delivered", received_by: receivedBy.trim(), delivered_at: fromLocalInput(deliveredAt), pod_notes: text.trim() || null,
        });
      } else if (step === "canceled") {
        await updateRow("shipments", shipment.id, { status: "canceled", cancel_reason: text.trim() || null });
      } else {
        await updateRow("shipments", shipment.id, { status: "exception" });
        if (text.trim() || location.trim()) {
          await insertRow("shipment_events", { shipment_id: shipment.id, note: text.trim() || null, location: location.trim() || null });
        }
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["shipments"] });
      void qc.invalidateQueries({ queryKey: ["shipment_events", shipment.id] });
      toast.success(t("tms.statusSaved", { status: t(`tms.status.${step}`) }));
      onDone();
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("common.error")),
  });

  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      {step === "delivered" && (
        <>
          <Field label={t("tms.receivedBy")} required>
            <Input value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} required maxLength={200} autoFocus />
          </Field>
          <Field label={t("tms.deliveredAt")} hint={t("tms.deliveredAtHint")}>
            <Input type="datetime-local" value={deliveredAt} onChange={(e) => setDeliveredAt(e.target.value)} required
              min={toLocalInput(shipment.dispatched_at) || undefined} max={toLocalInput(new Date().toISOString())} />
          </Field>
        </>
      )}
      {step === "exception" && (
        <Field label={t("tms.exceptionLocation")}>
          <Input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={200} placeholder={t("tms.ev.locationPlaceholder")} />
        </Field>
      )}
      <Field label={step === "delivered" ? t("tms.podNotes") : step === "exception" ? t("tms.exceptionNote") : t("tms.cancelReason")}
        required={step === "canceled"}>
        <Textarea rows={3} maxLength={step === "exception" ? 1000 : 2000} value={text} onChange={(e) => setText(e.target.value)}
          required={step === "canceled"} autoFocus={step !== "delivered"} />
      </Field>
      {error && <p className="text-sm text-serious">{error}</p>}
      <FormActions saving={save.isPending} label={step === "delivered" ? t("tms.markDelivered") : step === "exception" ? t("tms.reportException") : t("tms.cancel")}
        onCancel={onCancel} />
    </form>
  );
}

export function TrackingForm({ shipmentId }: { shipmentId: string }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [location, setLocation] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const empty = !location.trim() && !note.trim();
  const add = useMutation({
    mutationFn: () => insertRow("shipment_events", { shipment_id: shipmentId, location: location.trim() || null, note: note.trim() || null }),
    onSuccess: () => {
      setLocation("");
      setNote("");
      setError("");
      void qc.invalidateQueries({ queryKey: ["shipment_events", shipmentId] });
      toast.success(t("tms.ev.added"));
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("common.error")),
  });
  return (
    <form className="space-y-2 border-t border-line pt-3"
      onSubmit={(e) => { e.preventDefault(); if (empty) setError(t("tms.ev.needsContent")); else add.mutate(); }}>
      <div className="grid gap-2 sm:grid-cols-3">
        <Input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={200} placeholder={t("tms.ev.locationPlaceholder")}
          aria-label={t("tms.ev.location")} />
        <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder={t("tms.ev.note")}
          aria-label={t("tms.ev.note")} className="sm:col-span-2" />
      </div>
      {error && <p className="text-sm text-serious">{error}</p>}
      <div className="flex justify-end">
        <Button type="submit" variant="secondary" loading={add.isPending}>{t("tms.ev.add")}</Button>
      </div>
    </form>
  );
}

export function RateForm({ rate, onDone, onCancel }: { rate?: FreightRateRow; onDone: () => void; onCancel: () => void }) {
  const t = useT();
  const r = rate;
  const [f, setF] = useState({
    origin_city: r?.origin_city ?? "", destination_city: r?.destination_city ?? "", mode: (r?.mode ?? "road_ftl") as ShipmentMode,
    customer_id: r?.customer_id ?? "", rate_per_trip: r?.rate_per_trip?.toString() ?? "", rate_per_kg: r?.rate_per_kg?.toString() ?? "",
    min_charge: r && r.min_charge ? String(r.min_charge) : "", valid_from: r?.valid_from ?? new Date().toISOString().slice(0, 10),
    valid_to: r?.valid_to ?? "", notes: r?.notes ?? "",
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const customers = useCustomerPicker(f.customer_id, { activeOnly: true });
  const { error, saving, run } = useSubmit<void>(onDone);
  const noPrice = !f.rate_per_trip.trim() && !f.rate_per_kg.trim();
  const badRange = !!f.valid_to && f.valid_to < f.valid_from;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (noPrice || badRange) return;
    const row = {
      origin_city: f.origin_city.trim(), destination_city: f.destination_city.trim(), mode: f.mode, customer_id: f.customer_id || null,
      rate_per_trip: num(f.rate_per_trip), rate_per_kg: num(f.rate_per_kg), min_charge: num(f.min_charge) ?? 0,
      valid_from: f.valid_from, valid_to: f.valid_to || null, notes: f.notes.trim() || null,
    };
    void run(async () => {
      if (r) await updateRow("freight_rates", r.id, row);
      else await insertRow("freight_rates", row);
    });
  }

  return (
    <form className="space-y-3" onSubmit={submit}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("tms.rates.f.origin")} required>
          <Input value={f.origin_city} onChange={(e) => set("origin_city", e.target.value)} required maxLength={100} />
        </Field>
        <Field label={t("tms.rates.f.destination")} required>
          <Input value={f.destination_city} onChange={(e) => set("destination_city", e.target.value)} required maxLength={100} />
        </Field>
        <Field label={t("tms.rates.f.mode")}>
          <Select value={f.mode} onChange={(e) => set("mode", e.target.value as ShipmentMode)}>
            {SHIPMENT_MODES.map((m) => <option key={m} value={m}>{t(`tms.mode.${m}`)}</option>)}
          </Select>
        </Field>
        <Field label={t("tms.rates.f.customer")} hint={t("tms.rates.f.customerHint")}>
          <Combobox {...customers} value={f.customer_id} onChange={(v) => set("customer_id", v)} placeholder={t("tms.rates.f.anyCustomer")} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("tms.rates.f.perTrip")} error={noPrice ? t("tms.rates.f.priceRequired") : undefined}>
          <Input type="number" min={0} step="0.001" value={f.rate_per_trip} onChange={(e) => set("rate_per_trip", e.target.value)} />
        </Field>
        <Field label={t("tms.rates.f.perKg")}>
          <Input type="number" min={0} step="0.0001" value={f.rate_per_kg} onChange={(e) => set("rate_per_kg", e.target.value)} />
        </Field>
        <Field label={t("tms.rates.f.minCharge")}>
          <Input type="number" min={0} step="0.001" value={f.min_charge} onChange={(e) => set("min_charge", e.target.value)} placeholder="0" />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("tms.rates.f.validFrom")} required>
          <Input type="date" value={f.valid_from} onChange={(e) => set("valid_from", e.target.value)} required />
        </Field>
        <Field label={t("tms.rates.f.validTo")} hint={t("tms.rates.f.validToHint")} error={badRange ? t("tms.f.windowOrder") : undefined}>
          <Input type="date" value={f.valid_to} onChange={(e) => set("valid_to", e.target.value)} min={f.valid_from} />
        </Field>
      </div>
      <Field label={t("tms.rates.f.notes")}>
        <Textarea rows={2} maxLength={1000} value={f.notes} onChange={(e) => set("notes", e.target.value)} />
      </Field>
      {error && <p className="text-sm text-serious">{error}</p>}
      <FormActions saving={saving} disabled={noPrice || badRange} label={r ? t("action.save") : t("tms.rates.new")} onCancel={onCancel} />
    </form>
  );
}
