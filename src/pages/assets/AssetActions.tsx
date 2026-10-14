import { useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { insertRow, wrapDbError } from "../../lib/db";
import { useVehiclePicker } from "../../lib/pickers";
import { disposalResult } from "../../lib/depreciation";
import { formatMoney } from "../../lib/format";
import { bdiText } from "../../lib/bidi";
import { useTenant } from "../../context/AuthContext";
import { useModules } from "../../context/ModulesContext";
import { useT } from "../../i18n";
import { Button, ErrorState, Field, Input, Modal, Select, Textarea } from "../../components/ui";
import { Combobox } from "../../components/Combobox";
import { useToast } from "../../components/Toast";
import { useEmployeePicker } from "../employees/pickers";
import { useWarehouses } from "../inventory/hooks";
import { currencyDecimals, depreciationInput, eventTypes, manualEvents, todayIso } from "./labels";
import type { Asset, AssetEventType } from "./types";

export type AssetAction = "assign" | "return" | "dispose" | "event";

/** One mutation shape for every flow: run, refresh the asset and its history, toast, close. */
function useAssetMutation(assetId: string, run: () => Promise<unknown>, successKey: Parameters<ReturnType<typeof useT>>[0], onDone: () => void) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState("");
  const m = useMutation({
    mutationFn: run,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["assets"] });
      void qc.invalidateQueries({ queryKey: ["asset_events", assetId] });
      toast.success(t(successKey));
      onDone();
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("common.error")),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError("");
    m.mutate();
  };
  return { error, submit, pending: m.isPending };
}

async function rpc(fn: "asset_assign" | "asset_return" | "asset_dispose", args: Record<string, unknown>) {
  const { error } = await supabase.rpc(fn, args as never);
  if (error) throw wrapDbError(error);
}

function Footer({ onCancel, pending, label, danger }: { onCancel: () => void; pending: boolean; label: string; danger?: boolean }) {
  const t = useT();
  return (
    <div className="flex justify-end gap-2">
      <Button type="button" variant="secondary" onClick={onCancel}>{t("action.cancel")}</Button>
      <Button type="submit" variant={danger ? "danger" : "primary"} loading={pending}>{label}</Button>
    </div>
  );
}

function AssignForm({ asset, onDone }: { asset: Asset; onDone: () => void }) {
  const t = useT();
  const { isEnabled } = useModules();
  const employeesOn = isEnabled("employees");
  const [employee, setEmployee] = useState(asset.assigned_employee_id ?? "");
  const [vehicle, setVehicle] = useState(asset.assigned_vehicle_id ?? "");
  const [location, setLocation] = useState(asset.location ?? "");
  const [note, setNote] = useState("");
  const employeePicker = useEmployeePicker(employee, { activeOnly: true, enabled: employeesOn });
  const vehiclePicker = useVehiclePicker(vehicle);
  const { error, submit, pending } = useAssetMutation(
    asset.id,
    () =>
      rpc("asset_assign", {
        p_asset: asset.id,
        p_employee: employee || null,
        p_vehicle: vehicle || null,
        p_location: location.trim() || null,
        p_note: note.trim() || null,
      }),
    "assets.assigned",
    onDone,
  );
  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <ErrorState message={error} />}
      <p className="text-sm text-ink-2">{t("assets.assignHint")}</p>
      {employeesOn && (
        <Field label={t("assets.employee")}>
          <Combobox {...employeePicker} value={employee} onChange={setEmployee} />
        </Field>
      )}
      <Field label={t("assets.vehicle")}>
        <Combobox {...vehiclePicker} value={vehicle} onChange={setVehicle} />
      </Field>
      <Field label={t("assets.f.location")}>
        <Input value={location} onChange={(e) => setLocation(e.target.value)} />
      </Field>
      <Field label={t("assets.note")}>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
      </Field>
      <Footer onCancel={onDone} pending={pending} label={t("assets.assign")} />
    </form>
  );
}

function ReturnForm({ asset, onDone }: { asset: Asset; onDone: () => void }) {
  const t = useT();
  const { isEnabled } = useModules();
  const inventoryOn = isEnabled("inventory");
  const warehousesQ = useWarehouses();
  const [warehouse, setWarehouse] = useState(asset.warehouse_id ?? "");
  const [location, setLocation] = useState(asset.location ?? "");
  const [note, setNote] = useState("");
  const { error, submit, pending } = useAssetMutation(
    asset.id,
    () =>
      rpc("asset_return", {
        p_asset: asset.id,
        p_warehouse: inventoryOn ? warehouse || null : null,
        p_location: location.trim() || null,
        p_note: note.trim() || null,
      }),
    "assets.returned",
    onDone,
  );
  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <ErrorState message={error} />}
      <p className="text-sm text-ink-2">{t("assets.returnHint")}</p>
      {inventoryOn && (
        <Field label={t("assets.f.warehouse")}>
          <Select value={warehouse} onChange={(e) => setWarehouse(e.target.value)}>
            <option value="">{t("assets.f.none")}</option>
            {(warehousesQ.data ?? []).map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </Select>
        </Field>
      )}
      <Field label={t("assets.f.location")}>
        <Input value={location} onChange={(e) => setLocation(e.target.value)} />
      </Field>
      <Field label={t("assets.note")}>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
      </Field>
      <Footer onCancel={onDone} pending={pending} label={t("assets.return")} />
    </form>
  );
}

function DisposeForm({ asset, onDone }: { asset: Asset; onDone: () => void }) {
  const t = useT();
  const tenant = useTenant();
  const [date, setDate] = useState(todayIso());
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const decimals = currencyDecimals(tenant.currency);
  const result =
    asset.purchase_cost != null && date
      ? disposalResult(depreciationInput(asset), date, value === "" ? 0 : Number(value), decimals)
      : null;
  const { error, submit, pending } = useAssetMutation(
    asset.id,
    () =>
      rpc("asset_dispose", {
        p_asset: asset.id,
        p_disposed_at: date,
        p_value: value === "" ? null : Number(value),
        p_note: note.trim() || null,
      }),
    "assets.disposedToast",
    onDone,
  );
  let resultLine: ReactNode = null;
  if (result != null && result !== 0) {
    const amount = bdiText(formatMoney(Math.abs(result), tenant.currency));
    resultLine = (
      <p className={result > 0 ? "text-sm text-good" : "text-sm text-serious"}>
        {result > 0 ? t("assets.gain", { amount }) : t("assets.loss", { amount })}
      </p>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <ErrorState message={error} />}
      <p className="rounded-lg bg-warn-soft p-3 text-sm text-warn">{t("assets.disposeWarning")}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("assets.disposeDate")} required>
          <Input type="date" dir="ltr" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        <Field label={`${t("assets.disposeValue")} (${tenant.currency})`}>
          <Input type="number" dir="ltr" min={0} step="0.001" value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
      </div>
      {resultLine}
      <Field label={t("assets.note")}>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
      </Field>
      <Footer onCancel={onDone} pending={pending} label={t("assets.dispose")} danger />
    </form>
  );
}

function localNow(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function EventForm({ asset, onDone }: { asset: Asset; onDone: () => void }) {
  const t = useT();
  const tenant = useTenant();
  const [type, setType] = useState<AssetEventType>("serviced");
  const [at, setAt] = useState(localNow());
  const [cost, setCost] = useState("");
  const [detail, setDetail] = useState("");
  const { error, submit, pending } = useAssetMutation(
    asset.id,
    () =>
      insertRow("asset_events", {
        asset_id: asset.id,
        event_type: type,
        at: at ? new Date(at).toISOString() : undefined,
        cost: cost === "" ? null : Number(cost),
        detail: detail.trim() || null,
      }),
    "assets.eventLogged",
    onDone,
  );
  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <ErrorState message={error} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("assets.eventType")}>
          <Select value={type} onChange={(e) => setType(e.target.value as AssetEventType)}>
            {manualEvents.map((v) => (
              <option key={v} value={v}>{t(eventTypes[v])}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("assets.eventAt")}>
          <Input type="datetime-local" dir="ltr" value={at} onChange={(e) => setAt(e.target.value)} />
        </Field>
        <Field label={`${t("assets.eventCost")} (${tenant.currency})`}>
          <Input type="number" dir="ltr" min={0} step="0.001" value={cost} onChange={(e) => setCost(e.target.value)} />
        </Field>
      </div>
      <Field label={t("assets.note")}>
        <Textarea value={detail} onChange={(e) => setDetail(e.target.value)} maxLength={2000} />
      </Field>
      <Footer onCancel={onDone} pending={pending} label={t("assets.logEvent")} />
    </form>
  );
}

export function AssetActionModal({ asset, action, onClose }: { asset: Asset; action: AssetAction | null; onClose: () => void }) {
  const t = useT();
  const titles: Record<AssetAction, Parameters<typeof t>[0]> = {
    assign: "assets.assignTitle",
    return: "assets.returnTitle",
    dispose: "assets.disposeTitle",
    event: "assets.eventTitle",
  };
  return (
    <Modal title={action ? t(titles[action]) : ""} open={!!action} onClose={onClose}>
      {action === "assign" && <AssignForm asset={asset} onDone={onClose} />}
      {action === "return" && <ReturnForm asset={asset} onDone={onClose} />}
      {action === "dispose" && <DisposeForm asset={asset} onDone={onClose} />}
      {action === "event" && <EventForm asset={asset} onDone={onClose} />}
    </Modal>
  );
}
