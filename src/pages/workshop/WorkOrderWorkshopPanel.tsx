/**
 * Workshop card on the work order page: bay bookings, technician time
 * (manual entries, edit, delete) and issuing parts from stock.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Clock, Package, Trash2 } from "lucide-react";
import { deleteRow, listRows } from "../../lib/db";
import { formatDateTime, formatMoney } from "../../lib/format";
import { ltrText } from "../../lib/bidi";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useModules } from "../../context/ModulesContext";
import { useT } from "../../i18n";
import { Badge, Bdi, Button, Card, ErrorState, Ltr, Modal } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { BookingForm, IssuePartForm, LaborForm } from "./forms";
import { bookingTone, personName } from "./labels";
import { BOOKING_SELECT, LABOR_SELECT, type Booking, type Labor } from "./types";

export function WorkOrderWorkshopPanel({ workOrderId, status }: { workOrderId: string; status: string }) {
  const t = useT();
  const tenant = useTenant();
  const tz = tenant.timezone;
  const { isManager } = useAuth();
  const { isEnabled } = useModules();
  const qc = useQueryClient();
  const toast = useToast();
  const [modal, setModal] = useState<"book" | "labor" | "part" | Labor | null>(null);
  const [deleting, setDeleting] = useState<Labor | null>(null);
  const [error, setError] = useState("");
  const closed = status === "completed" || status === "canceled";

  const bookingsQ = useQuery({
    queryKey: ["workshop_bookings", "wo", workOrderId],
    queryFn: () => listRows<Booking>("workshop_bookings", (q) => q.select(BOOKING_SELECT).eq("work_order_id", workOrderId).order("starts_at").limit(50)),
  });
  const laborQ = useQuery({
    queryKey: ["work_order_labor", "wo", workOrderId],
    queryFn: () => listRows<Labor>("work_order_labor", (q) => q.select(LABOR_SELECT).eq("work_order_id", workOrderId).order("started_at").limit(200)),
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["work_order_labor"] });
    void qc.invalidateQueries({ queryKey: ["workshop_bookings"] });
    void qc.invalidateQueries({ queryKey: ["work_order_lines", workOrderId] });
    void qc.invalidateQueries({ queryKey: ["work_orders"] });
  };
  const remove = useMutation({
    mutationFn: (id: string) => deleteRow("work_order_labor", id),
    onSuccess: () => {
      setDeleting(null);
      refresh();
      toast.success(t("workshop.labor.deleted"));
    },
    onError: (err) => {
      setDeleting(null);
      setError(err instanceof Error ? err.message : t("common.error"));
    },
  });
  const close = () => setModal(null);
  const labor = laborQ.data ?? [];
  const hours = Math.round(labor.reduce((s, l) => s + Number(l.hours ?? 0), 0) * 100) / 100;
  const cost = labor.reduce((s, l) => s + Number(l.cost ?? 0), 0);

  return (
    <Card className="p-5 lg:col-span-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-ink">{t("workshop.panel.title")}</h3>
        {isManager && !closed && (
          <div className="ms-auto flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setModal("book")}><CalendarClock className="h-4 w-4" /> {t("workshop.new")}</Button>
            <Button variant="secondary" onClick={() => setModal("labor")}><Clock className="h-4 w-4" /> {t("workshop.labor.add")}</Button>
            {isEnabled("inventory") && (
              <Button variant="secondary" onClick={() => setModal("part")}><Package className="h-4 w-4" /> {t("workshop.parts.issue")}</Button>
            )}
          </div>
        )}
      </div>
      {error && <div className="mb-3"><ErrorState message={error} /></div>}
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">{t("workshop.panel.bookings")}</h4>
          {(bookingsQ.data ?? []).length === 0 ? <p className="py-2 text-sm text-ink-3">{t("workshop.panel.noBookings")}</p> : (
            <ul className="divide-y divide-line">
              {(bookingsQ.data ?? []).map((b) => (
                <li key={b.id} className="flex items-center gap-2 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-ink"><Bdi>{b.bay?.name}</Bdi></div>
                    <div className="text-xs text-ink-3">
                      {t("workshop.slot", { from: ltrText(formatDateTime(b.starts_at, tz)), to: ltrText(formatDateTime(b.ends_at, tz)) })}
                    </div>
                  </div>
                  <Badge tone={bookingTone[b.status]}>{t(`workshop.booking.${b.status}`)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-3">{t("workshop.labor.title")}</h4>
            {hours > 0 && (
              <span className="text-xs text-ink-2">
                {t("workshop.labor.total", { hours: ltrText(String(hours)), cost: ltrText(formatMoney(cost, tenant.currency)) })}
              </span>
            )}
          </div>
          {labor.length === 0 ? <p className="py-2 text-sm text-ink-3">{t("workshop.labor.empty")}</p> : (
            <ul className="divide-y divide-line">
              {labor.map((l) => (
                <li key={l.id} className="flex items-center gap-2 py-2">
                  <button type="button" className="min-w-0 flex-1 text-start disabled:cursor-default"
                    disabled={!isManager || closed || l.ended_at == null} onClick={() => setModal(l)}>
                    <div className="text-sm text-ink"><Bdi>{personName(l.employee)}</Bdi></div>
                    <div className="text-xs text-ink-3">
                      <Ltr>{formatDateTime(l.started_at, tz)}</Ltr>
                      {l.notes && <> · <Bdi>{l.notes}</Bdi></>}
                    </div>
                  </button>
                  {l.ended_at == null ? <Badge tone="purple">{t("workshop.labor.running")}</Badge> : (
                    <div className="shrink-0 text-end text-xs">
                      <div className="text-ink">{t("workshop.labor.hoursValue", { hours: ltrText(String(l.hours ?? 0)) })}</div>
                      <div className="text-ink-3">{formatMoney(l.cost ?? 0, tenant.currency)}</div>
                    </div>
                  )}
                  {isManager && !closed && (
                    <Button variant="ghost" aria-label={t("action.delete")} onClick={() => setDeleting(l)}><Trash2 className="h-4 w-4" /></Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <Modal title={t("workshop.newTitle")} open={modal === "book"} onClose={close}>
        {modal === "book" && (
          <BookingForm defaults={{ work_order_id: workOrderId }} onCancel={close}
            onDone={() => { close(); refresh(); toast.success(t("workshop.booked")); }} />
        )}
      </Modal>
      <Modal title={t("workshop.labor.addTitle")} open={modal === "labor" || (typeof modal === "object" && modal != null)} onClose={close}>
        {(modal === "labor" || (typeof modal === "object" && modal != null)) && (
          <LaborForm workOrderId={workOrderId} labor={typeof modal === "object" && modal != null ? modal : undefined} onCancel={close}
            onDone={() => { close(); refresh(); toast.success(t("workshop.labor.saved")); }} />
        )}
      </Modal>
      <Modal title={t("workshop.parts.title")} open={modal === "part"} onClose={close}>
        {modal === "part" && <IssuePartForm workOrderId={workOrderId} onCancel={close} onDone={close} />}
      </Modal>
      <Modal title={t("action.delete")} open={deleting != null} onClose={() => setDeleting(null)}>
        <p className="text-sm text-ink-2">{t("workshop.labor.deleteConfirm")}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setDeleting(null)}>{t("action.cancel")}</Button>
          <Button variant="danger" loading={remove.isPending} onClick={() => deleting && remove.mutate(deleting.id)}>{t("action.delete")}</Button>
        </div>
      </Modal>
    </Card>
  );
}
