/**
 * Idle sign-out (audit_security → security_settings.session_idle_minutes).
 * Activity is shared across tabs through localStorage, so a member working in
 * one tab isn't signed out by another that sat untouched.
 */
export const IDLE_STORAGE_KEY = "fm.lastActivity";
export const IDLE_CHECK_MS = 30_000;
/** Activity is written at most this often (mousemove fires constantly). */
export const IDLE_WRITE_THROTTLE_MS = 15_000;

export function isIdle(lastActivity: number, now: number, minutes: number | null | undefined): boolean {
  if (!minutes || minutes <= 0) return false;
  return now - lastActivity >= minutes * 60_000;
}

/** The latest of this tab's and the shared (other tabs') activity stamps. */
export function latestActivity(local: number, shared: string | null): number {
  const n = shared ? Number(shared) : NaN;
  return Number.isFinite(n) ? Math.max(local, n) : local;
}
