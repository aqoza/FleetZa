import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { apiFetch } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { Button, ErrorState, Field, Input, LoadingState } from "../../components/ui";
import { useT, type MessageKey } from "../../i18n";
import { AuthShell } from "./AuthShell";

interface InviteInfo {
  email: string;
  role: string;
  organization: string;
}

export default function AcceptInvitePage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const navigate = useNavigate();
  const { signIn } = useAuth();
  const t = useT();

  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [loadError, setLoadError] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) {
      setLoadError(t("auth.inviteMissingToken"));
      return;
    }
    apiFetch<InviteInfo>(`/invitations/${token}`)
      .then(setInvite)
      .catch((err) =>
        setLoadError(err instanceof Error ? err.message : t("auth.inviteNotFound")),
      );
  }, [token, t]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!invite) return;
    setError("");
    setBusy(true);
    try {
      await apiFetch("/invitations/accept", { body: { token, fullName, password } });
      await signIn(invite.email, password);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.inviteAcceptFailed"));
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <AuthShell title={t("auth.inviteProblem")}>
        <ErrorState message={loadError} />
        <p className="mt-4 text-sm text-slate-500">
          {t("auth.inviteHelp")}{" "}
          <Link to="/login" className="font-medium text-brand-600">
            {t("auth.signInLink")}
          </Link>
          .
        </p>
      </AuthShell>
    );
  }

  if (!invite) {
    return (
      <AuthShell title={t("auth.checkingInvite")}>
        <LoadingState />
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={t("auth.joinOrg", { org: invite.organization })}
      subtitle={t("auth.invitedAs", {
        role: t(`role.${invite.role}` as MessageKey),
        email: invite.email,
      })}
    >
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <ErrorState message={error} />}
        <Field label={t("field.fullName")} required>
          <Input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </Field>
        <Field label={t("auth.choosePassword")} required hint={t("auth.atLeast8")}>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
          />
        </Field>
        <Button type="submit" loading={busy} className="w-full">
          {t("auth.joinOrganization")}
        </Button>
      </form>
    </AuthShell>
  );
}
