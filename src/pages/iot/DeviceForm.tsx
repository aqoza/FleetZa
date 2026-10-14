import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { insertRow, updateRow } from "../../lib/db";
import { DEVICE_TYPES, type DeviceType } from "../../lib/iot";
import { useVehiclePicker } from "../../lib/pickers";
import { useT } from "../../i18n";
import { Button, ErrorState, Field, Input, Modal, Select, Textarea } from "../../components/ui";
import { Combobox } from "../../components/Combobox";
import { useToast } from "../../components/Toast";
import type { DeviceStatus, IotDevice } from "./types";

const STATUSES: DeviceStatus[] = ["active", "inactive", "faulty"];

export function DeviceForm({ device, onClose }: { device: IotDevice | null; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState(() => ({
    serial: device?.serial ?? "",
    name: device?.name ?? "",
    type: (device?.device_type ?? "temperature") as DeviceType,
    vehicle: device?.vehicle_id ?? "",
    asset: device?.asset_label ?? "",
    status: (device?.status ?? "active") as DeviceStatus,
    notes: device?.notes ?? "",
  }));
  const [error, setError] = useState("");
  const picker = useVehiclePicker(form.vehicle);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const m = useMutation({
    mutationFn: () => {
      const values = {
        serial: form.serial.trim(),
        name: form.name.trim(),
        device_type: form.type,
        vehicle_id: form.vehicle || null,
        asset_label: form.asset.trim() || null,
        status: form.status,
        notes: form.notes.trim() || null,
      };
      return device ? updateRow("iot_devices", device.id, values) : insertRow("iot_devices", values);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["iot_devices"] });
      void qc.invalidateQueries({ queryKey: ["picker", "iot_devices"] });
      toast.success(t("iot.deviceSaved"));
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("common.error")),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError("");
    m.mutate();
  };

  return (
    <Modal title={t(device ? "iot.editDevice" : "iot.addDevice")} open onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {error && <ErrorState message={error} />}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t("iot.f.serial")} hint={t("iot.f.serialHint")} required>
            <Input dir="ltr" maxLength={100} value={form.serial} onChange={(e) => set("serial", e.target.value)} required />
          </Field>
          <Field label={t("iot.f.name")} required>
            <Input maxLength={120} value={form.name} onChange={(e) => set("name", e.target.value)} required />
          </Field>
          <Field label={t("iot.f.type")} required>
            <Select value={form.type} onChange={(e) => set("type", e.target.value as DeviceType)}>
              {DEVICE_TYPES.map((ty) => (
                <option key={ty} value={ty}>{t(`iot.type.${ty}`)}</option>
              ))}
            </Select>
          </Field>
          <Field label={t("iot.f.status")} required>
            <Select value={form.status} onChange={(e) => set("status", e.target.value as DeviceStatus)}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{t(`iot.status.${s}`)}</option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={t("iot.f.vehicle")}>
          <Combobox {...picker} value={form.vehicle} onChange={(v) => set("vehicle", v)} />
        </Field>
        <Field label={t("iot.f.assetLabel")} hint={t("iot.f.assetLabelHint")}>
          <Input maxLength={120} value={form.asset} onChange={(e) => set("asset", e.target.value)} />
        </Field>
        <Field label={t("iot.f.notes")}>
          <Textarea rows={2} maxLength={2000} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>{t("action.cancel")}</Button>
          <Button type="submit" loading={m.isPending} disabled={!form.serial.trim() || !form.name.trim()}>
            {t("action.save")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
