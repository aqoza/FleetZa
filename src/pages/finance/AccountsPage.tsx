import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BookOpen, Plus } from "lucide-react";
import { deleteRow, insertRow, updateRow } from "../../lib/db";
import { formatMoney } from "../../lib/format";
import { ACCOUNT_TYPES, accountBalances, accountTree, type AccountType } from "../../../shared/finance";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useI18n, useT } from "../../i18n";
import { Badge, Bdi, Button, EmptyState, ErrorState, Field, Input, LoadingState, Ltr, Modal, Select, Textarea } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { FormActions, FormError, onSubmit, textOrNull, useSubmit } from "./forms";
import { accountName, todayIn, useAccounts, useBalances, type GlAccount } from "./types";

interface Row {
  account: GlAccount;
  depth: number;
  balance: number;
}

export default function AccountsPage() {
  const t = useT();
  const { language } = useI18n();
  const tenant = useTenant();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [type, setType] = useState<"" | AccountType>("");
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<GlAccount | "new" | null>(null);
  const accountsQ = useAccounts();
  const balancesQ = useBalances(null, todayIn(tenant.timezone));

  const rows = useMemo<Row[]>(() => {
    const accounts = accountsQ.data ?? [];
    const natural = new Map(accountBalances(accounts, balancesQ.data ?? []).map((b) => [b.account.id, b.natural]));
    return accountTree(accounts)
      .filter((n) => (showInactive || n.account.active) && (!type || n.account.account_type === type))
      .map((n) => ({ account: n.account, depth: type ? 0 : n.depth, balance: natural.get(n.account.id) ?? 0 }));
  }, [accountsQ.data, balancesQ.data, type, showInactive]);

  if (accountsQ.isLoading) return <LoadingState />;
  if (accountsQ.error) return <ErrorState message={(accountsQ.error as Error).message} />;

  const columns: Array<DataTableColumn<Row>> = [
    {
      id: "code",
      header: t("finance.acc.code"),
      cell: (r) => <Ltr className="whitespace-nowrap font-medium text-ink">{r.account.code}</Ltr>,
      exportValue: (r) => r.account.code,
    },
    {
      id: "name",
      header: t("finance.acc.name"),
      cell: (r) => (
        <span className="flex min-w-0 items-center gap-2" style={{ paddingInlineStart: `${r.depth * 1.25}rem` }}>
          <span className={`truncate ${r.account.active ? "text-ink" : "text-ink-3 line-through"}`}>
            <Bdi>{accountName(r.account, language)}</Bdi>
          </span>
          {r.account.is_system && <Badge tone="slate">{t("finance.acc.system")}</Badge>}
        </span>
      ),
      exportValue: (r) => r.account.name,
    },
    {
      id: "type",
      header: t("finance.acc.type"),
      minBreakpoint: "sm",
      cell: (r) => <span className="whitespace-nowrap text-ink-2">{t(`finance.type.${r.account.account_type}`)}</span>,
      exportValue: (r) => r.account.account_type,
    },
    {
      id: "balance",
      header: t("finance.acc.balance"),
      align: "end",
      cell: (r) => <Ltr className={`whitespace-nowrap ${r.balance < 0 ? "text-serious" : "text-ink"}`}>{formatMoney(r.balance, tenant.currency)}</Ltr>,
      exportValue: (r) => r.balance,
    },
  ];

  const close = () => setEditing(null);
  const done = (msg: string) => {
    close();
    void qc.invalidateQueries({ queryKey: ["gl_accounts"] });
    toast.success(msg);
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="w-full sm:w-52">
          <Select value={type} onChange={(e) => setType(e.target.value as "" | AccountType)} aria-label={t("finance.acc.type")}>
            <option value="">{t("finance.acc.anyType")}</option>
            {ACCOUNT_TYPES.map((x) => <option key={x} value={x}>{t(`finance.type.${x}`)}</option>)}
          </Select>
        </div>
        <label className="inline-flex items-center gap-2 text-sm text-ink-2">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          {t("finance.acc.showInactive")}
        </label>
        {isManager && (accountsQ.data ?? []).length > 0 && (
          <Button className="ms-auto" onClick={() => setEditing("new")}>
            <Plus className="h-4 w-4" /> {t("finance.acc.new")}
          </Button>
        )}
      </div>
      <DataTable<Row>
        tableId="gl_accounts"
        exportName="chart-of-accounts"
        rows={rows}
        rowKey={(r) => r.account.id}
        columns={columns}
        onRowClick={isManager ? (r) => setEditing(r.account) : undefined}
        empty={<EmptyState icon={<BookOpen className="h-10 w-10" />} title={t("finance.acc.empty")} description={t("finance.acc.emptyHint")} />}
      />
      <Modal title={editing === "new" ? t("finance.acc.newTitle") : t("finance.acc.editTitle")} open={editing !== null} onClose={close}>
        {editing !== null && (
          <AccountForm
            account={editing === "new" ? undefined : editing}
            accounts={accountsQ.data ?? []}
            onCancel={close}
            onDone={(deleted) => done(deleted ? t("finance.acc.deleted") : t("finance.saved"))}
          />
        )}
      </Modal>
    </div>
  );
}

function AccountForm({ account, accounts, onDone, onCancel }: {
  account?: GlAccount; accounts: GlAccount[]; onDone: (deleted: boolean) => void; onCancel: () => void;
}) {
  const t = useT();
  const { language } = useI18n();
  const a = account;
  const [f, setF] = useState({
    code: a?.code ?? "",
    name: a?.name ?? "",
    name_ar: a?.name_ar ?? "",
    account_type: (a?.account_type ?? "expense") as AccountType,
    parent_id: a?.parent_id ?? "",
    description: a?.description ?? "",
    active: a?.active ?? true,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const { error, saving, run } = useSubmit(onDone);
  const parents = accounts.filter((p) => p.account_type === f.account_type && p.id !== a?.id);
  const locked = !!a?.is_system;
  const [confirmDelete, setConfirmDelete] = useState(false);

  const submit = onSubmit(() => {
    const values: Record<string, unknown> = {
      code: f.code.trim(),
      name: f.name.trim(),
      name_ar: textOrNull(f.name_ar),
      account_type: f.account_type,
      parent_id: f.parent_id || null,
      description: textOrNull(f.description),
    };
    if (a) values.active = f.active;
    void run(async () => {
      if (a) await updateRow("gl_accounts", a.id, values);
      else await insertRow("gl_accounts", values);
      return false;
    });
  });
  const remove = () => void run(async () => {
    if (a) await deleteRow("gl_accounts", a.id);
    return true;
  });

  return (
    <form className="space-y-4" onSubmit={submit}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("finance.acc.code")} required>
          <Input value={f.code} onChange={(e) => set("code", e.target.value)} required maxLength={20} dir="ltr" disabled={locked}
            pattern="[0-9A-Za-z.\-]{1,20}" />
        </Field>
        <div className="sm:col-span-2">
          <Field label={t("finance.acc.type")} required>
            <Select value={f.account_type} onChange={(e) => { set("account_type", e.target.value as AccountType); set("parent_id", ""); }} disabled={locked}>
              {ACCOUNT_TYPES.map((x) => <option key={x} value={x}>{t(`finance.type.${x}`)}</option>)}
            </Select>
          </Field>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("finance.acc.name")} required>
          <Input value={f.name} onChange={(e) => set("name", e.target.value)} required maxLength={120} />
        </Field>
        <Field label={t("finance.acc.nameAr")}>
          <Input value={f.name_ar} onChange={(e) => set("name_ar", e.target.value)} maxLength={120} dir="rtl" />
        </Field>
      </div>
      <Field label={t("finance.acc.parent")}>
        <Select value={f.parent_id} onChange={(e) => set("parent_id", e.target.value)}>
          <option value="">{t("finance.acc.noParent")}</option>
          {parents.map((p) => <option key={p.id} value={p.id}>{`${p.code} · ${accountName(p, language)}`}</option>)}
        </Select>
      </Field>
      <Field label={t("finance.acc.description")}>
        <Textarea value={f.description} onChange={(e) => set("description", e.target.value)} rows={2} maxLength={500} />
      </Field>
      {a && (
        <label className="inline-flex items-center gap-2 text-sm text-ink-2">
          <input type="checkbox" checked={f.active} onChange={(e) => set("active", e.target.checked)} />
          {t("finance.acc.active")}
        </label>
      )}
      {locked && <p className="text-xs text-ink-3">{t("finance.acc.systemHint")}</p>}
      <FormError message={error} />
      <FormActions
        saving={saving}
        label={t("action.save")}
        onCancel={onCancel}
        extra={a && !locked ? (
          <Button type="button" variant="ghost" className="me-auto text-serious" disabled={saving}
            onClick={confirmDelete ? remove : () => setConfirmDelete(true)}>
            {confirmDelete ? t("finance.confirmDelete") : t("action.delete")}
          </Button>
        ) : undefined}
      />
    </form>
  );
}
