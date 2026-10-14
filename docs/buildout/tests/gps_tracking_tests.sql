-- Dry-run tests for 20261008000014_gps_tracking.sql (PGlite replica:
-- node docs/buildout/pglite/harness.mjs run docs/buildout/tests/gps_tracking_tests.sql).
begin;
create temp table _t (name text, ok boolean, detail text);
grant all on _t to authenticated, service_role;

insert into public.tenant_modules (tenant_id, module_id, enabled) values
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'notifications', true),
  ('5eed0000-0000-4000-8000-0000000000b1', 'gps_tracking', true)
on conflict (tenant_id, module_id) do update set enabled = true;
insert into public.vehicles (id, tenant_id, name, odometer) values
  ('a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d01', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Truck 1', 1000),
  ('a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8db1', '5eed0000-0000-4000-8000-0000000000b1', 'Foreign truck', 0);
insert into public.drivers (id, tenant_id, first_name) values
  ('d0000000-0000-4000-8000-000000000001', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Omar');
insert into public.vehicle_assignments (tenant_id, vehicle_id, driver_id, started_at) values
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d01',
   'd0000000-0000-4000-8000-000000000001', now() - interval '30 days');

-- Geometry
insert into _t select 'haversine ~1 deg lat', abs(app.geo_distance_m(23, 58, 24, 58) - 111195) < 100, app.geo_distance_m(23, 58, 24, 58)::text;
insert into _t select 'point in square', app.point_in_polygon(0.5, 0.5, '[[0,0],[0,1],[1,1],[1,0]]'), null;
insert into _t select 'point outside square', not app.point_in_polygon(1.5, 0.5, '[[0,0],[0,1],[1,1],[1,0]]'), null;

-- Module off
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
do $$ begin
  insert into public.geofences (name, center_lat, center_lng, radius_m) values ('Yard', 23.6, 58.4, 500);
  insert into _t values ('module off: geofence refused', false, null);
exception when others then insert into _t values ('module off: geofence refused', sqlstate = '42501', sqlerrm); end $$;
reset role;
insert into public.tenant_modules (tenant_id, module_id, enabled)
values ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'gps_tracking', true)
on conflict (tenant_id, module_id) do update set enabled = true;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
-- Yard: circle 500 m around (23.6, 58.4). Depot: polygon around (23.7, 58.5).
insert into public.geofences (name, center_lat, center_lng, radius_m, alert_on_enter, alert_on_exit) values
  ('Yard', 23.6, 58.4, 500, true, true);
insert into public.geofences (name, kind, polygon) values
  ('Depot', 'polygon', '[[23.69,58.49],[23.69,58.51],[23.71,58.51],[23.71,58.49]]');
do $$ begin
  insert into public.geofences (name, kind) values ('Broken', 'polygon');
  insert into _t values ('polygon needs points', false, null);
exception when others then insert into _t values ('polygon needs points', sqlstate = '23514', sqlerrm); end $$;
do $$ begin
  insert into public.gps_positions (vehicle_id, recorded_at, lat, lng, source)
  values ('a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d01', now(), 23.6, 58.4, 'api');
  insert into _t values ('client cannot claim api source', false, null);
exception when others then insert into _t values ('client cannot claim api source', sqlerrm = 'FORBIDDEN', sqlerrm); end $$;
do $$ begin
  insert into public.gps_positions (vehicle_id, recorded_at, lat, lng)
  values ('a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d01', now() + interval '1 day', 23.6, 58.4);
  insert into _t values ('future fix refused', false, null);
exception when others then insert into _t values ('future fix refused', sqlerrm = 'INVALID_POSITION_TIME', sqlerrm); end $$;
do $$ begin
  insert into public.gps_positions (vehicle_id, recorded_at, lat, lng)
  values ('a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8db1', now(), 23.6, 58.4);
  insert into _t values ('foreign vehicle refused', false, null);
exception when others then insert into _t values ('foreign vehicle refused', sqlerrm like 'CROSS_TENANT_REFERENCE%', sqlerrm); end $$;

-- Fix 1: outside everything.
insert into public.gps_positions (vehicle_id, recorded_at, lat, lng, speed_kmh)
values ('a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d01', now() - interval '60 minutes', 23.5, 58.3, 40);
insert into _t select 'driver from assignment', (select driver_id = 'd0000000-0000-4000-8000-000000000001'
  and created_by is not null from public.gps_positions limit 1), null;
insert into _t select 'last position created', (select count(*) = 1 and max(lat) = 23.5 from public.vehicle_last_positions), null;
insert into _t select 'first fix outside: no events', (select count(*) = 0 from public.geofence_events), null;
-- Fix 2: inside the yard, with an odometer reading.
insert into public.gps_positions (vehicle_id, recorded_at, lat, lng, speed_kmh, odometer_km)
values ('a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d01', now() - interval '40 minutes', 23.601, 58.4005, 5, 1250);
insert into _t select 'enter yard', (select count(*) = 1 from public.geofence_events
  where event = 'enter' and geofence_id = (select id from public.geofences where name = 'Yard')), null;
insert into _t select 'odometer raised', (select odometer = 1250 from public.vehicles where id = 'a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d01'), null;
-- Fix 3: backfilled older fix inside the depot: history only.
insert into public.gps_positions (vehicle_id, recorded_at, lat, lng, odometer_km)
values ('a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d01', now() - interval '50 minutes', 23.7, 58.5, 900);
insert into _t select 'older fix does not move last position', (select lat = 23.601 from public.vehicle_last_positions), null;
insert into _t select 'older fix: no events', (select count(*) = 1 from public.geofence_events), null;
insert into _t select 'odometer never lowered', (select odometer = 1250 from public.vehicles where id = 'a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d01'), null;
-- Fix 4: yard -> depot: exit yard + enter depot.
insert into public.gps_positions (vehicle_id, recorded_at, lat, lng)
values ('a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d01', now() - interval '10 minutes', 23.7, 58.5);
insert into _t select 'exit yard + enter depot', (select count(*) filter (where event = 'exit') = 1
  and count(*) filter (where event = 'enter' and geofence_id = (select id from public.geofences where name = 'Depot')) = 1
  from public.geofence_events), null;
do $$ begin
  insert into public.gps_positions (vehicle_id, recorded_at, lat, lng)
  values ('a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d01', (select max(recorded_at) from public.gps_positions), 1, 1);
  insert into _t values ('duplicate timestamp refused', false, null);
exception when others then insert into _t values ('duplicate timestamp refused', sqlstate = '23505', sqlerrm); end $$;
do $$ begin
  insert into public.vehicle_last_positions (vehicle_id, tenant_id, position_id, recorded_at, lat, lng)
  select vehicle_id, tenant_id, position_id, recorded_at, lat, lng from public.vehicle_last_positions;
  insert into _t values ('last positions not client-writable', false, null);
exception when others then insert into _t values ('last positions not client-writable', sqlstate = '42501', sqlerrm); end $$;
reset role;

insert into _t select 'alerts only for flagged fence (yard enter + exit)', (select count(distinct dedupe_key) = 2
  from public.notifications where kind = 'gps.geofence_alert'), null;

-- Delete the newest fix: last position falls back to the previous newest.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
delete from public.gps_positions where recorded_at = (select max(recorded_at) from public.gps_positions);
insert into _t select 'last position restored after delete', (select count(*) = 1 and max(lat) = 23.601 from public.vehicle_last_positions), null;
insert into _t select 'event keeps history, position link cleared', (select count(*) = 3 and count(position_id) = 1 from public.geofence_events), null;
reset role;

-- Service role (the API) inserts with an explicit tenant.
set local role service_role;
insert into public.gps_positions (tenant_id, vehicle_id, recorded_at, lat, lng, source)
values ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d01', now() - interval '1 minute', 23.5, 58.3, 'api');
insert into _t select 'api fix accepted, exit yard', (select count(*) filter (where event = 'exit') = 2 from public.geofence_events), null;
reset role;

-- Viewer
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"5eed0000-0000-4000-8000-00000000a003","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"viewer"}}', true);
insert into _t select 'viewer reads map', (select count(*) = 1 from public.vehicle_last_positions), null;
insert into _t select 'viewer reads events', (select count(*) = 4 from public.geofence_events), null;
do $$ begin
  insert into public.geofences (name, center_lat, center_lng, radius_m) values ('X', 1, 1, 100);
  insert into _t values ('viewer cannot add geofence', false, null);
exception when others then insert into _t values ('viewer cannot add geofence', sqlstate = '42501', sqlerrm); end $$;
reset role;

-- Other tenant
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"5eed0000-0000-4000-8000-00000000b001","role":"authenticated","app_metadata":{"tenant_id":"5eed0000-0000-4000-8000-0000000000b1","role":"owner"}}', true);
insert into _t select 'cross-tenant isolation', (select count(*) = 0 from public.gps_positions)
  and (select count(*) = 0 from public.geofences) and (select count(*) = 0 from public.vehicle_last_positions), null;
reset role;

-- Deleting the vehicle cleans up.
delete from public.vehicles where id = 'a7e1c0de-0001-4b2c-9d3e-4f5a6b7c8d01';
insert into _t select 'vehicle delete cascades', (select count(*) = 0 from public.gps_positions)
  and (select count(*) = 0 from public.vehicle_last_positions), null;

-- @print
select name, ok, detail from _t order by ok, name;
rollback;
