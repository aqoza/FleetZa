import { useEffect, useRef } from "react";
import { useAuth } from "../context/AuthContext";
import { useT } from "../i18n";
import { IDLE_CHECK_MS, IDLE_STORAGE_KEY, IDLE_WRITE_THROTTLE_MS, isIdle, latestActivity } from "../lib/idle";
import { useSecuritySettings } from "../pages/security/hooks";
import { useToast } from "./Toast";

const EVENTS = ["pointerdown", "keydown", "wheel", "touchstart", "mousemove"] as const;

function readShared(): string | null {
  try {
    return localStorage.getItem(IDLE_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Signs the member out after the tenant's idle limit (renders nothing). */
export function IdleGuard() {
  const t = useT();
  const toast = useToast();
  const { signOut } = useAuth();
  const { data: settings } = useSecuritySettings();
  const minutes = settings?.session_idle_minutes ?? null;
  const last = useRef(Date.now());
  const lastWrite = useRef(0);

  useEffect(() => {
    if (!minutes) return;
    last.current = Date.now();

    const touch = () => {
      const now = Date.now();
      last.current = now;
      if (now - lastWrite.current > IDLE_WRITE_THROTTLE_MS) {
        lastWrite.current = now;
        try {
          localStorage.setItem(IDLE_STORAGE_KEY, String(now));
        } catch {
          /* private mode: this tab still tracks its own activity */
        }
      }
    };
    const check = () => {
      if (isIdle(latestActivity(last.current, readShared()), Date.now(), minutes)) {
        toast.show(t("security.idleSignedOut", { minutes }));
        void signOut();
      }
    };

    touch();
    EVENTS.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    document.addEventListener("visibilitychange", check);
    const timer = window.setInterval(check, IDLE_CHECK_MS);
    return () => {
      EVENTS.forEach((e) => window.removeEventListener(e, touch));
      document.removeEventListener("visibilitychange", check);
      window.clearInterval(timer);
    };
  }, [minutes, signOut, t, toast]);

  return null;
}
