import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LogOut, Users } from "lucide-react";
import { wrapDbError } from "../../lib/db";
import { supabase } from "../../lib/supabase";
import { bdiText } from "../../lib/bidi";
import { formatDate, formatDateTime } from "../../lib/format";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useT, useTp, type MessageKey } from "../../i18n";
import { Badge, Bdi, Button, EmptyState, ErrorState, LoadingState, Ltr, Modal } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { memberName, useSecurityMembers } from "./hooks";
import { STALE_DAYS, type SecurityMember } from "./types";

const isStale = (m: SecurityMember, now = Date.now()) =>
  !m.last_sign_in_at || now - new Date(m.last_sign_in_at).getTime() > STALE_DAYS * 86_400_000;

export default function MembersPage() {
  const t = useT();
  const tp = useTp();
  const tenant = useTenant();
  const { profile } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const members = useSecurityMembers();
  const [target, setTarget] = useState<SecurityMember | null>(null);
  const [actionError, setActionError] = useState("");

  const signOut = useMutation({
    mutationFn: async (m: SecurityMember) => {
      const { data, error } = await supabase.rpc("revoke_member_sessions", { p_user: m.id });
      if (error) throw wrapDbError(error);
      return { m, count: (data as number) ?? 0 };
    },
    onSuccess: ({ m, count }) => {
      setTarget(null);
      setActionError("");
      const name = bdiText(memberName(m));
      toast.success(count > 0 ? tp("security.signedOut", count, { name }) : t("security.noSessions", { name }));
      void qc.invalidateQueries({ queryKey: ["security_members"] });
      void qc.invalidateQueries({ queryKey: ["audit_events"] });
    },
    onError: (err) => {
      setTarget(null);
      setActionError(err instanceof Error ? err.message : String(err));
    },
  });

  const columns: Array<DataTableColumn<SecurityMember>> = [
    {
      id: "member",
      header: t("security.member"),
      cell: (m) => (
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 font-medium text-ink">
            <Bdi>{memberName(m)}</Bdi>
            {m.id === profile?.id && <Badge tone="slate">{t("security.you")}</Badge>}
          </div>
          {m.full_name?.trim() && <div className="truncate text-xs text-ink-3"><Ltr>{m.email}</Ltr></div>}
          {isStale(m) && <div className="text-xs text-warn md:hidden">{t("security.inactive")}</div>}
        </div>
      ),
      sortValue: (m) => memberName(m),
      exportValue: (m) => `${memberName(m)} <${m.email}>`,
    },
    {
      id: "role",
      header: t("security.role"),
      cell: (m) => (
        <Badge tone={m.role === "owner" || m.role === "admin" ? "purple" : "slate"}>
          {t(`role.${m.role}` as MessageKey)}
        </Badge>
      ),
      sortValue: (m) => ["owner", "admin", "manager", "viewer"].indexOf(m.role),
      exportValue: (m) => m.role,
    },
    {
      id: "last_sign_in",
      header: t("security.lastSignIn"),
      minBreakpoint: "md",
      cell: (m) => (
        <div className="text-ink-2">
          <div className="whitespace-nowrap">
            {m.last_sign_in_at ? <Ltr>{formatDateTime(m.last_sign_in_at, tenant.timezone)}</Ltr> : t("security.neverSignedIn")}
          </div>
          {isStale(m) && <div className="text-xs text-warn">{t("security.inactive")}</div>}
        </div>
      ),
      sortValue: (m) => m.last_sign_in_at ?? "",
      exportValue: (m) => m.last_sign_in_at ?? "",
    },
    {
      id: "email",
      header: t("security.emailStatus"),
      minBreakpoint: "lg",
      cell: (m) =>
        m.email_confirmed_at ? (
          <Badge tone="green">{t("security.confirmed")}</Badge>
        ) : (
          <Badge tone="yellow">{t("security.unconfirmed")}</Badge>
        ),
      sortValue: (m) => (m.email_confirmed_at ? 1 : 0),
      exportValue: (m) => (m.email_confirmed_at ? "confirmed" : "unconfirmed"),
    },
    {
      id: "joined",
      header: t("security.joined"),
      minBreakpoint: "xl",
      cell: (m) => <span className="whitespace-nowrap text-ink-2"><Ltr>{formatDate(m.created_at, tenant.timezone)}</Ltr></span>,
      sortValue: (m) => m.created_at,
      exportValue: (m) => m.created_at,
    },
    {
      id: "actions",
      header: "",
      align: "end",
      cell: (m) =>
        m.id === profile?.id || m.role === "owner" ? null : (
          <button
            type="button"
            className="rounded p-1.5 text-ink-3 hover:bg-serious-soft hover:text-serious"
            onClick={() => setTarget(m)}
            aria-label={t("security.signOutEverywhere")}
            title={t("security.signOutEverywhere")}
          >
            <LogOut className="h-4 w-4 rtl:-scale-x-100" />
          </button>
        ),
    },
  ];

  return (
    <>
      {members.isLoading && <LoadingState />}
      {members.error && <ErrorState message={(members.error as Error).message} />}
      {actionError && (
        <div className="mb-4">
          <ErrorState message={actionError} />
        </div>
      )}
      {members.data && (
        <DataTable<SecurityMember>
          tableId="security-members"
          exportName="member-access"
          rows={members.data}
          rowKey={(m) => m.id}
          columns={columns}
          empty={<EmptyState icon={<Users className="h-10 w-10" />} title={t("security.membersEmpty")} />}
        />
      )}
      <Modal title={t("security.signOutEverywhere")} open={!!target} onClose={() => setTarget(null)}>
        {target && (
          <>
            <p className="text-sm text-ink-2">{t("security.signOutConfirm", { name: bdiText(memberName(target)) })}</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setTarget(null)}>{t("action.cancel")}</Button>
              <Button variant="danger" onClick={() => signOut.mutate(target)} loading={signOut.isPending}>
                {t("security.signOutEverywhere")}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
