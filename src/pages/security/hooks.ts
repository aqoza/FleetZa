import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { listRows, wrapDbError } from "../../lib/db";
import { supabase } from "../../lib/supabase";
import type { MessageKey } from "../../i18n";
import type { Posture, SecurityMember, SecuritySettings } from "./types";

/** The tenant's settings row (members can read it; null until an admin saves). */
export function useSecuritySettings(enabled = true) {
  return useQuery({
    queryKey: ["security_settings"],
    queryFn: async () => (await listRows<SecuritySettings>("security_settings", (q) => q.limit(1)))[0] ?? null,
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useSecurityMembers() {
  const q = useQuery({
    queryKey: ["security_members"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("security_members");
      if (error) throw wrapDbError(error);
      return (data ?? []) as SecurityMember[];
    },
  });
  const byId = useMemo(() => new Map((q.data ?? []).map((m) => [m.id, m])), [q.data]);
  return { ...q, byId };
}

export function usePosture() {
  return useQuery({
    queryKey: ["security_posture"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("security_posture");
      if (error) throw wrapDbError(error);
      return data as unknown as Posture;
    },
  });
}

const KNOWN_TABLES = new Set([
  "vehicles", "drivers", "customers", "contacts", "work_orders", "renewals", "sl_devices", "sl_technicians",
  "sl_jobs", "speed_limiter_installations", "speed_limiter_certificates", "products", "quotes", "sales_orders",
  "invoices", "payments", "companies", "branches", "departments", "employees", "suppliers", "supplier_contacts",
  "warehouses", "inventory_items", "documents", "api_keys", "automation_rules", "webhook_subscriptions",
  "security_settings", "auth_sessions",
]);

/** A localized record-type name, or the table name for ones added later. */
export function tableLabel(t: (k: MessageKey) => string, table: string): string {
  return KNOWN_TABLES.has(table) ? t(`security.table.${table}` as MessageKey) : table;
}

export const memberName = (m: Pick<SecurityMember, "full_name" | "email">) => m.full_name?.trim() || m.email;
