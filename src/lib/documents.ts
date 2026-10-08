/**
 * Documents — pure helpers for the module. Files live in the private
 * `documents` bucket at <tenant_id>/<document id>/<filename>; the storage
 * policies and a CHECK on public.documents both enforce the tenant folder.
 */

/** Same windows as the expiry scanner (app.scan_due_documents). */
export const EXPIRY_SOON_DAYS = 30;

export type ExpiryState = "none" | "ok" | "soon" | "expired";

/** Whole days from `today` to `iso` (both YYYY-MM-DD), negative once past. */
export function daysBetween(today: string, iso: string): number {
  const a = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10));
  const b = Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

export function expiryState(expiresOn: string | null | undefined, today: string): ExpiryState {
  if (!expiresOn) return "none";
  const days = daysBetween(today, expiresOn);
  if (days < 0) return "expired";
  if (days <= EXPIRY_SOON_DAYS) return "soon";
  return "ok";
}

/**
 * A storage-safe object name: keeps letters (any script), digits, dot, dash
 * and underscore, collapses the rest to "-", and caps the length while
 * keeping the extension. Never empty.
 */
export function safeFileName(name: string): string {
  const trimmed = name.trim().normalize("NFC");
  const dot = trimmed.lastIndexOf(".");
  const hasExt = dot > 0 && dot >= trimmed.length - 11;
  const base = hasExt ? trimmed.slice(0, dot) : trimmed;
  const ext = hasExt ? trimmed.slice(dot + 1).replace(/[^\p{L}\p{N}]/gu, "").toLowerCase() : "";
  const cleanBase = base
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 100) || "file";
  return ext ? `${cleanBase}.${ext}` : cleanBase;
}

export function storagePath(tenantId: string, documentId: string, fileName: string): string {
  return `${tenantId}/${documentId}/${safeFileName(fileName)}`;
}

/** The name a user typed for the file, or the file's own name without its extension. */
export function defaultDocumentName(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return (dot > 0 ? fileName.slice(0, dot) : fileName).trim().slice(0, 255);
}

export function formatBytes(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

/** Comma- or newline-separated tags, trimmed, de-duplicated (case-insensitive), max 20. */
export function parseTags(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.split(/[,،\n]/)) {
    const tag = raw.trim().slice(0, 40);
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
    if (out.length === 20) break;
  }
  return out;
}

/** The bucket's own limit (25 MB); checked client-side for a clear message. */
export const MAX_FILE_BYTES = 26_214_400;
