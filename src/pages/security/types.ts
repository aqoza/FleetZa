export interface SecuritySettings {
  tenant_id: string;
  session_idle_minutes: number | null;
  require_strong_passwords: boolean;
  audit_retention_days: number | null;
  updated_at: string;
}

export interface SecurityMember {
  id: string;
  full_name: string;
  email: string;
  role: string;
  created_at: string;
  last_sign_in_at: string | null;
  email_confirmed_at: string | null;
  banned_until: string | null;
}

export interface Posture {
  members: number;
  admins: number;
  stale_members: number;
  unconfirmed_members: number;
  api_keys_active: number;
  api_keys_no_expiry: number;
  api_keys_unused: number;
  audit_events_30d: number;
  webhooks_failing: number | null;
  session_idle_minutes: number | null;
  audit_retention_days: number | null;
}

export type AuditAction = "insert" | "update" | "delete";

export interface AuditEvent {
  id: number;
  table_name: string;
  row_id: string | null;
  action: AuditAction;
  actor: string | null;
  at: string;
  diff: Record<string, unknown> | null;
}

export const STALE_DAYS = 90;
