import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { apiFetch } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { Button, ErrorState, Field, Input, LoadingState } from "../../components/ui";
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

  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [loadError, setLoadError] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) {
      setLoadError("This invitation link is missing its token.");
      return;
    }
    apiFetch<InviteInfo>(`/invitations/${token}`)
      .then(setInvite)
      .catch((err) =>
        setLoadError(err instanceof Error ? err.message : "Invitation not found"),
      );
  }, [token]);

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
      setError(err instanceof Error ? err.message : "Could not accept invitation");
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <AuthShell title="Invitation problem">
        <ErrorState message={loadError} />
        <p className="mt-4 text-sm text-slate-500">
          Ask your administrator to send a new invitation, or{" "}
          <Link to="/login" className="font-medium text-brand-600">
            sign in
          </Link>
          .
        </p>
      </AuthShell>
    );
  }

  if (!invite) {
    return (
      <AuthShell title="Checking invitation…">
        <LoadingState />
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={`Join ${invite.organization}`}
      subtitle={`You've been invited as ${invite.role} (${invite.email}).`}
    >
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <ErrorState message={error} />}
        <Field label="Your name" required>
          <Input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </Field>
        <Field label="Choose a password" required hint="At least 8 characters">
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
          Join organization
        </Button>
      </form>
    </AuthShell>
  );
}
