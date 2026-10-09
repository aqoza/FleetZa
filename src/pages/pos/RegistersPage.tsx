import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Store } from "lucide-react";
import { insertRow, listRows, updateRow } from "../../lib/db";
import { useAuth } from "../../context/AuthContext";
import { useModules } from "../../context/ModulesContext";
import { useT } from "../../i18n";
import { Badge, Bdi, Button, EmptyState, ErrorState, Field, Input, LoadingState, Modal, Select, Textarea } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { FormActions, FormError, onSubmit, textOrNull, useSubmit } from "./forms";
import { useRegisters, type PosRegister } from "./types";

export default function RegistersPage() {
  const t = useT();
  const { isManager } = useAuth();
  const q = useRegisters();
  const [editing, setEditing] = useState<PosRegister | "new" | null>(null);

  const columns: Array<DataTableColumn<PosRegister>> = [
    {
      id: "name",
      header: t("pos.registers.name"),
      cell: (r) => <span className="font-medium text-ink"><Bdi>{r.name}</Bdi></span>,
      sortValue: (r) => r.name,
      exportValue: (r) => r.name,
    },
    {
      id: "warehouse",
      header: t("pos.registers.warehouse"),
      cell: (r) => <span className="text-ink-2"><Bdi>{r.warehouse?.name ?? t("pos.registers.noStock")}</Bdi></span>,
      exportValue: (r) => r.warehouse?.name ?? "",
    },
    {
      id: "active",
      header: t("pos.registers.status"),
      cell: (r) => <Badge tone={r.active ? "green" : "slate"}>{r.active ? t("pos.registers.active") : t("pos.registers.inactive")}</Badge>,
      exportValue: (r) => (r.active ? "active" : "inactive"),
    },
  ];

  return (
    <div>
      {isManager && (
        <div className="mb-3 flex justify-end">
          <Button onClick={() => setEditing("new")}><Plus className="h-4 w-4" /> {t("pos.registers.new")}</Button>
        </div>
      )}
      {q.isLoading && <LoadingState />}
      {q.error && <ErrorState message={(q.error as Error).message} />}
      {q.data && (
        <DataTable<PosRegister>
          tableId="pos_registers"
          exportName="pos-registers"
          rows={q.data}
          rowKey={(r) => r.id}
          columns={columns}
          onRowClick={isManager ? (r) => setEditing(r) : undefined}
          empty={<EmptyState icon={<Store className="h-10 w-10" />} title={t("pos.reg.noRegisters")} description={t("pos.registers.emptyHint")} />}
        />
      )}
      <Modal title={editing === "new" ? t("pos.registers.new") : t("pos.registers.edit")} open={!!editing} onClose={() => setEditing(null)}>
        {editing && <RegisterForm register={editing === "new" ? null : editing} onDone={() => setEditing(null)} />}
      </Modal>
    </div>
  );
}

function RegisterForm({ register, onDone }: { register: PosRegister | null; onDone: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const { isEnabled } = useModules();
  const stockOn = isEnabled("inventory");
  const [name, setName] = useState(register?.name ?? "");
  const [warehouseId, setWarehouseId] = useState(register?.warehouse_id ?? "");
  const [active, setActive] = useState(register?.active ?? true);
  const [notes, setNotes] = useState(register?.notes ?? "");
  const warehousesQ = useQuery({
    queryKey: ["warehouses", "pos"],
    enabled: stockOn,
    queryFn: () => listRows<{ id: string; name: string }>("warehouses", (q) => q.select("id, name").eq("active", true).order("name").limit(200)),
  });
  const { error, saving, run } = useSubmit(() => {
    void qc.invalidateQueries({ queryKey: ["pos_registers"] });
    toast.success(t("pos.saved"));
    onDone();
  });
  const submit = onSubmit(() => run(async () => {
    const values = { name: name.trim(), warehouse_id: warehouseId || null, active, notes: textOrNull(notes) };
    if (register) await updateRow("pos_registers", register.id, values);
    else await insertRow("pos_registers", values);
  }));

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label={t("pos.registers.name")} required>
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required autoFocus />
      </Field>
      {stockOn && (
        <Field label={t("pos.registers.warehouse")} hint={t("pos.registers.warehouseHint")}>
          <Select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
            <option value="">{t("pos.registers.noStock")}</option>
            {(warehousesQ.data ?? []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </Select>
        </Field>
      )}
      <label className="flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4 rounded border-line" />
        {t("pos.registers.active")}
      </label>
      <Field label={t("pos.notes")}>
        <Textarea rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <FormError message={error} />
      <FormActions saving={saving} label={t("pos.save")} onCancel={onDone} />
    </form>
  );
}
