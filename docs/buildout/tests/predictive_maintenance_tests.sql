-- Dry-run tests for 20261008000017_predictive_maintenance.sql (PGlite replica:
-- node docs/buildout/pglite/harness.mjs run docs/buildout/tests/predictive_maintenance_tests.sql).
-- The vehicles mirror the cases in shared/predictive.test.ts.
begin;
create temp table _t (name text, ok boolean, detail text);
grant all on _t to authenticated, service_role;

insert into public.tenant_modules (tenant_id, module_id, enabled) values
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'maintenance', true)
on conflict (tenant_id, module_id) do update set enabled = true;

insert into public.vehicles (id, tenant_id, name, year, status) values
  ('a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d0a', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Healthy', extract(year from current_date)::int - 2, 'active'),
  ('a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d0b', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Due soon', extract(year from current_date)::int - 2, 'active'),
  ('a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d0c', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Risky', extract(year from current_date)::int - 12, 'active'),
  ('a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d0d', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Retired', 1990, 'retired');

-- Healthy + Due soon: inspected 10 days ago.
insert into public.inspections (tenant_id, vehicle_id, performed_at, status) values
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d0a', now() - interval '10 days', 'pass'),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d0b', now() - interval '10 days', 'pass');
-- Due soon: 20 km/day on a straight line ending at 50,000 today; service due at 50,200 → 10 days.
insert into public.fuel_logs (tenant_id, vehicle_id, filled_at, odometer, volume) values
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d0b', now() - interval '90 days', 48200, 50),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d0b', now() - interval '60 days', 48800, 50),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d0b', now() - interval '30 days', 49400, 50);
update public.vehicles set odometer = 50000, odometer_updated_at = now() where id = 'a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d0b';
insert into public.service_reminders (tenant_id, vehicle_id, task, due_km, due_date) values
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d0b', 'Oil change', 50200, null),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d0b', 'Registration', null, current_date + 80);

-- Risky: overdue by km, 4 issues in 180 d (3 in 90 d, one open critical), cost 2,000 vs 500, 12 years, never inspected.
update public.vehicles set odometer = 50000, odometer_updated_at = now() - interval '400 days' where id = 'a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d0c';
insert into public.service_reminders (tenant_id, vehicle_id, task, due_km) values
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d0c', 'Brakes', 49000);
insert into public.issues (tenant_id, vehicle_id, title, priority, status, reported_at) values
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d0c', 'Brake noise', 'critical', 'open', now() - interval '5 days'),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d0c', 'Brake noise again', 'normal', 'resolved', now() - interval '40 days'),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d0c', 'Pads worn', 'normal', 'closed', now() - interval '80 days'),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d0c', 'Leak', 'low', 'closed', now() - interval '120 days');
insert into public.work_orders (id, tenant_id, vehicle_id, number, title, status, completed_at) values
  ('e0000000-0000-4000-8000-0000000000c1', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d0c', 9001, 'Brakes', 'completed', now() - interval '30 days'),
  ('e0000000-0000-4000-8000-0000000000c2', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d0c', 9002, 'Leak', 'completed', now() - interval '120 days');
insert into public.work_order_lines (tenant_id, work_order_id, description, quantity, unit_cost) values
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'e0000000-0000-4000-8000-0000000000c1', 'Pads and discs', 2, 1000),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'e0000000-0000-4000-8000-0000000000c2', 'Hose', 1, 500);

-- Module off
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
do $$ begin
  perform * from public.predictive_vehicle_health();
  insert into _t values ('module off: health refused', false, null);
exception when others then insert into _t values ('module off: health refused', sqlerrm like 'MODULE_DISABLED%', sqlerrm); end $$;
reset role;
insert into public.tenant_modules (tenant_id, module_id, enabled)
values ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'predictive_ai', true)
on conflict (tenant_id, module_id) do update set enabled = true;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
create temp table _h on commit drop as select h.*, v.name from public.predictive_vehicle_health() h
  join public.vehicles v on v.id = h.vehicle_id;

insert into _t select 'retired vehicles excluded', not exists (select 1 from _h where name = 'Retired'), null;
insert into _t select 'healthy scores zero', (select risk_score = 0 and band = 'low' and factors = '[]'::jsonb from _h where name = 'Healthy'),
  (select factors::text from _h where name = 'Healthy');
insert into _t select 'due soon: 20 km/day, 10 days, 20 pts',
  (select avg_daily_km = 20 and days_to_service = 10 and predicted_service_date = current_date + 10 and not service_overdue
      and risk_score = 20 and factors = '[{"code":"service_due_14d","points":20,"value":10}]'::jsonb from _h where name = 'Due soon'),
  (select concat_ws(' ', avg_daily_km, days_to_service, risk_score, factors) from _h where name = 'Due soon');
insert into _t select 'risky: factors in order, capped at 100',
  (select risk_score = 100 and band = 'high' and service_overdue and issue_rate = 8 and issues_90d = 3 and issues_180d = 4
      and open_critical = 1 and cost_90d = 2000 and cost_prev_90d = 500 and age_years = 12 and days_since_inspection is null
      and (select array_agg(x ->> 'code' order by ord) from jsonb_array_elements(factors) with ordinality as e(x, ord))
        = array['service_overdue', 'open_critical_issue', 'repeat_failure', 'issue_rate_high', 'cost_rising', 'age_10y', 'inspection_overdue']
      and (select (x ->> 'value')::numeric from jsonb_array_elements(factors) x where x ->> 'code' = 'cost_rising') = 4
    from _h where name = 'Risky'),
  (select concat_ws(' ', risk_score, issue_rate, cost_90d, cost_prev_90d, factors) from _h where name = 'Risky');

-- Snapshots (seed vehicles may also be flagged; assertions look at ours).
select public.predictive_snapshot();
insert into _t select 'snapshot opens predictions for medium/high only',
  (select count(*) = 1 from public.maintenance_predictions where vehicle_id = 'a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d0c' and status = 'open')
  and not exists (select 1 from public.maintenance_predictions where vehicle_id in
    ('a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d0a', 'a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d0b')), null;
select public.predictive_snapshot();
insert into _t select 'second snapshot refreshes, no duplicate',
  (select count(*) = 1 from public.maintenance_predictions where vehicle_id = 'a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d0c'), null;
do $$ begin
  update public.maintenance_predictions set status = 'actioned' where vehicle_id = 'a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d0c';
  insert into _t values ('actioned needs a work order', false, null);
exception when others then insert into _t values ('actioned needs a work order', sqlerrm = 'WORK_ORDER_REQUIRED', sqlerrm); end $$;
do $$ begin
  update public.maintenance_predictions set risk_score = 1 where vehicle_id = 'a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d0c';
  insert into _t values ('snapshot facts not editable', false, null);
exception when others then insert into _t values ('snapshot facts not editable', sqlstate = '42501', sqlerrm); end $$;
update public.maintenance_predictions set status = 'actioned', work_order_id = 'e0000000-0000-4000-8000-0000000000c1'
 where vehicle_id = 'a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d0c';
insert into _t select 'actioned with work order', (select status = 'actioned' and closed_at is not null and closed_by is not null
  from public.maintenance_predictions where vehicle_id = 'a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d0c'), null;
do $$ begin
  update public.maintenance_predictions set status = 'dismissed' where vehicle_id = 'a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d0c';
  insert into _t values ('closed prediction stays closed', false, null);
exception when others then insert into _t values ('closed prediction stays closed', sqlerrm = 'ILLEGAL_PREDICTION_TRANSITION', sqlerrm); end $$;
select public.predictive_snapshot();
insert into _t select 'next snapshot opens a fresh one',
  (select count(*) = 2 from public.maintenance_predictions where vehicle_id = 'a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d0c'), null;
update public.maintenance_predictions set status = 'dismissed', note = 'Vehicle being sold' where vehicle_id = 'a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d0c' and status = 'open';
insert into _t select 'dismiss with note',
  (select count(*) = 1 from public.maintenance_predictions where vehicle_id = 'a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d0c' and status = 'dismissed'), null;
reset role;

-- Viewer
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"5eed0000-0000-4000-8000-00000000a003","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"viewer"}}', true);
insert into _t select 'viewer reads health and predictions', (select count(*) = 1 from public.predictive_vehicle_health() where vehicle_id = 'a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d0c')
  and (select count(*) = 2 from public.maintenance_predictions where vehicle_id = 'a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d0c'), null;
do $$ begin
  perform public.predictive_snapshot();
  insert into _t values ('viewer cannot snapshot', false, null);
exception when others then insert into _t values ('viewer cannot snapshot', sqlerrm = 'FORBIDDEN', sqlerrm); end $$;
reset role;

-- Other tenant
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"5eed0000-0000-4000-8000-00000000b001","role":"authenticated","app_metadata":{"tenant_id":"5eed0000-0000-4000-8000-0000000000b1","role":"owner"}}', true);
insert into _t select 'cross-tenant isolation', (select count(*) = 0 from public.maintenance_predictions), null;
reset role;

-- @print
select name, ok, detail from _t order by ok, name;
rollback;
