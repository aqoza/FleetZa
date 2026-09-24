// Minimal, best-effort PostgREST emulation over in-memory fixture rows.
// Supports the operators the app actually uses (eq/neq/gt/gte/lt/lte/like/
// ilike/is/in/cs/not.*/or=(…)/and=(…)), order/limit/offset, exact counts via
// Content-Range, single-object Accept, and auto-embedding of `rel(cols)`
// select items via FK metadata parsed from database.types.ts.

const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);

// ---------- value helpers ----------

function unquote(v) {
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1).replace(/\\"/g, '"');
  return v;
}

function isNumeric(v) {
  return typeof v === "number" || (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v)));
}

function cmp(a, b) {
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : 1;
  if (b === null || b === undefined) return -1;
  if (typeof a === "boolean" || typeof b === "boolean") return String(a).localeCompare(String(b));
  if (isNumeric(a) && isNumeric(b)) return Number(a) - Number(b);
  const sa = typeof a === "object" ? JSON.stringify(a) : String(a);
  const sb = typeof b === "object" ? JSON.stringify(b) : String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

function likeToRegex(pattern, flags) {
  const esc = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/[*%]/g, ".*").replace(/_/g, ".");
  return new RegExp(`^${esc}$`, flags);
}

function splitTopLevel(s, sep = ",") {
  const out = [];
  let depth = 0;
  let quote = false;
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' && s[i - 1] !== "\\") quote = !quote;
    if (!quote) {
      if (c === "(" || c === "{" || c === "[") depth++;
      else if (c === ")" || c === "}" || c === "]") depth--;
      else if (c === sep && depth === 0) { out.push(cur); cur = ""; continue; }
    }
    cur += c;
  }
  if (cur !== "") out.push(cur);
  return out;
}

function parseList(v) {
  // "(a,b,"c d")" or "{a,b}"
  const inner = v.replace(/^[({]/, "").replace(/[)}]$/, "");
  if (inner === "") return [];
  return splitTopLevel(inner).map((x) => unquote(x.trim()));
}

/** Evaluate one `op.value` expression (value part may itself start with `not.`). */
function evalOp(cell, expr) {
  let negate = false;
  if (expr.startsWith("not.")) { negate = true; expr = expr.slice(4); }
  const dot = expr.indexOf(".");
  const op = dot === -1 ? expr : expr.slice(0, dot);
  const raw = dot === -1 ? "" : expr.slice(dot + 1);
  const val = unquote(raw);
  let r;
  switch (op) {
    case "eq": r = cell !== null && cell !== undefined && String(typeof cell === "object" ? JSON.stringify(cell) : cell) === val; break;
    case "neq": r = cell !== null && cell !== undefined && String(cell) !== val; break;
    case "gt": r = cell !== null && cell !== undefined && cmp(cell, val) > 0; break;
    case "gte": r = cell !== null && cell !== undefined && cmp(cell, val) >= 0; break;
    case "lt": r = cell !== null && cell !== undefined && cmp(cell, val) < 0; break;
    case "lte": r = cell !== null && cell !== undefined && cmp(cell, val) <= 0; break;
    case "like": r = cell !== null && cell !== undefined && likeToRegex(val).test(String(cell)); break;
    case "ilike": r = cell !== null && cell !== undefined && likeToRegex(val, "i").test(String(cell)); break;
    case "match": r = cell != null && new RegExp(val).test(String(cell)); break;
    case "imatch": r = cell != null && new RegExp(val, "i").test(String(cell)); break;
    case "is": {
      const v = val.toLowerCase();
      if (v === "null") r = cell === null || cell === undefined;
      else if (v === "true") r = cell === true;
      else if (v === "false") r = cell === false;
      else if (v === "unknown") r = cell === null || cell === undefined;
      else r = false;
      break;
    }
    case "isdistinct": r = String(cell ?? "null") !== val; break;
    case "in": {
      const list = parseList(raw);
      r = cell !== null && cell !== undefined && list.includes(String(cell));
      break;
    }
    case "cs": {
      // contains: array ⊇ list, or json object ⊇ object
      if (Array.isArray(cell)) {
        const list = raw.startsWith("[") ? JSON.parse(raw) : parseList(raw);
        r = list.every((x) => cell.map(String).includes(String(x)));
      } else if (cell && typeof cell === "object") {
        try {
          const want = JSON.parse(raw);
          r = Object.entries(want).every(([k, v]) => JSON.stringify(cell[k]) === JSON.stringify(v));
        } catch { r = true; }
      } else r = false;
      break;
    }
    case "cd": {
      if (Array.isArray(cell)) {
        const list = raw.startsWith("[") ? JSON.parse(raw) : parseList(raw);
        r = cell.every((x) => list.map(String).includes(String(x)));
      } else r = true;
      break;
    }
    case "ov": {
      if (Array.isArray(cell)) {
        const list = parseList(raw);
        r = cell.some((x) => list.includes(String(x)));
      } else r = false;
      break;
    }
    default:
      // fts/plfts/phfts/wfts, range ops (sl/sr/nxl/nxr/adj) … not emulated: match everything.
      r = true;
  }
  return negate ? !r : r;
}

/** Parse a logic tree body "a.eq.1,b.is.null,and(c.gt.2,d.lt.3)" into a predicate. */
function logicTree(kind, body) {
  const parts = splitTopLevel(body).map((p) => p.trim()).filter(Boolean);
  const preds = parts.map((p) => {
    let neg = false;
    let s = p;
    if (s.startsWith("not.")) { neg = true; s = s.slice(4); }
    const m = s.match(/^(and|or)\((.*)\)$/s);
    let pred;
    if (m) pred = logicTree(m[1], m[2]);
    else {
      const dot = s.indexOf(".");
      const col = s.slice(0, dot);
      const expr = s.slice(dot + 1);
      pred = (row) => (col.includes("->") ? true : evalOp(row[col], expr));
    }
    return neg ? (row) => !pred(row) : pred;
  });
  return kind === "or" ? (row) => preds.some((p) => p(row)) : (row) => preds.every((p) => p(row));
}

/** Build a row predicate from the URL's filter params (embedded `a.b=` filters are ignored). */
export function buildPredicate(searchParams) {
  const preds = [];
  for (const [key, value] of searchParams) {
    if (RESERVED.has(key)) continue;
    if (key === "or" || key === "and") {
      preds.push(logicTree(key, value.replace(/^\(/, "").replace(/\)$/, "")));
      continue;
    }
    if (key === "not.or" || key === "not.and") {
      const p = logicTree(key.slice(4), value.replace(/^\(/, "").replace(/\)$/, ""));
      preds.push((row) => !p(row));
      continue;
    }
    if (key.includes(".")) continue; // filter on an embedded resource: not emulated
    if (key.includes("->")) continue; // json path filter: not emulated
    preds.push((row) => evalOp(row[key], value));
  }
  return (row) => preds.every((p) => p(row));
}

export function applyOrder(rows, orderParam) {
  if (!orderParam) return rows;
  const terms = splitTopLevel(orderParam).map((t) => {
    const [col, ...mods] = t.trim().split(".");
    const desc = mods.includes("desc");
    const nullsFirst = mods.includes("nullsfirst") ? true : mods.includes("nullslast") ? false : desc; // PG default: nulls last on asc, first on desc
    return { col, desc, nullsFirst };
  });
  return [...rows].sort((a, b) => {
    for (const { col, desc, nullsFirst } of terms) {
      if (col.includes("(") || col.includes("->")) continue;
      const av = a[col];
      const bv = b[col];
      const an = av === null || av === undefined;
      const bn = bv === null || bv === undefined;
      if (an && bn) continue;
      if (an) return nullsFirst ? -1 : 1;
      if (bn) return nullsFirst ? 1 : -1;
      const c = cmp(av, bv);
      if (c !== 0) return desc ? -c : c;
    }
    return 0;
  });
}

// ---------- select= parsing + auto-embedding ----------

/** Parse "*, vehicles(name), cust:customers!fk(name, x:y(*))" into a tree. */
export function parseSelect(sel) {
  if (!sel) return [];
  return splitTopLevel(sel).map((raw) => {
    let s = raw.trim();
    const spread = s.startsWith("...");
    if (spread) s = s.slice(3);
    const open = s.indexOf("(");
    if (open === -1) return { kind: "column", name: s };
    const head = s.slice(0, open);
    const inner = s.slice(open + 1, s.lastIndexOf(")"));
    let alias = null;
    let rest = head;
    const colon = head.indexOf(":");
    if (colon !== -1 && head[colon + 1] !== ":") { alias = head.slice(0, colon); rest = head.slice(colon + 1); }
    const [rel, hint] = rest.split("!");
    return { kind: "embed", alias, rel: rel.trim(), hint: hint ? hint.trim() : null, spread, children: parseSelect(inner) };
  });
}

function pickRel(rels, hint) {
  if (!hint || hint === "inner" || hint === "left") return rels[0];
  return rels.find((r) => r.foreignKeyName === hint || r.columns.includes(hint)) ?? rels[0];
}

/**
 * Attach embedded resources the fixture row doesn't already carry, resolving
 * many-to-one (row.fk -> parent) and one-to-many (child.fk -> row) through the
 * schema's Relationships. Unresolvable embeds become null (m2o) or [] (o2m).
 */
export function embedRows(table, rows, selectTree, ctx) {
  const embeds = selectTree.filter((n) => n.kind === "embed");
  if (!embeds.length) return rows;
  const tdef = ctx.schema.tables[table];
  return rows.map((row) => {
    const out = { ...row };
    for (const e of embeds) {
      const key = e.alias ?? e.rel;
      if (key in out) continue;
      let value;
      const m2o = (tdef?.relationships ?? []).filter((r) => r.referencedRelation === e.rel);
      const childDef = ctx.schema.tables[e.rel];
      const o2m = (childDef?.relationships ?? []).filter((r) => r.referencedRelation === table);
      const parentRows = ctx.tables[e.rel] ?? [];
      if (m2o.length) {
        const r = pickRel(m2o, e.hint);
        const fkVal = row[r.columns[0]];
        const hit = fkVal == null ? null : parentRows.find((p) => String(p[r.referencedColumns[0]]) === String(fkVal));
        value = hit ? embedRows(e.rel, [hit], e.children, ctx)[0] : null;
      } else if (o2m.length) {
        const r = pickRel(o2m, e.hint);
        const pk = row[r.referencedColumns[0]];
        const kids = parentRows.filter((c) => String(c[r.columns[0]]) === String(pk));
        value = r.isOneToOne ? (kids[0] ? embedRows(e.rel, [kids[0]], e.children, ctx)[0] : null) : embedRows(e.rel, kids, e.children, ctx);
      } else {
        value = null;
      }
      if (e.spread && value && typeof value === "object" && !Array.isArray(value)) Object.assign(out, value);
      else out[key] = value;
    }
    return out;
  });
}

// ---------- request handling ----------

function contentRange(offset, n, total) {
  const t = total === null ? "*" : String(total);
  if (n === 0) return `*/${t}`;
  return `${offset}-${offset + n - 1}/${t}`;
}

let seq = 0;
export function fakeUuid() {
  seq++;
  const hex = (Date.now().toString(16) + seq.toString(16).padStart(6, "0") + Math.random().toString(16).slice(2)).padEnd(32, "0").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Handle one /rest/v1/<table> request against ctx.tables (mutated in place for
 * writes, so a create-then-list flow inside one page sees its own writes).
 * Returns { status, headers, body } where body is a JS value or null.
 */
export function handleTable({ method, table, url, headers, postData }, ctx) {
  const accept = headers["accept"] ?? "";
  const prefer = headers["prefer"] ?? "";
  const wantObject = accept.includes("vnd.pgrst.object");
  const wantCount = /count=(exact|planned|estimated)/.test(prefer);
  const sp = url.searchParams;
  const selectTree = parseSelect(sp.get("select") ?? "*");
  const rows = (ctx.tables[table] ??= []);
  const pred = buildPredicate(sp);

  const objectOr406 = (list, extraHeaders = {}) => {
    if (list.length === 1) return { status: 200, headers: extraHeaders, body: list[0] };
    return {
      status: 406,
      headers: extraHeaders,
      body: {
        code: "PGRST116",
        message: "JSON object requested, multiple (or no) rows returned",
        details: `The result contains ${list.length} rows`,
        hint: null,
      },
      intentional: true,
    };
  };

  if (method === "GET" || method === "HEAD") {
    let matched = rows.filter(pred);
    const total = matched.length;
    matched = applyOrder(matched, sp.get("order"));
    const offset = Number(sp.get("offset") ?? 0) || 0;
    const limit = sp.has("limit") ? Number(sp.get("limit")) : Infinity;
    const page = matched.slice(offset, offset + limit);
    const out = embedRows(table, page, selectTree, ctx);
    const h = { "content-range": contentRange(offset, out.length, wantCount ? total : null) };
    if (method === "HEAD") return { status: 200, headers: h, body: null, head: true };
    if (wantObject) return objectOr406(out, h);
    return { status: 200, headers: h, body: out };
  }

  let payload = null;
  try { payload = postData ? JSON.parse(postData) : null; } catch { payload = null; }
  const returnRep = prefer.includes("return=representation");
  const now = new Date().toISOString();

  if (method === "POST") {
    const list = (Array.isArray(payload) ? payload : [payload ?? {}]).map((r) => ({
      id: fakeUuid(),
      tenant_id: ctx.tenantId,
      created_at: now,
      updated_at: now,
      ...r,
    }));
    // upsert: merge onto existing rows by on_conflict (or id)
    const conflictCols = (sp.get("on_conflict") ?? "id").split(",");
    const merge = prefer.includes("resolution=merge-duplicates");
    const stored = list.map((r) => {
      if (merge) {
        const hit = rows.find((x) => conflictCols.every((c) => String(x[c]) === String(r[c])));
        if (hit) { Object.assign(hit, r); return hit; }
      }
      const filled = ctx.fill(table, [r])[0];
      rows.push(filled);
      return filled;
    });
    if (!returnRep) return { status: 201, headers: {}, body: null };
    const out = embedRows(table, stored, selectTree, ctx);
    return wantObject ? objectOr406(out) : { status: 201, headers: {}, body: out };
  }

  if (method === "PATCH") {
    const hits = rows.filter(pred);
    for (const h of hits) Object.assign(h, payload ?? {}, { updated_at: now });
    let out = hits;
    if (!hits.length) {
      // Echo the body even when nothing matched, so optimistic flows don't choke.
      const idEq = (sp.get("id") ?? "").replace(/^eq\./, "");
      out = [{ ...(payload ?? {}), id: idEq || fakeUuid() }];
    }
    if (!returnRep) return { status: 204, headers: {}, body: null };
    out = embedRows(table, out, selectTree, ctx);
    return wantObject ? objectOr406(out) : { status: 200, headers: {}, body: out };
  }

  if (method === "DELETE") {
    const hits = rows.filter(pred);
    ctx.tables[table] = rows.filter((r) => !hits.includes(r));
    if (!returnRep) return { status: 204, headers: {}, body: null };
    return wantObject ? objectOr406(hits) : { status: 200, headers: {}, body: hits };
  }

  return { status: 405, headers: {}, body: { message: `method ${method} not emulated` } };
}
