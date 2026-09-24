# Module build-out — handoff

**Goal:** turn every `coming_soon` module in `shared/modules.ts` into a real, working
module, plus two new master-data modules (`suppliers`, `employees`) that purchasing,
inventory, finance, HR, workshop and field workforce depend on. PR:
[aqoza/FleetZa#16](https://github.com/aqoza/FleetZa/pull/16) (draft), branch
`claude/upbeat-bell-d7gda4`.

Everything in `docs/buildout/` is working material for this build-out. It can be deleted
or folded into permanent docs before the PR merges.

## Read in this order
1. **This file**: status and next steps.
2. [FOUNDATION.md](FOUNDATION.md): the shared contract.
   - §0 production-safety rules (non-negotiable: a real customer tenant lives in this database).
   - §1 table and RLS template (module-gated RLS via `app.module_enabled`).
   - §2 the foundation API.
   - §3 module map (id → category → requires → route → cluster).
   - §4 migration order.
   - §5 time-based scans.
3. [CLUSTERS.md](CLUSTERS.md): the product brief per module (the minimum v1 scope).
4. [UI_CONVENTIONS.md](UI_CONVENTIONS.md): page dir, hub, i18n namespace and worker file per
   module. It also has the file-ownership rules that let modules be built in parallel without conflicts.
5. [FOUNDATION_REVIEW.md](FOUNDATION_REVIEW.md): how the foundation migration was verified, and its public API.

## Status

| Phase | State |
|---|---|
| 0. Plan + contract | ✅ `FOUNDATION.md`, `CLUSTERS.md`, `UI_CONVENTIONS.md` |
| 1. Shell wiring | ✅ committed. Covers: registry (all modules `available`, with data dependencies); nav items and sections (new: logistics, finance, people, platform); lazy `<ModuleGate>` hub route per module; public routes `/portal/:token`, `/vendor/:token`, `/track/:token`; en+ar namespace per module (registered); placeholder hub per module; worker route stubs mounted in `worker/index.ts`; `worker/apiKey.ts` (API-key auth for `/api/v1/*`); `src/components/HubNav.tsx`; Leaflet dependency; icon rail scrolls (fix for many enabled modules). |
| 2. Foundation migration | ✅ written, reviewed and dry-run tested (96/96 against the live schema, rolled back). ❗ **NOT APPLIED**: `supabase/migrations/20260924000001_platform_foundation.sql` |
| 3. Cluster migrations (8) | ⏳ not started. Briefs are in `CLUSTERS.md`; order and file names in `FOUNDATION.md` §4. |
| 4. Module UIs (32) | ⏳ not started. The hubs are placeholders. |
| 5. Integration + docs + final verification | ⏳ not started (list below) |

`npx tsc -b` and `npm test` pass on the branch as committed (272 tests).

## Next steps

### Step 1: apply the foundation migration
1. Read the migration header and `FOUNDATION_REVIEW.md` (the fixer's section lists the final public API).
2. Optionally re-run the dry-run: run `bash docs/buildout/tests/build_foundation_test.sh`, then pass
   `docs/buildout/tests/foundation_test_live.sql` to the Supabase MCP `execute_sql`
   (project `ugfdexoaxladblafcrlc`). It ends in `rollback;`, and every test row should be `pass = true`.
3. Apply with the Supabase MCP `apply_migration` (name `platform_foundation`, body = the file).
   - The migration creates all RLS policies last, under a 1 s `lock_timeout`, because any
     `CREATE POLICY` on this project briefly locks 23 auth/storage/realtime tables.
   - If it times out on a lock, simply retry.
4. Run the security and performance advisors.
   - Expect lint 0029 on the new public SECURITY DEFINER RPCs. This is intentional: each one re-checks tenant, role and module.
   - Nothing else new should appear.
5. Regenerate `src/lib/database.types.ts` (MCP `generate_typescript_types`), then run `npx tsc -b`.

### Step 2: wiring pass 2 (shared files; do this before the module builds start)
- **`src/lib/db.ts` `RAISED_MESSAGES`, plus `errors.*` keys in `src/i18n/messages/{en,ar}/errors.ts`,** for the foundation codes:
  - `NO_TENANT`, `MODULE_DISABLED`
  - `INVALID_DOC_TYPE`, `INVALID_DOC_PREFIX`, `INVALID_DOC_NUMBER`
  - `INVALID_QUANTITY`, `INVALID_UNIT_COST`, `INVALID_STOCK_MOVE_TYPE`
  - `INVENTORY_ITEM_NOT_FOUND`, `WAREHOUSE_NOT_FOUND`, `INSUFFICIENT_STOCK`, `TRANSFER_SAME_WAREHOUSE`
  - `INVALID_API_KEY_NAME`, `INVALID_API_SCOPE`, `INVALID_API_KEY_EXPIRY`, `API_KEY_NOT_FOUND`
  - `CROSS_TENANT_REFERENCE`

  Also add each cluster's codes once its spec exists.
- **`src/lib/types.ts`:** add `Supplier, SupplierContact, Employee, Department, Company, Branch, Warehouse,
  InventoryItem, StockLevel, StockMove, AppNotification, DocumentRow, ApiKey`, using the `Tables<…>` aliases.
- **`src/lib/pickers.ts`:** add `useSupplierPicker, useEmployeePicker, useWarehousePicker,
  useInventoryItemPicker, useBranchPicker, useCompanyPicker, useDepartmentPicker`, in the same style as
  `useVehiclePicker`, searching the columns a human would type.
  - Note: `employees` is readable only by managers and the linked user.
  - Use the explicit embed hints from `FOUNDATION_REVIEW.md` when embedding branches/departments/managers.

### Step 3: cluster migrations (8)
One migration per cluster, applied in the `FOUNDATION.md` §4 order after the foundation:
platform, people, supply, telematics, logistics, compliance_workshop, commerce, finance.
Cluster SQL may declare FKs, triggers and views only against foundation and pre-existing
tables; concept ownership across clusters is listed in `FOUNDATION.md` §4.

This is the process that produced a clean foundation; repeat it per cluster:
1. **Design + SQL.** Write `docs/buildout/specs/<cluster>.md` covering:
   - tables, state machines, RPCs, events
   - notification kinds with en+ar text
   - scanners `app.scan_due_<cluster>`
   - worker endpoints
   - UI page inventory
   - pure-logic libs with test cases
   - error codes with en+ar messages

   Then write the migration and a test script.
2. **Dry-run** as `begin; <migration>; <tests as the demo tenant>; rollback;` via `execute_sql`
   (impersonation snippet in `FOUNDATION.md` §0.5 — demo tenant only).
3. **Adversarial review** from two angles: (a) security + production safety, (b) correctness + completeness against the brief.
4. **Fix**, re-run until green, then `apply_migration`, run the advisors, and regenerate types.

### Step 4: module UIs (32)
Build per `UI_CONVENTIONS.md`. Each module owns only its own page dir, i18n namespace, lib/test
files and worker file, so modules can be built in parallel. Requests to change shared files go
to one integrator. Verify each module:
- with `npx tsc -b` and its unit tests;
- in the browser on the demo tenant (`demo@fleetmanage.test`), which works locally, unlike in the cloud container;
- and, for quick en/ar × light/dark × desktop/mobile screenshots, with the mocked-backend harness in `docs/buildout/smoke/` (see its README).

### Step 5: integration (shared surfaces; one owner each)
- **Header:** `NotificationBell` (from `src/pages/notifications/`) in `AppLayout`, gated on `notifications`,
  calling `refresh_notifications()` on mount.
- **Security:** the idle-timeout from `security_settings` in `AppLayout`, when `audit_security` is on.
- **Attachments:** the documents `AttachmentsPanel` on vehicle, driver, customer and employee detail pages.
- **Branches:** a branch picker on `VehicleForm` and the driver form (`vehicles.branch_id`, `drivers.branch_id`), when `multi_company` is on.
- **Vehicle 360 panels:**
  - insurance policies
  - incidents
  - regulatory `VehicleCompliancePanel`
  - GPS last position
  - trips
  - driver-behavior events
  - predictive risk
  - IoT devices
- **Customer 360 panels:** CRM opportunities, contracts, portal links and requests, shipments.
- **Other shared surfaces:**
  - dashboard widgets
  - `GlobalSearch` entities (employees, suppliers, shipments, policies…)
  - `ContextPanel` due-soon items
- **Module catalog copy:** rewrite descriptions in `src/i18n/messages/{en,ar}/modules.ts` to match what
  actually shipped. Several over-promise today:
  - notifications: "email, SMS" (in-app only)
  - vendor portal: "submit invoices" (v1 is view + acknowledge POs)
  - integrations: "ready-made integrations"
  - predictive: "AI" (the model is deterministic scoring)
- **Docs:**
  - `docs/MODULES.md`: the catalog is now fully available; module-gated RLS is the new standard
  - `docs/ARCHITECTURE_REVIEW.md`: status, since the entitlement gap is closed for every new table
  - `docs/PLAN.md` iteration entry
  - per-area docs, like `SALES.md` / `SPEED_LIMITERS.md`

### Definition of done (CLAUDE.md verification bar)
- `tsc -b` and `npm test` pass
- every module driven in the browser on the demo tenant
- Supabase security advisors clean (except the intentional 0029)
- `database.types.ts` regenerated
- `/api/verify/:certUuid` untouched and working
- all migrations additive and mirrored in `supabase/migrations/`

## Decisions made (and why)
- **`suppliers` and `employees` are new master-data modules.**
  - `ARCHITECTURE_REVIEW` §9.2 calls for them.
  - Without them, purchasing/finance/inventory would own suppliers and HR/workshop/field would own employees. That repeats the "customers trapped in speed limiters" inversion the review fixed.
- **Module-gated RLS for all new tables** (`app.module_enabled`). This closes risk #1 of the architecture review (entitlements were enforced only in React) for everything new. Old tables are unchanged.
- **Triggers on existing tables** (notifications, automation, webhooks) must be:
  - a no-op unless the tenant has enabled the owning module;
  - exception-safe.

  Production behavior therefore stays unchanged until a tenant opts in.
- **No new default modules.** `DEFAULT_MODULES` is unchanged, so existing tenants see nothing new until an admin enables a module.
- **No cron is available** (Pages Functions can't schedule). Time-based alerts run through `refresh_notifications()`:
  - it is throttled per tenant;
  - it discovers `app.scan_due_*` functions;
  - the SPA calls it when the bell mounts.
- **Public portals use capability links** (`/portal/:token`, `/vendor/:token`, `/track/:token`), the same posture as `/q/:token` and `/verify`. No auth or memberships refactor was needed.
- **Outbound webhooks are delivered by the worker (`/api/integrations/dispatch`), not `pg_net`.** Delivering from the DB to tenant-supplied URLs would be an SSRF surface from the database network.

## Found in passing (out of scope, worth separate PRs)
- **RTL text direction.** In Arabic mode, LTR data renders with broken ordering: phone
  "+1 702 555 0133" shows as "0133 555 702 1+", and "Gulf Freight Co." shows as ".Gulf Freight Co".
  These values need `dir="ltr"`, `<bdi>` or `unicode-bidi: plaintext`.
- **No plurals.** "1 vehicles in your fleet" (`vehicles.countInFleet`): `t()` has no plural support, and Arabic needs `Intl.PluralRules`.
- **Sales overview copy.** It repeats "Nothing needs attention right now." under three cards that already say it.
