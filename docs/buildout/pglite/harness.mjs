#!/usr/bin/env node
/**
 * Local PGlite replica of the FleetManage database, for fast migration dry-runs
 * that never touch production. See README.md.
 *
 *   node harness.mjs build [--skip=a,b]         # prelude + every repo migration + extras/ + seed.sql -> base.tgz
 *   node harness.mjs run a.sql [b.sql ...]      # load base.tgz, run the files statement by statement
 *   node harness.mjs bundle out.sql a.sql ...   # comment-stripped concatenation (+ md5) for execute_sql
 *
 * run options: --all (print every row-returning statement), --fresh (skip base.tgz,
 * start from prelude + migrations), --wide (no cell truncation), --quiet (no notices).
 * A comment line `-- @print` right before a statement always prints its rows.
 */
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../..");
const MIGRATIONS = join(REPO, "supabase", "migrations");
const EXTRAS = join(HERE, "extras");
const BASE = join(HERE, "base.tgz");
const extensions = { pgcrypto, uuid_ossp };

const argv = process.argv.slice(2);
const cmd = argv[0];
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const files = argv.slice(1).filter((a) => !a.startsWith("--"));

/** Split SQL into top-level statements, respecting quotes, dollar quotes and comments. */
export function splitSql(text) {
  const out = [];
  let i = 0;
  let start = 0;
  let line = 1;
  let startLine = 1;
  const n = text.length;
  let sawCode = false;
  while (i < n) {
    const c = text[i];
    const d = text[i + 1];
    if (c === "\n") { line++; i++; continue; }
    if (c === "-" && d === "-") {
      while (i < n && text[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && d === "*") {
      let depth = 1; i += 2;
      while (i < n && depth > 0) {
        if (text[i] === "\n") line++;
        if (text[i] === "/" && text[i + 1] === "*") { depth++; i += 2; continue; }
        if (text[i] === "*" && text[i + 1] === "/") { depth--; i += 2; continue; }
        i++;
      }
      continue;
    }
    if (!sawCode && !/\s/.test(c)) { sawCode = true; startLine = line; }
    if (c === "'" || c === '"') {
      const q = c; i++;
      while (i < n) {
        if (text[i] === "\n") line++;
        if (text[i] === q) {
          if (text[i + 1] === q) { i += 2; continue; }
          break;
        }
        i++;
      }
      i++;
      continue;
    }
    if (c === "$") {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(text.slice(i, i + 64));
      if (m) {
        const tag = m[0];
        const end = text.indexOf(tag, i + tag.length);
        const stop = end === -1 ? n : end + tag.length;
        for (let k = i; k < stop; k++) if (text[k] === "\n") line++;
        i = stop;
        continue;
      }
    }
    if (c === ";") {
      const stmt = text.slice(start, i).trim();
      if (sawCode) out.push({ sql: stmt, line: startLine });
      i++; start = i; sawCode = false;
      continue;
    }
    i++;
  }
  const tail = text.slice(start).trim();
  if (sawCode && tail) out.push({ sql: tail, line: startLine });
  return out;
}

function stripComments(text) {
  // Drop whole-line `--` comments and blank lines; keep everything else verbatim
  // (inline comments inside function bodies are harmless).
  return text
    .split(/\r?\n/)
    .filter((l) => !/^\s*--/.test(l) && l.trim() !== "")
    .join("\n");
}

function fmtCell(v, wide) {
  if (v === null || v === undefined) return "∅";
  let s = typeof v === "object" ? JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)) : String(v);
  s = s.replace(/\s+/g, " ");
  if (!wide && s.length > 300) s = s.slice(0, 297) + "...";
  return s;
}

function printRows(label, res, wide) {
  const cols = res.fields.map((f) => f.name);
  console.log(`\n── ${label} (${res.rows.length} row${res.rows.length === 1 ? "" : "s"})`);
  console.log(cols.join(" | "));
  for (const r of res.rows) console.log(cols.map((c) => fmtCell(r[c], wide)).join(" | "));
}

async function execFile(db, path, opts) {
  const text = readFileSync(path, "utf8");
  const stmts = splitSql(text);
  const lines = text.split("\n");
  let last = null;
  const t0 = Date.now();
  for (let s = 0; s < stmts.length; s++) {
    const { sql, line } = stmts[s];
    // `-- @print` on the nearest non-blank line before this statement.
    let k = line - 2;
    while (k >= 0 && lines[k].trim() === "") k--;
    const forcePrint = k >= 0 && /^\s*--\s*@print\b/.test(lines[k]);
    try {
      const results = await db.exec(sql, {
        onNotice: opts.quiet ? undefined : (n) => console.log(`  [${n.severity ?? "NOTICE"}] ${n.message}`),
      });
      for (const r of results) {
        if (r.fields && r.fields.length) {
          const label = `${basename(path)}:${line}`;
          if (opts.all || forcePrint) printRows(label, r, opts.wide);
          last = { label, r };
        }
      }
    } catch (e) {
      const head = sql.split("\n").slice(0, 6).join("\n");
      console.error(`\n✖ ${basename(path)}:${line}  ${e.code ?? ""} ${e.message}`);
      if (e.detail) console.error(`  detail: ${e.detail}`);
      if (e.hint) console.error(`  hint: ${e.hint}`);
      if (e.where) console.error(`  where: ${e.where}`);
      if (e.position) {
        const upto = sql.slice(0, Number(e.position) - 1);
        const relLine = upto.split("\n").length - 1;
        console.error(`  at line ${line + relLine}: ${sql.split("\n")[relLine]?.trim()}`);
      }
      console.error(`  statement:\n    ${head.replace(/\n/g, "\n    ")}${sql.split("\n").length > 6 ? "\n    ..." : ""}`);
      return { ok: false, last };
    }
  }
  if (!opts.quiet) console.log(`  ✓ ${basename(path)}: ${stmts.length} statements in ${Date.now() - t0} ms`);
  return { ok: true, last };
}

function migrationFiles() {
  const list = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).map((f) => join(MIGRATIONS, f));
  if (existsSync(EXTRAS)) {
    for (const f of readdirSync(EXTRAS).filter((f) => f.endsWith(".sql"))) list.push(join(EXTRAS, f));
  }
  return list.sort((a, b) => basename(a).localeCompare(basename(b)));
}

async function freshDb({ quiet, only } = {}) {
  const db = await PGlite.create({ extensions });
  const r = await execFile(db, join(HERE, "prelude.sql"), { quiet: true });
  if (!r.ok) throw new Error("prelude failed");
  for (const f of migrationFiles()) {
    if (only && !only(f)) continue;
    // apply_migration runs each file in one transaction; so do we.
    await db.exec("begin");
    const res = await execFile(db, f, { quiet });
    if (!res.ok) throw new Error(`migration failed: ${basename(f)}`);
    await db.exec("commit");
  }
  return db;
}

async function build() {
  // --skip=a,b leaves out migration files whose name contains any substring
  // (e.g. files that are not applied to production yet).
  const skipArg = argv.find((a) => a.startsWith("--skip="));
  const skip = skipArg ? skipArg.slice("--skip=".length).split(",").filter(Boolean) : [];
  const db = await freshDb({ quiet: false, only: (f) => !skip.some((x) => basename(f).includes(x)) });
  const seed = join(HERE, "seed.sql");
  if (existsSync(seed)) {
    const r = await execFile(db, seed, { quiet: false });
    if (!r.ok) throw new Error("seed failed");
  }
  const blob = await db.dumpDataDir("gzip");
  writeFileSync(BASE, Buffer.from(await blob.arrayBuffer()));
  console.log(`\nbase snapshot written: ${BASE}`);
  await db.close();
}

async function run() {
  if (!files.length) throw new Error("usage: node harness.mjs run file.sql [...]");
  let db;
  if (flags.has("--fresh") || !existsSync(BASE)) {
    if (!existsSync(BASE)) console.log("(no base.tgz — building from migrations; run `node harness.mjs build` to cache it)");
    db = await freshDb({ quiet: true });
  } else {
    db = await PGlite.create({ extensions, loadDataDir: new Blob([readFileSync(BASE)]) });
  }
  const opts = { all: flags.has("--all"), wide: flags.has("--wide"), quiet: flags.has("--quiet") };
  let ok = true;
  let last = null;
  for (const f of files) {
    const res = await execFile(db, resolve(f), opts);
    if (res.last) last = res.last;
    if (!res.ok) { ok = false; break; }
  }
  if (last && !opts.all) printRows(`last result — ${last.label}`, last.r, opts.wide);
  await db.close();
  return ok ? 0 : 1;
}

function bundle() {
  const [out, ...inputs] = files;
  if (!out || !inputs.length) throw new Error("usage: node harness.mjs bundle out.sql a.sql [...]");
  const text = inputs.map((f) => stripComments(readFileSync(resolve(f), "utf8"))).join("\n");
  writeFileSync(resolve(out), text + "\n");
  const md5 = createHash("md5").update(text + "\n").digest("hex");
  console.log(`${out}: ${Buffer.byteLength(text)} bytes, md5 ${md5}`);
  return 0;
}

const main = { build: async () => (await build(), 0), run, bundle: async () => bundle() }[cmd];
if (!main) {
  console.error("usage: node harness.mjs build | run file.sql [...] | bundle out.sql file.sql [...]");
  process.exit(2);
}
main().then(
  (code) => process.exit(code),
  (err) => { console.error(`[pglite] ${err?.stack ?? err}`); process.exit(2); },
);
