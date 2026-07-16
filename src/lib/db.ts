import type { PostgrestFilterBuilder } from "@supabase/postgrest-js";
import { supabase } from "./supabase";

type AnyFilter = PostgrestFilterBuilder<any, any, any, any[], any>;

export async function listRows<T>(
  table: string,
  build?: (q: AnyFilter) => AnyFilter,
): Promise<T[]> {
  let q = supabase.from(table).select("*") as unknown as AnyFilter;
  if (build) q = build(q);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as T[];
}

export async function getRow<T>(table: string, id: string): Promise<T | null> {
  const { data, error } = await supabase.from(table).select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as T) ?? null;
}

export async function insertRow<T>(table: string, values: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.from(table).insert(values).select().single();
  if (error) throw new Error(error.message);
  return data as T;
}

export async function updateRow<T>(
  table: string,
  id: string,
  values: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.from(table).update(values).eq("id", id).select().single();
  if (error) throw new Error(error.message);
  return data as T;
}

export async function deleteRow(table: string, id: string): Promise<void> {
  const { error } = await supabase.from(table).delete().eq("id", id);
  if (error) throw new Error(error.message);
}
