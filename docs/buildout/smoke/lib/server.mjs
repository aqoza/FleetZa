// Vite dev-server lifecycle: reuse if something already serves the SPA on the
// port, otherwise start ONE detached server (lock-file guarded so concurrent
// harness runs don't race) and leave it running for later runs.
import { spawn } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Parse VITE_* lines from the repo's .env.production (public values). */
export function readViteEnv(repoRoot) {
  const env = {};
  const file = join(repoRoot, ".env.production");
  if (!existsSync(file)) return env;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*(VITE_[A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

async function fetchText(url, timeoutMs = 2500) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    return { ok: res.ok, status: res.status, text: await res.text() };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Returns the base URL of a Vite server serving this SPA on `port`, or null. */
export async function probe(port) {
  for (const host of ["127.0.0.1", "localhost"]) {
    const base = `http://${host}:${port}`;
    const r = await fetchText(`${base}/`);
    if (r && r.ok && (r.text.includes("/@vite/client") || r.text.includes("/src/main.tsx"))) return base;
  }
  return null;
}

function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

/**
 * Ensure a dev server is up. Returns { baseUrl, started: boolean, pid? }.
 * Lock protocol: O_EXCL create of `vite-<port>.lock` holding {pid, ts}; a
 * lock whose owner died, or older than 3 minutes, is considered stale.
 */
function infoPath(smokeDir, port) {
  return join(smokeDir, `vite-${port}.json`);
}

function checkSameRepo(smokeDir, port, repoRoot) {
  try {
    const info = JSON.parse(readFileSync(infoPath(smokeDir, port), "utf8"));
    if (info.repoRoot && info.repoRoot !== repoRoot && pidAlive(info.pid)) {
      throw new Error(
        `The Vite server on :${port} serves ${info.repoRoot}, not ${repoRoot}. ` +
          `Use another --port for this checkout (or --stop-server --port ${port}).`,
      );
    }
  } catch (e) {
    if (e.code !== "ENOENT" && !(e instanceof SyntaxError)) throw e;
  }
}

export async function ensureServer({ port, repoRoot, smokeDir, log = () => {} }) {
  const existing = await probe(port);
  if (existing) {
    checkSameRepo(smokeDir, port, repoRoot);
    return { baseUrl: existing, started: false };
  }

  const lockPath = join(smokeDir, `vite-${port}.lock`);
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    let fd = null;
    try {
      fd = openSync(lockPath, "wx");
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
    if (fd !== null) {
      try {
        writeFileSync(fd, JSON.stringify({ pid: process.pid, ts: Date.now() }));
        closeSync(fd);
        // Re-check under the lock: another runner may have finished starting it.
        const again = await probe(port);
        if (again) { checkSameRepo(smokeDir, port, repoRoot); return { baseUrl: again, started: false }; }
        return await startServer({ port, repoRoot, smokeDir, log });
      } finally {
        try { unlinkSync(lockPath); } catch { /* already gone */ }
      }
    }
    // Someone else holds the lock: wait for their server, or break a stale lock.
    try {
      const info = JSON.parse(readFileSync(lockPath, "utf8") || "{}");
      const age = Date.now() - (info.ts ?? statSync(lockPath).mtimeMs);
      if ((info.pid && !pidAlive(info.pid)) || age > 180_000) {
        log(`breaking stale lock ${lockPath}`);
        try { unlinkSync(lockPath); } catch { /* raced */ }
        continue;
      }
    } catch { /* lock vanished or half-written; loop */ }
    await sleep(500);
    const up = await probe(port);
    if (up) { checkSameRepo(smokeDir, port, repoRoot); return { baseUrl: up, started: false }; }
  }
  throw new Error(`Timed out waiting for the Vite dev server on port ${port}`);
}

async function startServer({ port, repoRoot, smokeDir, log }) {
  const env = { ...process.env, ...readViteEnv(repoRoot), BROWSER: "none", FORCE_COLOR: "0" };
  if (!env.VITE_SUPABASE_URL) throw new Error("VITE_SUPABASE_URL not found in .env.production");
  const logPath = join(smokeDir, "vite.log");
  const out = openSync(logPath, "a");
  const localVite = join(repoRoot, "node_modules/vite/bin/vite.js");
  const [cmd, args] = existsSync(localVite)
    ? [process.execPath, [localVite, "--port", String(port), "--strictPort", "--host", "127.0.0.1"]]
    : ["npx", ["vite", "--port", String(port), "--strictPort", "--host", "127.0.0.1"]];
  log(`starting Vite: ${[cmd, ...args].join(" ")} (log: ${logPath})`);
  const child = spawn(cmd, args, { cwd: repoRoot, env, detached: true, stdio: ["ignore", out, out] });
  child.unref();
  closeSync(out);
  writeFileSync(join(smokeDir, "vite.pid"), String(child.pid));
  writeFileSync(infoPath(smokeDir, port), JSON.stringify({ pid: child.pid, port, repoRoot, startedAt: new Date().toISOString() }));
  let exited = null;
  child.on("exit", (code) => { exited = code; });
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (exited !== null) {
      const tail = readFileSync(logPath, "utf8").split("\n").slice(-20).join("\n");
      throw new Error(`Vite exited (code ${exited}) before serving. Log tail:\n${tail}`);
    }
    const up = await probe(port);
    if (up) return { baseUrl: up, started: true, pid: child.pid };
    await sleep(400);
  }
  throw new Error(`Vite did not start serving on port ${port} within 90s (see ${logPath})`);
}

/** Stop the server this harness started on `port` (used by --stop-server). */
export function stopServer(smokeDir, port) {
  let pid = null;
  const info = infoPath(smokeDir, port);
  const pidFile = join(smokeDir, "vite.pid");
  if (existsSync(info)) {
    try { pid = JSON.parse(readFileSync(info, "utf8")).pid; } catch { /* ignore */ }
  } else if (existsSync(pidFile)) {
    pid = Number(readFileSync(pidFile, "utf8"));
  }
  if (!pid) return false;
  let ok = false;
  for (const target of [-pid, pid]) {
    try { process.kill(target, "SIGTERM"); ok = true; break; } catch { /* try next */ }
  }
  try { unlinkSync(info); } catch { /* ignore */ }
  try { if (Number(readFileSync(pidFile, "utf8")) === pid) unlinkSync(pidFile); } catch { /* ignore */ }
  return ok;
}

/**
 * Confirm the served app was built with the Supabase URL we intercept
 * (a reused server started without the env would talk to localhost:54321).
 */
export async function servedSupabaseUrl(baseUrl) {
  const r = await fetchText(`${baseUrl}/src/lib/supabase.ts`, 30_000);
  if (!r || !r.ok) return null;
  const m = r.text.match(/"VITE_SUPABASE_URL":\s*"([^"]+)"/);
  return m ? m[1] : r.text.includes("supabase.co") ? "present" : null;
}
