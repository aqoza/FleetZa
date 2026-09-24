#!/usr/bin/env node
// FleetManage SPA smoke harness: renders routes against a fully faked Supabase
// backend (Playwright request interception), screenshots them, and reports
// console/page errors, raw i18n keys, horizontal overflow, gates and redirects.
//
//   node smoke/run.mjs --routes "/,/vehicles" [--langs en,ar] [--themes light,dark]
//        [--viewport desktop|mobile|both] [--fixtures extra.json|extra.mjs]
//        [--role owner|admin|manager|viewer] [--out dir] [--port 5199] [--wait 1500]
//        [--concurrency 4] [--timeout 45000] [--modules all|available|id,id]
//        [--shot full|viewport] [--repo path] [--strict] [--no-fill] [--stop-server]
//
// See README.md next to this file.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { baseFixtures, mergeFixtures, TENANT_ID, USER_EMAIL, USER_ID } from "./lib/fixtures.mjs";
import { fakeUuid, handleTable } from "./lib/postgrest.mjs";
import { fillRows, loadSchema } from "./lib/schema.mjs";
import { pageProbe } from "./lib/probe.mjs";
import { ensureServer, readViteEnv, servedSupabaseUrl, stopServer } from "./lib/server.mjs";

const SMOKE_DIR = dirname(fileURLToPath(import.meta.url));
// --repo <path> (or $FLEETZA_REPO) points the harness at a worktree instead.
// Default: the repo this harness is checked into (docs/buildout/smoke → root).
let REPO_ROOT = process.env.FLEETZA_REPO ?? resolve(SMOKE_DIR, "../../..");

// ---------------------------------------------------------------- options

function parseArgs(argv) {
  const opts = {
    routes: null, langs: ["en"], themes: ["light"], viewport: "desktop", fixtures: null,
    role: "owner", out: null, port: 5199, wait: 1500, concurrency: 4, timeout: 45000,
    strict: false, fill: true, stopServer: false, modules: "all", shot: "full",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const [flag, inline] = a.includes("=") ? [a.slice(0, a.indexOf("=")), a.slice(a.indexOf("=") + 1)] : [a, undefined];
    const next = () => (inline !== undefined ? inline : argv[++i]);
    switch (flag) {
      case "--routes": opts.routes = next().split(",").map((s) => s.trim()).filter(Boolean); break;
      case "--langs": opts.langs = next().split(",").map((s) => s.trim()).filter(Boolean); break;
      case "--themes": opts.themes = next().split(",").map((s) => s.trim()).filter(Boolean); break;
      case "--viewport": opts.viewport = next(); break;
      case "--fixtures": opts.fixtures = next(); break;
      case "--role": opts.role = next(); break;
      case "--out": opts.out = next(); break;
      case "--port": opts.port = Number(next()); break;
      case "--wait": opts.wait = Number(next()); break;
      case "--concurrency": opts.concurrency = Math.max(1, Number(next())); break;
      case "--timeout": opts.timeout = Number(next()); break;
      case "--strict": opts.strict = true; break;
      case "--modules": opts.modules = next(); break;
      case "--repo": opts.repo = next(); break;
      case "--shot": opts.shot = next(); break;
      case "--no-fill": opts.fill = false; break;
      case "--stop-server": opts.stopServer = true; break;
      case "-h": case "--help": opts.help = true; break;
      default: throw new Error(`Unknown option ${a}`);
    }
  }
  return opts;
}

const VIEWPORTS = {
  desktop: { viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false },
  mobile: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
};

// ---------------------------------------------------------------- i18n facts

function loadI18nFacts() {
  const dir = join(REPO_ROOT, "src/i18n/messages");
  const keys = new Set();
  const strings = { en: {}, ar: {} };
  for (const lang of ["en", "ar"]) {
    const ldir = join(dir, lang);
    if (!existsSync(ldir)) continue;
    for (const f of readdirSync(ldir)) {
      if (!f.endsWith(".ts")) continue;
      const src = readFileSync(join(ldir, f), "utf8");
      for (const m of src.matchAll(/^\s*"([^"]+)":\s*"((?:[^"\\]|\\.)*)"/gm)) {
        if (lang === "en") keys.add(m[1]);
        strings[lang][m[1]] = m[2];
      }
    }
  }
  const namespaces = new Set([...keys].map((k) => k.split(".")[0]));
  const pick = (k) => [strings.en[k], strings.ar[k]].filter(Boolean);
  return {
    keys,
    namespaces,
    gateTitles: pick("modules.gate.title").length ? pick("modules.gate.title") : ["This module isn't enabled"],
    loadingTexts: [...pick("common.loadingWorkspace"), ...pick("common.preparingOrg")],
  };
}

// ---------------------------------------------------------------- fake auth

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

function fakeSession(profile) {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 10 * 365 * 24 * 3600;
  const user = {
    id: USER_ID,
    aud: "authenticated",
    role: "authenticated",
    email: profile?.email ?? USER_EMAIL,
    email_confirmed_at: "2026-03-02T09:15:00.000Z",
    phone: "",
    confirmed_at: "2026-03-02T09:15:00.000Z",
    last_sign_in_at: new Date().toISOString(),
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: { full_name: profile?.full_name ?? "Demo Owner" },
    identities: [],
    created_at: "2026-03-02T09:15:00.000Z",
    updated_at: new Date().toISOString(),
    is_anonymous: false,
  };
  const access_token = [
    b64url({ alg: "HS256", typ: "JWT" }),
    b64url({ sub: USER_ID, email: user.email, role: "authenticated", aud: "authenticated", iat: now, exp, session_id: "smoke-session" }),
    "c21va2Utc2lnbmF0dXJl",
  ].join(".");
  return {
    access_token,
    token_type: "bearer",
    expires_in: exp - now,
    expires_at: exp,
    refresh_token: "smoke-refresh-token",
    user,
  };
}

// ---------------------------------------------------------------- fixtures

async function loadExtraFixtures(path) {
  if (!path) return null;
  const abs = isAbsolute(path) ? path : resolve(process.cwd(), path);
  if (/\.(mjs|js)$/.test(abs)) {
    const mod = await import(pathToFileURL(abs).href);
    return mod.default ?? mod;
  }
  return JSON.parse(readFileSync(abs, "utf8"));
}

function clone(v) {
  return v === undefined ? v : JSON.parse(JSON.stringify(v));
}

// ---------------------------------------------------------------- mock backend

const ONE_PX_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

function corsHeaders(reqHeaders, fallbackOrigin) {
  const origin = reqHeaders["origin"] ?? fallbackOrigin;
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-credentials": "true",
    "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,HEAD,OPTIONS",
    "access-control-allow-headers": reqHeaders["access-control-request-headers"] ?? "*",
    "access-control-expose-headers": "content-range, content-location, preference-applied, x-total-count, range-unit",
    vary: "Origin",
  };
}

function lookupApi(apiFixtures, method, url) {
  const exact = `${method} ${url.pathname}`;
  const withQuery = `${method} ${url.pathname}${url.search}`;
  if (withQuery in apiFixtures) return { hit: true, value: apiFixtures[withQuery] };
  if (exact in apiFixtures) return { hit: true, value: apiFixtures[exact] };
  for (const [k, v] of Object.entries(apiFixtures)) {
    if (k.endsWith("*") && withQuery.startsWith(k.slice(0, -1))) return { hit: true, value: v };
  }
  return { hit: false, value: undefined };
}

/** { __status, __body, __headers } lets a fixture pick a non-200 response. */
function unwrapResponse(value, defaultStatus = 200) {
  if (value && typeof value === "object" && !Array.isArray(value) && ("__status" in value || "__body" in value)) {
    return { status: value.__status ?? defaultStatus, body: value.__body ?? null, headers: value.__headers ?? {} };
  }
  return { status: defaultStatus, body: value, headers: {} };
}

async function installMocks(context, env) {
  const { supaHost, baseUrl, fixtures, session, stats, fill, schema } = env;
  const tables = {};
  for (const [name, rows] of Object.entries(fixtures.tables)) tables[name] = fill(name, clone(rows));
  const dbCtx = { tables, schema, tenantId: TENANT_ID, fill };
  const baseOrigin = new URL(baseUrl).origin;

  const fulfill = async (route, { status = 200, body = null, headers = {}, contentType = "application/json", raw = null }) => {
    const req = route.request();
    const h = { ...corsHeaders(req.headers(), baseOrigin), ...headers };
    stats.mockedRequests.add(req);
    if (status >= 400) stats.mockedErrorUrls.add(req.url());
    const payload = raw ?? (body === null || body === undefined ? "" : JSON.stringify(body));
    await route.fulfill({ status, headers: h, contentType, body: payload });
  };

  await context.route((url) => url.hostname === supaHost, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    const headers = req.headers();
    const path = url.pathname;
    stats.supabaseRequests++;
    try {
      if (method === "OPTIONS") return await fulfill(route, { status: 204 });

      // ---- auth
      if (path.startsWith("/auth/v1/")) {
        const sub = path.slice("/auth/v1/".length);
        if (sub === "user") {
          if (method === "PUT") {
            let patch = {};
            try { patch = JSON.parse(req.postData() ?? "{}"); } catch { /* ignore */ }
            return await fulfill(route, { body: { ...session.user, ...patch, user_metadata: { ...session.user.user_metadata, ...(patch.data ?? {}) } } });
          }
          return await fulfill(route, { body: session.user });
        }
        if (sub.startsWith("token")) return await fulfill(route, { body: session });
        if (sub === "logout") return await fulfill(route, { status: 204 });
        return await fulfill(route, { body: {} });
      }

      // ---- PostgREST
      if (path.startsWith("/rest/v1/rpc/")) {
        const fn = decodeURIComponent(path.slice("/rest/v1/rpc/".length));
        let args = {};
        if (method === "POST") { try { args = JSON.parse(req.postData() ?? "{}") ?? {}; } catch { args = {}; } }
        else args = Object.fromEntries(url.searchParams);
        let value;
        if (fn in fixtures.rpc) {
          const f = fixtures.rpc[fn];
          value = typeof f === "function" ? await f(args, { method, url: url.toString(), tables }) : clone(f);
        } else {
          stats.rpcMissing.add(fn);
          value = [];
        }
        stats.rpcCalls[fn] = (stats.rpcCalls[fn] ?? 0) + 1;
        const r = unwrapResponse(value);
        if (r.status === 200 && (headers["accept"] ?? "").includes("vnd.pgrst.object") && Array.isArray(r.body)) {
          if (r.body.length === 1) r.body = r.body[0];
          else {
            stats.intentional406++;
            return await fulfill(route, { status: 406, body: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: `The result contains ${r.body.length} rows`, hint: null } });
          }
        }
        const n = Array.isArray(r.body) ? r.body.length : 1;
        const h = { "content-range": n ? `0-${n - 1}/${n}` : "*/0", ...r.headers };
        if (method === "HEAD") return await fulfill(route, { status: r.status, headers: h });
        return await fulfill(route, { status: r.status, body: r.body, headers: h });
      }
      if (path.startsWith("/rest/v1/")) {
        const table = decodeURIComponent(path.slice("/rest/v1/".length).replace(/\/$/, ""));
        const res = handleTable({ method, table, url, headers, postData: req.postData() }, dbCtx);
        const key = `${method} ${table}`;
        stats.tableCalls[key] = (stats.tableCalls[key] ?? 0) + 1;
        if ((method === "GET" || method === "HEAD") && !(tables[table]?.length)) stats.emptyTables.add(table);
        if (res.intentional) stats.intentional406++;
        return await fulfill(route, { status: res.status, body: res.body, headers: res.headers });
      }

      // ---- storage
      if (path.startsWith("/storage/v1/")) {
        const sub = path.slice("/storage/v1/".length);
        let m;
        if ((m = sub.match(/^object\/sign\/([^/]+)\/(.+)$/)) && method === "POST") {
          return await fulfill(route, { body: { signedURL: `/object/sign/${m[1]}/${m[2]}?token=smoke` } });
        }
        if ((m = sub.match(/^object\/sign\/([^/]+)\/?$/)) && method === "POST") {
          let paths = [];
          try { paths = JSON.parse(req.postData() ?? "{}").paths ?? []; } catch { /* ignore */ }
          return await fulfill(route, { body: paths.map((p) => ({ path: p, signedURL: `/object/sign/${m[1]}/${p}?token=smoke`, error: null })) });
        }
        if (sub.startsWith("object/list/")) return await fulfill(route, { body: [] });
        if (method === "GET" || method === "HEAD") return await fulfill(route, { contentType: "image/png", raw: ONE_PX_PNG });
        if (method === "DELETE") return await fulfill(route, { body: [] });
        if ((m = sub.match(/^object\/([^/]+)\/(.+)$/))) return await fulfill(route, { body: { Key: `${m[1]}/${m[2]}`, Id: fakeUuid() } });
        if (sub.startsWith("bucket")) return await fulfill(route, { body: [] });
        return await fulfill(route, { body: {} });
      }

      // ---- edge functions (fixtures.api "POST /functions/v1/<name>")
      if (path.startsWith("/functions/v1/")) {
        const { hit, value } = lookupApi(fixtures.api, method, url);
        if (!hit) stats.apiMissing.add(`${method} ${path}`);
        let v = hit ? value : {};
        if (typeof v === "function") {
          let body = null;
          try { body = JSON.parse(req.postData() ?? "null"); } catch { body = req.postData(); }
          v = await v({ method, url: url.toString(), body, tables });
        }
        return await fulfill(route, unwrapResponse(clone(v)));
      }

      stats.unknownSupabase.add(`${method} ${path}`);
      return await fulfill(route, { body: [] });
    } catch (err) {
      stats.mockErrors.push(`${method} ${req.url()}: ${err?.message ?? err}`);
      try { await fulfill(route, { status: 500, body: { message: `smoke mock error: ${err?.message}` } }); } catch { /* page gone */ }
    }
  });

  // Worker API on the dev-server origin.
  await context.route(
    (url) => url.origin === baseOrigin && (url.pathname === "/api" || url.pathname.startsWith("/api/")),
    async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const method = req.method();
      const { hit, value } = lookupApi(fixtures.api, method, url);
      if (!hit) stats.apiMissing.add(`${method} ${url.pathname}`);
      let v = hit ? value : {};
      if (typeof v === "function") {
        let body = null;
        try { body = JSON.parse(req.postData() ?? "null"); } catch { body = req.postData(); }
        v = await v({ method, url: url.toString(), body, tables });
      }
      const r = unwrapResponse(clone(v));
      stats.mockedRequests.add(req);
      if (r.status >= 400) stats.mockedErrorUrls.add(req.url());
      await route.fulfill({ status: r.status, headers: r.headers, contentType: "application/json", body: JSON.stringify(r.body ?? {}) });
    },
  );
}

// ---------------------------------------------------------------- noise rules

// Console errors that are artifacts of the harness, not the app:
//  - "Failed to load resource" for a response the mock returned with a
//    non-2xx on purpose (PGRST116 406 from .single(), fixture __status errors).
//  - favicon requests; React DevTools / Vite client chatter.
function classifyConsole(msg, stats) {
  const text = msg.text();
  const loc = msg.location()?.url ?? "";
  if (/Failed to load resource/.test(text) && (stats.mockedErrorUrls.has(loc) || [...stats.mockedErrorUrls].some((u) => u.split("?")[0] === loc.split("?")[0]))) {
    return "mocked non-2xx response";
  }
  if (/favicon\.ico/.test(text) || /favicon\.ico/.test(loc)) return "favicon";
  if (/Download the React DevTools|\[vite\] (connecting|connected)/.test(text)) return "devtools/vite chatter";
  return null;
}

// ---------------------------------------------------------------- one page

function slugOf(route) {
  const s = route.replace(/^\/+|\/+$/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s || "home";
}

async function runJob(browser, job, env) {
  const { route, lang, theme, viewport } = job;
  const started = Date.now();
  const profileRow = env.fixtures.tables.profiles?.find((p) => p.id === USER_ID);
  const fixtures = {
    ...env.fixtures,
    tables: {
      ...env.fixtures.tables,
      // The signed-in profile's saved language wins over localStorage in the
      // app, so pin it to the language under test (and the role to --role).
      profiles: (env.fixtures.tables.profiles ?? []).map((p) => (p.id === USER_ID ? { ...p, language: lang, role: env.role } : p)),
    },
  };
  const session = fakeSession(profileRow);
  const stats = {
    supabaseRequests: 0, tableCalls: {}, rpcCalls: {}, emptyTables: new Set(), rpcMissing: new Set(),
    apiMissing: new Set(), unknownSupabase: new Set(), mockErrors: [], mockedErrorUrls: new Set(), intentional406: 0,
    mockedRequests: new WeakSet(),
  };
  const vp = VIEWPORTS[viewport];
  const context = await browser.newContext({
    ...vp,
    deviceScaleFactor: 1,
    locale: lang === "ar" ? "ar" : "en-US",
    colorScheme: theme,
    timezoneId: "UTC",
    reducedMotion: "reduce",
    serviceWorkers: "block",
  });
  await context.addInitScript(({ key, session, lang, theme }) => {
    try {
      localStorage.setItem(key, JSON.stringify(session));
      localStorage.setItem("fm.lang", lang);
      localStorage.setItem("fm.theme", theme);
    } catch { /* opaque origin (about:blank) */ }
  }, { key: env.storageKey, session, lang, theme });
  await installMocks(context, { ...env, fixtures, session, stats });

  const page = await context.newPage();
  const consoleErrors = [];
  const consoleWarnings = [];
  const noise = [];
  const pageErrors = [];
  const failedRequests = [];
  const badResponses = [];
  page.on("console", (msg) => {
    const type = msg.type();
    if (type !== "error" && type !== "warning") return;
    const why = classifyConsole(msg, stats);
    const entry = { text: msg.text().slice(0, 800), url: msg.location()?.url ?? null };
    if (why) noise.push({ ...entry, why });
    else if (type === "error") consoleErrors.push(entry);
    else consoleWarnings.push(entry);
  });
  page.on("pageerror", (err) => pageErrors.push({ message: String(err?.message ?? err).slice(0, 800), stack: String(err?.stack ?? "").split("\n").slice(0, 6).join("\n") }));
  page.on("requestfailed", (req) => {
    const u = req.url();
    if (/favicon\.ico/.test(u)) return;
    // Chromium reports every intercepted+fulfilled HEAD as net::ERR_ABORTED even
    // though fetch() resolved with the mocked status/headers (count queries).
    if (req.method() === "HEAD" && stats.mockedRequests.has(req)) return;
    failedRequests.push({ url: u, method: req.method(), failure: req.failure()?.errorText ?? "failed" });
  });
  page.on("response", (res) => {
    const u = res.url();
    if (res.status() >= 400 && !stats.mockedErrorUrls.has(u) && !/favicon\.ico/.test(u)) {
      badResponses.push({ url: u, status: res.status() });
    }
  });

  const target = env.baseUrl + (route.startsWith("/") ? route : `/${route}`);
  let navError = null;
  try {
    await page.goto(target, { waitUntil: "load", timeout: env.timeout });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    // Give the auth → membership → modules chain time to leave the loading screen.
    await page
      .waitForFunction((texts) => {
        const root = document.getElementById("root");
        if (!root || !root.innerText.trim()) return false;
        return !texts.some((t) => document.body.innerText.includes(t));
      }, env.i18n.loadingTexts, { timeout: 15000, polling: 200 })
      .catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(env.wait);
  } catch (e) {
    navError = String(e?.message ?? e).split("\n")[0];
  }

  let probe = null;
  try {
    probe = await page.evaluate(pageProbe, { gateTitles: env.i18n.gateTitles, loadingTexts: env.i18n.loadingTexts });
  } catch (e) {
    navError = navError ?? `probe failed: ${e?.message ?? e}`;
  }
  const rawKeys = (probe?.candidates ?? []).filter((c) => env.i18n.keys.has(c) || env.i18n.namespaces.has(c.split(".")[0]));

  const file = `${slugOf(route)}-${lang}-${theme}-${viewport}.png`;
  const shotPath = join(env.outDir, file);
  try {
    if (env.shot === "full") {
      // The shell is a fixed-height flex layout whose <main> scrolls, so a plain
      // fullPage shot would stop at the fold. Grow the viewport by the largest
      // inner scroll overflow so the whole page content is laid out and captured.
      const extra = await page.evaluate(() => {
        // Content scrollers only: the sidebar nav (inside <aside>/<nav>) also
        // scrolls, but growing the page for it would just pad the screenshot.
        let max = 0;
        for (const el of document.querySelectorAll("main, [class*='overflow-y-auto'], [class*='overflow-auto']")) {
          if (el.closest("aside, nav")) continue;
          const oy = getComputedStyle(el).overflowY;
          if (oy !== "auto" && oy !== "scroll") continue;
          const d = el.scrollHeight - el.clientHeight;
          if (d > max && el.clientHeight > 200) max = d;
        }
        return max;
      }).catch(() => 0);
      if (extra > 0) {
        const vpSize = page.viewportSize();
        await page.setViewportSize({ width: vpSize.width, height: Math.min(vpSize.height + extra, 12000) });
        await page.waitForTimeout(400);
      }
    }
    await page.screenshot({ path: shotPath, fullPage: env.shot === "full", animations: "disabled", timeout: 30000 });
  } catch (e) {
    navError = navError ?? `screenshot failed: ${e?.message ?? e}`;
  }
  await context.close();

  const requested = new URL(target).pathname.replace(/\/+$/, "") || "/";
  const finalPath = probe ? (new URL(probe.url).pathname.replace(/\/+$/, "") || "/") : null;
  const redirected = finalPath !== null && finalPath !== requested;
  const redirectedHome = redirected && finalPath === "/";
  const redirectedLogin = redirected && finalPath === "/login";

  const failures = [];
  if (navError) failures.push(`nav: ${navError}`);
  if (pageErrors.length) failures.push(`${pageErrors.length} pageerror`);
  if (consoleErrors.length) failures.push(`${consoleErrors.length} console error`);
  if (rawKeys.length) failures.push(`${rawKeys.length} raw i18n key`);
  if (probe?.overflow.overflow) failures.push(`overflow ${probe.overflow.scrollWidth}>${probe.overflow.innerWidth}`);
  const warnings = [];
  if (probe?.gated) warnings.push("module gate shown");
  if (redirectedLogin) warnings.push("redirected to /login (fake session rejected?)");
  else if (redirectedHome) warnings.push(`redirected to / (route unknown?)`);
  else if (redirected) warnings.push(`redirected to ${finalPath}`);
  if (probe && probe.overflow.docHeight > probe.overflow.innerHeight + 1) {
    // The shell is viewport-height with a scrolling <main>; a taller document
    // means something (e.g. an unscrollable sidebar) sticks out below the fold.
    warnings.push(`vertical overflow ${probe.overflow.docHeight}>${probe.overflow.innerHeight}`);
  }
  if (probe?.rootEmpty) warnings.push("blank #root");
  if (probe?.stuckLoading) warnings.push("still on loading screen");
  if (probe?.errorBoundary) warnings.push(`error text: ${probe.errorBoundary}`);
  if (failedRequests.length) warnings.push(`${failedRequests.length} failed request`);
  if (badResponses.length) warnings.push(`${badResponses.length} HTTP>=400 (unmocked)`);
  if (stats.mockErrors.length) warnings.push(`${stats.mockErrors.length} mock handler error`);
  // --strict: gates, redirects, blank/loading screens, failed requests etc. fail too.
  if (env.strict) failures.push(...warnings);

  return {
    route, lang, theme, viewport,
    screenshot: shotPath,
    ok: failures.length === 0,
    failures,
    warnings,
    finalUrl: probe?.url ?? null,
    finalPath,
    redirected,
    gated: probe?.gated ?? null,
    blank: probe?.rootEmpty ?? null,
    stuckLoading: probe?.stuckLoading ?? null,
    errorBoundary: probe?.errorBoundary ?? null,
    dir: probe?.dir ?? null,
    htmlLang: probe?.lang ?? null,
    htmlTheme: probe?.theme ?? null,
    textLength: probe?.textLength ?? 0,
    overflow: probe?.overflow ?? null,
    rawKeys,
    pageErrors,
    consoleErrors,
    consoleWarnings: consoleWarnings.slice(0, 20),
    failedRequests,
    badResponses,
    noise,
    backend: {
      supabaseRequests: stats.supabaseRequests,
      tableCalls: stats.tableCalls,
      rpcCalls: stats.rpcCalls,
      emptyTables: [...stats.emptyTables].sort(),
      rpcWithoutFixture: [...stats.rpcMissing].sort(),
      apiWithoutFixture: [...stats.apiMissing].sort(),
      unknownSupabasePaths: [...stats.unknownSupabase].sort(),
      intentional406: stats.intentional406,
      mockErrors: stats.mockErrors,
    },
    durationMs: Date.now() - started,
  };
}

// ---------------------------------------------------------------- output

function printTable(results) {
  const rows = results.map((r) => [
    r.ok ? "OK" : "FAIL",
    r.route,
    r.lang,
    r.theme,
    r.viewport,
    String(r.pageErrors.length),
    String(r.consoleErrors.length),
    String(r.rawKeys.length),
    r.overflow?.overflow ? `${r.overflow.scrollWidth}px` : "-",
    [...r.failures.filter((f) => f.startsWith("nav")), ...r.warnings].join("; ") || "",
  ]);
  const head = ["", "route", "lang", "theme", "vp", "pgErr", "conErr", "keys", "overflow", "notes"];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const fmt = (r) => r.map((c, i) => (i === 9 ? c : c.padEnd(widths[i]))).join("  ");
  console.log(fmt(head));
  console.log(widths.map((w, i) => "-".repeat(i === 9 ? 5 : w)).join("  "));
  for (const r of rows) console.log(fmt(r));
}

function detailLines(results) {
  const out = [];
  for (const r of results.filter((x) => !x.ok)) {
    out.push(`\n[${r.route} ${r.lang}/${r.theme}/${r.viewport}] ${r.failures.join(", ")}`);
    for (const e of r.pageErrors.slice(0, 3)) out.push(`  pageerror: ${e.message}`);
    for (const e of r.consoleErrors.slice(0, 3)) out.push(`  console:   ${e.text.split("\n")[0].slice(0, 200)}`);
    if (r.rawKeys.length) out.push(`  rawKeys:   ${r.rawKeys.slice(0, 8).join(", ")}`);
    for (const o of (r.overflow?.offenders ?? []).slice(0, 3)) out.push(`  overflow:  ${o.el} [${o.left}..${o.right}] "${o.text}"`);
  }
  return out.join("\n");
}

// ---------------------------------------------------------------- main

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(readFileSync(join(SMOKE_DIR, "README.md"), "utf8"));
    return 0;
  }
  if (opts.stopServer) {
    console.log(stopServer(SMOKE_DIR, opts.port) ? `stopped the Vite server on :${opts.port}` : "no recorded server / process not running");
    return 0;
  }
  if (opts.repo) REPO_ROOT = resolve(opts.repo);
  if (!existsSync(join(REPO_ROOT, "src/lib/database.types.ts"))) throw new Error(`--repo ${REPO_ROOT} does not look like the FleetManage repo`);
  if (!opts.routes?.length) throw new Error('--routes is required, e.g. --routes "/,/vehicles"');
  const viewports = opts.viewport === "both" ? ["desktop", "mobile"] : [opts.viewport];
  for (const v of viewports) if (!VIEWPORTS[v]) throw new Error(`--viewport must be desktop|mobile|both (got ${opts.viewport})`);
  for (const l of opts.langs) if (!["en", "ar"].includes(l)) throw new Error(`unsupported lang ${l}`);
  for (const t of opts.themes) if (!["light", "dark"].includes(t)) throw new Error(`unsupported theme ${t}`);
  if (!["owner", "admin", "manager", "viewer"].includes(opts.role)) throw new Error(`bad --role ${opts.role}`);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = resolve(opts.out ?? join(SMOKE_DIR, "out", `${stamp}-${process.pid}`));
  mkdirSync(outDir, { recursive: true });

  const viteEnv = readViteEnv(REPO_ROOT);
  const supaUrl = viteEnv.VITE_SUPABASE_URL;
  if (!supaUrl) throw new Error(`VITE_SUPABASE_URL missing from ${REPO_ROOT}/.env.production`);
  const supaHost = new URL(supaUrl).hostname;
  const storageKey = `sb-${supaHost.split(".")[0]}-auth-token`;

  const log = (m) => console.error(`[smoke] ${m}`);
  const server = await ensureServer({ port: opts.port, repoRoot: REPO_ROOT, smokeDir: SMOKE_DIR, log });
  log(`${server.started ? "started" : "reusing"} Vite at ${server.baseUrl}${server.pid ? ` (pid ${server.pid})` : ""}`);
  const served = await servedSupabaseUrl(server.baseUrl);
  if (served && served !== "present" && served !== supaUrl) {
    throw new Error(`The Vite server on :${opts.port} was started with VITE_SUPABASE_URL=${served}, expected ${supaUrl}. Stop it (node smoke/run.mjs --stop-server) or use another --port.`);
  }
  if (!served) log(`warning: could not confirm VITE_SUPABASE_URL in the served app; if pages hang on loading, restart the server with --stop-server`);

  const schema = loadSchema(REPO_ROOT);
  const now = new Date().toISOString();
  const fill = (table, rows) => (opts.fill ? fillRows(schema, table, rows, { tenantId: TENANT_ID, now, uuid: fakeUuid }) : rows);
  const extra = await loadExtraFixtures(opts.fixtures);
  if (!["full", "viewport"].includes(opts.shot)) throw new Error(`--shot must be full|viewport`);
  const fixtures = mergeFixtures(baseFixtures({ repoRoot: REPO_ROOT, role: opts.role, modules: opts.modules }), extra);
  const i18n = loadI18nFacts();

  const browser = await chromium.launch({ headless: true, ...(resolveExecutable() ?? {}) });
  const env = { baseUrl: server.baseUrl, supaHost, storageKey, fixtures, role: opts.role, schema, fill, i18n, outDir, wait: opts.wait, timeout: opts.timeout, strict: opts.strict, shot: opts.shot };

  const jobs = [];
  for (const route of opts.routes) for (const lang of opts.langs) for (const theme of opts.themes) for (const viewport of viewports) jobs.push({ route, lang, theme, viewport });
  log(`${jobs.length} page(s) → ${outDir}`);

  const results = new Array(jobs.length);
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const i = next++;
      let r = await runJob(browser, jobs[i], env);
      // A cold Vite can re-optimize deps mid-load ("Outdated Optimize Dep" /
      // "Failed to fetch dynamically imported module"): retry that page once.
      const flaky = [...r.pageErrors.map((e) => e.message), ...r.consoleErrors.map((e) => e.text), ...r.badResponses.map((b) => String(b.status))]
        .some((t) => /Outdated Optimize Dep|Failed to fetch dynamically imported module|^504$/.test(t));
      if (flaky) { log(`retrying ${jobs[i].route} (${jobs[i].lang}/${jobs[i].theme}/${jobs[i].viewport}) after Vite re-optimization`); r = await runJob(browser, jobs[i], env); r.retried = true; }
      results[i] = r;
      log(`${r.ok ? "ok  " : "FAIL"} ${r.route} ${r.lang}/${r.theme}/${r.viewport} (${r.durationMs}ms)`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency, jobs.length) }, worker));
  await browser.close();

  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl: server.baseUrl,
    options: { ...opts, fixtures: opts.fixtures ? resolve(opts.fixtures) : null },
    summary: {
      pages: results.length,
      ok: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      withWarnings: results.filter((r) => r.warnings.length).length,
    },
    results,
  };
  const reportPath = join(outDir, "report.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 2));

  printTable(results);
  const details = detailLines(results);
  if (details) console.log(details);
  console.log(`\n${report.summary.ok}/${report.summary.pages} ok · report: ${reportPath}`);
  return report.summary.failed ? 1 : 0;
}

function resolveExecutable() {
  // playwright-core is pinned to the Chromium build in /opt/pw-browsers; if a
  // different build is ever needed, fall back to whatever chrome is there.
  try {
    chromium.executablePath();
    if (existsSync(chromium.executablePath())) return null;
  } catch { /* fall through */ }
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? "/opt/pw-browsers";
  if (!existsSync(root)) return null;
  for (const d of readdirSync(root).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()) {
    const p = join(root, d, "chrome-linux", "chrome");
    if (existsSync(p)) return { executablePath: p };
  }
  return null;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`[smoke] ${err?.stack ?? err}`);
    process.exit(2);
  },
);
