# Final production audit — 2026-10-14

Release audited: `857ce22` (PR #59), followed by the activity-label fix in this PR.
Production: https://fleetmaster.uk · Supabase `ugfdexoaxladblafcrlc`.

Engineering assessment: 84/100, launchable with the coverage limits below.
No production blocker was found in the exercised paths. This is not a claim that
every possible UI operation, external provider, device, or load scenario was tested.

## Fixes

- Recent activity displayed `dashboard.entity.invoices` on the live site because
  the context panel constructed translation keys for tables without dictionary
  entries. Both activity surfaces now share compile-checked English/Arabic labels
  and use a translated “Record” fallback for unfamiliar tables.
  Regression: `AUDIT-UI-001` in `src/lib/auditLabels.test.ts`.
- The SQL harness previously returned exit 0 when a SELECT assertion returned
  false. Added `pglite/verify.mjs` to reject false/null assertions and SQL errors,
  and to retain logs plus a JSON summary. An injected false assertion correctly
  caused exit 1; the negative-control fixture was removed.
- Updated the historical foundation suite for the integrated schema: installed
  scanner signatures, both valid FK/restrict SQLSTATEs with parent/child retention,
  and deterministic cancellation in PGlite. A separate real-PostgreSQL timeout
  probe verifies the actual timer rather than claiming the emulator covers it.

## Production evidence

| Check | Result |
|---|---|
| Public tables without RLS | 0 |
| Invalid/not-ready indexes | 0 |
| Unvalidated public constraints | 0 |
| Application function comparison | 316 compared; 306 hash-identical, 10 differ only in comments/formatting after review |
| Policies / application triggers | All 398 policies and 440 triggers match the tested local schema |
| Extra platform function | Supabase-managed `rls_auto_enable()`, intentionally outside application migrations |
| Authenticated table access / tenant checks | 122 tables passed with demo owner and all modules enabled inside rollback |
| Report/summary RPCs | 20 passed |
| Role, tenant, and privileged-RPC assertions | 386 passed |
| HR, payroll, purchasing, receipt, vendor portal, finance, security workflows | 37 passed |
| Quote → order → invoice, uniqueness and FK behavior | 11 passed |
| Real notification timer cancellation / claim / later-scanner suppression | 3 passed |
| Live database assertions total | 579 passed |
| HTTP health, invalid capability links and unauthenticated API boundaries | 12 expected responses |
| Demo password sign-in and authenticated REST reads | Sign-in plus vehicles/customers/modules/profile reads passed; test session signed out |

Production write checks were restricted to the established demo tenant and
rolled back. Module flags match the pre-audit values, no temporary scanner
functions remain, and no quote-regression customer remains. Business data in the
customer tenant was not edited. Real-time certificate verification endpoints and
certificate mutation workflows were excluded per FOUNDATION.md.

Available 24-hour logs showed no HTTP 5xx responses. Observed 401/422 responses
matched authorization and leaked-password probes. Database errors came from
those denied-access checks and earlier management-API test/query mistakes.

Security advisors remain the documented 59 guarded SECURITY DEFINER notices and
one intentionally policy-free, inaccessible webhook-secret table. Performance
advisors contain only unused-index INFO notices (201 at this check); diagnostic
reads exercise indexes, so the changing unused count is not evidence of customer
adoption or a performance gain. No indexes were removed during this audit.

## Local regression and browser coverage

- All 46 registered modules are mapped in [REGRESSION.md](../REGRESSION.md), including
  registry-derived downstream dependencies and acceptance commands.
- 1,603 SQL assertions passed across 35 suites: 1,508 module/read assertions and
  95 foundation/storage assertions. The historical migration-lock marker and
  script fingerprint were excluded from behavioral totals.
- 529 unit tests passed in 42 files. TypeScript and production build passed.
- Browser matrix: 49 routes × English/Arabic × light/dark × desktop/mobile =
  392 cases; no page errors, console errors, raw translation keys or horizontal
  overflow failures. These browser cases use the repository's mocked backend.
- Rechecked all seven routes with warnings (56 cases) at lower concurrency:
  all passed; blank captures and cancelled application requests did not recur.
  Remaining warnings were eight GPS cases cancelling superseded map-tile requests
  (imagery rendered) and four naturally scrollable mobile settings pages. These
  are recorded rather than silently counted as warning-free.
- Representative HR Arabic/mobile/dark and finance desktop/light screenshots
  were inspected visually. GPS imagery and geofence rendered correctly.

The Vite build still advises about chunks over 500 kB. This audit found no
associated functional failure; bundle/load optimization remains separate from
the database advisor work.

## Reproduce

Local: `node docs/buildout/pglite/harness.mjs build`, then
`node docs/buildout/pglite/verify.mjs`, `npm test`, and `npm run build`.

Live SQL scripts (run through the Supabase connector, never substitute a customer
tenant): `production_module_reads_tests.sql`, `security_role_guards_tests.sql`,
`production_rollout_workflows.sql`, `sales_quote_reference_tests.sql`, and
`production_notification_timeout.sql`, all in `docs/buildout/tests/`.

Browser harness instructions: [smoke README](smoke/README.md).
The initial browser artifacts are in the local temporary directory
`fleetza-final-smoke`; the focused rerun is in `fleetza-final-smoke-recheck`.
SQL verification logs: `fleetza-regression-3osmMk` in the same temporary directory.

## Coverage limits and recovery

The production database paths, auth, API boundaries and selected live UI were
tested; every module's UI write flow was not exercised against production.
External email/webhook delivery, physical GPS/IoT devices, invitation delivery,
file-transfer round trips, concurrency/load, and real-money settlement were not
triggered. Local storage policy assertions do not prove a live upload/download.

No schema migration was required. Revert the activity-label commit through a
new PR if its presentation regresses. Test and documentation changes have no
production runtime effect. Restore no production test data: all such writes were
rolled back.

References:
- [Supabase security-definer advisor](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)
- [Supabase unused-index advisor](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index)
