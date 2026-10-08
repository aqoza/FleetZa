import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus } from "lucide-react";
import { insertRow, updateRow, wrapDbError } from "../../lib/db";
import { supabase } from "../../lib/supabase";
import { useI18n, useT } from "../../i18n";
import {
  Badge, Bdi, Button, Card, ErrorState, Field, Input, LoadingState, Ltr, Modal,
} from "../../components/ui";
import { useToast } from "../../components/Toast";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { useHrSettings, useLeaveTypes } from "./hooks";
import { WEEKDAY_KEYS, leaveTypeName } from "./labels";
import { SetupHr } from "./SetupHr";
import type { LeaveType } from "./types";

function SettingsForm() {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useHrSettings();
  const [weekend, setWeekend] = useState<number[]>([5, 6]);
  const [hours, setHours] = useState("8");
  const [multiplier, setMultiplier] = useState("1.25");
  const [empPct, setEmpPct] = useState("0");
  const [erPct, setErPct] = useState("0");
  const [nationalsOnly, setNationalsOnly] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const s = q.data;
    if (!s) return;
    setWeekend(s.weekend_days);
    setHours(String(Number(s.standard_daily_hours)));
    setMultiplier(String(Number(s.overtime_multiplier)));
    setEmpPct(String(Number(s.social_employee_pct)));
    setErPct(String(Number(s.social_employer_pct)));
    setNationalsOnly(s.social_nationals_only);
  }, [q.data]);

  const inRange = (v: string, lo: number, hi: number) => v.trim() !== "" && Number(v) >= lo && Number(v) <= hi;
  const valid =
    weekend.length <= 3 && inRange(hours, 1, 24) && inRange(multiplier, 1, 5) && inRange(empPct, 0, 50) && inRange(erPct, 0, 50);

  const save = useMutation({
    mutationFn: async () => {
      const { error: e } = await supabase.rpc("save_hr_settings", {
        p_weekend_days: weekend,
        p_standard_daily_hours: Number(hours),
        p_overtime_multiplier: Number(multiplier),
        p_social_employee_pct: Number(empPct),
        p_social_employer_pct: Number(erPct),
        p_social_nationals_only: nationalsOnly,
      });
      if (e) throw wrapDbError(e);
    },
    onSuccess: () => {
      setError("");
      void qc.invalidateQueries({ queryKey: ["hr_settings"] });
      toast.success(t("toast.saved"));
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (valid) save.mutate();
  };

  if (q.isLoading) return <LoadingState />;
  return (
    <Card className="p-4 sm:p-5">
      <h2 className="mb-3 text-base font-semibold text-ink">{t("hr.settingsTitle")}</h2>
      <form onSubmit={submit} className="space-y-4">
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-ink-2">{t("hr.weekend")}</legend>
          <div className="flex flex-wrap gap-2">
            {WEEKDAY_KEYS.map((key, day) => {
              const on = weekend.includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setWeekend((w) => (on ? w.filter((d) => d !== day) : [...w, day].sort()))}
                  className={
                    on
                      ? "rounded-full bg-brand-600 px-3 py-1 text-sm font-medium text-white"
                      : "rounded-full border border-line bg-surface px-3 py-1 text-sm text-ink-2 hover:bg-canvas"
                  }
                >
                  {t(key)}
                </button>
              );
            })}
          </div>
          <p className="mt-1 text-xs text-ink-3">{weekend.length > 3 ? t("hr.weekendTooMany") : t("hr.weekendHint")}</p>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("hr.dailyHours")} error={inRange(hours, 1, 24) ? undefined : t("hr.rangeError", { min: 1, max: 24 })}>
            <Input type="number" inputMode="decimal" step="0.5" min={1} max={24} value={hours} onChange={(e) => setHours(e.target.value)} dir="ltr" />
          </Field>
          <Field label={t("hr.overtimeMultiplier")} hint={t("hr.overtimeMultiplierHint")} error={inRange(multiplier, 1, 5) ? undefined : t("hr.rangeError", { min: 1, max: 5 })}>
            <Input type="number" inputMode="decimal" step="0.05" min={1} max={5} value={multiplier} onChange={(e) => setMultiplier(e.target.value)} dir="ltr" />
          </Field>
          <Field label={t("hr.socialEmployee")} error={inRange(empPct, 0, 50) ? undefined : t("hr.rangeError", { min: 0, max: 50 })}>
            <Input type="number" inputMode="decimal" step="0.01" min={0} max={50} value={empPct} onChange={(e) => setEmpPct(e.target.value)} dir="ltr" />
          </Field>
          <Field label={t("hr.socialEmployer")} error={inRange(erPct, 0, 50) ? undefined : t("hr.rangeError", { min: 0, max: 50 })}>
            <Input type="number" inputMode="decimal" step="0.01" min={0} max={50} value={erPct} onChange={(e) => setErPct(e.target.value)} dir="ltr" />
          </Field>
        </div>
        <label className="flex items-start gap-2 text-sm text-ink-2">
          <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-line" checked={nationalsOnly} onChange={(e) => setNationalsOnly(e.target.checked)} />
          <span>
            {t("hr.socialNationalsOnly")}
            <span className="block text-xs text-ink-3">{t("hr.socialNationalsOnlyHint")}</span>
          </span>
        </label>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end">
          <Button type="submit" loading={save.isPending} disabled={!valid}>{t("action.save")}</Button>
        </div>
      </form>
    </Card>
  );
}

function LeaveTypeForm({ type, onDone }: { type: LeaveType | null; onDone: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [code, setCode] = useState(type?.code ?? "");
  const [name, setName] = useState(type?.name ?? "");
  const [nameAr, setNameAr] = useState(type?.name_ar ?? "");
  const [days, setDays] = useState(type?.days_per_year == null ? "" : String(Number(type.days_per_year)));
  const [paid, setPaid] = useState(type?.paid ?? true);
  const [active, setActive] = useState(type?.active ?? true);
  const [error, setError] = useState("");
  const codeOk = /^[a-z][a-z0-9_]{1,30}$/.test(code);
  const daysOk = days.trim() === "" || (Number(days) >= 0 && Number(days) <= 366);
  const valid = codeOk && name.trim() !== "" && daysOk;

  const save = useMutation({
    mutationFn: () => {
      const values = {
        name: name.trim(),
        name_ar: nameAr.trim() || null,
        days_per_year: days.trim() === "" ? null : Number(days),
        paid,
        active,
      };
      return type ? updateRow<LeaveType>("leave_types", type.id, values) : insertRow<LeaveType>("leave_types", { ...values, code });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["leave_types"] });
      void qc.invalidateQueries({ queryKey: ["leave_balances"] });
      toast.success(t("toast.saved"));
      onDone();
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) save.mutate();
      }}
      className="space-y-4"
    >
      {!type && (
        <Field label={t("hr.typeCode")} hint={t("hr.typeCodeHint")} error={code === "" || codeOk ? undefined : t("hr.typeCodeHint")} required>
          <Input value={code} onChange={(e) => setCode(e.target.value.toLowerCase())} dir="ltr" required />
        </Field>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("hr.typeName")} required>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required />
        </Field>
        <Field label={t("hr.typeNameAr")}>
          <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} maxLength={100} dir="rtl" />
        </Field>
      </div>
      <Field label={t("hr.daysPerYear")} hint={t("hr.daysPerYearHint")} error={daysOk ? undefined : t("hr.rangeError", { min: 0, max: 366 })}>
        <Input type="number" inputMode="decimal" step="0.5" min={0} max={366} value={days} onChange={(e) => setDays(e.target.value)} dir="ltr" />
      </Field>
      <div className="flex flex-wrap gap-4 text-sm text-ink-2">
        <label className="flex items-center gap-2">
          <input type="checkbox" className="h-4 w-4 rounded border-line" checked={paid} onChange={(e) => setPaid(e.target.checked)} />
          {t("hr.paidLeave")}
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" className="h-4 w-4 rounded border-line" checked={active} onChange={(e) => setActive(e.target.checked)} />
          {t("hr.typeActive")}
        </label>
      </div>
      {error && <ErrorState message={error} />}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>{t("action.cancel")}</Button>
        <Button type="submit" loading={save.isPending} disabled={!valid}>{t("action.save")}</Button>
      </div>
    </form>
  );
}

function LeaveTypes() {
  const t = useT();
  const { language } = useI18n();
  const q = useLeaveTypes();
  const [editing, setEditing] = useState<LeaveType | "new" | null>(null);
  const columns: Array<DataTableColumn<LeaveType>> = [
    {
      id: "name",
      header: t("hr.typeName"),
      cell: (lt) => (
        <>
          <Bdi>{leaveTypeName(lt, language)}</Bdi>
          <div className="text-xs text-ink-3"><Ltr>{lt.code}</Ltr></div>
        </>
      ),
      sortValue: (lt) => lt.name,
      exportValue: (lt) => lt.name,
    },
    {
      id: "days",
      header: t("hr.daysPerYear"),
      align: "end",
      cell: (lt) => <span className="tabular-nums">{lt.days_per_year == null ? t("hr.notTracked") : <Ltr>{Number(lt.days_per_year)}</Ltr>}</span>,
      sortValue: (lt) => (lt.days_per_year == null ? null : Number(lt.days_per_year)),
    },
    {
      id: "paid",
      header: t("hr.paidLeave"),
      minBreakpoint: "sm",
      cell: (lt) => (lt.paid ? <Badge tone="green">{t("hr.paid")}</Badge> : <Badge tone="yellow">{t("hr.unpaid")}</Badge>),
    },
    {
      id: "active",
      header: t("common.status"),
      minBreakpoint: "sm",
      cell: (lt) => (lt.active ? <Badge tone="blue">{t("hr.typeActive")}</Badge> : <Badge>{t("hr.typeInactive")}</Badge>),
    },
    {
      id: "edit",
      header: t("common.actions"),
      align: "end",
      cell: (lt) => (
        <Button variant="ghost" className="px-2 py-1" onClick={() => setEditing(lt)} aria-label={t("action.edit")} title={t("action.edit")}>
          <Pencil className="h-4 w-4" />
        </Button>
      ),
    },
  ];
  if (q.isLoading) return <LoadingState />;
  if (q.error) return <ErrorState message={(q.error as Error).message} />;
  return (
    <Card className="p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-ink">{t("hr.leaveTypes")}</h2>
        <Button variant="secondary" onClick={() => setEditing("new")}>
          <Plus className="h-4 w-4" /> {t("hr.addLeaveType")}
        </Button>
      </div>
      {(q.data ?? []).length === 0 ? (
        <SetupHr />
      ) : (
        <DataTable<LeaveType> tableId="hr-leave-types" rows={q.data ?? []} rowKey={(lt) => lt.id} columns={columns} />
      )}
      <Modal
        title={editing === "new" ? t("hr.addLeaveType") : t("hr.editLeaveType")}
        open={editing !== null}
        onClose={() => setEditing(null)}
      >
        {editing !== null && <LeaveTypeForm type={editing === "new" ? null : editing} onDone={() => setEditing(null)} />}
      </Modal>
    </Card>
  );
}

export default function SettingsPage() {
  return (
    <div className="grid gap-4 xl:grid-cols-[2fr_3fr]">
      <div>
        <SettingsForm />
      </div>
      <div>
        <LeaveTypes />
      </div>
    </div>
  );
}
