import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { getCountry } from "../../shared/countries";
import { useI18n } from "../i18n";
import { configureFormatting } from "../lib/format";
import { supabase } from "../lib/supabase";
import type { Language, Profile, Tenant } from "../lib/types";

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  tenant: Tenant | null;
  loading: boolean;
  isManager: boolean;
  isAdmin: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  setLanguage: (lang: Language) => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { setLanguage: applyLanguage } = useI18n();
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);

  const loadMembership = useCallback(async (s: Session | null) => {
    if (!s) {
      setProfile(null);
      setTenant(null);
      return;
    }
    const [{ data: p }, { data: t }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", s.user.id).maybeSingle(),
      supabase.from("tenants").select("*").maybeSingle(),
    ]);
    setProfile((p as Profile) ?? null);
    setTenant((t as Tenant) ?? null);
  }, []);

  useEffect(() => {
    let cancelled = false;

    supabase.auth.getSession().then(async ({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      await loadMembership(data.session);
      if (!cancelled) setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      // Avoid Supabase deadlock: no awaited supabase calls inside the callback.
      if (event === "SIGNED_OUT") {
        setProfile(null);
        setTenant(null);
      } else if (event === "SIGNED_IN") {
        setTimeout(() => void loadMembership(s), 0);
      }
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [loadMembership]);

  // Keep the app-wide formatting locale in sync with the tenant's country.
  // Applied during render (useMemo, not useEffect) so the locale is set before
  // children render — otherwise the first commit after tenant loads paints with
  // the browser locale and can mix locales across components.
  useMemo(() => {
    configureFormatting({ locale: tenant ? getCountry(tenant.country).locale : undefined });
  }, [tenant]);

  // Apply the signed-in user's saved language once per profile load. Keyed on
  // the profile id (not language) so it doesn't fight the in-app switcher.
  const profileId = profile?.id;
  const profileLanguage = profile?.language;
  useEffect(() => {
    if (profileId && profileLanguage) applyLanguage(profileLanguage);
  }, [profileId, profileLanguage, applyLanguage]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const refresh = useCallback(async () => {
    const { data } = await supabase.auth.refreshSession();
    setSession(data.session);
    await loadMembership(data.session);
  }, [loadMembership]);

  const setLanguage = useCallback(
    async (lang: Language) => {
      applyLanguage(lang);
      setProfile((p) => (p ? { ...p, language: lang } : p));
      if (session) {
        await supabase.from("profiles").update({ language: lang }).eq("id", session.user.id);
      }
    },
    [applyLanguage, session],
  );

  const role = profile?.role;
  const value: AuthState = {
    session,
    profile,
    tenant,
    loading,
    isManager: role === "owner" || role === "admin" || role === "manager",
    isAdmin: role === "owner" || role === "admin",
    signIn,
    signOut,
    refresh,
    setLanguage,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

/** Convenience: tenant is guaranteed inside protected routes. */
export function useTenant(): Tenant {
  const { tenant } = useAuth();
  if (!tenant) throw new Error("Tenant not loaded");
  return tenant;
}
