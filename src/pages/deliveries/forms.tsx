import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { insertRow, updateRow, wrapDbError } from "../../lib/db";
import { formatMoney } from "../../lib/format";
import { ltrText } from "../../lib/bidi";
import { useCustomerPicker, useDriverPicker, useEntityPicker } from "../../lib/pickers";
import { FAILURE_REASONS, IMPORT_MAX_ROWS, mapImportRows, parseCsv, type FailureReason } from "../../../shared/deliveries";
import type { Vehicle } from "../../lib/types";
import { useTenant } from "../../context/AuthContext";
import { useT, useTp } from "../../i18n";
import { Button, Field, Input, Select, Textarea } from "../../components/ui";
import { Combobox } from "../../components/Combobox";
import { useToast } from "../../components/Toast";
import { SignaturePad } from "./SignaturePad";
import { parseCoord, todayInTz } from "./labels";
import type { Delivery, DeliveryRoute } from "./types";

function useSubmit(onDone: (id: string) => void) {
  const t = useT();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const run = async (fn: () => Promise<string>) => {
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

export function DeliveryForm({ delivery, onDone, onCancel }: { delivery?: Delivery; onDone: (id: string) => void; onCancel: () => void }) {
  const t = useT();
  const d = delivery;
  const [f, setF] = useState({
    recipient_name: d?.recipient_name ?? "", recipient_phone: d?.recipient_phone ?? "", address: d?.address ?? "",
    city: d?.city ?? "", lat: d?.lat?.toString() ?? "", lng: d?.lng?.toString() ?? "", parcels: String(d?.parcels ?? 1),
    weight_kg: d?.weight_kg?.toString() ?? "", cod_amount: d ? String(d.cod_amount) : "", customer_id: d?.customer_id ?? "",
    reference: d?.reference ?? "", instructions: d?.instructions ?? "",
  });
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));
  const customerPicker = useCustomerPicker(f.customer_id, { activeOnly: true });
  const { error, saving, run } = useSubmit(onDone);
  const lat = parseCoord(f.lat, 90);
  const lng = parseCoord(f.lng, 180);
  const badCoords = lat === undefined || lng === undefined || (lat == null) !== (lng == null);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (badCoords) return;
    const row = {
      recipient_name: f.recipient_name.trim(), recipient_phone: f.recipient_phone.trim() || null, address: f.address.trim(),
      city: f.city.trim() || null, lat, lng, parcels: Math.max(1, Math.round(Number(f.parcels) || 1)),
      weight_kg: f.weight_kg ? Number(f.weight_kg) : null, cod_amount: f.cod_amount ? Number(f.cod_amount) : 0,
      customer_id: f.customer_id || null, reference: f.reference.trim() || null, instructions: f.instructions.trim() || null,
    };
    void run(async () => {
      if (d) {
        await updateRow("deliveries", d.id, row);
        return d.id;
      }
      return (await insertRow<{ id: string }>("deliveries", row)).id;
    });
  }

  return (
    <form className="space-y-3" onSubmit={submit}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("deliveries.f.recipient")} required>
          <Input value={f.recipient_name} onChange={(e) => set("recipient_name", e.target.value)} required maxLength={200} />
        </Field>
        <Field label={t("deliveries.f.phone")}>
          <Input dir="ltr" type="tel" value={f.recipient_phone} onChange={(e) => set("recipient_phone", e.target.value)} maxLength={40} />
        </Field>
      </div>
      <Field label={t("deliveries.f.address")} required>
        <Input value={f.address} onChange={(e) => set("address", e.target.value)} required maxLength={500} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("deliveries.f.city")}>
          <Input value={f.city} onChange={(e) => set("city", e.target.value)} maxLength={100} />
        </Field>
        <Field label={t("deliveries.f.lat")} error={badCoords ? t("deliveries.f.coordsPair") : undefined}>
          <Input dir="ltr" inputMode="decimal" value={f.lat} onChange={(e) => set("lat", e.target.value)} placeholder="23.5880" />
        </Field>
        <Field label={t("deliveries.f.lng")}>
          <Input dir="ltr" inputMode="decimal" value={f.lng} onChange={(e) => set("lng", e.target.value)} placeholder="58.3829" />
        </Field>
      </div>
      <p className="-mt-1 text-xs text-ink-3">{t("deliveries.f.coordsHint")}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("deliveries.f.parcels")}>
          <Input type="number" min={1} max={9999} step={1} value={f.parcels} onChange={(e) => set("parcels", e.target.value)} />
        </Field>
        <Field label={t("deliveries.f.weight")}>
          <Input type="number" min={0} step="0.01" value={f.weight_kg} onChange={(e) => set("weight_kg", e.target.value)} />
        </Field>
        <Field label={t("deliveries.f.cod")}>
          <Input type="number" min={0} step="0.001" value={f.cod_amount} onChange={(e) => set("cod_amount", e.target.value)} placeholder="0" />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("deliveries.f.customer")}>
          <Combobox {...customerPicker} value={f.customer_id} onChange={(v) => set("customer_id", v)} placeholder={t("deliveries.f.noCustomer")} />
        </Field>
        <Field label={t("deliveries.f.reference")}>
          <Input value={f.reference} onChange={(e) => set("reference", e.target.value)} maxLength={100} placeholder={t("deliveries.f.referencePlaceholder")} />
        </Field>
      </div>
      <Field label={t("deliveries.f.instructions")}>
        <Textarea rows={2} maxLength={2000} value={f.instructions} onChange={(e) => set("instructions", e.target.value)} />
      </Field>
      {error && <p className="text-sm text-serious">{error}</p>}
      <FormActions saving={saving} disabled={badCoords} label={d ? t("action.save") : t("deliveries.new")} onCancel={onCancel} />
    </form>
  );
}

export function RouteForm({ route, onDone, onCancel }: { route?: DeliveryRoute; onDone: (id: string) => void; onCancel: () => void }) {
  const t = useT();
  const tenant = useTenant();
  const r = route;
  const [f, setF] = useState({
    route_date: r?.route_date ?? todayInTz(tenant.timezone), vehicle_id: r?.vehicle_id ?? "", driver_id: r?.driver_id ?? "",
    depot_name: r?.depot_name ?? "", depot_lat: r?.depot_lat?.toString() ?? "", depot_lng: r?.depot_lng?.toString() ?? "",
    notes: r?.notes ?? "",
  });
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));
  const vehicles = useEntityPicker<Vehicle>({
    table: "vehicles",
    selectedId: f.vehicle_id,
    searchColumns: ["name", "license_plate", "fleet_number"],
    orderBy: "name",
    toOption: (v) => ({ value: v.id, label: v.name, meta: v.license_plate ?? undefined }),
    filter: (q) => q.eq("status", "active"),
    scope: ["delivery-route-vehicles"],
  });
  const drivers = useDriverPicker(f.driver_id, { activeOnly: true });
  const { error, saving, run } = useSubmit(onDone);
  const lat = parseCoord(f.depot_lat, 90);
  const lng = parseCoord(f.depot_lng, 180);
  const badCoords = lat === undefined || lng === undefined || (lat == null) !== (lng == null);
  const locked = r != null && r.status !== "planned" && r.status !== "out_for_delivery";

  function submit(e: FormEvent) {
    e.preventDefault();
    if (badCoords || !f.vehicle_id) return;
    const row = locked
      ? { notes: f.notes.trim() || null }
      : {
          route_date: f.route_date, vehicle_id: f.vehicle_id, driver_id: f.driver_id || null, depot_name: f.depot_name.trim() || null,
          depot_lat: lat, depot_lng: lng, notes: f.notes.trim() || null,
        };
    void run(async () => {
      if (r) {
        await updateRow("delivery_routes", r.id, row);
        return r.id;
      }
      return (await insertRow<{ id: string }>("delivery_routes", row)).id;
    });
  }

  return (
    <form className="space-y-3" onSubmit={submit}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("deliveries.routes.f.date")} required>
          <Input type="date" value={f.route_date} onChange={(e) => set("route_date", e.target.value)} required disabled={locked} />
        </Field>
        <Field label={t("deliveries.routes.f.vehicle")} required>
          <Combobox {...vehicles} value={f.vehicle_id} onChange={(v) => set("vehicle_id", v)} required clearable={false} disabled={locked} placeholder={t("deliveries.routes.f.selectVehicle")} />
        </Field>
        <Field label={t("deliveries.routes.f.driver")}>
          <Combobox {...drivers} value={f.driver_id} onChange={(v) => set("driver_id", v)} placeholder={t("deliveries.routes.f.noDriver")} disabled={locked} />
        </Field>
        <Field label={t("deliveries.routes.f.depot")}>
          <Input value={f.depot_name} onChange={(e) => set("depot_name", e.target.value)} maxLength={200} placeholder={t("deliveries.routes.f.depotPlaceholder")} disabled={locked} />
        </Field>
        <Field label={t("deliveries.f.lat")} error={badCoords ? t("deliveries.f.coordsPair") : undefined}>
          <Input dir="ltr" inputMode="decimal" value={f.depot_lat} onChange={(e) => set("depot_lat", e.target.value)} disabled={locked} />
        </Field>
        <Field label={t("deliveries.f.lng")}>
          <Input dir="ltr" inputMode="decimal" value={f.depot_lng} onChange={(e) => set("depot_lng", e.target.value)} disabled={locked} />
        </Field>
      </div>
      <p className="-mt-1 text-xs text-ink-3">{t("deliveries.routes.f.depotHint")}</p>
      <Field label={t("deliveries.routes.f.notes")}>
        <Textarea rows={2} maxLength={4000} value={f.notes} onChange={(e) => set("notes", e.target.value)} />
      </Field>
      {error && <p className="text-sm text-serious">{error}</p>}
      <FormActions saving={saving} disabled={badCoords || !f.vehicle_id} label={r ? t("action.save") : t("deliveries.routes.new")} onCancel={onCancel} />
    </form>
  );
}

/** Mark delivered (with proof) or failed (with a reason). Shared by the delivery page and the run sheet. */
export function OutcomeForm({ delivery, outcome, onDone, onCancel }: {
  delivery: Pick<Delivery, "id" | "cod_amount" | "recipient_name">;
  outcome: "delivered" | "failed";
  onDone: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const tenant = useTenant();
  const qc = useQueryClient();
  const toast = useToast();
  const [podName, setPodName] = useState("");
  const [signature, setSignature] = useState<string | null>(null);
  const [cod, setCod] = useState(delivery.cod_amount > 0 ? String(delivery.cod_amount) : "");
  const [reason, setReason] = useState<FailureReason>("not_home");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const save = useMutation({
    mutationFn: () =>
      updateRow("deliveries", delivery.id, outcome === "delivered"
        ? { status: "delivered", pod_name: podName.trim(), pod_signature: signature, cod_collected: cod ? Number(cod) : 0 }
        : { status: "failed", failure_reason: reason, failure_note: note.trim() || null }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["deliveries"] });
      void qc.invalidateQueries({ queryKey: ["delivery_routes"] });
      toast.success(outcome === "delivered" ? t("deliveries.recordedDelivered") : t("deliveries.recordedFailed"));
      onDone();
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("common.error")),
  });

  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      {outcome === "delivered" ? (
        <>
          <Field label={t("deliveries.podName")} required>
            <Input value={podName} onChange={(e) => setPodName(e.target.value)} required maxLength={200} placeholder={delivery.recipient_name} autoFocus />
          </Field>
          <Field label={t("deliveries.signature")}>
            <SignaturePad onChange={setSignature} />
          </Field>
          {delivery.cod_amount > 0 && (
            <Field label={t("deliveries.codCollected")} hint={t("deliveries.codExpected", { amount: ltrText(formatMoney(delivery.cod_amount, tenant.currency)) })}>
              <Input type="number" min={0} step="0.001" value={cod} onChange={(e) => setCod(e.target.value)} required />
            </Field>
          )}
        </>
      ) : (
        <>
          <Field label={t("deliveries.failureReason")} required>
            <Select value={reason} onChange={(e) => setReason(e.target.value as FailureReason)}>
              {FAILURE_REASONS.map((r) => <option key={r} value={r}>{t(`deliveries.reason.${r}`)}</option>)}
            </Select>
          </Field>
          <Field label={t("deliveries.failureNote")}>
            <Textarea rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </>
      )}
      {error && <p className="text-sm text-serious">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>{t("action.cancel")}</Button>
        <Button type="submit" variant={outcome === "failed" ? "danger" : "primary"} loading={save.isPending}>
          {outcome === "delivered" ? t("deliveries.markDelivered") : t("deliveries.markFailed")}
        </Button>
      </div>
    </form>
  );
}

const MAX_PROBLEMS_SHOWN = 8;

export function ImportForm({ onDone, onCancel }: { onDone: (count: number) => void; onCancel: () => void }) {
  const t = useT();
  const tp = useTp();
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const parsed = useMemo(() => (text.trim() ? mapImportRows(parseCsv(text)) : null), [text]);
  const tooMany = (parsed?.rows.length ?? 0) > IMPORT_MAX_ROWS;
  const fieldLabel = (f: string) =>
    t(({ recipient_name: "deliveries.f.recipient", address: "deliveries.f.address", recipient_phone: "deliveries.f.phone", city: "deliveries.f.city",
      lat: "deliveries.f.lat", lng: "deliveries.f.lng", parcels: "deliveries.f.parcels", weight_kg: "deliveries.f.weight",
      cod_amount: "deliveries.f.cod", reference: "deliveries.f.reference", instructions: "deliveries.f.instructions" } as const)[f as "address"]);

  const save = useMutation({
    mutationFn: async () => {
      const { data, error: e } = await supabase.rpc("deliveries_import", { p_rows: parsed!.rows as never });
      if (e) throw wrapDbError(e);
      return Number(data ?? 0);
    },
    onSuccess: (n) => onDone(n),
    onError: (err) => setError(err instanceof Error ? err.message : t("common.error")),
  });

  const ready = parsed && parsed.rows.length > 0 && parsed.problems.length === 0 && !tooMany;
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (ready) save.mutate(); }}>
      <p className="text-sm text-ink-2">{t("deliveries.importHint")}</p>
      <Field label={t("deliveries.importFile")}>
        <input
          type="file"
          accept=".csv,text/csv"
          className="block w-full text-sm text-ink-2 file:me-3 file:rounded-lg file:border-0 file:bg-canvas file:px-3 file:py-2 file:text-sm file:font-medium file:text-ink"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (file) setText(await file.text());
          }}
        />
      </Field>
      <Field label={t("deliveries.importPaste")}>
        <Textarea dir="ltr" rows={5} value={text} onChange={(e) => setText(e.target.value)} className="font-mono text-xs"
          placeholder={"recipient,phone,address,city,latitude,longitude,parcels,cod\nAisha Al Balushi,+968 9123 4567,Way 3021,Muscat,23.5957,58.4167,2,12.500"} />
      </Field>
      {parsed && (
        <div className="space-y-1 text-sm">
          {tooMany ? (
            <p className="text-serious">{t("deliveries.importTooMany")}</p>
          ) : parsed.problems.length > 0 ? (
            <div className="rounded-lg border border-serious/30 bg-serious-soft p-3 text-serious">
              <p className="font-medium">{tp("deliveries.importProblems", parsed.problems.length)}</p>
              <ul className="mt-1 list-disc ps-5">
                {parsed.problems.slice(0, MAX_PROBLEMS_SHOWN).map((p, i) => (
                  <li key={i}>{t(`deliveries.importProblem.${p.problem}`, { line: p.line, field: fieldLabel(p.field) })}</li>
                ))}
              </ul>
              {parsed.problems.length > MAX_PROBLEMS_SHOWN && <p>{tp("deliveries.importMoreProblems", parsed.problems.length - MAX_PROBLEMS_SHOWN)}</p>}
            </div>
          ) : (
            <p className="text-good">{tp("deliveries.importRows", parsed.rows.length)}</p>
          )}
          {parsed.unknownHeaders.length > 0 && (
            <p className="text-xs text-ink-3">{t("deliveries.importUnknown", { columns: parsed.unknownHeaders.join(", ") })}</p>
          )}
        </div>
      )}
      {error && <p className="text-sm text-serious">{error}</p>}
      <FormActions saving={save.isPending} disabled={!ready} label={t("deliveries.importDo")} onCancel={onCancel} />
    </form>
  );
}
