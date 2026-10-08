import { useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FlaskConical, KeyRound, Pause, Pencil, Play, Plus, Trash2, Webhook } from "lucide-react";
import { deleteRow, listPage, updateRow, wrapDbError } from "../../lib/db";
import { supabase } from "../../lib/supabase";
import { bdiText } from "../../lib/bidi";
import { formatDateTime } from "../../lib/format";
import { EVENT_CATALOG } from "../../lib/automation";
import { SIGNATURE_HEADER, WILDCARD_EVENT, isSafeWebhookUrl } from "../../../shared/webhooks";
import { useTenant } from "../../context/AuthContext";
import { useT, useTp } from "../../i18n";
import {
  Badge, Bdi, Button, EmptyState, ErrorState, Field, Input, LoadingState, Ltr, Modal, Pagination,
} from "../../components/ui";
import { useToast } from "../../components/Toast";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { SecretReveal } from "./SecretReveal";
import { eventLabel } from "./labels";
import type { WebhookSubscription } from "./types";

const PAGE_SIZE = 25;

export default function WebhooksPage() {
  const t = useT();
  const tp = useTp();
  const tenant = useTenant();
  const qc = useQueryClient();
  const toast = useToast();
  const [page, setPage] = useState(0);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<WebhookSubscription | null>(null);
  const [deleting, setDeleting] = useState<WebhookSubscription | null>(null);
  const [rotating, setRotating] = useState<WebhookSubscription | null>(null);
  const [secret, setSecret] = useState<{ title: string; value: string } | null>(null);
  const [actionError, setActionError] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["webhook_subscriptions", "list", { page }],
    queryFn: () =>
      listPage<WebhookSubscription>("webhook_subscriptions", page, PAGE_SIZE, (q) => q.order("created_at", { ascending: false })),
  });
  const rows = data?.rows ?? [];

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["webhook_subscriptions"] });
    void qc.invalidateQueries({ queryKey: ["webhook_deliveries"] });
    setActionError("");
  };
  const fail = (err: unknown) => setActionError(err instanceof Error ? err.message : String(err));

  const toggle = useMutation({
    mutationFn: (w: WebhookSubscription) => updateRow("webhook_subscriptions", w.id, { active: !w.active }),
    onSuccess: refresh,
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteRow("webhook_subscriptions", id),
    onSuccess: () => {
      refresh();
      setDeleting(null);
      toast.success(t("toast.deleted"));
    },
    onError: (err) => {
      fail(err);
      setDeleting(null);
    },
  });
  const sendTest = useMutation({
    mutationFn: async (id: string) => {
      const { error: e } = await supabase.rpc("send_test_webhook", { p_id: id });
      if (e) throw wrapDbError(e);
    },
    onSuccess: () => {
      refresh();
      toast.success(t("integrations.testQueued"));
    },
    onError: fail,
  });
  const rotate = useMutation({
    mutationFn: async (id: string) => {
      const { data: value, error: e } = await supabase.rpc("rotate_webhook_secret", { p_id: id });
      if (e) throw wrapDbError(e);
      return value as string;
    },
    onSuccess: (value) => {
      setRotating(null);
      setSecret({ title: t("integrations.newSecret"), value });
    },
    onError: (err) => {
      fail(err);
      setRotating(null);
    },
  });

  const iconButton = (label: string, onClick: () => void, icon: ReactNode, danger = false) => (
    <button
      type="button"
      className={
        danger
          ? "rounded p-1.5 text-ink-3 hover:bg-serious-soft hover:text-serious"
          : "rounded p-1.5 text-ink-3 hover:bg-canvas hover:text-ink-2"
      }
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label={label}
      title={label}
    >
      {icon}
    </button>
  );

  const columns: Array<DataTableColumn<WebhookSubscription>> = [
    {
      id: "name",
      header: t("integrations.webhookName"),
      cell: (w) => (
        <div className="min-w-0">
          <div className="font-medium text-ink"><Bdi>{w.name}</Bdi></div>
          <div className="max-w-48 truncate font-mono text-xs text-ink-3 sm:max-w-xs lg:max-w-md" title={w.url}>
            <Ltr>{w.url}</Ltr>
          </div>
        </div>
      ),
      sortValue: (w) => w.name,
      exportValue: (w) => `${w.name} ${w.url}`,
    },
    {
      id: "events",
      header: t("integrations.events"),
      minBreakpoint: "md",
      cell: (w) =>
        w.events.includes(WILDCARD_EVENT) ? (
          <span className="text-ink-2">{t("integrations.allEventsShort")}</span>
        ) : (
          <span className="text-ink-2" title={w.events.map((e) => eventLabel(t, e)).join("\n")}>
            {w.events.length === 1 ? eventLabel(t, w.events[0]) : tp("integrations.eventCount", w.events.length)}
          </span>
        ),
      exportValue: (w) => w.events.join(" "),
    },
    {
      id: "last_success",
      header: t("integrations.lastSuccess"),
      minBreakpoint: "lg",
      cell: (w) => (
        <div className="text-ink-2">
          <div className="whitespace-nowrap">
            {w.last_success_at ? <Ltr>{formatDateTime(w.last_success_at, tenant.timezone)}</Ltr> : t("integrations.never")}
          </div>
          {w.failure_count > 0 && <div className="text-xs text-serious">{tp("integrations.failing", w.failure_count)}</div>}
        </div>
      ),
      sortValue: (w) => w.last_success_at ?? "",
      exportValue: (w) => w.last_success_at ?? "",
    },
    {
      id: "status",
      header: t("common.status"),
      cell: (w) =>
        w.active ? <Badge tone="green">{t("integrations.active")}</Badge> : <Badge tone="slate">{t("integrations.paused")}</Badge>,
      sortValue: (w) => (w.active ? 1 : 0),
      exportValue: (w) => (w.active ? "active" : "paused"),
    },
    {
      id: "actions",
      header: "",
      align: "end",
      // Phones open the edit dialog on row tap; it carries the same actions.
      minBreakpoint: "md",
      cell: (w) => (
        <div className="flex justify-end gap-1">
          {iconButton(t("integrations.sendTest"), () => sendTest.mutate(w.id), <FlaskConical className="h-4 w-4" />)}
          {iconButton(
            w.active ? t("integrations.pause") : t("integrations.resume"),
            () => toggle.mutate(w),
            w.active ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />,
          )}
          {iconButton(t("integrations.rotateSecret"), () => setRotating(w), <KeyRound className="h-4 w-4" />)}
          {iconButton(t("integrations.editWebhook"), () => setEditing(w), <Pencil className="h-4 w-4" />)}
          {iconButton(t("integrations.deleteWebhook"), () => setDeleting(w), <Trash2 className="h-4 w-4" />, true)}
        </div>
      ),
    },
  ];

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4" /> {t("integrations.newWebhook")}
        </Button>
      </div>
      {isLoading && <LoadingState />}
      {error && <ErrorState message={(error as Error).message} />}
      {actionError && (
        <div className="mb-4">
          <ErrorState message={actionError} />
        </div>
      )}
      {!isLoading && !error && (
        <DataTable<WebhookSubscription>
          tableId="webhooks"
          exportName="webhooks"
          rows={rows}
          rowKey={(w) => w.id}
          onRowClick={(w) => setEditing(w)}
          columns={columns}
          empty={
            <EmptyState
              icon={<Webhook className="h-10 w-10" />}
              title={t("integrations.webhooksEmptyTitle")}
              description={t("integrations.webhooksEmptyDesc")}
              action={
                <Button onClick={() => setAdding(true)}>
                  <Plus className="h-4 w-4" /> {t("integrations.newWebhook")}
                </Button>
              }
            />
          }
          footer={<Pagination page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onPage={setPage} />}
        />
      )}

      <Modal title={t("integrations.newWebhook")} open={adding} onClose={() => setAdding(false)} wide>
        {adding && (
          <WebhookForm
            onDone={(created) => {
              setAdding(false);
              refresh();
              if (created) {
                toast.success(t("integrations.webhookCreated"));
                setSecret({ title: t("integrations.signingSecret"), value: created });
              }
            }}
          />
        )}
      </Modal>
      <Modal title={t("integrations.editWebhook")} open={!!editing} onClose={() => setEditing(null)} wide>
        {editing && (
          <WebhookForm
            webhook={editing}
            onDone={() => {
              setEditing(null);
              refresh();
            }}
            extraActions={
              <>
                <Button type="button" variant="ghost" onClick={() => sendTest.mutate(editing.id)} loading={sendTest.isPending}>
                  <FlaskConical className="h-4 w-4" /> {t("integrations.sendTest")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setRotating(editing);
                    setEditing(null);
                  }}
                >
                  <KeyRound className="h-4 w-4" /> {t("integrations.rotateSecret")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="text-serious"
                  onClick={() => {
                    setDeleting(editing);
                    setEditing(null);
                  }}
                >
                  <Trash2 className="h-4 w-4" /> {t("action.delete")}
                </Button>
              </>
            }
          />
        )}
      </Modal>
      <Modal title={secret?.title ?? ""} open={!!secret} onClose={() => setSecret(null)}>
        {secret && (
          <>
            <p className="mb-3 text-sm text-ink-2">
              {t("integrations.signingSecretDesc", { header: SIGNATURE_HEADER })}
            </p>
            <SecretReveal label={secret.title} value={secret.value} onDone={() => setSecret(null)} />
          </>
        )}
      </Modal>
      <Modal title={t("integrations.rotateSecret")} open={!!rotating} onClose={() => setRotating(null)}>
        {rotating && (
          <>
            <p className="text-sm text-ink-2">{t("integrations.rotateConfirm", { name: bdiText(rotating.name) })}</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setRotating(null)}>{t("action.cancel")}</Button>
              <Button onClick={() => rotate.mutate(rotating.id)} loading={rotate.isPending}>
                {t("integrations.rotateSecret")}
              </Button>
            </div>
          </>
        )}
      </Modal>
      <Modal title={t("integrations.deleteWebhook")} open={!!deleting} onClose={() => setDeleting(null)}>
        {deleting && (
          <>
            <p className="text-sm text-ink-2">{t("integrations.deleteWebhookConfirm", { name: bdiText(deleting.name) })}</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeleting(null)}>{t("action.cancel")}</Button>
              <Button variant="danger" onClick={() => remove.mutate(deleting.id)} loading={remove.isPending}>
                {t("integrations.deleteWebhook")}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}

/** Create (returns the new signing secret through onDone) or edit a webhook. */
function WebhookForm({
  webhook,
  onDone,
  extraActions,
}: {
  webhook?: WebhookSubscription;
  onDone: (secret?: string) => void;
  extraActions?: ReactNode;
}) {
  const t = useT();
  const toast = useToast();
  const [name, setName] = useState(webhook?.name ?? "");
  const [url, setUrl] = useState(webhook?.url ?? "https://");
  const [events, setEvents] = useState<string[]>(webhook?.events ?? []);
  const [active, setActive] = useState(webhook?.active ?? true);
  const [submitted, setSubmitted] = useState(false);
  const [saveError, setSaveError] = useState("");
  const all = events.includes(WILDCARD_EVENT);
  // Events a subscription already holds that this build's catalog doesn't list.
  const extra = events.filter((e) => e !== WILDCARD_EVENT && !EVENT_CATALOG.some((c) => c.event === e));

  const urlOk = isSafeWebhookUrl(url);
  const eventsOk = events.length > 0;
  const nameOk = name.trim().length > 0 && name.trim().length <= 100;

  const save = useMutation({
    mutationFn: async () => {
      if (webhook) {
        await updateRow("webhook_subscriptions", webhook.id, { name: name.trim(), url: url.trim(), events, active });
        return undefined;
      }
      const { data, error } = await supabase.rpc("create_webhook_subscription", {
        p_name: name.trim(),
        p_url: url.trim(),
        p_events: events,
      });
      if (error) throw wrapDbError(error);
      return (data as { secret: string }).secret;
    },
    onSuccess: (createdSecret) => {
      if (webhook) toast.success(t("integrations.webhookSaved"));
      onDone(createdSecret);
    },
    onError: (err) => setSaveError(err instanceof Error ? err.message : String(err)),
  });

  const toggleEvent = (event: string, on: boolean) =>
    setEvents((cur) => (on ? [...new Set([...cur, event])] : cur.filter((e) => e !== event)));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (urlOk && eventsOk && nameOk) save.mutate();
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label={t("integrations.webhookName")} required error={submitted && !nameOk ? t("errors.webhookName") : undefined}>
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoFocus />
      </Field>
      <Field
        label={t("integrations.webhookUrl")}
        required
        hint={t("integrations.webhookUrlHint")}
        error={submitted && !urlOk ? t("integrations.webhookUrlInvalid") : undefined}
      >
        <Input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/fleet-hooks" />
      </Field>
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-ink-2">
          {t("integrations.events")} <span className="text-serious">*</span>
        </legend>
        <label className="mb-2 flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-line"
            checked={all}
            onChange={(e) => setEvents(e.target.checked ? [WILDCARD_EVENT] : [])}
          />
          {t("integrations.allEvents")}
        </label>
        {!all && (
          <div className="grid gap-x-4 gap-y-1.5 rounded-lg border border-line p-3 sm:grid-cols-2">
            {[...EVENT_CATALOG.map((c) => c.event), ...extra].map((event) => (
              <label key={event} className="flex items-start gap-2 text-sm text-ink-2">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-line"
                  checked={events.includes(event)}
                  onChange={(e) => toggleEvent(event, e.target.checked)}
                />
                <span>
                  {eventLabel(t, event)}
                  <span className="block font-mono text-xs text-ink-3" dir="ltr">{event}</span>
                </span>
              </label>
            ))}
          </div>
        )}
        {submitted && !eventsOk && <p className="mt-1 text-xs text-serious">{t("integrations.eventsInvalid")}</p>}
      </fieldset>
      {webhook && (
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-line"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          {t("integrations.webhookActive")}
        </label>
      )}
      {saveError && <ErrorState message={saveError} />}
      <div className="flex flex-wrap items-center gap-2">
        {extraActions && <div className="flex flex-wrap gap-1">{extraActions}</div>}
        <div className="ms-auto flex gap-2">
          <Button type="button" variant="secondary" onClick={() => onDone()}>{t("action.cancel")}</Button>
          <Button type="submit" loading={save.isPending}>
            {webhook ? t("integrations.saveWebhook") : t("integrations.createWebhook")}
          </Button>
        </div>
      </div>
    </form>
  );
}
