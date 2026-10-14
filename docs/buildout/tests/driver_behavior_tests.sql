-- Dry-run tests for 20261008000015_driver_behavior.sql (PGlite replica:
-- node docs/buildout/pglite/harness.mjs run docs/buildout/tests/driver_behavior_tests.sql).
begin;
create temp table _t (name text, ok boolean, detail text);
grant all on _t to authenticated, service_role;

insert into public.tenant_modules (tenant_id, module_id, enabled) values
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'notifications', true),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'gps_tracking', true)
on conflict (tenant_id, module_id) do update set enabled = true;
insert into public.vehicles (id, tenant_id, name) values
  ('a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d01', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Truck 1'),
  ('a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d02', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Truck 2'),
  ('a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8db1', '5eed0000-0000-4000-8000-0000000000b1', 'Foreign truck');
insert into public.drivers (id, tenant_id, first_name, last_name) values
  ('d0000000-0000-4000-8000-000000000001', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Omar', 'Said'),
  ('d0000000-0000-4000-8000-000000000002', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Lina', ''),
  ('d0000000-0000-4000-8000-0000000000b1', '5eed0000-0000-4000-8000-0000000000b1', 'Foreign', '');
insert into public.vehicle_assignments (tenant_id, vehicle_id, driver_id, started_at) values
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d01',
   'd0000000-0000-4000-8000-000000000001', now() - interval '30 days');

-- Module off
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
do $$ begin
  insert into public.driving_events (vehicle_id, occurred_at, event_type) values ('a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d01', now(), 'speeding');
  insert into _t values ('module off: event refused', false, null);
exception when others then insert into _t values ('module off: event refused', sqlstate = '42501', sqlerrm); end $$;
do $$ begin
  perform public.driver_scores(now() - interval '7 days', now());
  insert into _t values ('module off: scores refused', false, null);
exception when others then insert into _t values ('module off: scores refused', sqlerrm = 'MODULE_DISABLED', sqlerrm); end $$;
reset role;
insert into public.tenant_modules (tenant_id, module_id, enabled)
values ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'driver_behavior', true)
on conflict (tenant_id, module_id) do update set enabled = true;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
insert into public.driving_events (vehicle_id, occurred_at, event_type, severity, speed_kmh, speed_limit_kmh)
values ('a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d01', now() - interval '2 days', 'speeding', 'medium', 112, 80);
insert into _t select 'driver from assignment', (select driver_id = 'd0000000-0000-4000-8000-000000000001'
  and created_by is not null from public.driving_events), null;
insert into public.driving_events (vehicle_id, driver_id, occurred_at, event_type, severity)
values ('a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d02', 'd0000000-0000-4000-8000-000000000002', now() - interval '1 day', 'fatigue', 'high');
insert into public.driving_events (vehicle_id, driver_id, occurred_at, event_type, severity)
values ('a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d02', 'd0000000-0000-4000-8000-000000000002', now() - interval '1 day' + interval '1 minute', 'idling', 'low');
do $$ begin
  insert into public.driving_events (vehicle_id, occurred_at, event_type, source) values ('a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d01', now(), 'speeding', 'api');
  insert into _t values ('client cannot claim api source', false, null);
exception when others then insert into _t values ('client cannot claim api source', sqlerrm = 'FORBIDDEN', sqlerrm); end $$;
do $$ begin
  insert into public.driving_events (vehicle_id, occurred_at, event_type) values ('a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d01', now() + interval '1 day', 'speeding');
  insert into _t values ('future event refused', false, null);
exception when others then insert into _t values ('future event refused', sqlerrm = 'INVALID_EVENT_TIME', sqlerrm); end $$;
do $$ begin
  insert into public.driving_events (vehicle_id, occurred_at, event_type) values ('a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8db1', now(), 'speeding');
  insert into _t values ('foreign vehicle refused', false, null);
exception when others then insert into _t values ('foreign vehicle refused', sqlerrm like 'CROSS_TENANT_REFERENCE%', sqlerrm); end $$;
do $$ begin
  update public.driving_events set event_type = 'idling';
  insert into _t values ('event facts not editable', false, null);
exception when others then insert into _t values ('event facts not editable', sqlstate = '42501', sqlerrm); end $$;

-- Distance: Truck 1 GPS ~111 km for Omar; Lina has none, fuel logs 250 km.
insert into public.gps_positions (vehicle_id, recorded_at, lat, lng) values
  ('a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d01', now() - interval '3 days', 23.0, 58.0),
  ('a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d01', now() - interval '3 days' + interval '2 hours', 24.0, 58.0);
insert into public.fuel_logs (vehicle_id, driver_id, filled_at, odometer, volume) values
  ('a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d02', 'd0000000-0000-4000-8000-000000000002', now() - interval '5 days', 10000, 50),
  ('a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d02', 'd0000000-0000-4000-8000-000000000002', now() - interval '1 day', 10250, 60);
create temp table _s as select * from public.driver_scores(now() - interval '7 days', now());
reset role;
grant select on _s to authenticated;
insert into _t select 'omar: gps km, speeding medium = 8 pts', (select distance_km between 110 and 112 and penalty = 8
  and score = round(100 - 8 * 100.0 / distance_km, 1) and grade = 'A' from _s where driver_id = 'd0000000-0000-4000-8000-000000000001'),
  (select row(distance_km, penalty, score)::text from _s where driver_id = 'd0000000-0000-4000-8000-000000000001');
insert into _t select 'lina: fuel km 250, fatigue high + idling low = 19 pts', (select distance_km = 250 and penalty = 19
  and score = 92.4 and grade = 'A' and events = 2 and high_events = 1 from _s where driver_id = 'd0000000-0000-4000-8000-000000000002'),
  (select row(distance_km, penalty, score)::text from _s where driver_id = 'd0000000-0000-4000-8000-000000000002');
insert into _t select 'critical event notifies once', (select count(distinct dedupe_key) = 1 from public.notifications
  where kind = 'driver_behavior.critical_event'), null;

-- Coaching
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
insert into public.driver_coaching_sessions (driver_id, topics, event_ids, follow_up_date)
select 'd0000000-0000-4000-8000-000000000002', array['fatigue'], array_agg(id), current_date + 14
  from public.driving_events where driver_id = 'd0000000-0000-4000-8000-000000000002';
insert into _t select 'coaching session, coach defaults to me', (select coach_id = '129bbbae-fdfc-4d21-8a86-8949fec2403b'
  and cardinality(event_ids) = 2 and status = 'scheduled' from public.driver_coaching_sessions), null;
do $$ begin
  insert into public.driver_coaching_sessions (driver_id, topics) values ('d0000000-0000-4000-8000-000000000002', array['juggling']);
  insert into _t values ('unknown topic refused', false, null);
exception when others then insert into _t values ('unknown topic refused', sqlstate = '23514', sqlerrm); end $$;
do $$ begin
  insert into public.driver_coaching_sessions (driver_id, event_ids) values ('d0000000-0000-4000-8000-000000000002', array['00000000-0000-4000-8000-000000000000'::uuid]);
  insert into _t values ('foreign event id refused', false, null);
exception when others then insert into _t values ('foreign event id refused', sqlerrm like 'CROSS_TENANT_REFERENCE%', sqlerrm); end $$;
do $$ begin
  perform public.driver_scores(now(), now() - interval '1 day');
  insert into _t values ('bad period refused', false, null);
exception when others then insert into _t values ('bad period refused', sqlerrm = 'INVALID_PERIOD', sqlerrm); end $$;
reset role;

-- Service role (API)
set local role service_role;
insert into public.driving_events (tenant_id, vehicle_id, occurred_at, event_type, severity, source)
values ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d01', now() - interval '1 hour', 'harsh_braking', 'low', 'api');
insert into _t select 'api event accepted', (select count(*) = 1 from public.driving_events where source = 'api'), null;
reset role;

-- Viewer
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"5eed0000-0000-4000-8000-00000000a003","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"viewer"}}', true);
insert into _t select 'viewer reads events', (select count(*) = 4 from public.driving_events), null;
insert into _t select 'viewer reads scores', (select count(*) = 2 from public.driver_scores(now() - interval '7 days', now())), null;
do $$ begin
  insert into public.driver_coaching_sessions (driver_id) values ('d0000000-0000-4000-8000-000000000001');
  insert into _t values ('viewer cannot coach', false, null);
exception when others then insert into _t values ('viewer cannot coach', sqlstate = '42501', sqlerrm); end $$;
reset role;

-- Other tenant
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"5eed0000-0000-4000-8000-00000000b001","role":"authenticated","app_metadata":{"tenant_id":"5eed0000-0000-4000-8000-0000000000b1","role":"owner"}}', true);
insert into _t select 'cross-tenant isolation', (select count(*) = 0 from public.driving_events)
  and (select count(*) = 0 from public.driver_coaching_sessions), null;
reset role;

-- @print
select name, ok, detail from _t order by ok, name;
rollback;
