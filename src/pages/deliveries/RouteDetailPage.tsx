import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown, ArrowLeft, ArrowUp, CheckCircle2, ClipboardList, Pencil, Play, Plus, Shuffle, Trash2, X, XCircle,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { deleteRow, listRows, sanitizeSearch, updateRow, wrapDbError } from "../../lib/db";
import { formatDate, formatMoney } from "../../lib/format";
import { ltrText } from "../../lib/bidi";
import { nearestNeighborOrder, routeDistanceKm } from "../../../shared/deliveries";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useT, useTp } from "../../i18n";
import { Badge, Bdi, Button, Card, ErrorState, Input, LoadingState, Ltr, Modal } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { OutcomeForm, RouteForm } from "./forms";
import { useRoute, useRouteStops } from "./hooks";
import { deliveryTone, driverName, routeTone } from "./labels";
import { DELIVERY_SELECT, type Delivery } from "./types";

const WAITING_LIMIT = 200;

export default function RouteDetailPage() {
  const { id = "" } = useParams();
  const t = useT();
  const tp = useTp();
  const tenant = useTenant();
  const navigate = useNavigate();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const routeQ = useRoute(id);
  const stopsQ = useRouteStops(id);
  const [plan, setPlan] = useState<Delivery[] | null>(null);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<"edit" | "cancel" | "delete" | null>(null);
  const [outcome, setOutcome] = useState<{ d: Delivery; kind: "delivered" | "failed" } | null>(null);
  const [actionError, setActionError] = useState("");
  const route = routeQ.data;
  const planning = isManager && route?.status === "planned";
  const term = sanitizeSearch(search);

  // The editable plan starts from the saved stops and resets after each save.
  useEffect(() => {
    if (stopsQ.data) setPlan(stopsQ.data);
  }, [stopsQ.data]);

  const waitingQ = useQuery({
    queryKey: ["deliveries", "waiting", term],
    enabled: Boolean(planning),
    queryFn: () =>
      listRows<Delivery>("deliveries", (q) => {
        let f = q.select(DELIVERY_SELECT).eq("status", "pending");
        if (term) f = f.or(`doc_number.ilike.%${term}%,recipient_name.ilike.%${term}%,city.ilike.%${term}%`);
        return f.order("created_at").limit(WAITING_LIMIT);
      }),
  });

  const current = plan ?? [];
  const inPlan = useMemo(() => new Set(current.map((d) => d.id)), [current]);
  const waiting = (waitingQ.data ?? []).filter((d) => !inPlan.has(d.id));
  const dirty = Boolean(stopsQ.data && plan && (plan.length !== stopsQ.data.length || plan.some((d, i) => d.id !== stopsQ.data![i].id)));
  const depot = route?.depot_lat != null && route.depot_lng != null ? { lat: Number(route.depot_lat), lng: Number(route.depot_lng) } : null;
  const km = routeDistanceKm(depot, current.map((d) => ({ id: d.id, lat: d.lat == null ? null : Number(d.lat), lng: d.lng == null ? null : Number(d.lng) })));
  const codTotal = current.reduce((s, d) => s + Number(d.cod_amount), 0);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["deliveries"] });
    void qc.invalidateQueries({ queryKey: ["delivery_routes"] });
  };
  const savePlan = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("delivery_route_plan", { p_route_id: id, p_delivery_ids: current.map((d) => d.id) });
      if (error) throw wrapDbError(error);
    },
    onSuccess: () => {
      setActionError("");
      invalidate();
      toast.success(t("deliveries.routes.planSaved"));
    },
    onError: (err) => setActionError(err instanceof Error ? err.message : t("common.error")),
  });
  const setStatus = useMutation({
    mutationFn: (v: { status: string; done: string }) => updateRow("delivery_routes", id, { status: v.status }),
    onSuccess: (_d, v) => {
      setActionError("");
      setModal(null);
      invalidate();
      toast.success(v.done);
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : t("common.error"));
      setModal(null);
    },
  });
  const remove = useMutation({
    mutationFn: () => deleteRow("delivery_routes", id),
    onSuccess: () => {
      invalidate();
      toast.success(t("deliveries.routes.deleted"));
      navigate("/deliveries/routes");
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : t("common.error"));
      setModal(null);
    },
  });

  if (routeQ.isLoading || stopsQ.isLoading) return <LoadingState />;
  const err = routeQ.error ?? stopsQ.error;
  if (err) return <ErrorState message={(err as Error).message} />;
  if (!route) return <ErrorState message={t("deliveries.routes.notFound")} />;

  const move = (i: number, by: number) =>
    setPlan((p) => {
      if (!p) return p;
      const next = [...p];
      const [d] = next.splice(i, 1);
      next.splice(i + by, 0, d);
      return next;
    });
  const optimize = () =>
    setPlan((p) => {
      if (!p) return p;
      const order = nearestNeighborOrder(depot, p.map((d) => ({ id: d.id, lat: d.lat == null ? null : Number(d.lat), lng: d.lng == null ? null : Number(d.lng) })));
      const byId = new Map(p.map((d) => [d.id, d]));
      return order.map((x) => byId.get(x)!);
    });
  const saved = stopsQ.data ?? [];
  const doneCount = saved.filter((d) => d.status !== "assigned" && d.status !== "out_for_delivery").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Link to="/deliveries/routes" className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline">
          <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" /> {t("deliveries.routes.back")}
        </Link>
        <Ltr className="text-lg font-semibold text-ink">{route.doc_number}</Ltr>
        <Badge tone={routeTone[route.status]}>{t(`deliveries.route.${route.status}`)}</Badge>
        <span className="text-ink-2">{formatDate(`${route.route_date}T12:00:00Z`, "UTC")}</span>
        <span className="min-w-0 truncate text-ink-2">
          <Bdi>{route.vehicle?.name}</Bdi>
          {route.driver && <> · <Bdi>{driverName(route.driver)}</Bdi></>}
        </span>
        <div className="ms-auto flex flex-wrap gap-2">
          {(route.status === "out_for_delivery" || route.status === "completed") && (
            <Link to={`/deliveries/routes/${id}/run`}>
              <Button variant="secondary"><ClipboardList className="h-4 w-4" /> {t("deliveries.routes.runSheet")}</Button>
            </Link>
          )}
          {isManager && route.status !== "canceled" && (
            <Button variant="secondary" onClick={() => setModal("edit")}>
              <Pencil className="h-4 w-4" /> {t("action.edit")}
            </Button>
          )}
          {isManager && route.status === "planned" && (
            <>
              <Button variant="ghost" onClick={() => setModal("delete")}>
                <Trash2 className="h-4 w-4" /> {t("action.delete")}
              </Button>
              <Button variant="secondary" onClick={() => setModal("cancel")}>
                <XCircle className="h-4 w-4" /> {t("deliveries.routes.cancel")}
              </Button>
              <Button disabled={dirty || saved.length === 0} loading={setStatus.isPending}
                onClick={() => setStatus.mutate({ status: "out_for_delivery", done: t("deliveries.routes.started") })}>
                <Play className="h-4 w-4 rtl:-scale-x-100" /> {t("deliveries.routes.start")}
              </Button>
            </>
          )}
          {isManager && route.status === "out_for_delivery" && (
            <Button loading={setStatus.isPending} onClick={() => setStatus.mutate({ status: "completed", done: t("deliveries.routes.completed") })}>
              <CheckCircle2 className="h-4 w-4" /> {t("deliveries.routes.complete")}
            </Button>
          )}
        </div>
      </div>

      {actionError && <ErrorState message={actionError} />}
      {route.notes && <Bdi className="block whitespace-pre-line text-sm text-ink-2">{route.notes}</Bdi>}

      <div className={planning ? "grid gap-4 lg:grid-cols-2" : ""}>
        <Card className="p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-ink">{t("deliveries.routes.stops")}</h2>
            <span className="text-xs text-ink-3">
              {planning ? tp("deliveries.stopsCount", current.length) : t("deliveries.stopsDone", { done: doneCount, total: saved.length })}
            </span>
            {km > 0 && <span className="text-xs text-ink-3">· {t("deliveries.routes.distance", { km })}</span>}
            {codTotal > 0 && <span className="text-xs text-ink-3">· {t("deliveries.run.codTotal", { amount: ltrText(formatMoney(codTotal, tenant.currency)) })}</span>}
            {planning && (
              <div className="ms-auto flex gap-2">
                <Button variant="secondary" className="px-2.5 py-1 text-xs" disabled={current.length < 2} onClick={optimize} title={t("deliveries.routes.optimizeHint")}>
                  <Shuffle className="h-4 w-4" /> {t("deliveries.routes.optimize")}
                </Button>
                <Button className="px-2.5 py-1 text-xs" disabled={!dirty} loading={savePlan.isPending} onClick={() => savePlan.mutate()}>
                  {t("deliveries.routes.savePlan")}
                </Button>
              </div>
            )}
          </div>
          {planning && dirty && <p className="mb-2 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-xs text-warn">{t("deliveries.routes.unsaved")}</p>}
          {current.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-3">{t("deliveries.routes.noStops")}</p>
          ) : (
            <ol className="divide-y divide-line">
              {current.map((d, i) => (
                <li key={d.id} className="flex items-center gap-3 py-2">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-canvas text-xs font-semibold text-ink-2">
                    <Ltr>{i + 1}</Ltr>
                  </span>
                  <Link to={`/deliveries/d/${d.id}`} className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Bdi className="truncate font-medium text-ink">{d.recipient_name}</Bdi>
                      <Ltr className="text-xs text-ink-3">{d.doc_number}</Ltr>
                    </div>
                    <div className="truncate text-xs text-ink-3">
                      <Bdi>{[d.address, d.city].filter(Boolean).join(", ")}</Bdi>
                      {d.lat == null && <span className="ms-1 text-warn">· {t("deliveries.routes.noCoords")}</span>}
                    </div>
                  </Link>
                  {planning ? (
                    <div className="flex shrink-0 gap-1">
                      <Button variant="ghost" className="p-1.5" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t("deliveries.routes.moveUp")}>
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" className="p-1.5" disabled={i === current.length - 1} onClick={() => move(i, 1)} aria-label={t("deliveries.routes.moveDown")}>
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" className="p-1.5" onClick={() => setPlan((p) => p?.filter((x) => x.id !== d.id) ?? p)} aria-label={t("deliveries.routes.remove")}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex shrink-0 items-center gap-2">
                      {d.cod_amount > 0 && <span className="hidden text-xs text-ink-2 sm:inline">{formatMoney(d.cod_amount, tenant.currency)}</span>}
                      <Badge tone={deliveryTone[d.status]}>{t(`deliveries.status.${d.status}`)}</Badge>
                      {isManager && d.status === "out_for_delivery" && (
                        <>
                          <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => setOutcome({ d, kind: "failed" })}>
                            {t("deliveries.markFailed")}
                          </Button>
                          <Button className="px-2 py-1 text-xs" onClick={() => setOutcome({ d, kind: "delivered" })}>
                            {t("deliveries.markDelivered")}
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
        </Card>

        {planning && (
          <Card className="p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-ink">{t("deliveries.routes.waiting")}</h2>
              {waiting.length > 0 && (
                <Button variant="secondary" className="ms-auto px-2.5 py-1 text-xs" onClick={() => setPlan((p) => [...(p ?? []), ...waiting])}>
                  <Plus className="h-4 w-4" /> {t("deliveries.routes.addAll")}
                </Button>
              )}
            </div>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("deliveries.routes.waitingSearch")} className="mb-2" />
            {waitingQ.isLoading ? (
              <LoadingState />
            ) : waiting.length === 0 ? (
              <p className="py-6 text-center text-sm text-ink-3">{t("deliveries.routes.waitingEmpty")}</p>
            ) : (
              <ul className="max-h-[32rem] divide-y divide-line overflow-y-auto">
                {waiting.map((d) => (
                  <li key={d.id} className="flex items-center gap-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Bdi className="truncate text-sm font-medium text-ink">{d.recipient_name}</Bdi>
                        <Ltr className="text-xs text-ink-3">{d.doc_number}</Ltr>
                      </div>
                      <div className="truncate text-xs text-ink-3"><Bdi>{[d.address, d.city].filter(Boolean).join(", ")}</Bdi></div>
                    </div>
                    <Button variant="secondary" className="shrink-0 px-2.5 py-1 text-xs" onClick={() => setPlan((p) => [...(p ?? []), d])}>
                      <Plus className="h-4 w-4" /> {t("deliveries.routes.add")}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>

      <Modal title={t("deliveries.routes.editTitle")} open={modal === "edit"} onClose={() => setModal(null)} wide>
        {modal === "edit" && (
          <RouteForm
            route={route}
            onCancel={() => setModal(null)}
            onDone={() => {
              setModal(null);
              invalidate();
              toast.success(t("deliveries.routes.saved"));
            }}
          />
        )}
      </Modal>
      <Modal title={t("deliveries.routes.cancel")} open={modal === "cancel"} onClose={() => setModal(null)}>
        <p className="text-sm text-ink-2">{t("deliveries.routes.cancelConfirm", { number: route.doc_number ?? "" })}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setModal(null)}>{t("action.cancel")}</Button>
          <Button variant="danger" loading={setStatus.isPending}
            onClick={() => setStatus.mutate({ status: "canceled", done: t("deliveries.routes.canceled") })}>
            {t("deliveries.routes.cancel")}
          </Button>
        </div>
      </Modal>
      <Modal title={t("action.delete")} open={modal === "delete"} onClose={() => setModal(null)}>
        <p className="text-sm text-ink-2">{t("deliveries.routes.deleteConfirm", { number: route.doc_number ?? "" })}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setModal(null)}>{t("action.cancel")}</Button>
          <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>{t("action.delete")}</Button>
        </div>
      </Modal>
      <Modal
        title={outcome ? t(outcome.kind === "delivered" ? "deliveries.deliveredTitle" : "deliveries.failedTitle", { number: outcome.d.doc_number ?? "" }) : ""}
        open={!!outcome}
        onClose={() => setOutcome(null)}
      >
        {outcome && <OutcomeForm delivery={outcome.d} outcome={outcome.kind} onDone={() => setOutcome(null)} onCancel={() => setOutcome(null)} />}
      </Modal>
    </div>
  );
}
