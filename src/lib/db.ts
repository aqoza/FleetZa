import type { PostgrestFilterBuilder } from "@supabase/postgrest-js";
import type { Database } from "./database.types";
import { translate, type MessageKey } from "../i18n";
import { supabase } from "./supabase";

/** Compile-checked table names — a renamed table becomes a build error. */
export type TableName = keyof Database["public"]["Tables"];

type AnyFilter = PostgrestFilterBuilder<any, any, any, any[], any>;

/**
 * Maps raised exceptions (our triggers/RPCs) and common Postgres error codes
 * to localized messages. Raw driver text goes to the console only.
 */
const RAISED_MESSAGES: Record<string, MessageKey> = {
  VEHICLE_HAS_CERTIFICATES: "errors.vehicleHasCertificates",
  VEHICLE_HAS_COMPLETED_JOBS: "errors.vehicleHasCompletedJobs",
  VEHICLE_HAS_COMPLETED_WORK_ORDERS: "errors.vehicleHasCompletedWorkOrders",
  CUSTOMER_HAS_CERTIFICATES: "errors.customerHasCertificates",
  CUSTOMER_HAS_COMPLETED_JOBS: "errors.customerHasCompletedJobs",
  ILLEGAL_JOB_TRANSITION: "errors.illegalJobTransition",
  JOB_NOT_CERTIFIABLE: "errors.jobNotCertifiable",
  JOB_NOT_FOUND: "errors.jobNotFound",
  CERT_ALREADY_ISSUED: "errors.certAlreadyIssued",
  FORBIDDEN: "errors.forbidden",
};

/**
 * Sanitize free-text search before interpolating into a PostgREST `.or()`
 * logic tree: %, commas, and parentheses are tree syntax and would otherwise
 * turn a user's search into a 400 parse error.
 */
export function sanitizeSearch(term: string): string {
  return term.trim().replace(/[%,()]/g, "");
}

/** Wrap a PostgREST error into a user-facing, localized Error. Reused by
 *  direct supabase.rpc() call sites too. */
export function wrapDbError(error: { message: string; code?: string }): Error {
  const raised = Object.keys(RAISED_MESSAGES).find((k) => error.message.startsWith(k));
  let message: string | null = null;
  if (raised) message = translate(RAISED_MESSAGES[raised]);
  else if (error.code === "23505") message = translate("errors.duplicate");
  else if (error.code === "23503") message = translate("errors.referenced");
  else if (error.code === "42501") message = translate("errors.forbidden");
  if (message) {
    console.error("[db]", error.code, error.message);
    return new Error(message);
  }
  return new Error(error.message);
}

export async function listRows<T>(
  table: TableName,
  build?: (q: AnyFilter) => AnyFilter,
): Promise<T[]> {
  let q = supabase.from(table).select("*") as unknown as AnyFilter;
  if (build) q = build(q);
  const { data, error } = await q;
  if (error) throw wrapDbError(error);
  return (data ?? []) as T[];
}

export interface Page<T> {
  rows: T[];
  /** Exact total row count for the filtered set (drives pagination UI). */
  total: number;
}

/**
 * Paged variant of listRows: `page` is 0-based. Always pass a bounded
 * pageSize — this is the API that keeps big tenants under PostgREST's
 * 1,000-row response cap instead of silently truncating.
 */
export async function listPage<T>(
  table: TableName,
  page: number,
  pageSize: number,
  build?: (q: AnyFilter) => AnyFilter,
): Promise<Page<T>> {
  let q = supabase
    .from(table)
    .select("*", { count: "exact" }) as unknown as AnyFilter;
  if (build) q = build(q);
  const from = page * pageSize;
  const { data, error, count } = await q.range(from, from + pageSize - 1);
  if (error) throw wrapDbError(error);
  return { rows: (data ?? []) as T[], total: count ?? 0 };
}

export async function getRow<T>(table: TableName, id: string): Promise<T | null> {
  const { data, error } = await (supabase.from(table).select("*") as unknown as AnyFilter)
    .eq("id", id)
    .maybeSingle();
  if (error) throw wrapDbError(error);
  return (data as T) ?? null;
}

export async function insertRow<T>(table: TableName, values: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.from(table).insert(values as never).select().single();
  if (error) throw wrapDbError(error);
  return data as T;
}

export async function updateRow<T>(
  table: TableName,
  id: string,
  values: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await (supabase
    .from(table)
    .update(values as never) as unknown as AnyFilter)
    .eq("id", id)
    .select()
    .single();
  if (error) throw wrapDbError(error);
  return data as T;
}

export async function deleteRow(table: TableName, id: string): Promise<void> {
  const { error } = await (supabase.from(table).delete() as unknown as AnyFilter).eq("id", id);
  if (error) throw wrapDbError(error);
}
