import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, KeyRound, Plus } from "lucide-react";
import { listPage, wrapDbError } from "../../lib/db";
import { supabase } from "../../lib/supabase";
import { bdiText } from "../../lib/bidi";
import { formatDate, formatDateTime } from "../../lib/format";
import { useTenant } from "../../context/AuthContext";
import { useT } from "../../i18n";
import {
  Badge, Bdi, Button, EmptyState, ErrorState, Field, Input, LoadingState, Ltr, Modal, Pagination,
} from "../../components/ui";
import { useToast } from "../../components/Toast";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { SecretReveal } from "./SecretReveal";
import { scopeKey } from "./labels";
import { API_SCOPES, type ApiKey } from "./types";

const PAGE_SIZE = 25;

type KeyState = "active" | "revoked" | "expired";

function keyState(k: ApiKey, now = Date.now()): KeyState {
  if (!k.active || k.revoked_at) return "revoked";
  if (k.expires_at && new Date(k.expires_at).getTime() <= now) return "expired";
  return "active";
}

export default function ApiKeysPage() {
  const t = useT();
  const tenant = useTenant();
  const qc = useQueryClient();
  const toast = useToast();
  const [page, setPage] = useState(0);
  const [adding, setAdding] = useState(false);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["api_keys", "list", { page }],
    queryFn: () => listPage<ApiKey>("api_keys", page, PAGE_SIZE, (q) => q.order("created_at", { ascending: false })),
  });
  const rows = data?.rows ?? [];

  const revoke = useMutation({
    mutationFn: async (id: string) => {
      const { error: e } = await supabase.rpc("revoke_api_key", { p_id: id });
      if (e) throw wrapDbError(e);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["api_keys"] });
      setRevoking(null);
      setActionError("");
      toast.success(t("integrations.keyRevoked"));
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : String(err));
      setRevoking(null);
    },
  });

  const stateBadge = (s: KeyState) =>
    s === "active" ? (
      <Badge tone="green">{t("integrations.active")}</Badge>
    ) : s === "expired" ? (
      <Badge tone="yellow">{t("integrations.expired")}</Badge>
    ) : (
      <Badge tone="slate">{t("integrations.revoked")}</Badge>
    );

  const columns: Array<DataTableColumn<ApiKey>> = [
    {
      id: "name",
      header: t("integrations.keyName"),
      cell: (k) => (
        <div className="min-w-0">
          <div className="font-medium text-ink"><Bdi>{k.name}</Bdi></div>
          <div className="font-mono text-xs text-ink-3" dir="ltr">{k.key_prefix}…</div>
        </div>
      ),
      sortValue: (k) => k.name,
      exportValue: (k) => `${k.name} ${k.key_prefix}`,
    },
    {
      id: "scopes",
      header: t("integrations.scopes"),
      minBreakpoint: "md",
      cell: (k) => (
        <div className="flex flex-wrap gap-1">
          {k.scopes.map((s) => (
            <Badge key={s} tone="blue">{t(scopeKey(s))}</Badge>
          ))}
        </div>
      ),
      exportValue: (k) => k.scopes.join(" "),
    },
    {
      id: "expires",
      header: t("integrations.expires"),
      minBreakpoint: "lg",
      cell: (k) => (
        <span className="whitespace-nowrap text-ink-2">
          {k.expires_at ? <Ltr>{formatDate(k.expires_at, tenant.timezone)}</Ltr> : t("integrations.noExpiry")}
        </span>
      ),
      sortValue: (k) => k.expires_at ?? "9999",
      exportValue: (k) => k.expires_at ?? "",
    },
    {
      id: "last_used",
      header: t("integrations.lastUsed"),
      minBreakpoint: "lg",
      cell: (k) => (
        <span className="whitespace-nowrap text-ink-2">
          {k.last_used_at ? <Ltr>{formatDateTime(k.last_used_at, tenant.timezone)}</Ltr> : t("integrations.never")}
        </span>
      ),
      sortValue: (k) => k.last_used_at ?? "",
      exportValue: (k) => k.last_used_at ?? "",
    },
    {
      id: "status",
      header: t("common.status"),
      cell: (k) => stateBadge(keyState(k)),
      sortValue: (k) => keyState(k),
      exportValue: (k) => keyState(k),
    },
    {
      id: "actions",
      header: "",
      align: "end",
      cell: (k) =>
        keyState(k) === "revoked" ? null : (
          <button
            type="button"
            className="rounded p-1.5 text-ink-3 hover:bg-serious-soft hover:text-serious"
            onClick={(e) => {
              e.stopPropagation();
              setRevoking(k);
            }}
            aria-label={t("integrations.revokeKey")}
            title={t("integrations.revokeKey")}
          >
            <Ban className="h-4 w-4" />
          </button>
        ),
    },
  ];

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4" /> {t("integrations.newKey")}
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
        <DataTable<ApiKey>
          tableId="api-keys"
          exportName="api-keys"
          rows={rows}
          rowKey={(k) => k.id}
          columns={columns}
          empty={
            <EmptyState
              icon={<KeyRound className="h-10 w-10" />}
              title={t("integrations.keysEmptyTitle")}
              description={t("integrations.keysEmptyDesc")}
              action={
                <Button onClick={() => setAdding(true)}>
                  <Plus className="h-4 w-4" /> {t("integrations.newKey")}
                </Button>
              }
            />
          }
          footer={<Pagination page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onPage={setPage} />}
        />
      )}

      <Modal title={t("integrations.newKey")} open={adding} onClose={() => setAdding(false)}>
        {adding && (
          <ApiKeyForm
            onDone={(key) => {
              setAdding(false);
              if (key) {
                void qc.invalidateQueries({ queryKey: ["api_keys"] });
                toast.success(t("integrations.keyCreated"));
                setCreated(key);
              }
            }}
          />
        )}
      </Modal>
      <Modal title={t("integrations.yourKey")} open={!!created} onClose={() => setCreated(null)}>
        {created && <SecretReveal label={t("integrations.yourKey")} value={created} onDone={() => setCreated(null)} />}
      </Modal>
      <Modal title={t("integrations.revokeKey")} open={!!revoking} onClose={() => setRevoking(null)}>
        {revoking && (
          <>
            <p className="text-sm text-ink-2">{t("integrations.revokeConfirm", { name: bdiText(revoking.name) })}</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setRevoking(null)}>{t("action.cancel")}</Button>
              <Button variant="danger" onClick={() => revoke.mutate(revoking.id)} loading={revoke.isPending}>
                {t("integrations.revokeKey")}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}

function ApiKeyForm({ onDone }: { onDone: (key?: string) => void }) {
  const t = useT();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>([]);
  const [expires, setExpires] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [saveError, setSaveError] = useState("");
  const today = new Date().toISOString().slice(0, 10);
  const nameOk = name.trim().length > 0 && name.trim().length <= 100;
  const scopesOk = scopes.length > 0;
  const expiresOk = !expires || expires > today;

  const create = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("create_api_key", {
        p_name: name.trim(),
        p_scopes: scopes,
        // The key works through the whole chosen day, in the viewer's time zone.
        p_expires_at: expires ? new Date(`${expires}T23:59:59`).toISOString() : undefined,
      });
      if (error) throw wrapDbError(error);
      return data as string;
    },
    onSuccess: (key) => onDone(key),
    onError: (err) => setSaveError(err instanceof Error ? err.message : String(err)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (nameOk && scopesOk && expiresOk) create.mutate();
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field
        label={t("integrations.keyName")}
        required
        hint={t("integrations.keyNameHint")}
        error={submitted && !nameOk ? t("errors.apiKeyName") : undefined}
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoFocus />
      </Field>
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-ink-2">
          {t("integrations.scopes")} <span className="text-serious">*</span>
        </legend>
        <div className="space-y-1.5 rounded-lg border border-line p-3">
          {API_SCOPES.map((s) => (
            <label key={s} className="flex items-start gap-2 text-sm text-ink-2">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded border-line"
                checked={scopes.includes(s)}
                onChange={(e) => setScopes((cur) => (e.target.checked ? [...cur, s] : cur.filter((x) => x !== s)))}
              />
              <span>
                {t(scopeKey(s))}
                <span className="block font-mono text-xs text-ink-3" dir="ltr">{s}</span>
              </span>
            </label>
          ))}
        </div>
        {submitted && !scopesOk && <p className="mt-1 text-xs text-serious">{t("integrations.scopesInvalid")}</p>}
      </fieldset>
      <Field
        label={t("integrations.expires")}
        hint={t("integrations.expiresHint")}
        error={submitted && !expiresOk ? t("errors.apiKeyExpiry") : undefined}
      >
        <Input type="date" value={expires} min={today} onChange={(e) => setExpires(e.target.value)} dir="ltr" />
      </Field>
      {saveError && <ErrorState message={saveError} />}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => onDone()}>{t("action.cancel")}</Button>
        <Button type="submit" loading={create.isPending}>{t("integrations.createKey")}</Button>
      </div>
    </form>
  );
}
