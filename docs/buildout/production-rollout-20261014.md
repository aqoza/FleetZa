# Production migration rollout — 2026-10-14

Project: `ugfdexoaxladblafcrlc`. Source: main commit `7b6efae88112c68e277d0ac88dc3ef7da10f2797`.

Applied the four missing migrations unchanged, in dependency order. Each passed a short production dry-run with an immediate rollback before deployment.

| Migration | Production version |
|---|---|
| audit_security | 20261014083403 |
| payroll_hr | 20261014083420 |
| purchasing | 20261014083437 |
| vendor_portal | 20261014083451 |
| purchasing_tenant_indexes | Follow-up migration on 2026-10-14 |

The additive index follow-up covers tenant foreign keys on purchase_order_lines and vendor_bill_lines. The performance advisor no longer reports either table.

Validation:
- Rehearsed deployment after all already-deployed modules in local PGlite; 225 SQL assertions passed across audit/security, HR, purchasing, vendor portal, and finance.
- 37 production assertions passed using only the demo tenant and a rolled-back transaction. Covered settings, authorization, leave, attendance, payroll calculation/approval/payment, purchase totals, vendor access/acknowledgement, goods receipt/stock, vendor billing/payment, finance posting, and tenant isolation.
- Verified no temporary test employees, suppliers, or vendor links remained.
- All 15 new tables have RLS enabled and policies; anonymous table reads are denied.
- Live PostgREST returned HTTP 401 / 42501 for anonymous reads of the four module entry tables.
- The deployed vendor API at fleetmaster.uk returned HTTP 404 with not_found for an unknown token, confirming the worker can reach the installed RPC.
- Browser: the signed-in production dashboard and module catalog load. All four modules are available; existing tenant enablement was preserved. No new-module UI writes were performed in the customer's tenant.
- 527 unit tests passed (41 files); TypeScript and the production build passed.
- Regenerated database.types.ts from production. SQL RPC nullability is maintained in database.overrides.ts because the generator cannot infer it. No runtime behavior changed.

Security advisors: no new warning categories. The 17 added authenticated SECURITY DEFINER RPCs intentionally validate module, role, and tenant internally. Vendor token RPCs remain service-role-only. Existing warnings remain for leaked-password protection being disabled and intended authenticated definer RPCs; webhook_secrets intentionally has RLS and no client policy.
- [SECURITY DEFINER advisor](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)
- [Leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)

Limits: the local replica is PostgreSQL 18/PGlite; production tests ran against the actual project. No real session was revoked, no external payment was made, and all workflow fixtures rolled back. The legacy fleetza.pages.dev hostname timed out from this machine; the current fleetmaster.uk domain and API worked.
