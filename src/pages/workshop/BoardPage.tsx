import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Car, Plus, Timer, Warehouse, Wrench } from "lucide-react";
import { deleteRow, listRows, updateRow } from "../../lib/db";
import { formatDateTime } from "../../lib/format";
import { ltrText } from "../../lib/bidi";
import { BOOKING_TRANSITIONS, timelinePosition, type BookingStatus } from "../../../shared/workshop";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useT } from "../../i18n";
import { Badge, Bdi, Button, Card, ErrorState, Input, LoadingState, Ltr, Modal, StatCard } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { BookingForm } from "./forms";
import { bayTone, bookingBar, bookingTone, clockTime, todayInTz, zonedInstant } from "./labels";
import { BAY_SELECT, BOOKING_SELECT, type Bay, type Booking } from "./types";

const FROM_HOUR = 6;
const SPAN = 16; // 06:00 → 22:00

function BookingDetails({ booking, onClose }: { booking: Booking; onClose: () => void }) {
  const t = useT();
  const tenant = useTenant();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const done = () => {
    void qc.invalidateQueries({ queryKey: ["workshop_bookings"] });
    void qc.invalidateQueries({ queryKey: ["workshop_bays"] });
    void qc.invalidateQueries({ queryKey: ["work_orders"] });
  };
  const step = useMutation({
    mutationFn: (to: BookingStatus) => updateRow("workshop_bookings", booking.id, { status: to }),
    onSuccess: (_d, to) => {
      done();
      toast.success(t("workshop.statusSaved", { status: t(`workshop.booking.${to}`) }));
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("common.error")),
  });
  const remove = useMutation({
    mutationFn: () => deleteRow("workshop_bookings", booking.id),
    onSuccess: () => {
      done();
      toast.success(t("workshop.bookingDeleted"));
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("common.error")),
  });
  if (editing) {
    return (
      <BookingForm booking={booking} onCancel={() => setEditing(false)}
        onDone={() => { done(); toast.success(t("workshop.bookingSaved")); onClose(); }} />
    );
  }
  const next = BOOKING_TRANSITIONS[booking.status];
  const wo = booking.work_order;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={bookingTone[booking.status]}>{t(`workshop.booking.${booking.status}`)}</Badge>
        <Bdi className="font-medium text-ink">{booking.bay?.name}</Bdi>
      </div>
      {wo && (
        <div>
          <div className="text-sm text-ink"><Ltr>{t("workshop.woLabel", { number: wo.number })}</Ltr> · <Bdi>{wo.title}</Bdi></div>
          {wo.vehicles && <div className="text-xs text-ink-3"><Bdi>{wo.vehicles.name}</Bdi></div>}
        </div>
      )}
      <p className="text-sm text-ink-2">
        {t("workshop.slot", { from: ltrText(formatDateTime(booking.starts_at, tenant.timezone)), to: ltrText(formatDateTime(booking.ends_at, tenant.timezone)) })}
      </p>
      {booking.notes && <div className="text-sm text-ink-2"><Bdi>{booking.notes}</Bdi></div>}
      {error && <ErrorState message={error} />}
      <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-3">
        <Link to={`/maintenance/work-orders/${booking.work_order_id}`} className="me-auto self-center text-sm text-brand-700 hover:underline">
          {t("workshop.openWorkOrder")}
        </Link>
        {isManager && (booking.status === "scheduled" || booking.status === "canceled") && (
          <Button variant="ghost" loading={remove.isPending} onClick={() => remove.mutate()}>{t("action.delete")}</Button>
        )}
        {isManager && booking.status === "scheduled" && (
          <Button variant="secondary" onClick={() => setEditing(true)}>{t("action.edit")}</Button>
        )}
        {isManager && next.includes("canceled") && (
          <Button variant="secondary" loading={step.isPending} onClick={() => step.mutate("canceled")}>{t("workshop.cancelBooking")}</Button>
        )}
        {isManager && next.includes("in_progress") && (
          <Button loading={step.isPending} onClick={() => step.mutate("in_progress")}>{t("workshop.start")}</Button>
        )}
        {isManager && next.includes("done") && (
          <Button loading={step.isPending} onClick={() => step.mutate("done")}>{t("workshop.finish")}</Button>
        )}
      </div>
    </div>
  );
}

export default function BoardPage() {
  const t = useT();
  const tenant = useTenant();
  const tz = tenant.timezone;
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const today = todayInTz(tz);
  const [day, setDay] = useState(today);
  const [open, setOpen] = useState<Booking | null>(null);
  const [creating, setCreating] = useState<{ bay_id?: string; work_order_id?: string; starts_at?: string } | null>(null);
  const dayStart = useMemo(() => zonedInstant(day, FROM_HOUR, tz), [day, tz]);
  const dayEnd = new Date(dayStart.getTime() + SPAN * 3_600_000);
  const midnight = zonedInstant(today, 0, tz).toISOString();

  const baysQ = useQuery({
    queryKey: ["workshop_bays", "active"],
    queryFn: () => listRows<Bay>("workshop_bays", (q) => q.select(BAY_SELECT).eq("active", true).order("name").limit(100)),
  });
  const dayQ = useQuery({
    queryKey: ["workshop_bookings", "day", day],
    queryFn: () =>
      listRows<Booking>("workshop_bookings", (q) =>
        q.select(BOOKING_SELECT).lt("starts_at", dayEnd.toISOString()).gt("ends_at", dayStart.toISOString())
          .order("starts_at").limit(500)),
  });
  const liveQ = useQuery({
    queryKey: ["workshop_bookings", "live"],
    queryFn: () =>
      listRows<Booking>("workshop_bookings", (q) =>
        q.select(BOOKING_SELECT).or(`status.in.(scheduled,in_progress),and(status.eq.done,finished_at.gte.${midnight})`)
          .order("starts_at").limit(1000)),
  });
  const wosQ = useQuery({
    queryKey: ["work_orders", "workshop-open"],
    queryFn: () =>
      listRows<{ id: string; number: number; title: string; priority: string; vehicles: { name: string } | null }>("work_orders", (q) =>
        q.select("id, number, title, priority, vehicles(name)").in("status", ["open", "in_progress"])
          .order("number", { ascending: false }).limit(300)),
  });
  const clockedQ = useQuery({
    queryKey: ["work_order_labor", "open-count"],
    queryFn: () => listRows<{ id: string }>("work_order_labor", (q) => q.select("id").is("ended_at", null).limit(500)),
  });

  const live = liveQ.data ?? [];
  const inBay = live.filter((b) => b.status === "in_progress");
  const doneToday = live.filter((b) => b.status === "done");
  const booked = new Set(live.filter((b) => b.status !== "done").map((b) => b.work_order_id));
  const waiting = (wosQ.data ?? []).filter((w) => !booked.has(w.id));
  const bays = baysQ.data ?? [];
  const free = bays.filter((b) => b.status === "available").length;
  const occupied = bays.filter((b) => b.status === "occupied").length;
  const out = bays.filter((b) => b.status === "out_of_service").length;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["workshop_bookings"] });
    void qc.invalidateQueries({ queryKey: ["workshop_bays"] });
  };

  if (baysQ.isLoading || dayQ.isLoading) return <LoadingState />;
  const err = baysQ.error ?? dayQ.error ?? liveQ.error;
  if (err) return <ErrorState message={(err as Error).message} />;

  const hours = Array.from({ length: SPAN / 2 + 1 }, (_, i) => FROM_HOUR + i * 2);
  const nowPos = timelinePosition({ starts_at: new Date().toISOString(), ends_at: new Date(Date.now() + 60_000).toISOString() }, dayStart, SPAN);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={<Warehouse className="h-5 w-5" />} tone="green" label={t("workshop.kpi.bays")} value={free}
          sub={bays.length ? t("workshop.kpi.baysSub", { occupied, out }) : undefined} />
        <StatCard icon={<Car className="h-5 w-5 rtl:-scale-x-100" />} tone="violet" label={t("workshop.kpi.inBay")} value={inBay.length} />
        <StatCard icon={<Wrench className="h-5 w-5" />} tone="amber" label={t("workshop.kpi.waiting")} value={waiting.length} sub={t("workshop.kpi.waitingSub")} />
        <StatCard icon={<Timer className="h-5 w-5" />} label={t("workshop.kpi.clocked")} value={clockedQ.data?.length ?? 0} />
      </div>

      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold text-ink">{t("workshop.board.timeline")}</h2>
          <Input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} className="w-40" aria-label={t("workshop.board.date")} />
          {day !== today && <Button variant="ghost" onClick={() => setDay(today)}>{t("workshop.board.today")}</Button>}
          {isManager && bays.length > 0 && (
            <Button className="ms-auto" onClick={() => setCreating({ starts_at: day === today ? undefined : zonedInstant(day, 8, tz).toISOString() })}>
              <Plus className="h-4 w-4" /> {t("workshop.new")}
            </Button>
          )}
        </div>
        {bays.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-sm text-ink-3">{t("workshop.board.noBays")}</p>
            {isManager && <Link to="/workshop/bays" className="mt-2 inline-block text-sm text-brand-700 hover:underline">{t("workshop.board.addBays")}</Link>}
          </div>
        ) : (
          <div dir="ltr" className="overflow-x-auto">
            <div className="min-w-[640px]">
              <div className="ms-36 flex justify-between pb-1 text-[11px] text-ink-3">
                {hours.map((h) => <span key={h}>{`${String(h).padStart(2, "0")}:00`}</span>)}
              </div>
              {bays.map((bay) => {
                const rows = (dayQ.data ?? []).filter((b) => b.bay_id === bay.id);
                return (
                  <div key={bay.id} className="flex items-center gap-2 border-t border-line py-1.5">
                    <div className="sticky start-0 z-10 w-34 shrink-0 truncate bg-surface pe-2" dir="auto">
                      <div className="truncate text-sm font-medium text-ink"><Bdi>{bay.name}</Bdi></div>
                      <Badge tone={bayTone[bay.status]}>{t(`workshop.bayStatus.${bay.status}`)}</Badge>
                    </div>
                    <div className="relative h-10 flex-1 rounded-lg bg-canvas">
                      {day === today && nowPos && <div className="absolute inset-y-0 w-px bg-serious" style={{ left: `${nowPos.left}%` }} />}
                      {rows.map((b) => {
                        const pos = timelinePosition(b, dayStart, SPAN);
                        if (!pos) return null;
                        return (
                          <button key={b.id} type="button" onClick={() => setOpen(b)}
                            className={`absolute inset-y-1 overflow-hidden rounded-md px-1.5 text-start text-[11px] leading-4 ${bookingBar[b.status]}`}
                            style={{ left: `${pos.left}%`, width: `${Math.max(pos.width, 1.5)}%` }}
                            title={`${clockTime(b.starts_at, tz)}–${clockTime(b.ends_at, tz)}`}>
                            <span className="block truncate font-medium">{b.work_order ? `#${b.work_order.number}` : ""}</span>
                            <span className="block truncate" dir="auto">{b.work_order?.vehicles?.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            {(dayQ.data ?? []).length === 0 && <p className="pt-3 text-center text-sm text-ink-3">{t("workshop.board.emptyDay")}</p>}
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4">
          <h2 className="mb-2 text-sm font-semibold text-ink">{t("workshop.board.waiting")}</h2>
          {waiting.length === 0 ? <p className="py-4 text-center text-sm text-ink-3">{t("workshop.board.waitingEmpty")}</p> : (
            <ul className="divide-y divide-line">
              {waiting.slice(0, 12).map((w) => (
                <li key={w.id} className="flex items-center gap-2 py-2">
                  <Link to={`/maintenance/work-orders/${w.id}`} className="min-w-0 flex-1">
                    <div className="truncate text-sm text-ink"><Ltr className="text-brand-700">{`#${w.number}`}</Ltr> <Bdi>{w.title}</Bdi></div>
                    {w.vehicles && <div className="truncate text-xs text-ink-3"><Bdi>{w.vehicles.name}</Bdi></div>}
                  </Link>
                  {isManager && bays.length > 0 && (
                    <Button variant="secondary" onClick={() => setCreating({ work_order_id: w.id })}>
                      <CalendarClock className="h-4 w-4" /> {t("workshop.board.book")}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
        {([["inBay", inBay, "workshop.board.inBayEmpty"], ["doneToday", doneToday, "workshop.board.doneEmpty"]] as const).map(([key, list, empty]) => (
          <Card key={key} className="p-4">
            <h2 className="mb-2 text-sm font-semibold text-ink">{t(`workshop.board.${key}`)}</h2>
            {list.length === 0 ? <p className="py-4 text-center text-sm text-ink-3">{t(empty)}</p> : (
              <ul className="divide-y divide-line">
                {list.slice(0, 12).map((b) => (
                  <li key={b.id}>
                    <button type="button" onClick={() => setOpen(b)} className="flex w-full items-center gap-2 py-2 text-start hover:bg-canvas">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm text-ink">
                          <Ltr className="text-brand-700">{b.work_order ? `#${b.work_order.number}` : ""}</Ltr> <Bdi>{b.work_order?.title}</Bdi>
                        </div>
                        <div className="truncate text-xs text-ink-3"><Bdi>{b.bay?.name}</Bdi> · <Bdi>{b.work_order?.vehicles?.name}</Bdi></div>
                      </div>
                      <Ltr className="shrink-0 text-xs text-ink-2">{clockTime(key === "inBay" ? b.started_at ?? b.starts_at : b.finished_at ?? b.ends_at, tz)}</Ltr>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))}
      </div>

      <Modal title={open?.work_order ? t("workshop.woLabel", { number: open.work_order.number }) : t("workshop.editTitle")} open={open != null} onClose={() => setOpen(null)}>
        {open && <BookingDetails booking={open} onClose={() => setOpen(null)} />}
      </Modal>
      <Modal title={t("workshop.newTitle")} open={creating != null} onClose={() => setCreating(null)}>
        {creating && (
          <BookingForm defaults={creating} onCancel={() => setCreating(null)}
            onDone={() => { setCreating(null); refresh(); toast.success(t("workshop.booked")); }} />
        )}
      </Modal>
    </div>
  );
}
