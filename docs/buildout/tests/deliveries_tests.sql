-- Dry-run tests for 20261008000020_deliveries.sql (PGlite replica:
-- node docs/buildout/pglite/harness.mjs run docs/buildout/tests/deliveries_tests.sql).
begin;
create temp table _t (name text, ok boolean, detail text);
grant all on _t to authenticated, service_role;

insert into public.tenant_modules (tenant_id, module_id, enabled) values
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'workflow_automation', true)
on conflict (tenant_id, module_id) do update set enabled = true;

insert into public.vehicles (id, tenant_id, name, status) values
  ('a7e1c0de-0020-4b2c-9d3e-4f5a6b7c8d01', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Delivery Van', 'active');

-- Module off
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
do $$ begin
  insert into public.deliveries (recipient_name, address) values ('x', 'y');
  insert into _t values ('module off: insert refused', false, null);
exception when others then insert into _t values ('module off: insert refused', sqlstate = '42501', sqlerrm); end $$;
reset role;
insert into public.tenant_modules (tenant_id, module_id, enabled)
values ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'logistics_delivery', true)
on conflict (tenant_id, module_id) do update set enabled = true;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);

do $$ begin
  insert into public.deliveries (recipient_name, address, route_id) values ('x', 'y', gen_random_uuid());
  insert into _t values ('route only through delivery_route_plan', false, null);
exception when others then insert into _t values ('route only through delivery_route_plan', sqlstate = '42501', sqlerrm); end $$;

select public.deliveries_import('[
  {"recipient_name":"Aisha Al Balushi","address":"Way 3021, Al Khuwair","city":"Muscat","lat":23.5957,"lng":58.4167,"cod_amount":12.5,"parcels":2},
  {"recipient_name":"Khalid Said","address":"Building 44, Ruwi","city":"Muscat","lat":23.5880,"lng":58.5450},
  {"recipient_name":"Fatma Nasser","address":"Al Hail North","city":"Seeb","cod_amount":4},
  {"recipient_name":"Spare","address":"Somewhere","city":"Sohar"}
]'::jsonb);
create temp table _ids on commit drop as select id, recipient_name as k from public.deliveries
  where recipient_name in ('Aisha Al Balushi', 'Khalid Said', 'Fatma Nasser', 'Spare');
grant all on _ids to authenticated;
insert into _t select 'import numbers DLV, pending, token set',
  (select bool_and(doc_number ~ '^DLV-\d{5}$' and status = 'pending' and tracking_token is not null and attempts = 0)
     and count(*) = 4 from public.deliveries where id in (select id from _ids)), null;
insert into _t select 'import keeps cod and parcels',
  (select cod_amount = 12.5 and parcels = 2 from public.deliveries where id = (select id from _ids where k = 'Aisha Al Balushi')), null;
do $$ begin
  perform public.deliveries_import((select jsonb_agg(jsonb_build_object('recipient_name', 'r' || g, 'address', 'a'))
                                    from generate_series(1, 501) g));
  insert into _t values ('import capped at 500', false, null);
exception when others then insert into _t values ('import capped at 500', sqlerrm = 'IMPORT_TOO_LARGE', sqlerrm); end $$;

insert into public.delivery_routes (route_date, vehicle_id, driver_id, depot_name, depot_lat, depot_lng)
values (current_date, 'a7e1c0de-0020-4b2c-9d3e-4f5a6b7c8d01', '5eed0000-0000-4000-8000-00000000d001', 'Ghala depot', 23.588, 58.383);
create temp table _r on commit drop as select id from public.delivery_routes where depot_name = 'Ghala depot';
grant all on _r to authenticated;
insert into _t select 'route numbered RTE, planned',
  (select doc_number ~ '^RTE-\d{5}$' and status = 'planned' from public.delivery_routes where id = (select id from _r)), null;
do $$ begin
  insert into public.delivery_routes (route_date, vehicle_id) values (current_date, '5eed0000-0000-4000-8000-00000000e0b1');
  insert into _t values ('other tenant vehicle refused', false, null);
exception when others then insert into _t values ('other tenant vehicle refused', sqlerrm like 'CROSS_TENANT_REFERENCE%', sqlerrm); end $$;

do $$ begin
  update public.delivery_routes set status = 'out_for_delivery' where id = (select id from _r);
  insert into _t values ('empty route cannot start', false, null);
exception when others then insert into _t values ('empty route cannot start', sqlerrm = 'ROUTE_EMPTY', sqlerrm); end $$;
do $$ begin
  update public.deliveries set status = 'assigned' where id = (select id from _ids where k = 'Spare');
  insert into _t values ('assigned needs a route', false, null);
exception when others then insert into _t values ('assigned needs a route', sqlerrm = 'DELIVERY_NOT_ON_ROUTE', sqlerrm); end $$;

select public.delivery_route_plan((select id from _r), array[
  (select id from _ids where k = 'Khalid Said'), (select id from _ids where k = 'Aisha Al Balushi'),
  (select id from _ids where k = 'Fatma Nasser'), (select id from _ids where k = 'Spare')]);
insert into _t select 'plan assigns in order',
  (select array_agg(recipient_name order by sequence) = array['Khalid Said', 'Aisha Al Balushi', 'Fatma Nasser', 'Spare']
     and bool_and(status = 'assigned') from public.deliveries where route_id = (select id from _r)), null;
select public.delivery_route_plan((select id from _r), array[
  (select id from _ids where k = 'Aisha Al Balushi'), (select id from _ids where k = 'Khalid Said'),
  (select id from _ids where k = 'Fatma Nasser')]);
insert into _t select 'replan reorders and releases the dropped stop',
  (select array_agg(recipient_name order by sequence) = array['Aisha Al Balushi', 'Khalid Said', 'Fatma Nasser']
     from public.deliveries where route_id = (select id from _r))
  and (select status = 'pending' and route_id is null and sequence is null from public.deliveries
       where id = (select id from _ids where k = 'Spare')), null;
do $$ begin
  perform public.delivery_route_plan((select id from _r), array[gen_random_uuid()]);
  insert into _t values ('unknown delivery refused', false, null);
exception when others then insert into _t values ('unknown delivery refused', sqlerrm = 'DELIVERY_NOT_AVAILABLE', sqlerrm); end $$;

update public.delivery_routes set status = 'out_for_delivery' where id = (select id from _r);
insert into _t select 'starting the route sends stops out',
  (select bool_and(status = 'out_for_delivery') and count(*) = 3 from public.deliveries where route_id = (select id from _r))
  and (select started_at is not null from public.delivery_routes where id = (select id from _r)), null;
do $$ begin
  perform public.delivery_route_plan((select id from _r), array[(select id from _ids where k = 'Spare')]);
  insert into _t values ('started route cannot be replanned', false, null);
exception when others then insert into _t values ('started route cannot be replanned', sqlerrm = 'ROUTE_NOT_PLANNED', sqlerrm); end $$;
do $$ begin
  update public.delivery_routes set status = 'completed' where id = (select id from _r);
  insert into _t values ('route with stops out cannot complete', false, null);
exception when others then insert into _t values ('route with stops out cannot complete', sqlerrm = 'ROUTE_HAS_OPEN_STOPS', sqlerrm); end $$;

do $$ begin
  update public.deliveries set status = 'delivered' where id = (select id from _ids where k = 'Aisha Al Balushi');
  insert into _t values ('delivered needs a recipient name', false, null);
exception when others then insert into _t values ('delivered needs a recipient name', sqlerrm = 'POD_NAME_REQUIRED', sqlerrm); end $$;
do $$ begin
  update public.deliveries set pod_name = 'Aisha' where id = (select id from _ids where k = 'Aisha Al Balushi');
  insert into _t values ('proof only with the delivered step', false, null);
exception when others then insert into _t values ('proof only with the delivered step', sqlerrm = 'ILLEGAL_DELIVERY_TRANSITION', sqlerrm); end $$;
update public.deliveries set status = 'delivered', pod_name = 'Aisha', cod_collected = 12.5,
       pod_signature = 'data:image/png;base64,iVBORw0KGgo='
 where id = (select id from _ids where k = 'Aisha Al Balushi');
insert into _t select 'delivered stamps time and counts attempt',
  (select delivered_at is not null and attempts = 1 and cod_collected = 12.5 from public.deliveries
   where id = (select id from _ids where k = 'Aisha Al Balushi')), null;
do $$ begin
  update public.deliveries set pod_signature = 'javascript:alert(1)', pod_name = 'K', status = 'delivered'
   where id = (select id from _ids where k = 'Khalid Said');
  insert into _t values ('signature must be an image data URL', false, null);
exception when others then insert into _t values ('signature must be an image data URL', sqlstate = '23514', sqlerrm); end $$;
do $$ begin
  update public.deliveries set status = 'failed' where id = (select id from _ids where k = 'Khalid Said');
  insert into _t values ('failed needs a reason', false, null);
exception when others then insert into _t values ('failed needs a reason', sqlerrm = 'FAILURE_REASON_REQUIRED', sqlerrm); end $$;
update public.deliveries set status = 'failed', failure_reason = 'not_home' where id = (select id from _ids where k = 'Khalid Said');
update public.deliveries set status = 'out_for_delivery' where id = (select id from _ids where k = 'Khalid Said');
insert into _t select 'retry clears the failure and keeps the attempt count',
  (select status = 'out_for_delivery' and failure_reason is null and attempts = 1 from public.deliveries
   where id = (select id from _ids where k = 'Khalid Said')), null;
update public.deliveries set status = 'failed', failure_reason = 'refused' where id = (select id from _ids where k = 'Khalid Said');
update public.deliveries set status = 'returned' where id = (select id from _ids where k = 'Khalid Said');
update public.deliveries set status = 'failed', failure_reason = 'wrong_address' where id = (select id from _ids where k = 'Fatma Nasser');
update public.deliveries set status = 'pending' where id = (select id from _ids where k = 'Fatma Nasser');
insert into _t select 'failed back to the queue leaves the route',
  (select status = 'pending' and route_id is null and attempts = 1 from public.deliveries
   where id = (select id from _ids where k = 'Fatma Nasser')), null;
do $$ begin
  update public.deliveries set cod_amount = 1 where id = (select id from _ids where k = 'Aisha Al Balushi');
  insert into _t values ('delivered is locked', false, null);
exception when others then insert into _t values ('delivered is locked', sqlerrm = 'DELIVERY_LOCKED', sqlerrm); end $$;
do $$ begin
  update public.deliveries set status = 'out_for_delivery' where id = (select id from _ids where k = 'Spare');
  insert into _t values ('pending cannot jump to out', false, null);
exception when others then insert into _t values ('pending cannot jump to out', sqlerrm = 'ILLEGAL_DELIVERY_TRANSITION', sqlerrm); end $$;
do $$ begin
  update public.deliveries set tracking_token = gen_random_uuid() where id = (select id from _ids where k = 'Spare');
  insert into _t values ('tracking token not client-writable', false, null);
exception when others then insert into _t values ('tracking token not client-writable', sqlstate = '42501', sqlerrm); end $$;

update public.delivery_routes set status = 'completed' where id = (select id from _r);
insert into _t select 'route completes once no stop is out',
  (select status = 'completed' and completed_at is not null from public.delivery_routes where id = (select id from _r)), null;
do $$ begin
  update public.delivery_routes set notes = 'ok' where id = (select id from _r);
  insert into _t values ('completed route notes stay editable', true, null);
exception when others then insert into _t values ('completed route notes stay editable', false, sqlerrm); end $$;
do $$ begin
  update public.delivery_routes set route_date = current_date + 1 where id = (select id from _r);
  insert into _t values ('completed route locked', false, null);
exception when others then insert into _t values ('completed route locked', sqlerrm = 'ROUTE_LOCKED', sqlerrm); end $$;
do $$ begin
  delete from public.delivery_routes where id = (select id from _r);
  insert into _t values ('completed route not deletable', false, null);
exception when others then insert into _t values ('completed route not deletable', sqlerrm = 'ROUTE_NOT_DELETABLE', sqlerrm); end $$;
do $$ begin
  delete from public.deliveries where id = (select id from _ids where k = 'Aisha Al Balushi');
  insert into _t values ('delivered not deletable', false, null);
exception when others then insert into _t values ('delivered not deletable', sqlerrm = 'DELIVERY_NOT_DELETABLE', sqlerrm); end $$;

-- A second route: cancel and delete put stops back to pending.
insert into public.delivery_routes (route_date, vehicle_id, notes) values (current_date + 1, 'a7e1c0de-0020-4b2c-9d3e-4f5a6b7c8d01', 'r2');
select public.delivery_route_plan((select id from public.delivery_routes where notes = 'r2'),
  array[(select id from _ids where k = 'Spare'), (select id from _ids where k = 'Fatma Nasser')]);
update public.delivery_routes set status = 'canceled' where notes = 'r2';
insert into _t select 'canceling a route returns its stops',
  (select bool_and(status = 'pending' and route_id is null) from public.deliveries
   where id in (select id from _ids where k in ('Spare', 'Fatma Nasser'))), null;
insert into public.delivery_routes (route_date, vehicle_id, notes) values (current_date + 2, 'a7e1c0de-0020-4b2c-9d3e-4f5a6b7c8d01', 'r3');
select public.delivery_route_plan((select id from public.delivery_routes where notes = 'r3'),
  array[(select id from _ids where k = 'Spare')]);
delete from public.delivery_routes where notes = 'r3';
insert into _t select 'deleting a planned route returns its stops',
  (select status = 'pending' and route_id is null from public.deliveries where id = (select id from _ids where k = 'Spare')), null;
delete from public.deliveries where id = (select id from _ids where k = 'Spare');
insert into _t select 'pending delivery deletable', not exists (select 1 from public.deliveries where id = (select id from _ids where k = 'Spare')), null;
reset role;

insert into _t select 'delivered and failed emit events',
  (select count(*) filter (where event = 'delivery.delivered') = 1 and count(*) filter (where event = 'delivery.failed') = 3
   from public.domain_events where entity_type = 'delivery'), null;

-- Viewer
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"5eed0000-0000-4000-8000-00000000a003","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"viewer"}}', true);
insert into _t select 'viewer reads deliveries', (select count(*) = 3 from public.deliveries where id in (select id from _ids)), null;
do $$ begin
  perform public.deliveries_import('[{"recipient_name":"v","address":"a"}]'::jsonb);
  insert into _t values ('viewer cannot import', false, null);
exception when others then insert into _t values ('viewer cannot import', sqlstate = '42501', sqlerrm); end $$;
do $$ begin
  perform public.delivery_route_plan((select id from _r), '{}');
  insert into _t values ('viewer cannot plan', false, null);
exception when others then insert into _t values ('viewer cannot plan', sqlerrm = 'FORBIDDEN', sqlerrm); end $$;
reset role;

-- Other tenant
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"5eed0000-0000-4000-8000-00000000b001","role":"authenticated","app_metadata":{"tenant_id":"5eed0000-0000-4000-8000-0000000000b1","role":"owner"}}', true);
insert into _t select 'cross-tenant isolation',
  (select count(*) = 0 from public.deliveries) and (select count(*) = 0 from public.delivery_routes), null;
reset role;

-- @print
select name, ok, detail from _t order by ok, name;
rollback;
