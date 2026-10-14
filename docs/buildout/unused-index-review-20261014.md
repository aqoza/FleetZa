# Unused-index review — 2026-10-14

Project: `ugfdexoaxladblafcrlc` (production).

## Decision and deployed change

Reviewed all 598 public indexes against the 265 initial unused-index notices.
Compared table, access method, leading key columns, operator classes, collations,
sort/null ordering, predicates, expressions, included columns, validity, uniqueness,
and constraint ownership. There were no exact or unconditional leading-prefix
duplicates among the unused non-unique candidates.

Removed only `public.sales_orders_quote_idx` (16 kB), using repository migration
`20261014000004_remove_redundant_quote_index.sql`, applied as production version
`20261014092715`. Retained `sales_orders_quote_uk`: its unique B-tree covers every
non-null quote reference and enforces one sales order per quote.

This is workload redundancy, not identical index coverage. The retained partial
index excludes null quote IDs. Repository queries, live function definitions,
and recorded statement shapes showed no application `sales_orders.quote_id IS NULL`
filter requiring that coverage. The only matching recorded statements were this
audit's own row counts. Orders created without quotes remain supported; lists use
tenant/status/date filters. A future dedicated unquoted-order query should have
its plan reviewed.

The removed index had zero scans, no dependent objects, no constraint ownership,
and was not replica identity. The sales-order table had zero rows. The migration
checks the replacement's exact definition, uniqueness, validity, and readiness
before dropping the redundant index, without CASCADE. DDL uses a 3-second lock
timeout and 60-second statement timeout. Local migration replay and production
transactional rehearsal passed before applying.

Retained every other index: lack of scans alone does not establish redundancy,
especially for new/empty modules and foreign-key support. In particular, the
eight recently added foreign-key indexes remain.

## Verification

- 11 focused quote-reference assertions passed locally and in production both
  during rehearsal and after deployment. Covered quote conversion/totals/copied
  lines, reverse links, equality lookup, duplicate conversion and duplicate quote
  rejection, invalid FK rejection, multiple orders without quotes, ON DELETE SET
  NULL, invoice creation, and tenant isolation. All production test writes used
  the demo tenant and were rolled back; outbound automation modules were disabled
  only within that transaction.
- 107 additional SQL assertions passed across finance and customer portal suites
  (118 total including the focused suite).
- EXPLAIN before and after deployment confirmed `sales_orders_quote_uk` serves
  both a generic prepared quote equality query and the FK reference lookup with
  FOR KEY SHARE. Sequential scans were disabled only in rolled-back diagnostic
  transactions. This proves index availability, not a measured latency gain.
- 527 unit tests passed across 41 files. TypeScript and production build passed;
  the existing large-bundle advisory remains.
- Regenerated database types are unchanged.
- The production sales-order page rendered its expected empty state in the
  existing signed-in browser session. Browser verification was read-only;
  write-workflow checks used the demo SQL transaction above.
- Production catalog confirms the old index is absent, the replacement is
  unique/valid/ready, and sales orders still contain zero rows.
- Performance advisor: no missing-FK warnings; 260 unused-index INFO findings at
  the post-change check. Only one index was removed; additional notices cleared
  because verification exercised previously unused indexes. Statistics include
  diagnostic activity and are not a pure customer-workload measure.
- Security advisor unchanged: 59 guarded SECURITY DEFINER RPC notices and one
  intentional deny-all RLS notice, documented in security-review-20261014.md.

The test initially invoked the legacy one-argument invoice RPC ambiguously;
it now supplies the explicit second JSONB argument, matching the application.

## Recovery

If a future workload needs the full index, recreate it in a new forward migration:

```sql
create index sales_orders_quote_idx on public.sales_orders (quote_id);
```

For a large or busy table, use CREATE INDEX CONCURRENTLY outside a transaction.
No rollback was needed.

References:
- [Supabase unused-index advisor](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index)
- [PostgreSQL partial indexes](https://www.postgresql.org/docs/current/indexes-partial.html)
