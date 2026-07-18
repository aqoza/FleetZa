import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  MODULES,
  dependentsOf,
  getModule,
  requirementsOf,
} from "../../shared/modules";
import { listRows } from "../lib/db";
import { supabase } from "../lib/supabase";
import type { TenantModule } from "../lib/types";
import { useAuth } from "./AuthContext";

interface ModulesState {
  /** Enabled module ids (alwaysOn modules are always present). */
  enabled: Set<string>;
  loading: boolean;
  isEnabled: (id: string) => boolean;
  /**
   * Enable/disable a module (admin-only; RLS enforces).
   * Enabling auto-enables its transitive requirements.
   * Disabling throws if enabled modules still depend on it.
   */
  setModuleEnabled: (id: string, enabled: boolean) => Promise<void>;
}

const ModulesContext = createContext<ModulesState | null>(null);

const ALWAYS_ON = new Set(MODULES.filter((m) => m.alwaysOn).map((m) => m.id));

async function upsertModule(moduleId: string, enabled: boolean, userId: string | undefined) {
  const { data: updated, error: updateErr } = await supabase
    .from("tenant_modules")
    .update({ enabled, enabled_at: new Date().toISOString(), enabled_by: userId ?? null })
    .eq("module_id", moduleId)
    .select("module_id");
  if (updateErr) throw new Error(updateErr.message);
  if (!updated?.length) {
    const { error: insertErr } = await supabase
      .from("tenant_modules")
      .insert({ module_id: moduleId, enabled, enabled_by: userId ?? null });
    if (insertErr) throw new Error(insertErr.message);
  }
}

export function ModulesProvider({ children }: { children: ReactNode }) {
  const { session, tenant } = useAuth();
  const qc = useQueryClient();

  // Keyed by tenant id so a sign-out → sign-in as another tenant can never be
  // served the previous tenant's module set from cache.
  const { data: rows, isLoading } = useQuery({
    queryKey: ["tenant_modules", tenant?.id],
    queryFn: () => listRows<TenantModule>("tenant_modules"),
    enabled: Boolean(session && tenant),
    staleTime: 60_000,
  });

  const enabled = useMemo(() => {
    const set = new Set<string>(ALWAYS_ON);
    for (const row of rows ?? []) {
      if (row.enabled && getModule(row.module_id)) set.add(row.module_id);
    }
    return set;
  }, [rows]);

  const isEnabled = useCallback((id: string) => enabled.has(id), [enabled]);

  const setModuleEnabled = useCallback(
    async (id: string, next: boolean) => {
      const mod = getModule(id);
      if (!mod || mod.status !== "available") throw new Error("This module is not available yet.");
      if (mod.alwaysOn) throw new Error("This module is part of the platform core.");
      const userId = session?.user.id;
      try {
        if (next) {
          // Enable transitive requirements first, then the module itself.
          const toEnable = [...requirementsOf(id).filter((dep) => !enabled.has(dep)), id];
          for (const dep of toEnable) await upsertModule(dep, true, userId);
        } else {
          const blockers = dependentsOf(id, enabled);
          if (blockers.length) {
            throw new Error(`DEPENDENTS:${blockers.join(",")}`);
          }
          await upsertModule(id, false, userId);
        }
      } finally {
        // Even a mid-sequence failure may have enabled dependencies — refetch
        // so the UI reflects whatever actually landed in the DB.
        await qc.invalidateQueries({ queryKey: ["tenant_modules"] });
      }
    },
    [enabled, session, qc],
  );

  const value = useMemo<ModulesState>(
    () => ({
      enabled,
      loading: Boolean(session && tenant) && isLoading,
      isEnabled,
      setModuleEnabled,
    }),
    [enabled, isLoading, session, tenant, isEnabled, setModuleEnabled],
  );

  return <ModulesContext.Provider value={value}>{children}</ModulesContext.Provider>;
}

export function useModules(): ModulesState {
  const ctx = useContext(ModulesContext);
  if (!ctx) throw new Error("useModules must be used within ModulesProvider");
  return ctx;
}
