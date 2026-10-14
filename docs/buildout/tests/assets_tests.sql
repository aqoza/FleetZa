-- Dry-run tests for 20261008000013_assets.sql (PGlite replica:
-- node docs/buildout/pglite/harness.mjs run docs/buildout/tests/assets_tests.sql).
begin;
create temp table _t (name text, ok boolean, detail text);
grant all on _t to authenticated;

insert into public.tenant_modules (tenant_id, module_id, enabled) values
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'notifications', true),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'employees', true),
  ('5eed0000-0000-4000-8000-0000000000b1', 'assets', true)
on conflict (tenant_id, module_id) do update set enabled = true;
insert into public.employees (id, tenant_id, first_name) values
  ('e0000000-0000-4000-8000-000000000001', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Aisha'),
  ('e0000000-0000-4000-8000-0000000000b1', '5eed0000-0000-4000-8000-0000000000b1', 'Foreign');
insert into public.vehicles (id, tenant_id, name) values
  ('a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d01', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Truck 1');

-- Module off
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
do $$ begin
  insert into public.assets (name) values ('Generator');
  insert into _t values ('module off: asset refused', false, null);
exception when others then insert into _t values ('module off: asset refused', sqlstate = '42501', sqlerrm); end $$;
reset role;
insert into public.tenant_modules (tenant_id, module_id, enabled)
values ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'assets', true)
on conflict (tenant_id, module_id) do update set enabled = true;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
create temp table _a as
  with ins as (insert into public.assets (name, category, purchase_date, purchase_cost, useful_life_months, salvage_value, warranty_expiry)
               values ('Diesel generator 20 kVA', 'generator', current_date - 400, 12000, 60, 2000, current_date + 5) returning *)
  select * from ins;
grant select on _a to authenticated;
insert into _t select 'numbered AST + defaults', (select doc_number = 'AST-00001' and status = 'in_service'
  and depreciation_method = 'straight_line' and created_by is not null from _a), (select doc_number from _a);
do $$ begin
  insert into public.assets (name, status) values ('X', 'disposed');
  insert into _t values ('cannot create disposed', false, null);
exception when others then insert into _t values ('cannot create disposed', sqlerrm = 'INVALID_ASSET_STATUS', sqlerrm); end $$;
do $$ begin
  insert into public.assets (name, purchase_cost, salvage_value) values ('X', 100, 200);
  insert into _t values ('salvage above cost refused', false, null);
exception when others then insert into _t values ('salvage above cost refused', sqlstate = '23514', sqlerrm); end $$;
do $$ begin
  update public.assets set status = 'disposed' where id = (select id from _a);
  insert into _t values ('cannot set disposed directly', false, null);
exception when others then insert into _t values ('cannot set disposed directly', sqlerrm = 'INVALID_ASSET_STATUS', sqlerrm); end $$;
do $$ begin
  update public.assets set assigned_employee_id = 'e0000000-0000-4000-8000-000000000001' where id = (select id from _a);
  insert into _t values ('assignment not client-writable', false, null);
exception when others then insert into _t values ('assignment not client-writable', sqlstate = '42501', sqlerrm); end $$;
do $$ begin
  insert into public.asset_events (asset_id, event_type) values ((select id from _a), 'assigned');
  insert into _t values ('client cannot log flow event', false, null);
exception when others then insert into _t values ('client cannot log flow event', sqlerrm = 'FORBIDDEN', sqlerrm); end $$;
insert into public.asset_events (asset_id, event_type, detail, cost) values ((select id from _a), 'serviced', 'Oil change', 45);
insert into _t select 'manual event logged', (select count(*) = 1 from public.asset_events where event_type = 'serviced'), null;

-- Assign / return
do $$ begin
  perform public.asset_assign((select id from _a));
  insert into _t values ('assign needs an assignee', false, null);
exception when others then insert into _t values ('assign needs an assignee', sqlerrm = 'ASSET_ASSIGNEE_REQUIRED', sqlerrm); end $$;
do $$ begin
  perform public.asset_assign((select id from _a), 'e0000000-0000-4000-8000-0000000000b1');
  insert into _t values ('assign foreign employee refused', false, null);
exception when others then insert into _t values ('assign foreign employee refused', sqlerrm like 'CROSS_TENANT_REFERENCE%', sqlerrm); end $$;
select public.asset_assign((select id from _a), 'e0000000-0000-4000-8000-000000000001', 'a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d01', 'Site B', 'For the night shift');
insert into _t select 'assigned', (select assigned_employee_id is not null and assigned_vehicle_id is not null and assigned_at is not null
  and location = 'Site B' from public.assets where id = (select id from _a)), null;
insert into _t select 'assign event', (select count(*) = 1 from public.asset_events where event_type = 'assigned'
  and employee_id = 'e0000000-0000-4000-8000-000000000001' and detail = 'For the night shift'), null;
select public.asset_return((select id from _a), null, 'Main yard', null);
insert into _t select 'returned to storage', (select assigned_employee_id is null and assigned_vehicle_id is null and status = 'in_storage'
  and location = 'Main yard' from public.assets where id = (select id from _a)), null;
insert into _t select 'return event keeps who had it', (select count(*) = 1 from public.asset_events where event_type = 'returned'
  and employee_id = 'e0000000-0000-4000-8000-000000000001'), null;
do $$ begin
  perform public.asset_return((select id from _a));
  insert into _t values ('return unassigned refused', false, null);
exception when others then insert into _t values ('return unassigned refused', sqlerrm = 'ASSET_NOT_ASSIGNED', sqlerrm); end $$;
reset role;

-- Viewer: reads, cannot act
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"5eed0000-0000-4000-8000-00000000a003","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"viewer"}}', true);
insert into _t select 'viewer reads assets', (select count(*) = 1 from public.assets), null;
do $$ begin
  perform public.asset_assign((select id from _a), 'e0000000-0000-4000-8000-000000000001');
  insert into _t values ('viewer cannot assign', false, null);
exception when others then insert into _t values ('viewer cannot assign', sqlerrm = 'FORBIDDEN', sqlerrm); end $$;
do $$ begin
  update public.assets set name = 'hacked' where id = (select id from _a);
  insert into _t values ('viewer update is a no-op', (select name from public.assets where id = (select id from _a)) <> 'hacked', null);
exception when others then insert into _t values ('viewer update is a no-op', true, sqlerrm); end $$;
reset role;

-- Warranty scanner
select app.scan_due_assets('170d2d86-5c22-4bcb-9d74-420c879419b2');
select app.scan_due_assets('170d2d86-5c22-4bcb-9d74-420c879419b2');
insert into _t select 'warranty notified once per stage', (select count(distinct dedupe_key) = 1 and count(*) >= 1 from public.notifications
  where kind = 'assets.warranty_expiring' and params->>'stage' = 'd7'), null;

-- Dispose
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
select public.asset_assign((select id from _a), 'e0000000-0000-4000-8000-000000000001');
select public.asset_dispose((select id from _a), current_date, 3500, 'Sold to scrap dealer');
insert into _t select 'disposed', (select status = 'disposed' and disposed_at = current_date and disposal_value = 3500
  and assigned_employee_id is null from public.assets where id = (select id from _a)), null;
insert into _t select 'dispose event', (select count(*) = 1 from public.asset_events where event_type = 'disposed' and cost = 3500), null;
do $$ begin
  update public.assets set name = 'Renamed' where id = (select id from _a);
  insert into _t values ('disposed asset is read-only', false, null);
exception when others then insert into _t values ('disposed asset is read-only', sqlerrm = 'ASSET_DISPOSED', sqlerrm); end $$;
do $$ begin
  insert into public.asset_events (asset_id, event_type) values ((select id from _a), 'note');
  insert into _t values ('disposed asset events frozen', false, null);
exception when others then insert into _t values ('disposed asset events frozen', sqlerrm = 'ASSET_DISPOSED', sqlerrm); end $$;
do $$ begin
  perform public.asset_assign((select id from _a), 'e0000000-0000-4000-8000-000000000001');
  insert into _t values ('cannot assign disposed', false, null);
exception when others then insert into _t values ('cannot assign disposed', sqlerrm = 'ASSET_DISPOSED', sqlerrm); end $$;
reset role;
delete from public.notifications where kind = 'assets.warranty_expiring';
insert into _t select 'scanner skips disposed', app.scan_due_assets('170d2d86-5c22-4bcb-9d74-420c879419b2') = 0, null;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
delete from public.assets where id = (select id from _a);
insert into _t select 'disposed asset can be deleted with its events', (select count(*) = 0 from public.asset_events), null;
reset role;

-- Other tenant
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"5eed0000-0000-4000-8000-00000000b001","role":"authenticated","app_metadata":{"tenant_id":"5eed0000-0000-4000-8000-0000000000b1","role":"owner"}}', true);
insert into _t select 'cross-tenant isolation', (select count(*) = 0 from public.assets), null;
reset role;

-- @print
select name, ok, detail from _t order by ok, name;
rollback;
