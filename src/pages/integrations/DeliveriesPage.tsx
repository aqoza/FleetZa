import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw, Send } from "lucide-react";
import { listPage, listRows, wrapDbError } from "../../lib/db";
import { supabase } from "../../lib/supabase";
import { formatDateTime } from "../../lib/format";
import { MAX_ATTEMPTS } from "../../../shared/webhooks";
import { useTenant } from "../../context/AuthContext";
import { useT } from "../../i18n";
import {
  Badge, Bdi, Button, EmptyState, ErrorState, LoadingState, Ltr, Pagination, Select,
} from "../../components/ui";
import { useToast } from "../../components/Toast";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { DELIVERY_TONE, deliveryStatusKey, eventLabel } from "./labels";
import { useDispatch } from "./hooks";
import type { DeliveryStatus, WebhookDelivery, WebhookSubscription } from "./types";

const PAGE_SIZE = 25;

type DeliveryRow = WebhookDelivery & { subscription: { name: string } | null };

export default function DeliveriesPage() {
  const t = useT();
  const tenant = useTenant();
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState<"all" | DeliveryStatus>("all");
  const [subscription, setSubscription] = useState("all");
  const [page, setPage] = useState(0);
  const [actionError, setActionError] = useState("");
  const dispatch = useDispatch({ announce: true });

  const subsQ = useQuery({
    queryKey: ["webhook_subscriptions", "options"],
    queryFn: () =>
      listRows<Pick<WebhookSubscription, "id" | "name">>("webhook_subscriptions", (q) =>
        q.select("id, name").order("name").limit(200),
      ),
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ["webhook_deliveries", "list", { status, subscription, page }],
    queryFn: () =>
      listPage<DeliveryRow>("webhook_deliveries", page, PAGE_SIZE, (q) => {
        let f = q.select("*, subscription:webhook_subscriptions(name)");
        if (status !== "all") f = f.eq("status", status);
        if (subscription !== "all") f = f.eq("subscription_id", subscription);
        return f.order("created_at", { ascending: false });
      }),
  });
  const rows = data?.rows ?? [];
  const filtersOn = status !== "all" || subscription !== "all";

  const retry = useMutation({
    mutationFn: async (id: string) => {
      const { error: e } = await supabase.rpc("retry_webhook_delivery", { p_id: id });
      if (e) throw wrapDbError(e);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["webhook_deliveries"] });
      setActionError("");
      toast.success(t("integrations.retryQueued"));
      dispatch.mutate();
    },
    onError: (err) => setActionError(err instanceof Error ? err.message : String(err)),
  });

  const when = (iso: string) => <Ltr>{formatDateTime(iso, tenant.timezone)}</Ltr>;

  const columns: Array<DataTableColumn<DeliveryRow>> = [
    {
      id: "time",
      header: t("integrations.time"),
      cell: (d) => <span className="whitespace-nowrap text-ink-2">{when(d.created_at)}</span>,
      sortValue: (d) => d.created_at,
      exportValue: (d) => d.created_at,
    },
    {
      id: "webhook",
      header: t("integrations.webhook"),
      cell: (d) => (
        <div className="min-w-0">
          <div className="font-medium text-ink"><Bdi>{d.subscription?.name ?? "—"}</Bdi></div>
          <div className="text-xs text-ink-3">{eventLabel(t, d.event)}</div>
        </div>
      ),
      sortValue: (d) => d.subscription?.name ?? "",
      exportValue: (d) => `${d.subscription?.name ?? ""} ${d.event}`,
    },
    {
      id: "status",
      header: t("integrations.status"),
      cell: (d) => (
        <div>
          <Badge tone={DELIVERY_TONE[d.status]}>{t(deliveryStatusKey(d.status))}</Badge>
          <div className="mt-1 whitespace-nowrap text-xs text-ink-3">
            {d.status === "pending" && d.attempts > 0 && t("integrations.nextAttempt", { time: formatDateTime(d.next_attempt_at, tenant.timezone) })}
            {d.status === "delivered" && d.delivered_at && t("integrations.deliveredAt", { time: formatDateTime(d.delivered_at, tenant.timezone) })}
          </div>
        </div>
      ),
      sortValue: (d) => d.status,
      exportValue: (d) => d.status,
    },
    {
      id: "attempts",
      header: t("integrations.attempts"),
      align: "end",
      minBreakpoint: "md",
      cell: (d) => <span className="tabular-nums text-ink-2"><Ltr>{`${d.attempts}/${MAX_ATTEMPTS}`}</Ltr></span>,
      sortValue: (d) => d.attempts,
      exportValue: (d) => d.attempts,
    },
    {
      id: "response",
      header: t("integrations.response"),
      minBreakpoint: "lg",
      cell: (d) => (
        <div className="max-w-64">
          <div className="tabular-nums text-ink-2"><Ltr>{d.response_code ?? "—"}</Ltr></div>
          {d.last_error && (
            <div className="truncate text-xs text-serious" title={d.last_error}>
              <Ltr>{d.last_error}</Ltr>
            </div>
          )}
        </div>
      ),
      sortValue: (d) => d.response_code ?? 0,
      exportValue: (d) => `${d.response_code ?? ""} ${d.last_error ?? ""}`.trim(),
    },
    {
      id: "actions",
      header: "",
      align: "end",
      cell: (d) =>
        d.status === "failed" ? (
          <button
            type="button"
            className="rounded p-1.5 text-ink-3 hover:bg-canvas hover:text-ink-2"
            onClick={(e) => {
              e.stopPropagation();
              retry.mutate(d.id);
            }}
            aria-label={t("integrations.retry")}
            title={t("integrations.retry")}
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        ) : null,
    },
  ];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as "all" | DeliveryStatus);
            setPage(0);
          }}
          className="w-full sm:w-auto sm:max-w-44"
          aria-label={t("integrations.status")}
        >
          <option value="all">{t("integrations.allStatuses")}</option>
          {(["pending", "delivered", "failed"] as const).map((s) => (
            <option key={s} value={s}>{t(deliveryStatusKey(s))}</option>
          ))}
        </Select>
        {(subsQ.data ?? []).length > 1 && (
          <Select
            value={subscription}
            onChange={(e) => {
              setSubscription(e.target.value);
              setPage(0);
            }}
            className="w-full sm:w-auto sm:max-w-60"
            aria-label={t("integrations.webhook")}
          >
            <option value="all">{t("integrations.allWebhooks")}</option>
            {(subsQ.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
        )}
        <div className="ms-auto">
          <Button variant="secondary" onClick={() => dispatch.mutate()} loading={dispatch.isPending}>
            <Send className="h-4 w-4 rtl:-scale-x-100" /> {t("integrations.deliverNow")}
          </Button>
        </div>
      </div>
      {isLoading && <LoadingState />}
      {error && <ErrorState message={(error as Error).message} />}
      {(actionError || dispatch.error) && (
        <div className="mb-4">
          <ErrorState message={actionError || (dispatch.error as Error).message} />
        </div>
      )}
      {!isLoading && !error && (
        <DataTable<DeliveryRow>
          tableId="webhook-deliveries"
          exportName="webhook-deliveries"
          rows={rows}
          rowKey={(d) => d.id}
          columns={columns}
          empty={
            <EmptyState
              icon={<Send className="h-10 w-10 rtl:-scale-x-100" />}
              title={filtersOn ? t("integrations.deliveriesEmptyFilteredTitle") : t("integrations.deliveriesEmptyTitle")}
              description={filtersOn ? t("integrations.deliveriesEmptyFilteredDesc") : t("integrations.deliveriesEmptyDesc")}
            />
          }
          footer={<Pagination page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onPage={setPage} />}
        />
      )}
    </>
  );
}
