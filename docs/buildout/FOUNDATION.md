# Module build-out — shared contract (READ FULLY before writing SQL or UI)

Goal: every `coming_soon` module in `shared/modules.ts` becomes a real, working module,
plus two new master-data modules (`suppliers`, `employees`). This file is the contract
all builders share. Repo conventions in CLAUDE.md / docs/MODULES.md / docs/SALES.md /
docs/DESIGN_SYSTEM.md / docs/I18N.md still apply — this file adds to them.

Supabase project: `ugfdexoaxladblafcrlc` (PRODUCTION — a real customer tenant lives here).

## 0. Production-safety rules (non-negotiable)

1. **Additive only.** New tables, new columns (nullable or with defaults), new functions,
   new triggers. Never drop/rename/retype existing objects; never rewrite existing
   functions' behavior for tenants that have not enabled the new module.
2. **Triggers on EXISTING tables** (vehicles, issues, work_orders, invoices, …) must be
   (a) AFTER triggers unless there is no alternative, (b) a no-op unless
   `app.tenant_module_enabled(new.tenant_id, '<module>')`, and (c) wrapped in
   `begin … exception when others then raise warning …; end` so a bug can never
   break an existing write path in production.
3. **Every migration/dry-run starts with** `set local lock_timeout = '3s'; set local statement_timeout = '60s';`
   (in the migration file too — harmless under apply_migration).
4. **Dry-run protocol.** Test SQL with the Supabase MCP `execute_sql` wrapped in
   `begin; … rollback;` — never `apply_migration` unless you are explicitly told to.
   Only the LAST statement's result set is returned, so gather assertions into a temp
   table (`create temp table _t on commit drop as …`) or use a final `select`; or raise
   an exception with the assertion results as the message. Never leave data behind.
5. **Impersonation for tests** (demo tenant ONLY — never touch any other tenant's rows):
   ```sql
   set local role authenticated;
   select set_config('request.jwt.claims',
     '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated",
       "app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
   ```
   Demo tenant "Acme Logistics" `170d2d86-5c22-4bcb-9d74-420c879419b2` (US, USD,
   archetype service_provider). Owner user `129bbbae-fdfc-4d21-8a86-8949fec2403b`
   (demo@fleetmanage.test), manager `950e38aa-2bd7-4c55-9dfc-9b4255316548`.
   For a viewer test use role "viewer" in app_metadata. To test module gating, insert
   `tenant_modules` rows for the demo tenant inside the rolled-back transaction
   (as postgres, before `set local role`), e.g.
   `insert into public.tenant_modules (tenant_id, module_id, enabled) values ('170d…','inventory', true) on conflict do nothing;`
   (check the PK/unique first — `(tenant_id, module_id)`).
6. Never call `/api/verify` code paths or change certificate tables' behavior.

## 1. New-table template (all module tables)

```sql
create table public.<t> (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  …,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- index EVERY foreign key column (advisor rule), plus (tenant_id, <list sort>) for lists
```
- Money `numeric(14,4)` for unit prices, `numeric(14,2)` or document-scale for totals
  (follow docs/SALES.md for documents: totals computed server-side by triggers, rounded
  with the tenant's `currency_decimals`; snapshot `currency`/`currency_decimals` on the doc).
- Distances km, volumes liters, weights kg, durations minutes/hours numeric. Timestamps timestamptz, business dates `date`.
- Enums as `text` + `check (x in (…))`.
- Cross-row references FK with explicit `on delete` (restrict for issued documents, set null for optional links, cascade only for owned children such as lines).
- Triggers: `<t>_updated_at` → `app.set_updated_at()`; `<t>_stamp_actor` → `app.stamp_actor()` (BEFORE INSERT OR UPDATE); `<t>_audit` → `app.log_audit()` (AFTER I/U/D) for master data and documents (not for high-volume logs: positions, readings, events, stock moves, notifications).

### RLS — module-gated loop (NEW standard, replaces the plain loop for new tables)
```sql
do $$
declare t text;
begin
  foreach t in array array['<t1>','<t2>'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I_select on public.%I for select to authenticated
       using (tenant_id = (select app.tenant_id()) and (select app.module_enabled(%L)))', t, t, '<module>');
    execute format('create policy %I_insert on public.%I for insert to authenticated
       with check (tenant_id = (select app.tenant_id()) and (select app.is_manager()) and (select app.module_enabled(%L)))', t, t, '<module>');
    execute format('create policy %I_update on public.%I for update to authenticated
       using (tenant_id = (select app.tenant_id()) and (select app.is_manager()) and (select app.module_enabled(%L)))
       with check (tenant_id = (select app.tenant_id()) and (select app.is_manager()) and (select app.module_enabled(%L)))', t, t, '<module>', '<module>');
    execute format('create policy %I_delete on public.%I for delete to authenticated
       using (tenant_id = (select app.tenant_id()) and (select app.is_manager()) and (select app.module_enabled(%L)))', t, t, '<module>');
  end loop;
end $$;
```
Variations: admin-only writes → `app.is_admin()`; server-maintained tables (ledgers,
computed summaries, logs) → select policy only, writes via SECURITY DEFINER functions;
append-only tables → no update/delete policy. Tables with per-user rows (notifications)
→ `recipient_id = (select auth.uid())`.

### SECURITY DEFINER functions
`set search_path = ''`, fully qualified names, **re-assert** tenant + role + module
inside (`app.tenant_id()`, `app.is_manager()`, `app.module_enabled()`), raise
SCREAMING_SNAKE codes. `revoke execute … from public, anon;` (and from authenticated
for internal `app.*` helpers). Public RPCs callable by the SPA live in `public`, with
`grant execute … to authenticated`. SECURITY INVOKER is preferred where RLS suffices.

### Raised error codes
SCREAMING_SNAKE, module-prefixed where ambiguous (`ILLEGAL_TRIP_TRANSITION`,
`INSUFFICIENT_STOCK`). Each code needs an `errors.*` i18n key + a `RAISED_MESSAGES`
entry in `src/lib/db.ts` (the shell-wiring step adds them — just list them in your spec).
Message format: `raise exception 'CODE' ` or `'CODE: detail'` (wrapDbError matches the prefix).

## 2. Foundation (migration 20260924000001_platform_foundation.sql — applied FIRST)

### Helpers
- `app.module_enabled(p_module text) returns boolean` — STABLE, SECURITY DEFINER:
  `exists (select 1 from public.tenant_modules where tenant_id = app.tenant_id() and module_id = p_module and enabled)`.
  Always call as `(select app.module_enabled('x'))` in policies (initplan caching).
- `app.tenant_module_enabled(p_tenant uuid, p_module text) returns boolean` — same, for triggers/definer code.
- `document_sequences`: doc_type check relaxed to a format check `doc_type ~ '^[a-z][a-z0-9_]{1,40}$'`;
  new nullable `prefix text` column (per-tenant override of a document prefix).
- `app.assign_doc_number()` — generic numbering trigger fn. Usage (note INSERT **or UPDATE OF**):
  `create trigger <t>_number before insert or update of number, doc_number on public.<t> for each row execute function app.assign_doc_number('<doc_type>', '<DEFAULT_PREFIX>');`
  Requires columns `number integer` and `doc_number text` on the table.
  `doc_number = coalesce(ds.prefix, TG_ARGV[1]) || '-' || lpad(n, 5, '0')`.
  Add BOTH `create unique index <t>_tenant_number_uk on public.<t>(tenant_id, number);` and
  `create unique index <t>_tenant_doc_number_uk on public.<t>(tenant_id, doc_number);`
  Client writes (SET ROLE authenticated/anon — every PostgREST call, incl. definer RPCs the SPA
  invokes) NEVER choose numbers: supplied number/doc_number are replaced on INSERT and kept
  unchanged on UPDATE. Only trusted sessions (service_role, direct SQL) may import an explicit
  number in 1..99,999,999 (else `INVALID_DOC_NUMBER`); the counter is advanced past it.
- `app.notify(p_tenant uuid, p_audience text, p_kind text, p_severity text, p_entity_type text, p_entity_id uuid, p_link text, p_params jsonb, p_title text, p_body text, p_dedupe_key text, p_recipient uuid default null)`
  SECURITY DEFINER. No-op unless tenant has `notifications` enabled. Fans out one row per
  recipient: `p_recipient` if given, else by audience `'managers'` (owner/admin/manager),
  `'admins'` (owner/admin), `'all'` (every profile in tenant). Skips users who muted the
  kind. Dedupe: `(tenant_id, recipient_id, dedupe_key)` unique when dedupe_key not null
  (`on conflict do nothing`). `p_kind` like `'insurance.policy_expiring'`; `p_title`/`p_body`
  are English fallbacks; the SPA localizes by kind + params.
- `app.emit_event(p_tenant uuid, p_event text, p_entity_type text, p_entity_id uuid, p_payload jsonb)`
  SECURITY DEFINER. Foundation version: inserts into `domain_events` only if the tenant
  has `workflow_automation` or `integrations` enabled; otherwise no-op. The platform
  cluster REPLACES it (create or replace) to also evaluate automation rules and enqueue
  webhook deliveries. Other clusters just `perform app.emit_event(...)` from their own
  triggers for their notable events (names `<entity>.<verb>`, e.g. `trip.completed`).

### Master data tables (all get stamp_actor + updated_at; audit on all except stock_moves/stock_levels)
| Table | Owning module (RLS gate) | Key columns |
|---|---|---|
| `suppliers` | suppliers | number/doc_number (`SUP`), name, name_ar, supplier_type (`parts,fuel,service,insurance,carrier,leasing,utilities,equipment,other`), cr_number, tax_number, email, phone, website, address, city, country, payment_terms_days int, currency, bank_name, iban, rating smallint 1–5, status (`active,inactive,blocked`), notes |
| `supplier_contacts` | suppliers | supplier_id (cascade), name, title, email, phone, is_primary (partial unique one primary per supplier) |
| `departments` | employees | name, name_ar, code, parent_id self-FK, manager_employee_id (FK employees, set null) |
| `employees` | employees | number/doc_number (`EMP`), first_name, last_name, name_ar, job_title, department_id, branch_id, manager_id self-FK, employment_type (`full_time,part_time,contract,temporary,intern`), status (`active,on_leave,suspended,terminated`), hire_date, termination_date, birth_date, gender (`male,female`), nationality (ISO-2), national_id, passport_number, passport_expiry, residence_permit_number, residence_permit_expiry, work_permit_expiry, email, phone, address, emergency_contact_name, emergency_contact_phone, user_id (auth user/profile id, unique per tenant, nullable), driver_id (FK drivers, set null, unique per tenant), sl_technician_id (FK sl_technicians, set null), basic_salary numeric(14,2), housing_allowance, transport_allowance, other_allowance, hourly_rate numeric(14,4), bank_name, iban, social_insurance_number, notes |
| `companies` | multi_company | legal_name, trade_name, name_ar, cr_number, tax_number, email, phone, address, city, country, currency, is_default (partial unique one default per tenant), active |
| `branches` | multi_company | company_id (restrict), code, name, name_ar, address, city, country, phone, manager_employee_id (FK employees set null), active |
| `warehouses` | inventory | code, name, name_ar, branch_id (set null), address, is_default (one per tenant), active |
| `inventory_items` | inventory | sku (unique per tenant, case-insensitive), name, name_ar, description, category, item_type (`part,consumable,fluid,tire,tool,merchandise,other`), uom, barcode, cost_price numeric(14,4) (moving average, server-maintained), sale_price numeric(14,4), product_id (FK products set null — link to the sales catalog), preferred_supplier_id (FK suppliers set null), reorder_point numeric(14,3), reorder_qty numeric(14,3), track_stock bool default true, active |
| `stock_levels` | inventory (select only; server-maintained) | item_id, warehouse_id, on_hand numeric(14,3), unique(item_id, warehouse_id) |
| `stock_moves` | inventory (select only; insert via definer fns only; immutable) | item_id, warehouse_id, move_type (`receipt,issue,transfer_in,transfer_out,adjustment,sale,return,consumption`), quantity numeric(14,3) SIGNED (+in, −out), unit_cost numeric(14,4), reference_type text, reference_id uuid, notes, moved_at timestamptz |

Additive columns on existing tables: `vehicles.branch_id`, `drivers.branch_id`
(FK branches, set null, indexed). No other existing-table changes in the foundation.

### Foundation rules added by the review round (cluster migrations follow them too)
- **Lock layout.** On this project EVERY `CREATE POLICY` (any table, any schema) takes ACCESS
  EXCLUSIVE locks on ~23 auth.*/storage.*/realtime.* tables until commit (blocks sign-ins and
  token refreshes). Nothing else does (tables, triggers, indexes, FKs, grants, bucket inserts
  verified). So: put `alter table … enable row level security` early, but ALL `create policy`
  statements in ONE final block at the very end of the migration, after any ALTER on existing
  tables, preceded by `set local lock_timeout = '1s';`. Dry-runs hold these locks until their
  rollback — keep them short (no `pg_sleep`).
- **Same-tenant FKs.** Every client-writable FK to a tenant-owned parent gets
  `create trigger <t>_same_tenant before insert or update of <fk cols> on public.<t> for each row
  execute function app.assert_same_tenant('<col>', '<parent table>', …);` (pairs; parent must
  have `id` + `tenant_id`). Raises `CROSS_TENANT_REFERENCE: <col>` (also for a non-existent id).
  Not needed for definer-only tables that check the tenant themselves.
- **Stock ledger.** `app.post_stock_move` locks the item `FOR NO KEY UPDATE` (never `FOR UPDATE`
  an inventory_items row in your own RPC before calling it — use `for no key update` too). Callers
  posting several items in one transaction post them in a deterministic order (`order by item_id`).
  `INSUFFICIENT_STOCK` is raised only for outbound moves (inbound moves may reduce a deficit).
  Low stock: any outbound (non-transfer) move leaving the item total ≤ reorder_point, and raising
  reorder_point / re-enabling tracking above the current total, emit `inventory.low_stock`
  (managers) + `stock.below_reorder`, both deduplicated per item per day
  (`<kind>:<item id>:<date>`). `stock_adjust` rounds the target to 3 decimals first.
- **Blank form fields.** `employees.last_name` is nullable; `inventory_items.uom` null/blank →
  `'unit'`, `cost_price` null → 0 (insert) / unchanged (update). Other NOT NULL columns with
  defaults (enums, booleans, `tags`) must be sent with a value or omitted, never `null`.
- **api_keys** `updated_at`/`stamp_actor`/audit triggers fire only on `update of tenant_id, name,
  key_prefix, key_hash, scopes, active, expires_at, revoked_at` — never for `last_used_at`.
- **refresh_notifications**: a scanner cancelled by the statement timeout (or a spent 5 s budget)
  stops the run but keeps the 15-min throttle claim; scanners run in name order and must stay well
  under a second per tenant.
- **PostgREST embeds**: employees↔branches and employees↔departments have two FKs each — always
  name the FK: `branches!employees_branch_id_fkey(name)`, `departments!employees_department_id_fkey(name)`,
  `manager:employees!branches_manager_employee_id_fkey(first_name,last_name)`,
  `manager:employees!departments_manager_employee_id_fkey(first_name,last_name)`,
  `manager:employees!employees_manager_id_fkey(first_name,last_name)`.
- **Declared template deviations** (system / append-only tables): `stock_moves` has created_by +
  created_at only; `notifications`, `notification_state`, `domain_events` have no actor columns or
  audit; `notification_preferences` has no actor columns (its user_id is the writer).

### Stock ledger API (the ONLY way stock changes)
- `app.post_stock_move(p_tenant, p_item, p_warehouse, p_type, p_qty_signed, p_unit_cost, p_ref_type, p_ref_id, p_notes) returns uuid`
  internal (definer, revoked from clients). Inserts the move, upserts `stock_levels`,
  maintains moving-average `inventory_items.cost_price` on positive receipts, raises
  `INSUFFICIENT_STOCK` if on_hand would go negative (except `adjustment`). Emits
  `stock.below_reorder` event + `inventory.low_stock` notification when crossing below reorder_point.
- Public RPCs (security definer, re-assert manager + `inventory` module):
  `stock_receive(item, warehouse, qty, unit_cost, notes)`, `stock_issue(item, warehouse, qty, ref_type, ref_id, notes)`,
  `stock_transfer(item, from_wh, to_wh, qty, notes)`, `stock_adjust(item, warehouse, new_on_hand, notes)`.
  Other clusters (purchasing receipts, workshop parts, POS sales) call `app.post_stock_move` from their own definer RPCs.

### Platform horizontals
| Table | Gate | Notes |
|---|---|---|
| `notifications` | recipient only (`recipient_id = auth.uid()` and tenant) + `notifications` module | kind, severity (`info,warning,critical`), entity_type, entity_id, link (SPA path), params jsonb, title, body, dedupe_key, read_at. Clients may UPDATE only `read_at` (column grant) and DELETE own; inserts via `app.notify` only. Index (recipient_id, read_at, created_at desc). |
| `notification_preferences` | own rows | user_id default auth.uid(), kind, muted bool; unique(tenant, user, kind) |
| `documents` | documents | name, storage_path (unique), mime_type, size_bytes, entity_type (text, e.g. 'vehicle','driver','employee','incident','insurance_policy','contract','supplier','asset'...), entity_id uuid, category (`general,contract,invoice,receipt,photo,license,insurance,permit,report,certificate,other`), description, expires_on date, tags text[]. **Read: members, EXCEPT HR files** — `entity_type = 'employee'` rows are visible to managers + the employee whose `employees.user_id` is the caller; `entity_type like 'hr\_%'` (e.g. `hr_payslip`, `hr_disciplinary`) is manager-only. Attach HR/people files with those entity types. Writes: managers. Storage bucket `documents` (private, 25 MB limit); object path `<tenant_id>/<document uuid>/<filename>`; storage.objects: tenant folder + module; select = manager OR a visible `documents` row with that storage_path (file visibility == row visibility; orphans manager-only); insert/update/delete = manager. |
| `api_keys` | integrations, admin-only (select+write) | name, key_prefix (first 12 chars, shown in UI), key_hash (sha256 hex, unique), scopes text[] (`telematics:write,iot:write,driver_events:write,vehicles:read,deliveries:write`), active, expires_at, last_used_at. `public.create_api_key(p_name, p_scopes text[], p_expires_at)` returns the plaintext key ONCE (`fm_` || encode(extensions.gen_random_bytes(24),'hex')); only the hash is stored. `public.revoke_api_key(p_id)`. |
| `domain_events` | select for admins with integrations or workflow_automation enabled | event, entity_type, entity_id, payload jsonb, occurred_at; bigint identity id; index (tenant_id, occurred_at desc). Writes via app.emit_event only. |

## 3. Module map (registry after this work)

| Module | Category | requires | routes (SPA prefix) | Cluster |
|---|---|---|---|---|
| gps_tracking | fleet_ops | fleet | /gps | telematics |
| driver_behavior | fleet_ops | drivers | /driver-behavior | telematics |
| trip_planning | fleet_ops | fleet | /trips | logistics |
| dispatch | fleet_ops | fleet, drivers | /dispatch | logistics |
| workshop | maintenance | maintenance, employees | /workshop | compliance_workshop |
| predictive_ai | maintenance | maintenance | /predictive | telematics |
| insurance_mgmt | compliance | fleet | /insurance | compliance_workshop |
| incidents | compliance | fleet | /incidents | compliance_workshop |
| regulatory | compliance | fleet | /regulatory | compliance_workshop |
| tms | logistics | fleet, customers | /tms | logistics |
| logistics_delivery | logistics | fleet, drivers | /deliveries | logistics |
| assets | logistics | — | /assets | supply |
| inventory | logistics | — | /inventory | supply (UI) / foundation (tables) |
| purchasing | commerce | suppliers | /purchasing | supply |
| pos | commerce | sales | /pos | commerce_finance |
| crm | commerce | customers | /crm | commerce_finance |
| finance | finance | suppliers | /finance | commerce_finance |
| contracts | finance | customers | /contracts | commerce_finance |
| payroll_hr | people | employees | /hr | people |
| mobile_workforce | people | employees | /field | people |
| **employees** (new) | people | — | /employees | people (UI) / foundation (tables) |
| **suppliers** (new) | customer | — | /suppliers | supply (UI) / foundation (tables) |
| customer_portal | customer | customers | /customer-portal (admin) + public /portal/:token | commerce_finance |
| vendor_portal | customer | purchasing | /vendor-portal (admin) + public /vendor/:token | supply |
| bi_analytics | analytics | reports | /analytics | commerce_finance |
| documents | platform | — | /documents | platform |
| workflow_automation | platform | — | /automation | platform |
| integrations | platform | — | /integrations | platform |
| iot_devices | platform | fleet | /iot | telematics |
| notifications | platform | — | /notifications | platform |
| audit_security | platform | — | /security | platform |
| multi_company | platform | — | /companies | platform |

Public (no-auth) pages follow the `/q/:token` + `worker/quotes.ts` pattern: unguessable
uuid capability token, Worker route using the service-role client, explicit tenant
scoping, whitelisted fields only, drafts/revoked indistinguishable from not-found.
Planned: `/portal/:token` (customer_portal), `/vendor/:token` (vendor_portal),
`/track/:token` (logistics_delivery). API-key ingestion lives under `/api/v1/*`
(worker, sha256 lookup of `api_keys.key_hash`, scope check, `last_used_at` bump,
explicit `tenant_id` on inserts because the service role has no JWT tenant).

## 4. Migration files (one per cluster, applied in this order)
1. `20260924000001_platform_foundation.sql`
2. `20260924000002_platform_modules.sql` (documents/notifications/automation/integrations/audit_security/multi_company extras)
3. `20260924000003_people.sql` (payroll_hr, mobile_workforce)
4. `20260924000004_supply_chain.sql` (purchasing, vendor_portal, assets; inventory extras if any)
5. `20260924000005_telematics.sql` (gps_tracking, driver_behavior, iot_devices, predictive_ai)
6. `20260924000006_logistics.sql` (trip_planning, dispatch, tms, logistics_delivery)
7. `20260924000007_compliance_workshop.sql` (workshop, insurance_mgmt, incidents, regulatory)
8. `20260924000008_commerce.sql` (crm, contracts, customer_portal) — cluster `commerce`
9. `20260924000009_finance.sql` (finance, pos, bi_analytics) — cluster `finance`
(CLUSTERS.md describes these six modules under one heading `commerce_finance`; the work is split in two clusters.)

Cluster migrations may declare FKs, triggers and views ONLY against foundation objects
and pre-existing tables — never against another cluster's tables (clusters are dry-run
independently and may be applied in any order after the foundation). PL/pgSQL function
BODIES may read another cluster's tables (resolved at call time), but guard with
`to_regclass('public.x') is not null` when the call can happen before that cluster exists.

Concept ownership across clusters (do not build a concept owned by another cluster):
- Vendor bills / vendor payments (accounts payable) → supply (purchasing module). Finance
  reads them at runtime to post journals.
- Expenses, chart of accounts, journals → commerce_finance (finance module).
- Driving events → telematics. Incidents may store a free `driving_event_id uuid` with no FK.
- Field tasks → people (mobile_workforce). Dispatch jobs → logistics.
- Insurance claims ↔ incidents → both compliance_workshop (FK allowed, same cluster).
- Service requests from the customer portal → commerce_finance (customer_portal).

## 5. Time-based scans (no cron exists — Pages Functions cannot schedule)

Foundation provides `public.refresh_notifications(p_force boolean default false) returns integer`
(authenticated): throttled per tenant via `notification_state(tenant_id pk, last_scan_at)`
(skips if scanned < 15 min ago unless `p_force` and caller is admin); then runs EVERY
function named `app.scan_due_<suffix>(p_tenant uuid) returns integer` that exists
(discovered via pg_proc, executed dynamically, each wrapped in its own exception block).
The SPA calls it when the bell mounts. So each cluster that has time-based alerts
(expiring policies/permits/contracts/employee documents, overdue bills, due trips…)
ships its own `app.scan_due_<cluster>(p_tenant uuid)` (definer, revoked from clients)
that calls `app.notify(..., p_dedupe_key => '<kind>:<entity id>:<due date>')` and may
`perform app.emit_event(..., p_dedupe_key => …)` for automation triggers. The platform
cluster ships `app.scan_due_core` for pre-existing tables (renewals, driver licenses,
service reminders, certificates, overdue invoices).

`app.emit_event` takes an optional final `p_dedupe_key text default null`;
`domain_events` has a partial unique index `(tenant_id, dedupe_key) where dedupe_key is not null`
(duplicates are silently skipped).
