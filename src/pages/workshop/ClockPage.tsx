import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LogIn, LogOut, Timer } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { listRows, wrapDbError } from "../../lib/db";
import { formatMoney } from "../../lib/format";
import { ltrText } from "../../lib/bidi";
import { elapsedLabel } from "../../../shared/workshop";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useT } from "../../i18n";
import { Bdi, Button, Card, ErrorState, Field, Input, LoadingState, Ltr } from "../../components/ui";
import { Combobox } from "../../components/Combobox";
import { useToast } from "../../components/Toast";
import { useEmployeePicker, useOpenWorkOrderPicker } from "./forms";
import { clockTime, personName, zonedInstant, todayInTz } from "./labels";
import { LABOR_SELECT, type Labor } from "./types";

function useNow(ms: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

export default function ClockPage() {
  const t = useT();
  const tenant = useTenant();
  const tz = tenant.timezone;
  const { session, isManager } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const now = useNow(30_000);
  const uid = session?.user.id ?? "";
  const [picked, setPicked] = useState("");
  const [woId, setWoId] = useState("");
  const [offNotes, setOffNotes] = useState("");
  const [error, setError] = useState("");

  const meQ = useQuery({
    queryKey: ["employees", "me", uid],
    enabled: !!uid,
    queryFn: async () =>
      (await listRows<{ id: string; first_name: string; last_name: string | null }>("employees", (q) =>
        q.select("id, first_name, last_name").eq("user_id", uid).eq("status", "active").limit(1)))[0] ?? null,
  });
  const employeeId = picked || meQ.data?.id || "";
  const employees = useEmployeePicker(employeeId);
  const wos = useOpenWorkOrderPicker(woId);
  const openQ = useQuery({
    queryKey: ["work_order_labor", "open"],
    queryFn: () => listRows<Labor>("work_order_labor", (q) => q.select(LABOR_SELECT).is("ended_at", null).order("started_at").limit(200)),
  });
  const todayQ = useQuery({
    queryKey: ["work_order_labor", "today"],
    queryFn: () =>
      listRows<Labor>("work_order_labor", (q) =>
        q.select(LABOR_SELECT).not("ended_at", "is", null).gte("started_at", zonedInstant(todayInTz(tz), 0, tz).toISOString())
          .order("ended_at", { ascending: false }).limit(200)),
  });
  const mine = (openQ.data ?? []).find((l) => l.employee_id === employeeId) ?? null;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["work_order_labor"] });
    void qc.invalidateQueries({ queryKey: ["work_order_lines"] });
  };
  const on = useMutation({
    mutationFn: async () => {
      const { error: err } = await supabase.rpc("workshop_clock_on", { p_work_order_id: woId, p_employee_id: employeeId });
      if (err) throw wrapDbError(err);
    },
    onSuccess: () => {
      setError("");
      setWoId("");
      refresh();
      toast.success(t("workshop.clock.clockedOn"));
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("common.error")),
  });
  const off = useMutation({
    mutationFn: async (laborId: string) => {
      const { data, error: err } = await supabase.rpc("workshop_clock_off", { p_labor_id: laborId, ...(offNotes.trim() ? { p_notes: offNotes.trim() } : {}) });
      if (err) throw wrapDbError(err);
      return data as number;
    },
    onSuccess: (hours) => {
      setError("");
      setOffNotes("");
      refresh();
      toast.success(t("workshop.clock.clockedOff", { hours: ltrText(String(hours ?? 0)) }));
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("common.error")),
  });

  if (meQ.isLoading || openQ.isLoading) return <LoadingState />;
  const canPick = isManager;
  const woText = (l: Labor) => (l.work_order ? `#${l.work_order.number} · ${l.work_order.title}` : "");

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <Card className="p-5 lg:col-span-2">
        {canPick ? (
          <Field label={t("workshop.clock.who")}>
            <Combobox {...employees} value={employeeId} onChange={setPicked} placeholder={t("workshop.clock.selectEmployee")} />
          </Field>
        ) : meQ.data ? (
          <div className="text-sm text-ink-3">{t("workshop.clock.you")}: <Bdi className="font-medium text-ink">{personName(meQ.data)}</Bdi></div>
        ) : (
          <p className="rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn">{t("workshop.clock.notLinked")}</p>
        )}

        {employeeId && (
          <div className="mt-5">
            {mine ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-good-soft text-good"><Timer className="h-6 w-6" /></span>
                  <div className="min-w-0">
                    <div className="text-xs text-ink-3">{t("workshop.clock.elapsed")}</div>
                    <Ltr className="text-3xl font-semibold tabular-nums text-ink">{elapsedLabel(mine.started_at, now)}</Ltr>
                  </div>
                </div>
                <p className="text-sm text-ink-2">
                  {t("workshop.clock.onFor", { wo: ltrText(woText(mine)), time: ltrText(clockTime(mine.started_at, tz)) })}
                </p>
                <Field label={t("workshop.clock.offNotes")}>
                  <Input value={offNotes} onChange={(e) => setOffNotes(e.target.value)} maxLength={1000} />
                </Field>
                <Button className="w-full" variant="danger" loading={off.isPending} onClick={() => off.mutate(mine.id)}>
                  <LogOut className="h-4 w-4 rtl:-scale-x-100" /> {t("workshop.clock.off")}
                </Button>
              </div>
            ) : (
              <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (woId) on.mutate(); }}>
                <p className="text-sm text-ink-3">{t("workshop.clock.idle")}</p>
                <Field label={t("workshop.f.workOrder")} required>
                  <Combobox {...wos} value={woId} onChange={setWoId} required clearable={false} placeholder={t("workshop.f.selectWorkOrder")} />
                </Field>
                <Button type="submit" className="w-full" loading={on.isPending} disabled={!woId}>
                  <LogIn className="h-4 w-4 rtl:-scale-x-100" /> {t("workshop.clock.on")}
                </Button>
              </form>
            )}
          </div>
        )}
        {error && <div className="mt-3"><ErrorState message={error} /></div>}
      </Card>

      <div className="space-y-4 lg:col-span-3">
        <Card className="p-4">
          <h2 className="mb-2 text-sm font-semibold text-ink">{t("workshop.clock.now")}</h2>
          {(openQ.data ?? []).length === 0 ? <p className="py-4 text-center text-sm text-ink-3">{t("workshop.clock.nowEmpty")}</p> : (
            <ul className="divide-y divide-line">
              {(openQ.data ?? []).map((l) => (
                <li key={l.id} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ink"><Bdi>{personName(l.employee)}</Bdi></div>
                    <div className="truncate text-xs text-ink-3">
                      <Link to={`/maintenance/work-orders/${l.work_order_id}`} className="hover:underline"><Bdi>{woText(l)}</Bdi></Link>
                    </div>
                  </div>
                  <Ltr className="shrink-0 tabular-nums text-sm text-ink-2">{elapsedLabel(l.started_at, now)}</Ltr>
                  {isManager && l.employee_id !== employeeId && (
                    <Button variant="secondary" loading={off.isPending && off.variables === l.id} onClick={() => off.mutate(l.id)}>
                      {t("workshop.clock.off")}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-4">
          <h2 className="mb-2 text-sm font-semibold text-ink">{t("workshop.clock.today")}</h2>
          {todayQ.isLoading ? <LoadingState /> : (todayQ.data ?? []).length === 0 ? (
            <p className="py-4 text-center text-sm text-ink-3">{t("workshop.clock.todayEmpty")}</p>
          ) : (
            <ul className="divide-y divide-line">
              {(todayQ.data ?? []).map((l) => (
                <li key={l.id} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-ink"><Bdi>{personName(l.employee)}</Bdi></div>
                    <div className="truncate text-xs text-ink-3"><Bdi>{woText(l)}</Bdi></div>
                  </div>
                  <div className="shrink-0 text-end">
                    <Ltr className="block text-sm text-ink">{`${clockTime(l.started_at, tz)}–${clockTime(l.ended_at!, tz)}`}</Ltr>
                    <span className="text-xs text-ink-3">
                      {t("workshop.labor.total", { hours: ltrText(String(l.hours ?? 0)), cost: ltrText(formatMoney(l.cost ?? 0, tenant.currency)) })}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
