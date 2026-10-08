import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { insertRow, listRows, updateRow, wrapDbError } from "../../lib/db";
import { formatDateTime } from "../../lib/format";
import { ltrText, bdiText } from "../../lib/bidi";
import { useEntityPicker, type Picker } from "../../lib/pickers";
import { BAY_TYPES, findConflict, type BayType } from "../../../shared/workshop";
import { useTenant } from "../../context/AuthContext";
import { useT } from "../../i18n";
import { Button, Field, Input, Select, Textarea } from "../../components/ui";
import { Combobox } from "../../components/Combobox";
import { useToast } from "../../components/Toast";
import { fromLocalInput, toLocalInput } from "./labels";
import type { Bay, Booking, Labor } from "./types";

function FormActions({ saving, label, onCancel, disabled }: { saving: boolean; label: string; onCancel: () => void; disabled?: boolean }) {
  const t = useT();
  return (
    <div className="flex justify-end gap-2">
      <Button type="button" variant="secondary" onClick={onCancel}>{t("action.cancel")}</Button>
      <Button type="submit" loading={saving} disabled={disabled}>{label}</Button>
    </div>
  );
}

const errText = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

// --- Pickers ----------------------------------------------------------------

export function useBayPicker(selectedId: string): Picker {
  return useEntityPicker<Bay>({
    table: "workshop_bays",
    selectedId,
    searchColumns: ["name", "code"],
    orderBy: "name",
    toOption: (b) => ({ value: b.id, label: b.name, meta: b.code ?? undefined }),
    filter: (q) => q.eq("active", true).neq("status", "out_of_service"),
    scope: ["workshop-bays-bookable"],
  });
}

export function useOpenWorkOrderPicker(selectedId: string): Picker {
  return useEntityPicker<{ id: string; number: number; title: string }>({
    table: "work_orders",
    selectedId,
    searchColumns: ["title"],
    orderBy: "number",
    ascending: false,
    toOption: (w) => ({ value: w.id, label: `#${w.number} · ${w.title}` }),
    filter: (q) => q.in("status", ["open", "in_progress"]),
    scope: ["workshop-open-wos"],
  });
}

export function useEmployeePicker(selectedId: string): Picker {
  return useEntityPicker<{ id: string; first_name: string; last_name: string | null; job_title: string | null }>({
    table: "employees",
    selectedId,
    searchColumns: ["first_name", "last_name", "name_ar", "doc_number"],
    orderBy: "first_name",
    toOption: (e) => ({ value: e.id, label: `${e.first_name} ${e.last_name ?? ""}`.trim(), meta: e.job_title ?? undefined }),
    filter: (q) => q.eq("status", "active"),
    scope: ["workshop-employees"],
  });
}

// --- Booking ----------------------------------------------------------------

export function BookingForm({ booking, defaults, onDone, onCancel }: {
  booking?: Booking;
  defaults?: { bay_id?: string; work_order_id?: string; starts_at?: string };
  onDone: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const tenant = useTenant();
  const b = booking;
  const start0 = b?.starts_at ?? defaults?.starts_at ?? new Date(Math.ceil(Date.now() / 3_600_000) * 3_600_000).toISOString();
  const [f, setF] = useState({
    bay_id: b?.bay_id ?? defaults?.bay_id ?? "", work_order_id: b?.work_order_id ?? defaults?.work_order_id ?? "",
    starts_at: toLocalInput(start0),
    ends_at: toLocalInput(b?.ends_at ?? new Date(Date.parse(start0) + 2 * 3_600_000).toISOString()),
    notes: b?.notes ?? "",
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const bays = useBayPicker(f.bay_id);
  const wos = useOpenWorkOrderPicker(f.work_order_id);
  const [error, setError] = useState("");
  const startIso = fromLocalInput(f.starts_at);
  const endIso = fromLocalInput(f.ends_at);
  const badOrder = !!startIso && !!endIso && endIso <= startIso;

  // Live bookings of the chosen bay around the slot, to warn before saving.
  const nearQ = useQuery({
    queryKey: ["workshop_bookings", "near", f.bay_id, startIso?.slice(0, 10)],
    enabled: !!f.bay_id && !!startIso,
    queryFn: () =>
      listRows<Booking>("workshop_bookings", (q) =>
        q.select("id, bay_id, starts_at, ends_at, status").eq("bay_id", f.bay_id).in("status", ["scheduled", "in_progress"])
          .gte("ends_at", new Date(Date.parse(startIso!) - 7 * 86_400_000).toISOString())
          .lte("starts_at", new Date(Date.parse(startIso!) + 8 * 86_400_000).toISOString()).limit(500)),
  });
  const conflict = startIso && endIso && !badOrder && f.bay_id
    ? findConflict({ id: b?.id, bay_id: f.bay_id, starts_at: startIso, ends_at: endIso, status: "scheduled" }, nearQ.data ?? [])
    : null;
  const bayName = bays.options.find((o) => o.value === f.bay_id)?.label ?? "";

  const save = useMutation({
    mutationFn: async () => {
      const row = { bay_id: f.bay_id, starts_at: startIso, ends_at: endIso, notes: f.notes.trim() || null };
      if (b) await updateRow("workshop_bookings", b.id, row);
      else await insertRow("workshop_bookings", { ...row, work_order_id: f.work_order_id });
    },
    onSuccess: onDone,
    onError: (err) => setError(errText(err, t("common.error"))),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (badOrder || !f.bay_id || !f.work_order_id) return;
    save.mutate();
  }

  return (
    <form className="space-y-3" onSubmit={submit}>
      <Field label={t("workshop.f.workOrder")} required>
        <Combobox {...wos} value={f.work_order_id} onChange={(v) => set("work_order_id", v)} required clearable={false}
          disabled={!!b} placeholder={t("workshop.f.selectWorkOrder")} />
      </Field>
      <Field label={t("workshop.f.bay")} required>
        <Combobox {...bays} value={f.bay_id} onChange={(v) => set("bay_id", v)} required clearable={false} placeholder={t("workshop.f.selectBay")} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("workshop.f.starts")} required error={badOrder ? t("workshop.f.endsAfter") : undefined}>
          <Input type="datetime-local" value={f.starts_at} onChange={(e) => set("starts_at", e.target.value)} required />
        </Field>
        <Field label={t("workshop.f.ends")} required>
          <Input type="datetime-local" value={f.ends_at} onChange={(e) => set("ends_at", e.target.value)} required min={f.starts_at} />
        </Field>
      </div>
      {conflict && (
        <p className="rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn">
          {t("workshop.f.conflict", {
            bay: bdiText(bayName),
            from: ltrText(formatDateTime(conflict.starts_at, tenant.timezone)),
            to: ltrText(formatDateTime(conflict.ends_at, tenant.timezone)),
          })}
        </p>
      )}
      <Field label={t("workshop.f.notes")}>
        <Textarea rows={2} maxLength={1000} value={f.notes} onChange={(e) => set("notes", e.target.value)} />
      </Field>
      {error && <p className="text-sm text-serious">{error}</p>}
      <FormActions saving={save.isPending} disabled={badOrder || !!conflict} label={b ? t("action.save") : t("workshop.board.book")} onCancel={onCancel} />
    </form>
  );
}

// --- Bay ----------------------------------------------------------------------

export function BayForm({ bay, onDone, onCancel }: { bay?: Bay; onDone: () => void; onCancel: () => void }) {
  const t = useT();
  const [f, setF] = useState({
    name: bay?.name ?? "", code: bay?.code ?? "", bay_type: (bay?.bay_type ?? "general") as BayType,
    out: bay?.status === "out_of_service", active: bay?.active ?? true, notes: bay?.notes ?? "",
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const [error, setError] = useState("");
  const save = useMutation({
    mutationFn: async () => {
      // "occupied" belongs to the bookings; only toggle out of service here.
      const status = f.out ? "out_of_service" : bay?.status === "occupied" ? "occupied" : "available";
      const row = { name: f.name.trim(), code: f.code.trim() || null, bay_type: f.bay_type, status, active: f.active, notes: f.notes.trim() || null };
      if (bay) await updateRow("workshop_bays", bay.id, row);
      else await insertRow("workshop_bays", row);
    },
    onSuccess: onDone,
    onError: (err) => setError(errText(err, t("common.error"))),
  });
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <Field label={t("workshop.bays.f.name")} required>
            <Input value={f.name} onChange={(e) => set("name", e.target.value)} required maxLength={100} />
          </Field>
        </div>
        <Field label={t("workshop.bays.f.code")}>
          <Input dir="ltr" value={f.code} onChange={(e) => set("code", e.target.value)} maxLength={20} placeholder="L1" />
        </Field>
      </div>
      <Field label={t("workshop.bays.f.type")}>
        <Select value={f.bay_type} onChange={(e) => set("bay_type", e.target.value as BayType)}>
          {BAY_TYPES.map((b) => <option key={b} value={b}>{t(`workshop.bayType.${b}`)}</option>)}
        </Select>
      </Field>
      <label className="flex items-start gap-2 text-sm text-ink-2">
        <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-line" checked={f.out} onChange={(e) => set("out", e.target.checked)} />
        <span>
          {t("workshop.bays.f.outOfService")}
          <span className="block text-xs text-ink-3">{t("workshop.bays.f.outHint")}</span>
        </span>
      </label>
      <label className="flex items-center gap-2 text-sm text-ink-2">
        <input type="checkbox" className="h-4 w-4 rounded border-line" checked={f.active} onChange={(e) => set("active", e.target.checked)} />
        {t("workshop.bays.f.active")}
      </label>
      <Field label={t("workshop.bays.f.notes")}>
        <Textarea rows={2} maxLength={1000} value={f.notes} onChange={(e) => set("notes", e.target.value)} />
      </Field>
      {error && <p className="text-sm text-serious">{error}</p>}
      <FormActions saving={save.isPending} label={bay ? t("action.save") : t("workshop.bays.new")} onCancel={onCancel} />
    </form>
  );
}

// --- Labor (manual entry / edit) ---------------------------------------------

export function LaborForm({ workOrderId, labor, onDone, onCancel }: {
  workOrderId: string;
  labor?: Labor;
  onDone: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const l = labor;
  const now = new Date().toISOString();
  const [f, setF] = useState({
    employee_id: l?.employee_id ?? "", started_at: toLocalInput(l?.started_at ?? new Date(Date.now() - 3_600_000).toISOString()),
    ended_at: toLocalInput(l?.ended_at ?? now), hours: l?.hours?.toString() ?? "", notes: l?.notes ?? "",
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const employees = useEmployeePicker(f.employee_id);
  const [error, setError] = useState("");
  const badOrder = !!f.ended_at && f.ended_at < f.started_at;
  const save = useMutation({
    mutationFn: async () => {
      const row = {
        started_at: fromLocalInput(f.started_at), ended_at: fromLocalInput(f.ended_at),
        hours: f.hours.trim() === "" ? null : Number(f.hours), notes: f.notes.trim() || null,
      };
      if (l) await updateRow("work_order_labor", l.id, row);
      else await insertRow("work_order_labor", { ...row, work_order_id: workOrderId, employee_id: f.employee_id });
    },
    onSuccess: onDone,
    onError: (err) => setError(errText(err, t("common.error"))),
  });
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (!badOrder && f.employee_id) save.mutate(); }}>
      <Field label={t("workshop.labor.employee")} required>
        <Combobox {...employees} value={f.employee_id} onChange={(v) => set("employee_id", v)} required clearable={false}
          disabled={!!l} placeholder={t("workshop.clock.selectEmployee")} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("workshop.labor.started")} required error={badOrder ? t("workshop.f.endsAfter") : undefined}>
          <Input type="datetime-local" value={f.started_at} onChange={(e) => set("started_at", e.target.value)} required max={toLocalInput(now)} />
        </Field>
        <Field label={t("workshop.labor.ended")} required>
          <Input type="datetime-local" value={f.ended_at} onChange={(e) => set("ended_at", e.target.value)} required max={toLocalInput(now)} />
        </Field>
      </div>
      <Field label={t("workshop.labor.hours")} hint={t("workshop.labor.hoursHint")}>
        <Input type="number" min={0} max={168} step="0.25" value={f.hours} onChange={(e) => set("hours", e.target.value)} />
      </Field>
      <Field label={t("workshop.labor.notes")}>
        <Textarea rows={2} maxLength={1000} value={f.notes} onChange={(e) => set("notes", e.target.value)} />
      </Field>
      {error && <p className="text-sm text-serious">{error}</p>}
      <FormActions saving={save.isPending} disabled={badOrder} label={l ? t("action.save") : t("workshop.labor.add")} onCancel={onCancel} />
    </form>
  );
}

// --- Parts --------------------------------------------------------------------

export function IssuePartForm({ workOrderId, onDone, onCancel }: { workOrderId: string; onDone: () => void; onCancel: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [itemId, setItemId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [qty, setQty] = useState("1");
  const [error, setError] = useState("");
  const items = useEntityPicker<{ id: string; name: string; sku: string | null }>({
    table: "inventory_items",
    selectedId: itemId,
    searchColumns: ["name", "sku", "barcode"],
    orderBy: "name",
    toOption: (i) => ({ value: i.id, label: i.name, meta: i.sku ?? undefined }),
    filter: (q) => q.eq("active", true),
    scope: ["workshop-items"],
  });
  const warehouses = useEntityPicker<{ id: string; name: string; code: string | null; is_default: boolean }>({
    table: "warehouses",
    selectedId: warehouseId,
    searchColumns: ["name", "code"],
    orderBy: "name",
    toOption: (w) => ({ value: w.id, label: w.name, meta: w.code ?? undefined }),
    filter: (q) => q.eq("active", true),
    scope: ["workshop-warehouses"],
  });
  const issue = useMutation({
    mutationFn: async () => {
      const { error: err } = await supabase.rpc("workshop_issue_part", {
        p_work_order_id: workOrderId, p_item_id: itemId, p_warehouse_id: warehouseId, p_qty: Number(qty),
      });
      if (err) throw wrapDbError(err);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["work_order_lines", workOrderId] });
      void qc.invalidateQueries({ queryKey: ["work_orders"] });
      void qc.invalidateQueries({ queryKey: ["stock_levels"] });
      toast.success(t("workshop.parts.issued"));
      onDone();
    },
    onError: (err) => setError(errText(err, t("common.error"))),
  });
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (itemId && warehouseId && Number(qty) > 0) issue.mutate(); }}>
      <p className="text-xs text-ink-3">{t("workshop.parts.hint")}</p>
      <Field label={t("workshop.parts.item")} required>
        <Combobox {...items} value={itemId} onChange={setItemId} required clearable={false} placeholder={t("workshop.parts.selectItem")} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <Field label={t("workshop.parts.warehouse")} required>
            <Combobox {...warehouses} value={warehouseId} onChange={setWarehouseId} required clearable={false}
              placeholder={t("workshop.parts.selectWarehouse")} />
          </Field>
        </div>
        <Field label={t("workshop.parts.qty")} required>
          <Input type="number" min={0.01} step="0.01" value={qty} onChange={(e) => setQty(e.target.value)} required />
        </Field>
      </div>
      {error && <p className="text-sm text-serious">{error}</p>}
      <FormActions saving={issue.isPending} label={t("workshop.parts.issue")} onCancel={onCancel} />
    </form>
  );
}
