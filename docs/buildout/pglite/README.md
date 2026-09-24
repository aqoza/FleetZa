# Local PGlite replica — fast, production-free migration dry-runs

`harness.mjs` boots [PGlite](https://pglite.dev) (Postgres 18 compiled to WASM, in-process;
production is Postgres 17 — avoid 18-only features) with Supabase-shaped scaffolding
(`prelude.sql`: roles `anon`/`authenticated`/`service_role` (bypassrls), `auth.uid()`/`auth.jwt()`
reading `request.jwt.claims`, `auth.users`, `storage.buckets/objects`, `extensions.pgcrypto`),
replays **every** file in `supabase/migrations/` plus `extras/` in filename order (each in its
own transaction, like `apply_migration`), then `seed.sql`, and caches the result in `base.tgz`.

```bash
cd docs/buildout/pglite && npm install          # once
node harness.mjs build                           # after any migration in supabase/migrations changes (~10 s)
node harness.mjs run my_dryrun.sql               # load base.tgz, run statement by statement
node harness.mjs run --all a.sql b.sql           # print every row-returning statement
node harness.mjs bundle out.sql mig.sql tests.sql # comment-stripped concat + md5, for the final execute_sql
```

- Files run **statement by statement**, so an error names the file, line and statement.
  `-- @print` on the line before a statement prints its rows; otherwise only the last
  row-returning statement is printed. `RAISE NOTICE`/`WARNING` lines are shown.
- A cluster dry-run is `begin; <migration file>; <tests>; rollback;` — pass the files in order:
  `node harness.mjs run tests/begin.sql ../../../supabase/migrations/2026092400000N_x.sql tests/x_tests.sql`
  (or put `begin;`/`rollback;` in the test file and apply the migration inside it).
- Each `run` starts from the cached snapshot, so nothing persists between runs.
- **Seed** (`seed.sql`): the demo tenant `170d2d86-…` with owner `129bbbae-…` and manager
  `950e38aa-…` (the production ids, so FOUNDATION.md §0.5 impersonation works unchanged), plus a
  local-only viewer `5eed0000-0000-4000-8000-00000000a003` and a second tenant "Other Co"
  `5eed0000-0000-4000-8000-0000000000b1` (OMR, 3 decimals) with owner `5eed0000-0000-4000-8000-00000000b001`
  for cross-tenant tests. Vehicles `…e001–e005`, drivers `…d001–d003`, customers `…c001/c002`,
  products `…a101/a102`, issues, reminders, renewals, fuel logs. Module rows mirror production
  (drivers **disabled**); enable modules inside your transaction.
- `extras/` holds production migrations that are not on `main` yet
  (`20260901000003_certificate_quotes.sql`, from commit 1401d88).

Fidelity limits: no supautils (policy creation takes no auth locks here), single session (no
concurrency/deadlock testing), no `pg_net`/`pg_cron`/vault. **The final dry-run of every
migration still runs on production** (`execute_sql`, `begin … rollback`, FOUNDATION.md §0.4).
