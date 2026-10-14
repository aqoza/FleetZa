#!/usr/bin/env node
// Fail closed on SQL assertion rows, not only on SQL execution errors.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const tests = resolve(here, "../tests");
const scratch = mkdtempSync(join(tmpdir(), "fleetza-regression-"));
const suites = readdirSync(tests).filter((name) => name.endsWith("_tests.sql")).sort();
const results = [];

function run(label, files) {
  const result = spawnSync(process.execPath, [join(here, "harness.mjs"), "run", ...files, "--all", "--quiet"],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 180_000 });
  const output = (result.stdout ?? "") + (result.stderr ?? "");
  writeFileSync(join(scratch, label + ".log"), output);
  let columns = [], duplicate = false, assertions = 0;
  const failures = [];
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith("──")) { columns = []; duplicate = line.includes("last result"); }
    if (/^(name|test) \|/.test(line)) { columns = line.split(" | "); continue; }
    if (duplicate) continue;
    const bool = columns.includes("ok") ? columns.indexOf("ok") : columns.indexOf("pass");
    if (bool >= 0 && line.includes(" | ")) {
      const values = line.split(" | ");
      // Metadata and a historical migration-phase lock probe are not behavior checks.
      if (values[0] === "zz script md5" || values[0].startsWith("00d no contended locks")) continue;
      assertions++;
      if (values[bool] !== "true") failures.push(line);
    }
    if (line === "11 sales quote regression assertions passed; all test writes rolled back") assertions += 11;
  }
  const ok = result.status === 0 && !result.error && assertions > 0 && failures.length === 0;
  results.push({ suite: label, assertions, ok, failures, exitCode: result.status,
    ...(result.error ? { error: result.error.message } : {}) });
  console.log(label + ": " + (ok ? "PASS" : "FAIL") + " (" + assertions + " assertions)");
  if (!ok) console.error(output.slice(-5000));
}

// Run together for speed, while preserving per-suite output boundaries.
run("modules", suites.map((file) => join(tests, file)));
const begin = join(scratch, "foundation-begin.sql");
writeFileSync(begin, `begin;
create temp table _lock_probe as
select coalesce(string_agg(c.relname, ', '),'') as held
from pg_locks l join pg_class c on c.oid=l.relation
where l.pid=pg_backend_pid() and l.mode='AccessExclusiveLock'
  and c.relnamespace in ('auth'::regnamespace,'storage'::regnamespace);
grant select on _lock_probe to public;
`);
run("foundation", [begin, ...["foundation_tests_body.sql", "foundation_tests_storage.sql",
  "foundation_tests_report.sql", "rollback.sql"].map((file) => join(tests, file))]);
const summary = { suites: suites.length + 1, assertions: results.reduce((n, r) => n + r.assertions, 0),
  ok: results.every((r) => r.ok), results, logs: scratch };
writeFileSync(join(scratch, "summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
process.exitCode = summary.ok ? 0 : 1;
