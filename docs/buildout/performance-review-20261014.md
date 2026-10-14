# Production performance review — 2026-10-14

Project: `ugfdexoaxladblafcrlc` (production).

## Changes applied

Added eight indexes through migration
`20261014000003_foreign_key_performance_indexes.sql`, production version
`20261014091553`:

| Table | Leading indexed column |
|---|---|
| invoices | job_id |
| quotes | job_id |
| sales_orders | job_id |
| pos_sessions | opened_by |
| pos_sessions | closed_by |
| sl_settings | default_technician_id |
| vehicle_last_positions | driver_id |
| webhook_secrets | tenant_id |

The existing sales-document job indexes start with tenant_id. They remain useful
for tenant-filtered application queries; the additional indexes put the foreign
key first for parent-row reference checks without a tenant filter. Existing
indexes, constraints, RLS, and document behavior were preserved.

Production preflight counted 0–2 rows per affected table, with total table/index
sizes no larger than 192 kB. This justified short transactional index builds
through the migration API, protected by a 3-second lock timeout and 60-second
statement timeout. The migration was rehearsed locally and in a rolled-back
production transaction before applying. All eight deployed indexes are valid
and ready, using 80 kB combined. Larger tables would require concurrent builds.

Changed Auth connection allocation in the Supabase dashboard from an absolute
limit of 10 to 17% of database maximum connections. Supabase's displayed effective
limit remains 10 out of 60; the allocation can now scale with instance size.
The 10-second Auth request timeout was preserved.

## Advisor results and retained indexes

| Finding | Before | After |
|---|---:|---:|
| Unindexed foreign keys | 8 | 0 |
| Auth connection strategy is absolute | 1 | 0 |
| Unused index | 257 | 265 informational findings |

The new indexes initially add eight unused-index notices. These notices are
candidates for workload review, not evidence that the indexes should be removed.
Before the change, the 257 unused non-unique indexes occupied only 2,728 kB;
233 were on tables with zero estimated live rows, and 254 had leading columns
covering a foreign-key relationship. The largest was 56 kB. Many modules are
new or inactive, so lack of recorded scans is expected. Removing these indexes
would lose useful foreign-key/query support for little storage benefit.
Database statistics had last reset on 2026-07-15; individual index creation and
module adoption are more recent than that reset.

Security advisors were also checked: no new findings. The intentionally guarded
59 privileged RPCs and locked-down webhook secret table remain as documented in
[the security review](security-review-20261014.md). Leaked-password protection
remains enabled.

## Verification

- All eight new indexes are valid/ready in production, and all eight missing-FK
  findings cleared.
- EXPLAIN checks confirmed indexed equality paths for all eight foreign-key
  predicates. Sequential scans were disabled only inside a rolled-back test
  transaction to establish index availability on these tiny tables. This is not
  a claim of measured latency improvement; the planner may prefer a sequential
  scan or an existing index at current data volumes.
- 597 SQL assertions passed across finance, POS, GPS, integrations/webhooks,
  customer portal, and authorization regression suites.
- 37 production workflow assertions passed with all demo test writes rolled back.
- 527 unit tests passed across 41 files; TypeScript and production build passed.
- Regenerated production database types match the tracked snapshot unchanged.
- Auth settings endpoint returned HTTP 200. A known leaked password was rejected
  with HTTP 422, weak_password/pwned, without creating an account.
- Signed-in dashboard rendered; dashboard HTTP 200 and unknown vendor-token API
  HTTP 404/not_found remained correct.
- No production customer rows, passwords, sessions, or module enablement changed.

Rollback, if a regression is discovered: remove only the eight new indexes in a
new forward migration, and restore the Auth allocation to absolute 10. No rollback
was needed. This review verifies the advisor findings and affected functionality;
it is not a production load test.

References:
- [Supabase foreign-key index advisor](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys)
- [Supabase unused-index advisor](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index)
- [Supabase production readiness](https://supabase.com/docs/guides/deployment/going-into-prod)
