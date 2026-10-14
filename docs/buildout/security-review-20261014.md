# Production security warning review — 2026-10-14

Project: `ugfdexoaxladblafcrlc` (production). Reviewed after enabling leaked-password protection.

## Fixed: missing application role could bypass legacy RPC guards

`app.is_admin()` and `app.is_manager()` returned SQL NULL when a JWT omitted
`app_metadata.role`. RLS predicates rejected that value, but PL/pgSQL
`IF NOT app.is_manager() THEN ...` skipped its denial branch. Local regression
tests reproduced unauthorized progress into finance operations, predictive
snapshots, and automation condition testing with incomplete claims.

Migration `20261014000002_role_checks_fail_closed.sql` makes both predicates
return false for missing or null roles. Owner/admin/manager permissions remain
the same. Function signatures, grants, tenant selection, and certificate
numbering logic are unchanged. Production migration version: `20261014090405`.

The migration passed a rolled-back production dry-run, then was applied through
Supabase migrations. Rollback uses a new forward migration; restoring nullable
authorization checks would reintroduce the defect.

## Remaining advisor findings

| Finding | Count | Assessment |
|---|---:|---|
| Signed-in users can execute SECURITY DEFINER function | 59 warnings | Intentional application RPCs. All deny anonymous execution and set an empty search path. Authorization is checked in the RPC or its internal helper. Revoking these grants would break supported workflows. |
| RLS enabled with no policy: webhook_secrets | 1 informational | Intentional deny-by-default secret storage. No anonymous or authenticated table privileges, and no client RLS policy. Secrets are created/rotated through admin RPCs and delivered to the worker through service-role-only RPCs. |
| Leaked-password protection disabled | 0 | Protection remains enabled; the previous warning is absent. |

Access review covered the 59 live function definitions, shared authorization
helpers, and production privileges. Manager/admin RPCs retain role and tenant
checks. Member APIs retain self-service checks: field check-ins/tasks, leave
requests/balances, and workshop time entries. Finance pending counts are a
tenant-scoped member read; notification refresh is tenant-scoped and throttled,
with forced refresh restricted to admins. The legacy certificate-number RPC was
inspected but not invoked. No permissive policy or blanket grant was added merely
to remove an advisor finding.

- [Supabase guidance on authenticated SECURITY DEFINER RPCs](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)
- [Supabase guidance on RLS without policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)

## Verification

- The new regression suite failed against the previous definitions and passes
  with the migration: 386 assertions covering valid roles, missing/null/unknown
  roles, editable user metadata, 49 privileged RPC denial checks across five
  non-privileged role variants, grants/search paths on all 59 flagged RPCs, and
  webhook secret isolation.
- The same 386 assertions passed against production, both in the migration
  dry-run and after deployment. Only demo module flags were temporarily changed;
  each RPC attempt and the complete transaction were rolled back.
- 1,355 local SQL assertions passed across 32 module/security suites, including
  positive finance, inventory, payroll, purchasing, portals, and cross-tenant tests.
- 37 additional production workflow assertions passed with all test writes
  rolled back. These cover HR, purchasing, finance posting, vendor access, and
  security settings/authorization without revoking an actual session.
- 527 unit tests passed across 41 files. TypeScript and production build passed.
- Regenerated database types from production and compared with the tracked
  snapshot: no changes.
- Signed-in production dashboard rendered. Dashboard HTTP 200; unknown vendor
  token returned the expected HTTP 404/not_found. No customer settings changed.
- Security advisors rerun: only the intentional findings above remain.

Scope: this is a review of the reported Supabase security findings and their
authorization paths, not a full application penetration test. The local database
replica uses PGlite; the authorization and workflow checks above also ran against
the actual production project. Production certificate workflows were not invoked.
