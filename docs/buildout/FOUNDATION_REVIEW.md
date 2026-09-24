# Foundation migration — review record

How `supabase/migrations/20260924000001_platform_foundation.sql` was built and checked:
1. A writer drafted the migration and a test suite, and dry-ran both against the live schema inside a single `begin … rollback` transaction, impersonating the demo tenant.
2. Three independent reviewers attacked it, each from one angle: security/tenant isolation, correctness/concurrency, and production safety.
3. A fixer verified every finding, fixed it and re-ran the suite.

**Final state:** all 17 findings are resolved: 13 fixed in the migration, 2 documented in the contract, 1 partly rejected with a reason, and 1 where fixing the broader root cause replaced the reviewer's proposed fix. 96 of 96 tests pass against the live schema in a rolled-back transaction, and the md5 of the script the server received matches the file.
The migration has **NOT been applied** to the database yet (see HANDOFF.md).

To re-run the dry-run: `bash docs/buildout/tests/build_foundation_test.sh`, then pass `docs/buildout/tests/foundation_test_live.sql` to the Supabase MCP `execute_sql` tool (project `ugfdexoaxladblafcrlc`). The script ends in `rollback;`.

## Fixer — dispositions, final results, public API

All 18 findings are dispositioned: 14 fixed in the migration, 4 fixed at contract/doc level (one of those also in the file header) plus one partly rejected. The full dry-run passes live on `ugfdexoaxladblafcrlc`: 96/96, in one `begin; migration; tests; rollback;` run. Its `zz script md5` (7ee99c9308cf7245c24954eef403c8d7) matches the local file byte-for-byte, and a follow-up query confirmed nothing was left behind. Nothing is committed yet; the migration file is still untracked on `claude/upbeat-bell-d7gda4`.

One finding went further than the review said. On this project, **any** `CREATE POLICY` takes exclusive locks on 23 auth, storage and realtime tables until commit, not just policies on `storage.objects`. I checked this live: tables, triggers, indexes, foreign keys, grants and the bucket insert take none of these locks. So the fix is to put every policy last in the migration, not to split storage into its own file. I tried the split and then dropped it, so the contract's file list is unchanged.

## Per-finding disposition
| # | Finding | Disposition |
|---|---|---|
| 1 | Viewers can read employee HR files (table + bucket) | **Fixed.** `documents_select`: rows with `entity_type='employee'` are visible to managers and to the employee whose login is linked; `hr_*` types are managers only. Storage select now requires manager OR a visible `documents` row with that `storage_path`, so orphans are managers only. Contract amended. Tests 09d/09e/09f. |
| 2 | Client can forge or poison `number`/`doc_number` | **Fixed.** When the session role is authenticated/anon, supplied values are replaced on insert and frozen on update (trigger is now `before insert or update of number, doc_number`). Trusted sessions (service_role, direct SQL) can import numbers in 1..99,999,999, otherwise `INVALID_DOC_NUMBER`. Added `unique (tenant_id, doc_number)`. Tests 02f/02g. |
| 3 | Cross-tenant foreign keys (branch company pinning, primary-contact squatting) | **Fixed.** New `app.assert_same_tenant()` trigger on every client-writable foreign key of the new tables raises `CROSS_TENANT_REFERENCE: <col>`, the same error for "doesn't exist", so it can't be used to probe other tenants. Primary-contact index is now `(supplier_id, tenant_id)`. `vehicles`/`drivers.branch_id` left as they are: `on delete set null` only touches the writer's own row, and §0.2 rules out blocking triggers on existing tables. Tests 08d/08e/08f. |
| 4 | `FOR UPDATE` deadlock | **Fixed.** `for no key update` in `post_stock_move` and `stock_adjust`. Reproduced with two local sessions: old version → `deadlock detected`, new version → both post, one after the other (99→97). Test 00g. |
| 5 | `INSUFFICIENT_STOCK` raised on inbound moves | **Fixed.** Raised only when quantity < 0. Test 03q. |
| 6, 14 | `api_keys` audit/updated_at/stamp triggers fire on every `last_used_at` stamp | **Fixed.** The three triggers fire only on updates of tenant_id, name, key_prefix, key_hash, scopes, active, expires_at, revoked_at. Tests 00h/06i. I did not change the worker-side throttle in `worker/apiKey.ts` (not my file); the DB fix is enough on its own. |
| 7, 13 | Out-of-range explicit numbers / integer overflow | **Fixed** as part of #2 (bounds check, clients can't pass explicit numbers). Test 02g. |
| 8 | `stock_adjust` rounding | **Fixed.** Target rounded to 3 decimals before comparing. Test 03r. |
| 9 | Nulls into NOT NULL columns with defaults | **Fixed.** `employees.last_name` is now nullable; new `app.inventory_item_defaults` trigger turns null/blank `uom` into `'unit'` and null `cost_price` into 0 on insert (unchanged on update). Tests 02x-a/03v. |
| 10 | `stock.below_reorder` event not deduplicated | **Fixed.** Per-item-per-day dedupe key, same as the notification. Test 03s. |
| 11 | Low-stock alert only fires on a crossing | **Fixed.** New `app.alert_low_stock`. Any outbound, non-transfer move that leaves the total at or below the reorder point alerts. A new trigger also alerts when the reorder point is raised above the current total, or tracking/active is switched back on. All deduplicated daily. No scanner added. Tests 03t/03u. |
| 12 | Storage policies take auth locks | **Fixed (broader root cause, see above).** Migration now runs: RLS enabled early → … → §17 ALTERs on existing tables (under `lock_timeout 1s`) → §18 all 54 policies plus the bucket, last. Test 00d uses a lock probe spliced in before §17: live shows none held. |
| 15 | Scanner timeout aborts `refresh_notifications` | **Fixed.** `when query_canceled` → warning and stop scanning, but the throttle claim is kept; also a 5 s time budget. Test 07g. |
| 16 | Ambiguous PostgREST embeds | **Contract/doc only.** Documented the explicit FK hints (below) in FOUNDATION.md and in a migration comment. |
| 17 | Undeclared deviations from the table template | **Contract/doc only.** Declared in the migration header and in FOUNDATION.md. |
| — | Reviewer's proposed separate storage migration | **Rejected** after trying it: it doesn't help, because every `CREATE POLICY` takes the same locks. Policies-last replaces it. |

Every new regression test fails against the pre-fix migration, which I ran locally as a check.

## Final test results
| Section | Tests | Local | Live |
|---|---|---|---|
| 00 structure (FK indexes, RLS, grants, **lock probe**, **no-key lock**, **api_keys triggers**) | 00a–00h | 8/8 | 8/8 |
| 01 module gate | 01a–c | 3/3 | 3/3 |
| 02 suppliers / numbering (**02f, 02g** forge/import/bounds/unique), prefix, contacts | 02a–i, 02g2 | 10/10 | 10/10 |
| 02x employees / companies / branches (last_name null) | 02x-a–i | 9/9 | 9/9 |
| 03 stock ledger (**03q–03v**) | 03a–v | 22/22 | 22/22 |
| 04 direct ledger writes denied | 04 | 1/1 | 1/1 |
| 05 notify fan-out / dedupe / mute / RLS | 05a–l | 12/12 | 12/12 |
| 06 api keys (**06i**) | 06a–i | 9/9 | 9/9 |
| 07 refresh_notifications (**07g** timeout) | 07a–g | 7/7 | 7/7 |
| 08 cross-tenant (**08d–f**) | 08a–f | 6/6 | 6/6 |
| 09 documents / storage (**09d–f** HR visibility) | 09, 09a–f | 7/7 | 7/7 |
| 10 events dedupe / visibility | 10a–b | 2/2 | 2/2 |
| **Total** | | **96/96** | **96/96**, md5 matches |

Security advisors show only two warnings that predate this migration (`next_certificate_number`, leaked-password protection). Once the migration is applied, lint 0029 will also flag the public SECURITY DEFINER RPCs. That is intentional: each one re-checks tenant, role and module inside.

## Public API for UI builders
**Tables** (module gate; reads for members, writes for managers unless noted):
- `companies`, `branches` — multi_company
- `departments` — employees
- `employees` — employees; readable only by managers and the linked user; `last_name` nullable
- `suppliers`, `supplier_contacts` — suppliers
- `warehouses`, `inventory_items` — inventory
- `stock_levels`, `stock_moves` — inventory; read-only
- `documents` — documents; HR restriction as in #1
- `notifications` — the recipient's own rows; client may update `read_at` only, and delete
- `notification_preferences` — own rows
- `notification_state` — read-only
- `domain_events` — admins, with integrations or workflow_automation on
- `api_keys` — admin only; client may update `name` only, and delete

Other table changes:
- New column `vehicles.branch_id`, `drivers.branch_id` (set null).
- Bucket `documents`: private, 25 MB, path `<tenant>/<doc id>/<file>`.
- Numbering: `SUP-00001` / `EMP-00001`; per-tenant prefix override via `set_document_prefix`.

**RPCs (authenticated):**
- `set_document_prefix(p_doc_type text, p_prefix text) → void` — admin
- `stock_receive(p_item uuid, p_warehouse uuid, p_qty numeric, p_unit_cost numeric = null, p_notes text = null) → uuid` — manager
- `stock_issue(p_item uuid, p_warehouse uuid, p_qty numeric, p_ref_type text = null, p_ref_id uuid = null, p_notes text = null) → uuid` — manager
- `stock_transfer(p_item uuid, p_from_warehouse uuid, p_to_warehouse uuid, p_qty numeric, p_notes text = null) → uuid` — manager; returns the transfer reference id
- `stock_adjust(p_item uuid, p_warehouse uuid, p_new_on_hand numeric, p_notes text = null) → uuid|null` — manager
- `create_api_key(p_name text, p_scopes text[], p_expires_at timestamptz = null) → text` — admin; plaintext key returned once
- `revoke_api_key(p_id uuid) → void` — admin
- `refresh_notifications(p_force boolean = false) → integer`

**Helper functions (for cluster SQL):**
- `app.module_enabled(text)`, `app.tenant_module_enabled(uuid, text)`
- `app.require_module(text, level = 'manager') → tenant uuid`
- `app.assign_doc_number('<type>', '<PREFIX>')` — trigger: `before insert or update of number, doc_number`, plus unique indexes on `(tenant_id, number)` and `(tenant_id, doc_number)`
- `app.assert_same_tenant('<col>', '<parent>', …)` — trigger
- `app.ensure_single_default()`, `app.guard_item_cost()`, `app.inventory_item_defaults()`
- Internal, revoked from clients:
  - `app.notify(tenant, audience, kind, severity, entity_type, entity_id, link, params, title, body, dedupe_key, recipient = null)`
  - `app.emit_event(tenant, event, entity_type, entity_id, payload, dedupe_key = null)`
  - `app.post_stock_move(tenant, item, warehouse, type, qty_signed, unit_cost, ref_type, ref_id, notes)`
  - `app.alert_low_stock(tenant, item, on_hand, warehouse = null, move = null)`
- `app.api_scopes()`
- Scanner convention: `app.scan_due_<suffix>(uuid) returns integer`

**Notification kind / event:** `inventory.low_stock` (params item_id, sku, name, on_hand, reorder_point, reorder_qty, uom; link `/inventory?item=<id>`) and event `stock.below_reorder`.

**Embed hints:**
- `branches!employees_branch_id_fkey(...)`
- `departments!employees_department_id_fkey(...)`
- `manager:employees!branches_manager_employee_id_fkey(...)`
- `manager:employees!departments_manager_employee_id_fkey(...)`
- `manager:employees!employees_manager_id_fkey(...)`

**Raised error codes** (each needs `RAISED_MESSAGES` + `errors.*`):
- Unchanged: `NO_TENANT`, `FORBIDDEN`, `MODULE_DISABLED`, `INVALID_DOC_TYPE`, `INVALID_DOC_PREFIX`, `INVALID_QUANTITY`, `INVALID_UNIT_COST`, `INVALID_STOCK_MOVE_TYPE`, `INVENTORY_ITEM_NOT_FOUND`, `WAREHOUSE_NOT_FOUND`, `INSUFFICIENT_STOCK: …`, `TRANSFER_SAME_WAREHOUSE`, `INVALID_API_KEY_NAME`, `INVALID_API_SCOPE`, `INVALID_API_KEY_EXPIRY`, `API_KEY_NOT_FOUND`
- Internal only: `INVALID_AUDIENCE`
- **New:** `INVALID_DOC_NUMBER`, `CROSS_TENANT_REFERENCE: <col>`
- Postgres codes the UI will see: 23505 (sku, codes, doc_number, one primary contact, one employee per login/driver), 23503 (deleting a company that has branches), 23514, 42501.

## Files
- `supabase/migrations/20260924000001_platform_foundation.sql` — the migration (I created and then deleted a separate storage migration; no extra file remains)
- `docs/buildout/tests/foundation_test.sql` — full test script. `foundation_test_live.sql` in the same folder is the comment-stripped copy that was run live.
- `docs/buildout/tests/build_foundation_test.sh` — rebuilds both from `foundation_tests_body.sql`, `foundation_tests_storage.sql` and `foundation_tests_report.sql` (same folder)
- `docs/buildout/FOUNDATION.md` — §2 amended: numbering usage, documents visibility, and a "rules added by the review round" block. That block covers the lock layout (policies last, `lock_timeout 1s`), same-tenant triggers, stock lock and ordering, blank-field rule, api_keys triggers, scanner budget, embed hints and declared deviations.

## Findings as raised

### [MEDIUM] (security) Documents table and bucket let any member (viewer) read HR files attached to employees, bypassing the new employees restriction

**Evidence:** Live dry-run S2, `begin … rollback` (script docs/buildout/tests/sec_review_live.sql): the manager inserts an employee (salary 9999, national_id) plus a documents row {entity_type:'employee', entity_id:<emp>, name:'Passport scan - Secret Person'} and its storage object `<tenant>/<doc id>/passport.pdf`. As a viewer the result is `employees visible=0, employee documents visible=1, storage objects visible=1`. Cause: `documents_select` (migration lines 752-767, loop entry ('documents','documents')) and `documents_objects_select` (lines 888-891) gate only on tenant + module. The storage select policy is also not tied to a visible `documents` row, so viewers can list and download every object in the tenant folder, including orphans. The writer restricted `employees` because it holds salary, IBAN and national id (deviation 1), but passports, contracts and permits uploaded against employees stay open to every viewer. The people cluster will attach exactly these files. Note: FOUNDATION.md §2 says 'members read' for documents, so fixing this also needs a spec amendment.

**Proposed fix:** Make visibility follow the owning entity. (a) documents_select: add `and (entity_type is distinct from 'employee' or (select app.is_manager()) or exists (select 1 from public.employees e where e.id = documents.entity_id and e.user_id = (select auth.uid())))`. A generic `app.document_visible(entity_type, entity_id)` helper would let clusters register more sensitive entity types. (b) documents_objects_select: replace the bare folder check with `exists (select 1 from public.documents d where d.storage_path = storage.objects.name)`. That subquery runs with the invoker's RLS, so object visibility equals row visibility and orphan objects become unreadable. Add a test showing a viewer sees 0 employee documents and 0 objects, and the linked employee sees their own.

### [MEDIUM] (security) app.assign_doc_number trusts a client-supplied number/doc_number: any manager can forge duplicate document numbers or push the counter to INT_MAX, breaking numbering for the whole tenant

**Evidence:** Live dry-run S3, as manager: (a) `insert into suppliers (name) …` gives SUP-00001; then `insert into suppliers (name, number, doc_number) values ('Forged', 777777, 'SUP-00001')` is accepted. Result: `first=SUP-00001 forged=SUP-00001 dupes=2`. The unique index is only (tenant_id, number), and the trigger returns early when both fields are set (lines 151-159). (b) `insert into suppliers (name, number) values ('Poison', 2147483646)` succeeds and advances `document_sequences.next_number` to 2147483647 (lines 153-156). The next normal insert then fails: `22003 integer out of range` in app.next_doc_number. Every later supplier insert in the tenant fails the same way. There is no in-app recovery: set_document_prefix only updates `prefix`, and document_sequences has no client write policy. Explicit INT_MAX also raises 22003. Updates are unguarded as well: the numbering trigger is BEFORE INSERT only and the update policies allow every column, so number/doc_number can be rewritten later (from reading the code; I only tested the insert path). This is the generic primitive that later clusters will reuse for POs, vendor bills, POS receipts and journals, where forged or duplicate fiscal numbers are a fraud risk.

**Proposed fix:** In app.assign_doc_number, ignore client values when `current_user in ('authenticated','anon')`: always allocate via app.next_doc_number and always derive doc_number from it. Allow explicit numbers only for trusted callers (service_role or definer import RPCs), with a sane bound (e.g. `number between 1 and 99999999`) so the counter cannot reach INT_MAX. Add a BEFORE UPDATE guard that keeps number/doc_number for client roles, same pattern as app.guard_item_cost. Add `unique (tenant_id, doc_number)` on numbered tables. Document the rule in FOUNDATION §2 so clusters inherit it.

### [LOW] (security) FKs and an index that are not tenant-scoped let one tenant interfere with another's rows (blocked delete, primary-contact slot squatted)

**Evidence:** Live dry-run S4 and S4b, using a throwaway tenant B created and rolled back inside the transaction: (1) the demo manager cannot see B's company (visible=0), but `insert into branches (name, company_id) values ('Pin', <B company id>)` succeeds. B's owner then cannot delete its own company: `23503 … violates foreign key constraint "branches_company_id_fkey"` (FK is `on delete restrict`, line 276). (2) supplier_contacts_primary_uk is on `(supplier_id)` only (lines 442-443). The demo manager inserts a primary contact on B's supplier, and B's owner then gets `23505 duplicate key … supplier_contacts_primary_uk` when adding their own primary contact. B cannot see the blocking row (`owner sees contacts=0`), so B cannot fix it. The attacker needs B's UUID, hence low severity. The writer's open question covers FKs in general; this confirms real cross-tenant impact from the restrict FK and the global partial unique index.

**Proposed fix:** Validate that parents belong to the same tenant. Either (a) add `unique (tenant_id, id)` on parent tables and make child FKs composite `(tenant_id, company_id) references companies(tenant_id, id)`. This works for restrict/cascade FKs; for `on delete set null` FKs use PG15+ `set null (company_id)` column lists, or use option b. Or (b) add a BEFORE INSERT OR UPDATE trigger per child table that checks the parent's tenant_id = new.tenant_id and raises e.g. `CROSS_TENANT_REFERENCE`. Minimum cheap fix: scope the partial index as `(tenant_id, supplier_id) where is_primary` and change branches.company_id to `on delete set null`. Cover vehicles/drivers.branch_id, employees.* FKs, inventory_items.product_id/preferred_supplier_id and supplier_contacts.supplier_id the same way.

### [MEDIUM] (correctness) post_stock_move locks the item with FOR UPDATE, so callers that already hold a key-share lock on it can deadlock (lock upgrade)

**Evidence:** Migration lines 1074-1077 use `select * ... from public.inventory_items ... for update`, and stock_adjust at lines 1261-1263 does the same. FOR UPDATE conflicts with the FOR KEY SHARE lock that every FK insert takes on the referenced item. FOUNDATION §2 says purchasing receipts, workshop parts and POS sales call app.post_stock_move from their own RPCs or triggers. The natural pattern is to insert a line with an FK to inventory_items and then post the move in the same transaction. When two such transactions run concurrently on the same item, each holds KEY SHARE and waits for the other's FOR UPDATE. Reproduced on the local harness, built from the identical migration: two sessions each ran `insert into wo_parts(item_id) values (X); pg_sleep(1); select app.post_stock_move(..., 'consumption', -1, ...)`. S2 failed with `ERROR: deadlock detected ... while locking tuple (0,2) in relation "inventory_items" ... PL/pgSQL function app.post_stock_move ... line 30`. Control: I changed only that clause to `for no key update` and re-ran. Both sessions succeeded and were still serialized (on_hand 99 -> 97, 4 moves). The live dry-run confirmed the deployed body uses `for update`.

**Proposed fix:** Use `for no key update` in app.post_stock_move and in stock_adjust's pre-lock. NO KEY UPDATE still conflicts with itself, so every move of one item stays serialized and the moving average stays correct. It does not conflict with the KEY SHARE locks taken by FK inserts. Also state in the contract that multi-item callers must post in a deterministic order (e.g. order by item_id) to avoid cross-item deadlocks.

### [MEDIUM] (correctness) INSUFFICIENT_STOCK is raised on inbound moves (receipt/return/transfer_in) into a negative balance, so stock cannot be received

**Evidence:** Line 1096 is `if v_on_hand < 0 and p_type <> 'adjustment' and v_item.track_stock then raise 'INSUFFICIENT_STOCK'`. It checks the resulting balance for every move, including positive ones. A warehouse balance can legitimately be negative while track_stock=true in two ways: the item went negative while track_stock=false and tracking was then switched on, or another cluster posted a negative 'adjustment', which post_stock_move allows. After that, any receipt that doesn't lift the balance to >= 0 fails. Live rolled-back run (md5 of script d34d76d528bbe7c0b5c6da58157e57fa matched): an item with track_stock=false was issued 10 (balance -10), then track_stock was set to true, then stock_receive(+5 @ 2) returned `P0001 INSUFFICIENT_STOCK: on hand -10.000, requested 5.000`. The same result reproduced locally. The spec says to raise only 'if on_hand would go negative'.

**Proposed fix:** Only check outbound quantities: `if v_qty < 0 and v_on_hand < 0 and p_type <> 'adjustment' and v_item.track_stock then ...`. That lets inbound moves reduce a deficit, and the error message is no longer misleading.

### [MEDIUM] (correctness) Every API request writes an audit_events row: the worker stamps api_keys.last_used_at on each call, and api_keys has log_audit, stamp_actor and updated_at triggers

**Evidence:** worker/apiKey.ts:96 runs `admin.from("api_keys").update({ last_used_at: ... }).eq("id", row.id)` on every authenticated /api/v1 request, with no throttle. The migration (lines 709-740) attaches `api_keys_audit` (after insert or update or delete), `api_keys_stamp_actor` and `api_keys_updated_at` to api_keys. Live rolled-back run: 3 service-role updates of last_used_at produced 3 new audit_events rows, whose diff contained only `last_used_at` (reproduced locally). Telematics and IoT ingestion is high-frequency, so audit_events, which admins browse in the security module, grows by one row per request. The header comment says audit is not meant for high-volume system writes. Every stamp also rewrites updated_at/updated_by (updated_by becomes null for the service role).

**Proposed fix:** Limit the api_keys audit trigger (and the stamp_actor/updated_at update triggers) to meaningful columns, e.g. `after insert or delete or update of name, scopes, active, expires_at, revoked_at on public.api_keys`. Use a separate `before insert` trigger for stamp_actor. Also or instead, throttle the worker stamp to at most once a minute (`.or('last_used_at.is.null,last_used_at.lt.<now-60s>')`).

### [LOW] (correctness) assign_doc_number accepts any explicit number: negatives format oddly, and a large value permanently breaks the tenant's numbering (integer overflow)

**Evidence:** The explicit-number path (lines 151-156) moves the counter to `greatest(next, v_n + 1)` without any bounds check. A manager can post `number` directly through PostgREST, because the column is writable under the insert/update policies. Live rolled-back run: number -5 gave doc_number `SUP-000-5`, and number 0 gave `SUP-00000` (local run). After an insert with number 2147483646, the next auto-numbered supplier failed with `22003 integer out of range` (next_doc_number's `next_number + 1` overflows), and every later insert of that doc type fails the same way. A mistyped import number such as 99999999 also permanently jumps the sequence. UPDATEs of `number` are unguarded as well, so an edited number can collide later with the counter (23505 on a future insert).

**Proposed fix:** In the explicit path, reject numbers that are non-positive or unreasonably large (e.g. `if new.number < 1 or new.number > 99999999 then raise exception 'INVALID_DOC_NUMBER'`) and add the code to RAISED_MESSAGES. Optionally add a BEFORE UPDATE guard that keeps `number` immutable, or advances the counter the same way when it changes.

### [LOW] (correctness) stock_adjust compares the unrounded target with the 3-decimal balance, so tiny differences raise INVALID_QUANTITY instead of returning null

**Evidence:** Line 1271 is `if p_new_on_hand = v_current then return null`, and then post_stock_move rounds the difference to 3 decimals and rejects a result of 0. Live rolled-back run: with on_hand 3.000, stock_adjust(3.0004) returned `P0001 INVALID_QUANTITY`. By contrast, 3.0006 would post a +0.001 move.

**Proposed fix:** Round the target first: `p_new_on_hand := round(p_new_on_hand, 3);` before the comparison, or compare `round(p_new_on_hand,3) = v_current`.

### [LOW] (correctness) NOT NULL columns with defaults reject the SPA's usual `field.trim() || null` payloads (employees.last_name, inventory_items.uom, inventory_items.cost_price)

**Evidence:** Existing forms send blank optional fields as null (e.g. src/pages/sales/CatalogPage.tsx:47 `sku: form.sku.trim() || null`). A column default applies only when the column is omitted, not when null is sent. Live rolled-back run: `insert into employees (first_name, last_name) values ('RV', null)` failed with 23502 on last_name, and `insert into inventory_items (name, uom) values ('RV-X', null)` failed with 23502 on uom. cost_price is also `not null default 0` and fails the same way.

**Proposed fix:** Make last_name nullable (it is not required by the spec), or have the UI builders omit these keys rather than send null. Alternatively, add a BEFORE INSERT/UPDATE trigger that replaces nulls with the defaults (`new.uom := coalesce(new.uom, 'unit')`, `new.cost_price := coalesce(new.cost_price, 0)`). State whichever rule you pick in the module specs.

### [LOW] (correctness) The stock.below_reorder event is not deduplicated, although the low-stock notification is deduplicated per item per day

**Evidence:** The notify call (line 1142) passes a per-day dedupe key, but the emit_event call (lines 1143-1148) passes none. Live rolled-back run: an item with reorder_point 5 crossed below it 3 times in one transaction. That produced 3 `stock.below_reorder` domain_events but only 2 notifications, one each for the owner and the manager. The platform cluster will run automation rules on each event, e.g. 'create purchase request on low stock', so an item hovering around its reorder point triggers duplicate actions in the same day.

**Proposed fix:** Pass the same key to emit_event: `p_dedupe_key => 'stock.below_reorder:' || p_item::text || ':' || current_date::text`. If per-crossing events are intended, document that consumers must deduplicate.

### [LOW] (correctness) Low-stock alerts fire only when stock crosses the reorder point, so items that start at or below it, or whose reorder_point is raised above on_hand, never alert

**Evidence:** The condition at lines 1128-1131 requires `v_total_before > reorder_point`. Live rolled-back run: a new item with reorder_point 10 received 5 and was then issued 4, leaving on_hand 1. That produced 0 notifications and 0 events. No scan_due_* scanner covers inventory, so these items stay silent until they first go above the reorder point and drop back below it.

**Proposed fix:** Add an `app.scan_due_inventory(p_tenant)` scanner that notifies for items whose total on hand is <= reorder_point, using the same per-day dedupe key. Alternatively, also alert on moves where `v_total_after <= reorder_point` and no alert was sent today (the dedupe key already prevents spam).

### [MEDIUM] (prodsafety) Creating the storage.objects policies takes AccessExclusive locks on every auth.* and storage.* table while the migration already holds exclusive locks on vehicles, drivers and document_sequences

**Evidence:** I isolated this with a rolled-back bisect on the live project, running as postgres. `create table public._rv_probe` took no auth or storage locks, and neither did `insert into storage.buckets …`. `create policy rv_probe_policy on storage.objects …` took AccessExclusiveLock on 19 relations, held until commit: auth.users, auth.sessions, auth.refresh_tokens, auth.identities, auth.one_time_tokens, auth.flow_state, auth.mfa_factors, auth.mfa_challenges, auth.mfa_amr_claims, auth.audit_log_entries, auth.instances, auth.oauth_clients, auth.saml_providers, auth.saml_relay_states, auth.sso_providers, auth.sso_domains, storage.buckets, storage.buckets_analytics and storage.objects. storage.objects is owned by supabase_storage_admin and postgres is not a member of that role, so the grant appears to go through supautils. In the full live dry-run (migration + checks, rolled back), the transaction ended up holding those 19 locks plus AccessExclusive on public.vehicles, public.drivers and public.document_sequences, and ShareRowExclusive on tenants, profiles, products and sl_technicians. The migration itself took 151 ms. The storage policies are at lines 888-910. The vehicles/drivers ALTERs (502-507) and the document_sequences ALTER (124-130) run earlier, so while the migration waits for the auth locks (lock_timeout 3s per lock), every fleet read on vehicles or drivers is blocked, including the /api/verify certificate lookup, which embeds vehicles. All new sign-ins and token refreshes for every tenant also queue behind the pending lock. Every dry-run that includes this file (all cluster dry-runs will prepend the foundation) holds these auth locks for the whole test run, not just the 151 ms.

**Proposed fix:** Move `insert into storage.buckets` and the four `documents_objects_*` policies out of the foundation into a separate small migration. Apply it on its own at a quiet time, with a short `set local lock_timeout = '1s'`, and retry if it times out. Cluster dry-runs should not include it. In the foundation, also move the document_sequences, vehicles and drivers ALTERs to the end of the file so their exclusive locks are held for milliseconds, not for the whole migration.

### [MEDIUM] (prodsafety) A client-supplied explicit `number` advances the shared counter: one manager insert can permanently break SUP/EMP numbering (integer overflow)

**Evidence:** In `app.assign_doc_number` (lines 150-156), an explicit `new.number` is written back as `next_number = greatest(ds.next_number, v_n + 1)`. The `number` column is client-writable through RLS for any manager. Live rolled-back run, as the demo manager with the suppliers module on: `insert into suppliers (name, number) values ('rv explicit', 2147483646)` succeeded and returned SUP-2147483646. The next plain `insert into suppliers (name)` then failed with `22003 integer out of range` from `SQL function next_doc_number`. `insert into employees (first_name, number) values ('rv', 2147483647)` also failed with 22003. On the local harness, document_sequences was left at next_number=2147483647, so every later supplier insert for that tenant fails. Clients cannot write document_sequences, and set_document_prefix does not reset next_number, so only an operator can recover it with SQL. The existing sales trigger (`app.next_sales_doc_number`) keeps an explicit number without touching the counter, so this is a new failure mode. Zero or negative explicit numbers also produce malformed doc numbers (`lpad('-5',5,'0')` gives 'SUP-000-5').

**Proposed fix:** Honour an explicit number (and move the counter) only for privileged callers, using the same `current_user not in ('authenticated','anon')` test as guard_item_cost. For client roles, ignore the supplied number/doc_number and allocate a new one. Alternatively, validate `new.number between 1 and <sane cap>` and raise a SCREAMING_SNAKE code (e.g. INVALID_DOC_NUMBER) before touching document_sequences.

### [MEDIUM] (prodsafety) api_keys audit, updated_at and stamp_actor triggers fire on every per-request last_used_at bump, so each /api/v1 call writes an audit_events row

**Evidence:** worker/apiKey.ts:96 runs `admin.from("api_keys").update({ last_used_at })` as the service role on every authenticated /api/v1 request, and positions/IoT ingestion is the high-volume path. The migration adds `api_keys_audit` (AFTER I/U/D → app.log_audit) plus `api_keys_updated_at` and `api_keys_stamp_actor` (lines 706-740). Live rolled-back run: create_api_key as the demo owner, then 3× `update public.api_keys set last_used_at = clock_timestamp()` as service_role. Result: 4 audit_events rows for the key (1 insert + 3 updates), with the latest diff = {last_used_at}. stamp_actor also rewrites updated_by to NULL (no JWT) and set_updated_at bumps updated_at on every call, so the admin rename/revoke provenance is lost. audit_events has no retention, so it grows by one row per API request, which is the kind of high-volume log FOUNDATION §1 says must stay out of the audit log.

**Proposed fix:** Scope the api_keys triggers to meaningful columns, e.g. `create trigger api_keys_audit after insert or delete or update of name, scopes, active, expires_at, revoked_at on public.api_keys …`. Use the same `update of` list for api_keys_updated_at and api_keys_stamp_actor (stamp_actor also on insert). Optionally, in worker/apiKey.ts, bump last_used_at only when it is older than a few minutes.

### [LOW] (prodsafety) refresh_notifications does not isolate scanner timeouts: one slow scanner aborts the whole call, loses the throttle claim, and every bell mount re-runs all scanners

**Evidence:** The per-scanner handler is `exception when others` (line 1400), and OTHERS does not match QUERY_CANCELED. On the local harness (base_foundation), I added `app.scan_due_slow` (pg_sleep 2) and `app.scan_due_zz_other` and set statement_timeout to 1s. `select public.refresh_notifications()` then failed with 57014 raised inside app.scan_due_slow. notification_state had 0 rows afterwards, because the claim was rolled back, and scan_due_zz_other never ran. The live `authenticated` role has statement_timeout=8s. Once any cluster's scanner gets slow for a large tenant, each user's bell mount re-runs every scanner until the timeout, with no throttle, which is load amplification on production. I confirmed that trapping it by name works: `exception when query_canceled` caught the timeout and execution continued.

**Proposed fix:** In the scanner loop, add `when query_canceled then raise warning …; exit;` before `when others`. That stops scanning but keeps the committed-with-the-call claim, and the partial count is recorded. Also document a per-scanner time budget for cluster authors.

### [LOW] (prodsafety) New FK pairs make PostgREST embeds ambiguous: employees↔branches and employees↔departments

**Evidence:** Live rolled-back catalog query after the migration found two FKs for each pair: branches↔employees (branches_manager_employee_id_fkey, employees_branch_id_fkey) and departments↔employees (departments_manager_employee_id_fkey, employees_department_id_fkey). Under PostgREST's disambiguation rules, `employees?select=*,branches(*)` or `departments(*)` returns PGRST201, and after type regeneration the postgrest-js typed `.select()` gives a SelectQueryError type. The UI builders for employees, people and workshop will run into this. Existing embeds, including worker/verify.ts, only use pre-existing pairs and are not affected.

**Proposed fix:** Document the required FK hints in FOUNDATION §2 or docs/MODULES.md, e.g. `branches!employees_branch_id_fkey(name)`, `departments!employees_department_id_fkey(name)`, and `manager:employees!branches_manager_employee_id_fkey(...)`, so cluster UIs compile and work on the first attempt.

### [LOW] (prodsafety) Undeclared deviations from the §1/§2 table template (actor/updated columns and triggers)

**Evidence:** FOUNDATION §2 says the master-data tables, stock_moves included, 'all get stamp_actor + updated_at', and the §1 template gives every module table created_by/updated_by/created_at/updated_at. stock_moves (lines 528-547) has only `created_by default auth.uid()` and created_at: no updated_by/updated_at columns and no stamp_actor/updated_at triggers (it is not in the loop at 709-711). notifications, notification_preferences, notification_state and domain_events have no created_by/updated_by. notification_preferences, which users write themselves, has no stamp_actor, and notifications has no updated_at even though read_at is client-updatable. These choices are defensible for append-only or system tables, but they are not in the writer's deviation list, and later clusters copying the foundation will treat them as the pattern.

**Proposed fix:** Either add them to the declared deviations (append-only ledger and system tables: no updated_* columns and no stamp_actor) or add the columns and triggers so they match the template.

## Writer's original report

All 78 tests pass on the live project (`ugfdexoaxladblafcrlc`) in one `begin … rollback` run, and nothing was left behind. I checked afterwards: no new tables, bucket, storage policies or `app` functions, the `document_sequences` check is unchanged, and there is no `dryrun` tenant and no new demo `tenant_modules` rows. The last row of the run is the md5 of the script the server received, `64f01726361d56002708d7ba041bc3c7`, which matches the file on disk. `apply_migration` was not used, and the migration file is not committed yet.

## Files
- `supabase/migrations/20260924000001_platform_foundation.sql` — the migration.
- `docs/buildout/tests/foundation_test.sql` — `begin;` + migration + tests + `rollback;`, the exact script that was run.
- `docs/buildout/tests/foundation_tests_body.sql` — the tests on their own, for rebuilding the script after migration edits.
- Local test harness in `/var/tmp/fz_pg`: Postgres 16 on socket `/var/tmp/fz_pg`, port 55432, still running. It stubs Supabase's `auth`, `storage` and `extensions` schemas. Template databases: `base` (existing migrations + demo seed) and `base_foundation` (same plus this migration). `run_on.sh <template> <file>` runs a script against a fresh copy. It is for quick syntax checks only, not a replacement for the real dry-run.

## Objects created
**Helpers**
- `app.module_enabled(text)` and `app.tenant_module_enabled(uuid,text)`: stable, security definer, granted to authenticated and service_role.
- `app.require_module(p_module, p_level default 'manager') returns uuid` — new. Raises `NO_TENANT` / `FORBIDDEN` / `MODULE_DISABLED` and returns the tenant id.
- `document_sequences`: doc_type check relaxed to a format check; new `prefix` column.
- `app.assign_doc_number()` trigger function; `public.set_document_prefix(doc_type, prefix)` admin RPC (new).
- `app.ensure_single_default()`, `app.guard_item_cost()`, `app.api_scopes()`.

**Tables** (RLS on every one, every FK column indexed)
- Master data: `companies`, `branches`, `departments`, `employees`, `suppliers`, `supplier_contacts`, `warehouses`, `inventory_items`.
- Ledger: `stock_levels`, `stock_moves`.
- Platform: `notifications`, `notification_preferences`, `notification_state`, `domain_events`, `documents`, `api_keys`.
- Existing tables: `vehicles.branch_id` and `drivers.branch_id` (nullable FK, set null, indexed).
- Numbering: suppliers `SUP`, employees `EMP`.
- `set_updated_at` + `stamp_actor` on the master data tables, `documents`, `api_keys` and `stock_levels`.
- `log_audit` on master data, `documents` and `api_keys`.

**Stock ledger:** `app.post_stock_move` (internal) and public RPCs `stock_receive`, `stock_issue`, `stock_transfer`, `stock_adjust`.

**Storage:** private bucket `documents` (25 MB limit) and policies `documents_objects_{select,insert,update,delete}`.

**Platform functions:** `public.create_api_key`, `public.revoke_api_key`, `public.refresh_notifications`, `app.notify`, `app.emit_event`.

**Signatures other clusters must match exactly:**
- `app.notify(p_tenant uuid, p_audience text, p_kind text, p_severity text, p_entity_type text, p_entity_id uuid, p_link text, p_params jsonb, p_title text, p_body text, p_dedupe_key text, p_recipient uuid default null) returns integer` (rows inserted).
- `app.emit_event(p_tenant uuid, p_event text, p_entity_type text, p_entity_id uuid, p_payload jsonb, p_dedupe_key text default null) returns bigint` (event id, or null if skipped). The platform cluster's `create or replace` must keep this return type and these defaults.
- `app.post_stock_move(p_tenant, p_item, p_warehouse, p_type, p_qty_signed, p_unit_cost, p_ref_type, p_ref_id, p_notes) returns uuid`.
- `app.notify`, `app.emit_event` and `app.post_stock_move` are revoked from authenticated, so any trigger that calls them must be SECURITY DEFINER.

**New error codes for `RAISED_MESSAGES`:** `NO_TENANT`, `MODULE_DISABLED`, `INVALID_DOC_TYPE`, `INVALID_DOC_PREFIX`, `INVALID_STOCK_MOVE_TYPE`, `INVALID_QUANTITY`, `INVALID_UNIT_COST`, `INVENTORY_ITEM_NOT_FOUND`, `WAREHOUSE_NOT_FOUND`, `INSUFFICIENT_STOCK`, `TRANSFER_SAME_WAREHOUSE`, `INVALID_API_KEY_NAME`, `INVALID_API_SCOPE`, `INVALID_API_KEY_EXPIRY`, `API_KEY_NOT_FOUND`. `INVALID_AUDIENCE` is a developer error only; `FORBIDDEN` already exists.

## Test results (live project, all pass)
| Test | Detail |
|---|---|
| 00a every FK column indexed | all covered |
| 00b RLS on all 16 new tables | ok |
| 00c function grants | module_enabled: authenticated yes, anon no; notify/emit/post_stock_move: authenticated no; RPCs: anon no |
| 00d bucket private, 25 MB | ok |
| 00e doc_type format check + prefix column | ok |
| 00f no scanners exist yet | ok |
| 01a/b inventory off: owner sees 0 items, insert denied | 42501 |
| 01c inventory on: owner sees and inserts | ok |
| 02a viewer cannot insert suppliers | 42501 |
| 02b numbering | SUP-00001, SUP-00002 |
| 02c manager cannot set prefix | FORBIDDEN |
| 02d prefix override | VEN-00003 |
| 02e prefix validation | INVALID_DOC_PREFIX / INVALID_DOC_TYPE |
| 02f explicit number kept, counter advanced | VEN-00010, VEN-00011 |
| 02g clearing the prefix | SUP-00012 |
| 02h one primary contact per supplier | 23505 |
| 02i viewer reads suppliers | 6 |
| 02x-a employee numbering | EMP-00001/2 |
| 02x-b employees.user_id unique | 23505 |
| 02x-c department code unique, case-insensitive | 23505 |
| 02x-d one default company | 1 |
| 02x-e vehicles.branch_id settable | 1 row |
| 02x-f company with branches cannot be deleted | 23503 |
| 02x-g/h/i employee visibility | viewer 0 / linked user 1 / manager 2 |
| 03a one default warehouse | 1 |
| 03b 10@5 + 10@7 | on_hand 20, cost 6 |
| 03c issue 25 | INSUFFICIENT_STOCK, level unchanged |
| 03d transfer 5 | 15 / 5, two moves |
| 03e no alert above reorder point | 0 |
| 03f adjust to 3 | level 3, adjustment move −12 |
| 03g/i low-stock notification | reaches owner + manager |
| 03h stock.below_reorder event | 1 |
| 03j manager cannot read domain_events | 0 |
| 03k client cannot overwrite cost_price | stays 6 |
| 03l adjust to same value | null, no move |
| 03m input validation | INVALID_QUANTITY / TRANSFER_SAME_WAREHOUSE |
| 03n issue records average cost + reference | unit_cost 6 |
| 03o ledger | exactly 6 moves |
| 03p viewer | RPC FORBIDDEN, ledger readable |
| 04 direct insert/update/delete on stock_moves/stock_levels | all 42501 |
| 05a managers audience | owner + manager only |
| 05b dedupe | 0 new rows |
| 05c admins audience | owner only |
| 05d muted kind skipped | 1 |
| 05e/f explicit recipient; recipient outside tenant | 1 / 0 |
| 05g invalid audience | INVALID_AUDIENCE |
| 05h user sees only own notifications | 3 |
| 05i can set read_at, cannot change title | 42501 on title |
| 05j others' rows / insert | 0 rows / 42501 |
| 05k delete own | 1 |
| 05l title untouched | Hello |
| 06a manager cannot create a key | FORBIDDEN |
| 06b key format | fm_ + 48 hex |
| 06c storage | only sha256 + prefix stored, key not in audit log |
| 06d validation, key_hash immutable | INVALID_API_SCOPE / INVALID_API_KEY_EXPIRY / 42501 |
| 06e/f rename + revoke; unknown id | ok / API_KEY_NOT_FOUND |
| 06g manager cannot read api_keys | 0 |
| 06h integrations off | MODULE_DISABLED |
| 07a no scanners | 0, state recorded |
| 07b throttled | 0 |
| 07c non-admin force ignored | 0 |
| 07d admin force | 2; broken and wrong-signature scanners isolated |
| 07e stale rescan, dedupe holds | 0 |
| 07f notifications off | 0 |
| 08a foreign item/warehouse in stock RPCs | rejected, W1 unchanged |
| 08b other tenant invisible, foreign tenant_id insert denied | 0 / 42501 |
| 08c notify/emit when modules off | no-op |
| 09a document path must start with own tenant id | 23514 |
| 09b storage writes | own folder only (foreign 42501); viewer can read, cannot write |
| 09c documents module off | files and rows hidden |
| 10a emit_event dedupe | ok |
| 10b viewer cannot read domain_events | 0 |

## Deviations from FOUNDATION.md
1. **Employee visibility:** managers see all employees; other users see only their own row (`user_id = auth.uid()`). The spec says all members read, but the table holds salary, IBAN and national id.
2. **`app.tenant_module_enabled` is granted to authenticated.** Invoker triggers on existing tables (§0.2) call it; without the grant their exception block would silently skip them.
3. **Additions not in the spec:**
   - `app.require_module`, `set_document_prefix` and an extensible `app.api_scopes()`.
   - Setting `is_default` on a company or warehouse automatically clears the previous default.
   - Client updates cannot change `cost_price`; the value is silently kept.
   - New columns: `stock_moves.on_hand_after`, `api_keys.revoked_at`, `domain_events.actor`, `notification_state.last_scan_count`.
4. **Numbering:**
   - An explicitly supplied number is kept and the counter moves past it.
   - Numbers of 100000 and above are not truncated. `lpad(…,5)` truncates them, which is also a bug in the existing sales and certificate numbering.
5. **Nullable columns:** `branches.company_id` and `inventory_items.sku` (unique when set).
6. **Stock rules:**
   - The low-stock alert fires when the item's total across warehouses drops to or below `reorder_point`. Transfers never alert, and the alert is deduplicated per item per day.
   - Its link is `/inventory?item=<id>`.
   - `track_stock=false` items can go negative.
   - `return` moves accept either sign.
   - Quantities are rounded to 3 decimals, costs to 4.
7. **API keys:** no insert policy (the RPC is the only way in). Admins can update only `name` and can delete; revocation is permanent.
8. **Return values:** `stock_transfer` returns the shared reference id (`reference_type='stock_transfer'`); `stock_adjust` returns null when nothing changed.

## Open questions
- **Cross-tenant FK references:** foreign keys don't check that the referenced row is in the same tenant (e.g. `vehicles.branch_id`, `supplier_contacts.supplier_id`). The existing tables have the same gap; the stock RPCs do check. Should we add composite FKs or a validation trigger?
- **Retention:** `notifications` and `domain_events` have no cleanup.
- **Realtime:** `notifications` is not in the realtime publication, so the bell would have to poll.
- **Applying for real** still needs `apply_migration`, regenerating `database.types.ts` and running the security advisors; none of that was done.
- **Git:** the migration is an untracked file on branch `claude/upbeat-bell-d7gda4`. I didn't check for open pull requests.
