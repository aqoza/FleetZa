import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { deleteRow, insertRow, listRows, wrapDbError } from "../../lib/db";
import { storagePath } from "../../lib/documents";
import { translate } from "../../i18n";
import type { TableName } from "../../lib/db";
import { linkTypes } from "./labels";
import type { DocumentRow, LinkType } from "./types";

const BUCKET = "documents";

/**
 * Row first (client-generated id, so the path is known), then the bytes; if
 * the upload fails the row is removed again so no document points at nothing.
 * The storage policies only let managers write, matching the row policies.
 */
export async function uploadDocument(
  tenantId: string,
  file: File,
  values: Record<string, unknown>,
): Promise<DocumentRow> {
  const id = crypto.randomUUID();
  const path = storagePath(tenantId, id, file.name);
  const row = await insertRow<DocumentRow>("documents", {
    ...values,
    id,
    storage_path: path,
    mime_type: file.type || null,
    size_bytes: file.size,
  });
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || undefined,
    upsert: false,
  });
  if (error) {
    await deleteRow("documents", id).catch(() => undefined);
    console.error("[documents] upload", error.message);
    throw new Error(translate("documents.uploadFailed"));
  }
  return row;
}

/** File first, then the row: a failed row delete leaves a visible row, never a silent orphan. */
export async function deleteDocument(doc: Pick<DocumentRow, "id" | "storage_path">): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET).remove([doc.storage_path]);
  if (error) throw wrapDbError(error);
  await deleteRow("documents", doc.id);
}

/**
 * A short-lived signed URL; the bucket is private. Viewing opens a tab
 * synchronously (inside the click, so popup blockers allow it) and points it
 * at the URL once signed; downloading navigates to a URL whose response is
 * an attachment, so the page stays put.
 */
export async function openDocument(doc: Pick<DocumentRow, "storage_path" | "name">, download = false): Promise<void> {
  const tab = download ? null : window.open("about:blank", "_blank");
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(doc.storage_path, 60, download ? { download: doc.name } : undefined);
  if (error || !data?.signedUrl) {
    tab?.close();
    throw new Error(translate("documents.downloadFailed"));
  }
  if (tab) {
    tab.opener = null;
    tab.location.href = data.signedUrl;
  } else if (download) {
    window.location.assign(data.signedUrl);
  } else {
    window.open(data.signedUrl, "_blank", "noopener");
  }
}

const LINK_TABLES: Record<LinkType, { table: TableName; columns: string; label: (r: Record<string, unknown>) => string }> = {
  vehicle: { table: "vehicles", columns: "id, name, license_plate", label: (r) => String(r.name ?? r.license_plate ?? "") },
  driver: {
    table: "drivers",
    columns: "id, first_name, last_name",
    label: (r) => `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim(),
  },
  customer: { table: "customers", columns: "id, name", label: (r) => String(r.name ?? "") },
  supplier: { table: "suppliers", columns: "id, name", label: (r) => String(r.name ?? "") },
  employee: {
    table: "employees",
    columns: "id, first_name, last_name",
    label: (r) => `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim(),
  },
};

/**
 * Names of the records a page of documents links to: one bounded `in()`
 * query per record type present on the page. A record the caller cannot see
 * (RLS) or a type from another module simply has no name.
 */
export function useLinkedNames(rows: Array<Pick<DocumentRow, "entity_type" | "entity_id">>, isEnabled: (m: string) => boolean) {
  const byType = new Map<LinkType, string[]>();
  for (const r of rows) {
    if (!r.entity_type || !r.entity_id || !(r.entity_type in LINK_TABLES)) continue;
    const type = r.entity_type as LinkType;
    const list = byType.get(type) ?? [];
    if (!list.includes(r.entity_id)) list.push(r.entity_id);
    byType.set(type, list);
  }
  const key = [...byType.entries()].map(([k, v]) => `${k}:${[...v].sort().join(",")}`).sort().join("|");
  return useQuery({
    queryKey: ["documents", "linked-names", key],
    enabled: byType.size > 0,
    queryFn: async () => {
      const names = new Map<string, string>();
      await Promise.all(
        [...byType.entries()].map(async ([type, ids]) => {
          const cfg = LINK_TABLES[type];
          if (!isEnabled(linkTypes[type].module)) return;
          const found = await listRows<Record<string, unknown>>(cfg.table, (q) => q.select(cfg.columns).in("id", ids));
          for (const r of found) names.set(`${type}:${r.id as string}`, cfg.label(r));
        }),
      );
      return names;
    },
    staleTime: 60_000,
  });
}
