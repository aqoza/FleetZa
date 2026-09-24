// Reads the repo's generated src/lib/database.types.ts (text-level parse, no
// TypeScript needed) to learn every table/view's Row columns + FK relationships.
// Used to (a) fill columns a fixture row leaves out, and (b) auto-embed
// `select=*,vehicles(name)` style resources from other fixture tables.
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * @returns {{ tables: Record<string, { columns: Record<string, string>,
 *   relationships: { columns: string[], referencedRelation: string, referencedColumns: string[], foreignKeyName: string }[] }> }}
 */
export function loadSchema(repoRoot) {
  const src = readFileSync(join(repoRoot, "src/lib/database.types.ts"), "utf8");
  const lines = src.split("\n");
  const tables = {};
  let section = null; // "Tables" | "Views" | null
  let inPublic = false;
  let current = null; // table name
  let mode = null; // "Row" | "Relationships" | null
  let rel = null;
  for (const line of lines) {
    if (/^  public: \{$/.test(line)) { inPublic = true; continue; }
    if (!inPublic) continue;
    const sec = line.match(/^    (\w+): \{$/);
    if (sec) { section = sec[1] === "Tables" || sec[1] === "Views" ? sec[1] : null; current = null; continue; }
    if (/^  \}$/.test(line)) { inPublic = false; section = null; continue; }
    if (!section) continue;
    const tbl = line.match(/^      (\w+): \{$/);
    if (tbl) { current = tbl[1]; tables[current] = { kind: section, columns: {}, relationships: [] }; mode = null; continue; }
    if (!current) continue;
    if (/^        Row: \{$/.test(line)) { mode = "Row"; continue; }
    if (/^        Relationships: \[$/.test(line)) { mode = "Relationships"; continue; }
    if (/^        (Insert|Update): \{$/.test(line)) { mode = null; continue; }
    if (/^        [\}\]]$/.test(line)) { mode = null; continue; }
    if (mode === "Row") {
      const col = line.match(/^          (\w+): (.+)$/);
      if (col) tables[current].columns[col[1]] = col[2].trim();
    } else if (mode === "Relationships") {
      if (/^          \{$/.test(line)) { rel = {}; continue; }
      if (/^          \},?$/.test(line)) { if (rel) tables[current].relationships.push(rel); rel = null; continue; }
      if (!rel) continue;
      const m = line.match(/^            (\w+): (.+)$/);
      if (!m) continue;
      const [, k, v] = m;
      if (k === "columns" || k === "referencedColumns") {
        rel[k] = [...v.matchAll(/"([^"]+)"/g)].map((x) => x[1]);
      } else if (k === "referencedRelation" || k === "foreignKeyName") {
        rel[k] = v.replace(/"/g, "");
      } else if (k === "isOneToOne") {
        rel[k] = v === "true";
      }
    }
  }
  return { tables };
}

/** A default value for a column whose type string came from database.types.ts. */
export function defaultFor(col, type, ctx) {
  const nullable = /\|\s*null\b/.test(type);
  if (col === "tenant_id") return ctx.tenantId;
  if (col === "id" && /string/.test(type)) return ctx.uuid();
  if (/_at$/.test(col) && /string/.test(type) && !nullable) return ctx.now;
  if (nullable) return null;
  if (/\[\]$/.test(type)) return [];
  if (/^string/.test(type)) return "";
  if (/^number/.test(type)) return 0;
  if (/^boolean/.test(type)) return false;
  if (/^Json/.test(type)) return {};
  return null;
}

/** Fill any Row column a fixture row omits (only for tables the schema knows). */
export function fillRows(schema, table, rows, ctx) {
  const t = schema.tables[table];
  if (!t || !Array.isArray(rows)) return rows;
  return rows.map((row) => {
    if (!row || typeof row !== "object") return row;
    const out = { ...row };
    for (const [col, type] of Object.entries(t.columns)) {
      if (!(col in out)) out[col] = defaultFor(col, type, ctx);
    }
    return out;
  });
}
