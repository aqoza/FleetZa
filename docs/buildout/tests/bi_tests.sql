-- Dry-run tests for 20261008000031_bi_analytics.sql (PGlite replica:
-- node docs/buildout/pglite/harness.mjs run docs/buildout/tests/bi_tests.sql).
begin;
create temp table _t (name text, ok boolean, detail text);
grant all on _t to authenticated, service_role, anon;
create temp table _ids (k text primary key, id uuid);
grant all on _ids to authenticated, service_role;

insert into public.tenant_modules (tenant_id, module_id, enabled) values
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'fuel', true),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'maintenance', true),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'sales', true)
on conflict (tenant_id, module_id) do update set enabled = true;
insert into public.customers (id, tenant_id, name) values
  ('b1000000-0031-4b2c-9d3e-0000000000c1', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Gulf Freight');
-- A completed work order with two lines on Truck 01.
insert into public.work_orders (id, tenant_id, vehicle_id, title, status, priority, completed_at) values
  ('b1000000-0031-4b2c-9d3e-0000000000a1', '170d2d86-5c22-4bcb-9d74-420c879419b2', '5eed0000-0000-4000-8000-00000000e001',
   'Service', 'completed', 'normal', now() - interval '5 days');
insert into public.work_order_lines (tenant_id, work_order_id, description, category, quantity, unit_cost) values
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'b1000000-0031-4b2c-9d3e-0000000000a1', 'Oil', 'part', 4, 12.5),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'b1000000-0031-4b2c-9d3e-0000000000a1', 'Labor', 'labor', 2, 40);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
do $$ begin
  insert into public.bi_dashboards (name) values ('Ops');
  insert into _t values ('module off: dashboard refused', false, null);
exception when others then insert into _t values ('module off: dashboard refused', sqlstate = '42501', sqlerrm); end $$;
do $$ begin
  perform * from public.bi_metric('fuel_cost', 'none', current_date - 30, current_date);
  insert into _t values ('module off: metric refused', false, null);
exception when others then insert into _t values ('module off: metric refused', sqlerrm = 'MODULE_DISABLED', sqlerrm); end $$;
reset role;
insert into public.tenant_modules (tenant_id, module_id, enabled) values
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'reports', true),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'bi_analytics', true)
on conflict (tenant_id, module_id) do update set enabled = true;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);

-- Metrics
insert into _t select 'fuel cost total over 90 days',
  (select value = 2490 from public.bi_metric('fuel_cost', 'none', current_date - 90, current_date)),
  (select value::text from public.bi_metric('fuel_cost', 'none', current_date - 90, current_date));
insert into _t select 'fuel cost total over 20 days',
  (select value = 1010 from public.bi_metric('fuel_cost', 'none', current_date - 20, current_date)), null;
insert into _t select 'fuel cost by vehicle labelled by plate, largest first',
  (select array_agg(label order by value desc) = array['NV-1001', 'NV-2003'] and max(value) = 2280
   from public.bi_metric('fuel_cost', 'vehicle', current_date - 90, current_date)), null;
insert into _t select 'fuel liters by driver: unassigned log grouped under empty key',
  (select count(*) = 2 and bool_or(key = '' and value = 60) and bool_or(label = 'Omar Khalil' and value = 570)
   from public.bi_metric('fuel_liters', 'driver', current_date - 90, current_date)), null;
insert into _t select 'fuel cost by month keys are YYYY-MM, ascending',
  (select bool_and(key ~ '^\d{4}-\d{2}$') and array_agg(key order by key) = array_agg(key) and sum(value) = 2490
   from public.bi_metric('fuel_cost', 'month', current_date - 90, current_date)), null;
insert into _t select 'week keys are Monday dates',
  (select bool_and(extract(isodow from key::date) = 1) from public.bi_metric('fuel_cost', 'week', current_date - 90, current_date)), null;
insert into _t select 'distance from odometer deltas',
  (select value = 2210 from public.bi_metric('distance_km', 'none', current_date - 90, current_date)),
  (select value::text from public.bi_metric('distance_km', 'none', current_date - 90, current_date));
insert into _t select 'distance counts the delta of the first log in range against an earlier one',
  (select value = 1110 from public.bi_metric('distance_km', 'none', current_date - 20, current_date)), null;
insert into _t select 'maintenance cost sums completed lines',
  (select value = 130 from public.bi_metric('maintenance_cost', 'none', current_date - 30, current_date)), null;
insert into _t select 'maintenance cost by category',
  (select bool_or(key = 'labor' and value = 80) and bool_or(key = 'part' and value = 50)
   from public.bi_metric('maintenance_cost', 'category', current_date - 30, current_date)), null;
insert into _t select 'issues by status',
  (select bool_or(key = 'open' and value >= 2) from public.bi_metric('issues_count', 'status', current_date - 30, current_date)), null;
insert into _t select 'vehicles count snapshot by type ignores the period',
  (select bool_or(key = 'truck' and value = 3) and bool_or(key = 'bus' and value = 1)
   from public.bi_metric('vehicles_count', 'category', current_date - 1, current_date)), null;
insert into _t select 'module metric without its table returns no rows',
  (select count(*) = 0 from public.bi_metric('trips_completed', 'month', current_date - 90, current_date)), null;
insert into _t select 'empty period returns a zero total row',
  (select count(*) = 1 and min(value) = 0 from public.bi_metric('fuel_cost', 'none', current_date - 400, current_date - 300)), null;
do $$ begin
  perform * from public.bi_metric('salaries; drop table x', 'none', current_date - 30, current_date);
  insert into _t values ('unknown metric refused', false, null);
exception when others then insert into _t values ('unknown metric refused', sqlerrm = 'BI_UNKNOWN_METRIC', sqlerrm); end $$;
do $$ begin
  perform * from public.bi_metric('payroll_net', 'vehicle', current_date - 30, current_date);
  insert into _t values ('dimension outside the metric refused', false, null);
exception when others then insert into _t values ('dimension outside the metric refused', sqlerrm = 'BI_INVALID_DIMENSION', sqlerrm); end $$;
do $$ begin
  perform * from public.bi_metric('fuel_cost', 'month', current_date, current_date - 1);
  insert into _t values ('reversed period refused', false, null);
exception when others then insert into _t values ('reversed period refused', sqlerrm = 'BI_INVALID_PERIOD', sqlerrm); end $$;
do $$ begin
  perform * from public.bi_metric('fuel_cost', 'month', current_date - 2000, current_date);
  insert into _t values ('period over three years refused', false, null);
exception when others then insert into _t values ('period over three years refused', sqlerrm = 'BI_INVALID_PERIOD', sqlerrm); end $$;

-- Dashboards and widgets
with x as (insert into public.bi_dashboards (name, description) values ('  Ops board ', 'Daily') returning id)
insert into _ids select 'dash', id from x;
insert into _t select 'dashboard created: trimmed, owned, shared, stamped',
  (select name = 'Ops board' and owner_id = '129bbbae-fdfc-4d21-8a86-8949fec2403b' and is_shared and created_by is not null
   from public.bi_dashboards where id = (select id from _ids where k = 'dash')), null;
with x as (insert into public.bi_widgets (dashboard_id, widget_type, metric, dimension, period, title, size)
           values ((select id from _ids where k = 'dash'), 'bar', 'fuel_cost', 'vehicle', 'last_90_days', '   ', 'large') returning id)
insert into _ids select 'w1', id from x;
insert into _t select 'widget created, blank title stored as null',
  (select title is null and size = 'large' from public.bi_widgets where id = (select id from _ids where k = 'w1')), null;
do $$ begin
  insert into public.bi_widgets (dashboard_id, metric, dimension) values ((select id from _ids where k = 'dash'), 'nope', 'month');
  insert into _t values ('widget with unknown metric refused', false, null);
exception when others then insert into _t values ('widget with unknown metric refused', sqlerrm = 'BI_UNKNOWN_METRIC', sqlerrm); end $$;
do $$ begin
  insert into public.bi_widgets (dashboard_id, metric, dimension) values ((select id from _ids where k = 'dash'), 'vehicles_count', 'month');
  insert into _t values ('widget with invalid dimension refused', false, null);
exception when others then insert into _t values ('widget with invalid dimension refused', sqlerrm = 'BI_INVALID_DIMENSION', sqlerrm); end $$;
do $$ begin
  insert into public.bi_widgets (dashboard_id, metric, dimension, period) values ((select id from _ids where k = 'dash'), 'fuel_cost', 'month', 'custom');
  insert into _t values ('custom period needs dates', false, null);
exception when others then insert into _t values ('custom period needs dates', sqlerrm = 'BI_INVALID_PERIOD', sqlerrm); end $$;
insert into public.bi_widgets (dashboard_id, metric, dimension, period, date_from, date_to)
values ((select id from _ids where k = 'dash'), 'fuel_cost', 'month', 'last_30_days', current_date - 5, current_date);
insert into _t select 'dates dropped when the period is not custom',
  (select count(*) = 1 from public.bi_widgets where dashboard_id = (select id from _ids where k = 'dash') and period = 'last_30_days' and date_from is null), null;
do $$ begin
  update public.bi_widgets set dashboard_id = gen_random_uuid() where id = (select id from _ids where k = 'w1');
  insert into _t values ('widget cannot move to another dashboard', false, null);
exception when others then insert into _t values ('widget cannot move to another dashboard', sqlstate = '42501', sqlerrm); end $$;
update public.bi_widgets set position = 5 where id = (select id from _ids where k = 'w1');
insert into _t select 'widget position updated',
  (select position = 5 from public.bi_widgets where id = (select id from _ids where k = 'w1')), null;
do $$ begin
  update public.bi_dashboards set owner_id = '5eed0000-0000-4000-8000-00000000a003' where id = (select id from _ids where k = 'dash');
  insert into _t values ('owner column not client-writable', false, null);
exception when others then insert into _t values ('owner column not client-writable', sqlstate = '42501', sqlerrm); end $$;

insert into _ids select 'default', public.bi_create_default_dashboard('Fleet overview');
insert into _t select 'default dashboard has eight widgets',
  (select count(*) = 8 from public.bi_widgets where dashboard_id = (select id from _ids where k = 'default')), null;
insert into _t select 'every default widget metric works',
  (select bool_and((select count(*) >= 0 from public.bi_metric(w.metric, w.dimension, current_date - 90, current_date)))
   from public.bi_widgets w where w.dashboard_id = (select id from _ids where k = 'default')), null;
with x as (insert into public.bi_dashboards (name, is_shared) values ('My private', false) returning id)
insert into _ids select 'private', id from x;

-- Audit trail
insert into _t select 'dashboard changes audited',
  (select count(*) >= 1 from public.audit_events where table_name = 'bi_dashboards'), null;
reset role;

-- Viewer: reads shared dashboards, not private ones, cannot write.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"5eed0000-0000-4000-8000-00000000a003","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"viewer"}}', true);
insert into _t select 'viewer sees shared dashboards and their widgets',
  (select count(*) = 2 from public.bi_dashboards) and (select count(*) >= 10 from public.bi_widgets), null;
insert into _t select 'viewer does not see a private dashboard',
  (select count(*) = 0 from public.bi_dashboards where id = (select id from _ids where k = 'private')), null;
insert into _t select 'viewer can run metrics',
  (select value = 2490 from public.bi_metric('fuel_cost', 'none', current_date - 90, current_date)), null;
do $$ begin
  insert into public.bi_dashboards (name) values ('Mine');
  insert into _t values ('viewer cannot create dashboards', false, null);
exception when others then insert into _t values ('viewer cannot create dashboards', sqlstate = '42501', sqlerrm); end $$;
update public.bi_widgets set size = 'small' where id = (select id from _ids where k = 'w1');
reset role;
insert into _t select 'viewer update changed nothing',
  (select size = 'large' from public.bi_widgets where id = (select id from _ids where k = 'w1')), null;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"5eed0000-0000-4000-8000-00000000a003","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"viewer"}}', true);
do $$ begin
  perform public.bi_create_default_dashboard('x');
  insert into _t values ('viewer cannot create the default dashboard', false, null);
exception when others then insert into _t values ('viewer cannot create the default dashboard', sqlerrm = 'FORBIDDEN', sqlerrm); end $$;
reset role;

-- A module table that appears later is picked up without changing the function.
create table public.trips (id uuid primary key default gen_random_uuid(), tenant_id uuid, vehicle_id uuid, driver_id uuid,
  customer_id uuid, status text, completed_at timestamptz);
grant select on public.trips to authenticated;
insert into public.trips (tenant_id, vehicle_id, driver_id, status, completed_at) values
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', '5eed0000-0000-4000-8000-00000000e001', '5eed0000-0000-4000-8000-00000000d002', 'completed', now() - interval '3 days'),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', '5eed0000-0000-4000-8000-00000000e001', '5eed0000-0000-4000-8000-00000000d002', 'completed', now() - interval '4 days'),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', '5eed0000-0000-4000-8000-00000000e002', null, 'planned', null);
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
insert into _t select 'trips metric reads the new table',
  (select count(*) = 1 and min(label) = 'Maria Lopez' and min(value) = 2 from public.bi_metric('trips_completed', 'driver', current_date - 30, current_date)), null;
reset role;

-- Other tenant: sees nothing of ours, and its metrics only cover its own data.
insert into public.tenant_modules (tenant_id, module_id, enabled) values
  ('5eed0000-0000-4000-8000-0000000000b1', 'reports', true),
  ('5eed0000-0000-4000-8000-0000000000b1', 'bi_analytics', true),
  ('5eed0000-0000-4000-8000-0000000000b1', 'fuel', true)
on conflict (tenant_id, module_id) do update set enabled = true;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"5eed0000-0000-4000-8000-00000000b001","role":"authenticated","app_metadata":{"tenant_id":"5eed0000-0000-4000-8000-0000000000b1","role":"owner"}}', true);
insert into _t select 'other tenant sees no dashboards or widgets',
  (select count(*) = 0 from public.bi_dashboards) and (select count(*) = 0 from public.bi_widgets), null;
insert into _t select 'other tenant metric does not include our fuel',
  (select value = 0 from public.bi_metric('fuel_cost', 'none', current_date - 90, current_date)), null;
do $$ begin
  insert into public.bi_widgets (dashboard_id, metric, dimension) values ((select id from _ids where k = 'dash'), 'fuel_cost', 'month');
  insert into _t values ('other tenant cannot add widgets to our dashboard', false, null);
exception when others then insert into _t values ('other tenant cannot add widgets to our dashboard', sqlstate = '42501' or sqlerrm like 'CROSS_TENANT%', sqlerrm); end $$;
reset role;

select name, ok, detail from _t order by ok, name;
rollback;
