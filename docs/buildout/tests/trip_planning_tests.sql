-- Dry-run tests for 20261008000018_trip_planning.sql (PGlite replica:
-- node docs/buildout/pglite/harness.mjs run docs/buildout/tests/trip_planning_tests.sql).
begin;
create temp table _t (name text, ok boolean, detail text);
grant all on _t to authenticated, service_role;

insert into public.tenant_modules (tenant_id, module_id, enabled) values
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'workflow_automation', true)
on conflict (tenant_id, module_id) do update set enabled = true;

-- V1: 30 L/100 km at 0.4 per liter (600 L after the first fill over 2,000 km).
insert into public.vehicles (id, tenant_id, name, status, odometer) values
  ('a7e1c0de-0018-4b2c-9d3e-4f5a6b7c8d01', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Trip V1', 'active', 82000),
  ('a7e1c0de-0018-4b2c-9d3e-4f5a6b7c8d02', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Trip V2', 'active', 1000),
  ('a7e1c0de-0018-4b2c-9d3e-4f5a6b7c8d03', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Trip V3', 'retired', 500);
insert into public.fuel_logs (tenant_id, vehicle_id, filled_at, odometer, volume, total_cost) values
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'a7e1c0de-0018-4b2c-9d3e-4f5a6b7c8d01', now() - interval '60 days', 80000, 100, 40),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'a7e1c0de-0018-4b2c-9d3e-4f5a6b7c8d01', now() - interval '40 days', 81000, 300, 120),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'a7e1c0de-0018-4b2c-9d3e-4f5a6b7c8d01', now() - interval '20 days', 82000, 300, 120);
update public.vehicles set odometer = 82000 where id = 'a7e1c0de-0018-4b2c-9d3e-4f5a6b7c8d01';

-- Module off
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
do $$ begin
  insert into public.trips (vehicle_id, purpose, planned_start, planned_end)
  values ('a7e1c0de-0018-4b2c-9d3e-4f5a6b7c8d01', 'x', now(), now() + interval '1 hour');
  insert into _t values ('module off: insert refused', false, null);
exception when others then insert into _t values ('module off: insert refused', sqlstate = '42501', sqlerrm); end $$;
reset role;
insert into public.tenant_modules (tenant_id, module_id, enabled)
values ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'trip_planning', true)
on conflict (tenant_id, module_id) do update set enabled = true;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);

do $$ begin
  insert into public.trips (vehicle_id, purpose, planned_start, planned_end, status)
  values ('a7e1c0de-0018-4b2c-9d3e-4f5a6b7c8d01', 'x', now(), now() + interval '1 hour', 'completed');
  insert into _t values ('client cannot insert a status', false, null);
exception when others then insert into _t values ('client cannot insert a status', sqlstate = '42501', sqlerrm); end $$;
do $$ begin
  insert into public.trips (vehicle_id, purpose, planned_start, planned_end)
  values ('a7e1c0de-0018-4b2c-9d3e-4f5a6b7c8d01', 'x', now(), now() - interval '1 hour');
  insert into _t values ('window must end after start', false, null);
exception when others then insert into _t values ('window must end after start', sqlstate = '23514', sqlerrm); end $$;
do $$ begin
  insert into public.trips (vehicle_id, purpose, planned_start, planned_end)
  values ('5eed0000-0000-4000-8000-00000000e0b1', 'x', now(), now() + interval '1 hour');
  insert into _t values ('other tenant vehicle refused', false, null);
exception when others then insert into _t values ('other tenant vehicle refused', sqlerrm like 'CROSS_TENANT_REFERENCE%', sqlerrm); end $$;

insert into public.trips (vehicle_id, driver_id, purpose, planned_start, planned_end, planned_distance_km)
values ('a7e1c0de-0018-4b2c-9d3e-4f5a6b7c8d01', '5eed0000-0000-4000-8000-00000000d001', 'Muscat run',
        date_trunc('hour', now()) + interval '1 day', date_trunc('hour', now()) + interval '1 day 4 hours', 300);
create temp table _ids on commit drop as select id, 't1'::text as k from public.trips where purpose = 'Muscat run';
grant all on _ids to authenticated;
insert into _t select 'numbered, planned, estimated (30 L/100 km, 0.4/L)',
  (select doc_number ~ '^TRP-\d{5}$' and status = 'planned' and estimated_fuel_l = 90 and estimated_cost = 36
      and created_by = '129bbbae-fdfc-4d21-8a86-8949fec2403b'
   from public.trips where id = (select id from _ids where k = 't1')),
  (select concat_ws(' ', doc_number, status, estimated_fuel_l, estimated_cost) from public.trips where id = (select id from _ids where k = 't1'));

-- Overlapping trip on the same vehicle: planned is allowed, warned.
insert into public.trips (vehicle_id, purpose, planned_start, planned_end)
values ('a7e1c0de-0018-4b2c-9d3e-4f5a6b7c8d01', 'Overlap', date_trunc('hour', now()) + interval '1 day 2 hours',
        date_trunc('hour', now()) + interval '1 day 6 hours');
insert into _ids select id, 't2' from public.trips where purpose = 'Overlap';
insert into _t select 'trip_conflicts warns on planned overlap',
  (select count(*) = 1 and bool_and(vehicle_clash) and not bool_or(driver_clash)
   from public.trip_conflicts('a7e1c0de-0018-4b2c-9d3e-4f5a6b7c8d01', null,
     date_trunc('hour', now()) + interval '1 day 2 hours', date_trunc('hour', now()) + interval '1 day 6 hours',
     (select id from _ids where k = 't2'))), null;
insert into _t select 'estimate cleared without distance',
  (select estimated_fuel_l is null from public.trips where id = (select id from _ids where k = 't2')), null;

update public.trips set status = 'dispatched' where id = (select id from _ids where k = 't1');
insert into _t select 'dispatched stamps time',
  (select status = 'dispatched' and dispatched_at is not null from public.trips where id = (select id from _ids where k = 't1')), null;
do $$ begin
  update public.trips set status = 'dispatched' where id = (select id from _ids where k = 't2');
  insert into _t values ('dispatch blocked by vehicle double-booking', false, null);
exception when others then insert into _t values ('dispatch blocked by vehicle double-booking', sqlerrm = 'TRIP_VEHICLE_CONFLICT', sqlerrm); end $$;

insert into public.trips (vehicle_id, driver_id, purpose, planned_start, planned_end)
values ('a7e1c0de-0018-4b2c-9d3e-4f5a6b7c8d02', '5eed0000-0000-4000-8000-00000000d001', 'Driver clash',
        date_trunc('hour', now()) + interval '1 day 3 hours', date_trunc('hour', now()) + interval '1 day 5 hours');
insert into _ids select id, 't3' from public.trips where purpose = 'Driver clash';
do $$ begin
  update public.trips set status = 'dispatched' where id = (select id from _ids where k = 't3');
  insert into _t values ('dispatch blocked by driver double-booking', false, null);
exception when others then insert into _t values ('dispatch blocked by driver double-booking', sqlerrm = 'TRIP_DRIVER_CONFLICT', sqlerrm); end $$;

insert into public.trips (vehicle_id, purpose, planned_start, planned_end)
values ('a7e1c0de-0018-4b2c-9d3e-4f5a6b7c8d03', 'Retired', now() + interval '10 days', now() + interval '10 days 1 hour');
do $$ begin
  update public.trips set status = 'dispatched' where purpose = 'Retired';
  insert into _t values ('retired vehicle cannot be dispatched', false, null);
exception when others then insert into _t values ('retired vehicle cannot be dispatched', sqlerrm = 'VEHICLE_NOT_AVAILABLE', sqlerrm); end $$;
do $$ begin
  update public.trips set status = 'in_progress' where id = (select id from _ids where k = 't2');
  insert into _t values ('planned cannot jump to in progress', false, null);
exception when others then insert into _t values ('planned cannot jump to in progress', sqlerrm = 'ILLEGAL_TRIP_TRANSITION', sqlerrm); end $$;
do $$ begin
  update public.trips set estimated_cost = 1 where id = (select id from _ids where k = 't1');
  insert into _t values ('estimates are server-side', false, null);
exception when others then insert into _t values ('estimates are server-side', sqlstate = '42501', sqlerrm); end $$;

-- Stops
insert into public.trip_stops (trip_id, name, lat, lng) values
  ((select id from _ids where k = 't1'), 'Depot', 23.588, 58.3829),
  ((select id from _ids where k = 't1'), 'Barka', 23.6786, 57.8861),
  ((select id from _ids where k = 't1'), 'Sohar', 24.3474, 56.7094);
insert into _t select 'stops numbered in insert order',
  (select array_agg(name order by sequence) = array['Depot', 'Barka', 'Sohar'] and bool_and(status = 'pending')
   from public.trip_stops where trip_id = (select id from _ids where k = 't1')), null;
select public.trip_stops_reorder((select id from _ids where k = 't1'),
  (select array_agg(id order by case name when 'Sohar' then 1 when 'Depot' then 2 else 3 end)
   from public.trip_stops where trip_id = (select id from _ids where k = 't1')));
insert into _t select 'reorder renumbers',
  (select array_agg(name order by sequence) = array['Sohar', 'Depot', 'Barka']
   from public.trip_stops where trip_id = (select id from _ids where k = 't1')), null;
do $$ begin
  perform public.trip_stops_reorder((select id from _ids where k = 't1'),
    (select array_agg(id) from public.trip_stops where trip_id = (select id from _ids where k = 't1') and name <> 'Barka'));
  insert into _t values ('reorder needs every stop', false, null);
exception when others then insert into _t values ('reorder needs every stop', sqlerrm = 'STOP_LIST_MISMATCH', sqlerrm); end $$;
do $$ begin
  update public.trip_stops set status = 'arrived' where name = 'Sohar' and trip_id = (select id from _ids where k = 't1');
  insert into _t values ('stops move only on a running trip', false, null);
exception when others then insert into _t values ('stops move only on a running trip', sqlerrm = 'STOP_TRIP_NOT_STARTED', sqlerrm); end $$;

update public.trips set status = 'in_progress' where id = (select id from _ids where k = 't1');
insert into _t select 'start stamps time and odometer',
  (select actual_start is not null and start_odometer = 82000 from public.trips where id = (select id from _ids where k = 't1')), null;
update public.trip_stops set status = 'arrived' where name = 'Sohar' and trip_id = (select id from _ids where k = 't1');
update public.trip_stops set status = 'departed' where name = 'Sohar' and trip_id = (select id from _ids where k = 't1');
update public.trip_stops set status = 'skipped' where name = 'Depot' and trip_id = (select id from _ids where k = 't1');
insert into _t select 'stop arrival and departure stamped',
  (select actual_arrival is not null and actual_departure is not null from public.trip_stops
   where name = 'Sohar' and trip_id = (select id from _ids where k = 't1')), null;
do $$ begin
  update public.trip_stops set status = 'departed' where name = 'Barka' and trip_id = (select id from _ids where k = 't1');
  insert into _t values ('pending stop cannot depart', false, null);
exception when others then insert into _t values ('pending stop cannot depart', sqlerrm = 'ILLEGAL_STOP_TRANSITION', sqlerrm); end $$;
do $$ begin
  update public.trips set status = 'canceled' where id = (select id from _ids where k = 't1');
  insert into _t values ('running trip cannot be canceled', false, null);
exception when others then insert into _t values ('running trip cannot be canceled', sqlerrm = 'ILLEGAL_TRIP_TRANSITION', sqlerrm); end $$;
do $$ begin
  update public.trips set status = 'completed', end_odometer = 81000 where id = (select id from _ids where k = 't1');
  insert into _t values ('end odometer below start refused', false, null);
exception when others then insert into _t values ('end odometer below start refused', sqlerrm = 'INVALID_TRIP_ODOMETER', sqlerrm); end $$;

update public.trips set status = 'completed', end_odometer = 82310 where id = (select id from _ids where k = 't1');
insert into _t select 'complete: actual distance and vehicle odometer',
  (select t.actual_distance_km = 310 and t.actual_end is not null and t.completed_at is not null and v.odometer = 82310
   from public.trips t join public.vehicles v on v.id = t.vehicle_id where t.id = (select id from _ids where k = 't1')), null;
reset role;
insert into _t select 'events trip.dispatched and trip.completed',
  (select count(*) = 2 from public.domain_events
   where entity_id = (select id from _ids where k = 't1') and event in ('trip.dispatched', 'trip.completed')), null;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);

do $$ begin
  update public.trips set purpose = 'changed' where id = (select id from _ids where k = 't1');
  insert into _t values ('completed trip locked', false, null);
exception when others then insert into _t values ('completed trip locked', sqlerrm = 'TRIP_LOCKED', sqlerrm); end $$;
update public.trips set notes = 'Fuel receipt filed' where id = (select id from _ids where k = 't1');
insert into _t select 'notes still editable when completed',
  (select notes = 'Fuel receipt filed' from public.trips where id = (select id from _ids where k = 't1')), null;
do $$ begin
  delete from public.trip_stops where name = 'Barka' and trip_id = (select id from _ids where k = 't1');
  insert into _t values ('completed trip stops locked', false, null);
exception when others then insert into _t values ('completed trip stops locked', sqlerrm = 'TRIP_LOCKED', sqlerrm); end $$;
do $$ begin
  delete from public.trips where id = (select id from _ids where k = 't1');
  insert into _t values ('completed trip not deletable', false, null);
exception when others then insert into _t values ('completed trip not deletable', sqlerrm = 'TRIP_NOT_DELETABLE', sqlerrm); end $$;

-- Now T2 can be dispatched (T1 completed), then canceled.
update public.trips set status = 'dispatched' where id = (select id from _ids where k = 't2');
update public.trips set status = 'canceled', cancel_reason = 'Customer postponed' where id = (select id from _ids where k = 't2');
insert into _t select 'dispatched trip canceled with reason',
  (select status = 'canceled' and canceled_at is not null from public.trips where id = (select id from _ids where k = 't2')), null;

insert into public.trip_stops (trip_id, name) values ((select id from _ids where k = 't3'), 'Somewhere');
delete from public.trips where id = (select id from _ids where k = 't3');
insert into _t select 'planned trip deleted with its stops',
  not exists (select 1 from public.trips where id = (select id from _ids where k = 't3'))
  and not exists (select 1 from public.trip_stops where name = 'Somewhere'), null;
reset role;

-- Viewer
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"5eed0000-0000-4000-8000-00000000a003","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"viewer"}}', true);
insert into _t select 'viewer reads trips and stops',
  (select count(*) = 1 from public.trips where id = (select id from _ids where k = 't1'))
  and (select count(*) = 3 from public.trip_stops where trip_id = (select id from _ids where k = 't1')), null;
do $$ begin
  insert into public.trips (vehicle_id, purpose, planned_start, planned_end)
  values ('a7e1c0de-0018-4b2c-9d3e-4f5a6b7c8d02', 'viewer', now(), now() + interval '1 hour');
  insert into _t values ('viewer cannot plan trips', false, null);
exception when others then insert into _t values ('viewer cannot plan trips', sqlstate = '42501', sqlerrm); end $$;
do $$ begin
  perform public.trip_stops_reorder((select id from _ids where k = 't1'), array[]::uuid[]);
  insert into _t values ('viewer cannot reorder', false, null);
exception when others then insert into _t values ('viewer cannot reorder', sqlerrm = 'FORBIDDEN', sqlerrm); end $$;
reset role;

-- Other tenant
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"5eed0000-0000-4000-8000-00000000b001","role":"authenticated","app_metadata":{"tenant_id":"5eed0000-0000-4000-8000-0000000000b1","role":"owner"}}', true);
insert into _t select 'cross-tenant isolation',
  (select count(*) = 0 from public.trips) and (select count(*) = 0 from public.trip_stops), null;
reset role;

-- @print
select name, ok, detail from _t order by ok, name;
rollback;
