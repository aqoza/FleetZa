-- Dry-run tests for 20261008000002_inventory_reports.sql (PGlite replica:
-- node docs/buildout/pglite/harness.mjs run docs/buildout/tests/inventory_reports_tests.sql).
begin;
create temp table _t (name text, ok boolean, detail text);
grant all on _t to authenticated;

insert into public.tenant_modules (tenant_id, module_id, enabled) values
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'inventory', true)
on conflict (tenant_id, module_id) do update set enabled = true;

-- Act as the demo owner for the writes (RPCs re-assert manager + module).
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);

insert into public.warehouses (id, name, code, is_default) values
  ('aa000000-0000-4000-8000-000000000001', 'Main', 'MAIN', true),
  ('aa000000-0000-4000-8000-000000000002', 'Van 1', 'VAN1', false);
insert into public.inventory_items (id, sku, name, category, reorder_point, reorder_qty) values
  ('bb000000-0000-4000-8000-000000000001', 'OIL', 'Oil filter', 'Filters', 10, 50),
  ('bb000000-0000-4000-8000-000000000002', 'PAD', 'Brake pads', 'Brakes', 4, null),
  ('bb000000-0000-4000-8000-000000000003', 'TIRE', 'Tyre', 'Tyres', null, null);

select public.stock_receive('bb000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000001', 8, 2.5, null);
select public.stock_receive('bb000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000002', 4, 4, null);
select public.stock_receive('bb000000-0000-4000-8000-000000000002', 'aa000000-0000-4000-8000-000000000001', 3, 20, null);
select public.stock_receive('bb000000-0000-4000-8000-000000000003', 'aa000000-0000-4000-8000-000000000001', 6, 100, null);

-- Oil: 12 on hand (> 10) avg cost (8*2.5+4*4)/12 = 3. Pads: 3 <= 4 → low. Tyre: no reorder point.
insert into _t select 'summary numbers',
  s.item_count = 3 and s.warehouse_count = 2 and s.low_stock_count = 1 and s.out_of_stock_count = 0
  and s.stock_value = 12 * 3 + 3 * 20 + 6 * 100,
  format('%s', row(s.*))
from public.inventory_summary() s;

insert into _t select 'low stock lists only pads, suggested = gap',
  (select array_agg(sku) from public.inventory_low_stock()) = array['PAD']
  and (select suggested_qty from public.inventory_low_stock() where sku = 'PAD') = 1, null;

select public.stock_issue('bb000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000001', 3, null, null, null);
insert into _t select 'oil drops to 9 and joins the list with its reorder qty',
  (select suggested_qty from public.inventory_low_stock() where sku = 'OIL') = 50
  and (select array_agg(sku order by sku) from public.inventory_low_stock()) = array['OIL', 'PAD'], null;

insert into _t select 'valuation by warehouse and category',
  (select count(*) from public.inventory_valuation()) = 4
  and (select stock_value from public.inventory_valuation()
         where warehouse_name = 'Van 1' and category = 'Filters') = 12, null;

-- A viewer reads the same numbers; another tenant reads none.
select set_config('request.jwt.claims',
  '{"sub":"5eed0000-0000-4000-8000-00000000a003","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"viewer"}}', true);
insert into _t select 'viewer sees the summary', (select item_count from public.inventory_summary()) = 3, null;

select set_config('request.jwt.claims',
  '{"sub":"5eed0000-0000-4000-8000-00000000b001","role":"authenticated","app_metadata":{"tenant_id":"5eed0000-0000-4000-8000-0000000000b1","role":"owner"}}', true);
insert into _t select 'other tenant sees nothing',
  (select item_count from public.inventory_summary()) = 0
  and not exists (select 1 from public.inventory_low_stock())
  and not exists (select 1 from public.inventory_valuation()), null;

reset role;
-- Module off: RLS hides everything.
update public.tenant_modules set enabled = false
  where tenant_id = '170d2d86-5c22-4bcb-9d74-420c879419b2' and module_id = 'inventory';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
insert into _t select 'module disabled hides everything',
  (select item_count from public.inventory_summary()) = 0, null;
reset role;

insert into _t select 'anon cannot execute',
  not has_function_privilege('anon', 'public.inventory_summary()', 'execute')
  and not has_function_privilege('anon', 'public.inventory_low_stock(integer)', 'execute')
  and not has_function_privilege('anon', 'public.inventory_valuation()', 'execute'), null;

-- @print
select name, ok, detail from _t order by ok, name;
rollback;
