-- Dry-run tests for 20261008000019_dispatch.sql (PGlite replica:
-- node docs/buildout/pglite/harness.mjs run docs/buildout/tests/dispatch_tests.sql).
begin;
create temp table _t (name text, ok boolean, detail text);
grant all on _t to authenticated, service_role;

insert into public.tenant_modules (tenant_id, module_id, enabled) values
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'workflow_automation', true),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'notifications', true)
on conflict (tenant_id, module_id) do update set enabled = true;

insert into public.vehicles (id, tenant_id, name, status) values
  ('a7e1c0de-0019-4b2c-9d3e-4f5a6b7c8d01', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Dispatch V1', 'active'),
  ('a7e1c0de-0019-4b2c-9d3e-4f5a6b7c8d02', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Dispatch V2', 'active'),
  ('a7e1c0de-0019-4b2c-9d3e-4f5a6b7c8d03', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Dispatch V3', 'in_shop');

-- Module off
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
do $$ begin
  insert into public.dispatch_jobs (title, window_start, window_end) values ('x', now(), now() + interval '1 hour');
  insert into _t values ('module off: insert refused', false, null);
exception when others then insert into _t values ('module off: insert refused', sqlstate = '42501', sqlerrm); end $$;
reset role;
insert into public.tenant_modules (tenant_id, module_id, enabled)
values ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'dispatch', true)
on conflict (tenant_id, module_id) do update set enabled = true;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);

do $$ begin
  insert into public.dispatch_jobs (title, window_start, window_end, vehicle_id)
  values ('x', now(), now() + interval '1 hour', 'a7e1c0de-0019-4b2c-9d3e-4f5a6b7c8d01');
  insert into _t values ('vehicle only through dispatch_assign', false, null);
exception when others then insert into _t values ('vehicle only through dispatch_assign', sqlstate = '42501', sqlerrm); end $$;

insert into public.dispatch_jobs (title, priority, job_type, customer_id, window_start, window_end) values
  ('Deliver pallets', 'urgent', 'delivery', '5eed0000-0000-4000-8000-00000000c001',
   date_trunc('hour', now()) + interval '1 hour', date_trunc('hour', now()) + interval '3 hours'),
  ('Overlapping pickup', 'normal', 'pickup', null,
   date_trunc('hour', now()) + interval '2 hours', date_trunc('hour', now()) + interval '4 hours'),
  ('Later service', 'low', 'service', null,
   date_trunc('hour', now()) + interval '5 hours', date_trunc('hour', now()) + interval '6 hours');
create temp table _ids on commit drop as select id, title as k from public.dispatch_jobs
  where title in ('Deliver pallets', 'Overlapping pickup', 'Later service');
grant all on _ids to authenticated;
insert into _t select 'numbered DSP, status new',
  (select bool_and(doc_number ~ '^DSP-\d{5}$' and status = 'new') and count(*) = 3 from public.dispatch_jobs
   where id in (select id from _ids)), null;
reset role;
insert into _t select 'urgent job notifies managers',
  (select count(*) > 0 from public.notifications where kind = 'dispatch.urgent_job'
     and entity_id = (select id from _ids where k = 'Deliver pallets'))
  and not exists (select 1 from public.notifications where kind = 'dispatch.urgent_job'
     and entity_id = (select id from _ids where k = 'Overlapping pickup')), null;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);

do $$ begin
  update public.dispatch_jobs set status = 'assigned' where id = (select id from _ids where k = 'Deliver pallets');
  insert into _t values ('assigned needs a vehicle', false, null);
exception when others then insert into _t values ('assigned needs a vehicle', sqlerrm = 'DISPATCH_NOT_ASSIGNED', sqlerrm); end $$;
do $$ begin
  perform public.dispatch_assign((select id from _ids where k = 'Deliver pallets'), 'a7e1c0de-0019-4b2c-9d3e-4f5a6b7c8d03', null);
  insert into _t values ('vehicle in the shop refused', false, null);
exception when others then insert into _t values ('vehicle in the shop refused', sqlerrm = 'DISPATCH_VEHICLE_UNAVAILABLE', sqlerrm); end $$;
do $$ begin
  perform public.dispatch_assign((select id from _ids where k = 'Deliver pallets'), '5eed0000-0000-4000-8000-00000000e0b1', null);
  insert into _t values ('other tenant vehicle refused', false, null);
exception when others then insert into _t values ('other tenant vehicle refused', sqlerrm like 'CROSS_TENANT_REFERENCE%', sqlerrm); end $$;

select public.dispatch_assign((select id from _ids where k = 'Deliver pallets'), 'a7e1c0de-0019-4b2c-9d3e-4f5a6b7c8d01',
                              '5eed0000-0000-4000-8000-00000000d001');
insert into _t select 'assign sets vehicle, driver, time',
  (select status = 'assigned' and vehicle_id = 'a7e1c0de-0019-4b2c-9d3e-4f5a6b7c8d01' and driver_id = '5eed0000-0000-4000-8000-00000000d001'
      and assigned_at is not null from public.dispatch_jobs where id = (select id from _ids where k = 'Deliver pallets')), null;
do $$ begin
  perform public.dispatch_assign((select id from _ids where k = 'Overlapping pickup'), 'a7e1c0de-0019-4b2c-9d3e-4f5a6b7c8d01', null);
  insert into _t values ('busy vehicle refused', false, null);
exception when others then insert into _t values ('busy vehicle refused', sqlerrm = 'DISPATCH_VEHICLE_BUSY', sqlerrm); end $$;
do $$ begin
  perform public.dispatch_assign((select id from _ids where k = 'Overlapping pickup'), 'a7e1c0de-0019-4b2c-9d3e-4f5a6b7c8d02',
                                 '5eed0000-0000-4000-8000-00000000d001');
  insert into _t values ('busy driver refused', false, null);
exception when others then insert into _t values ('busy driver refused', sqlerrm = 'DISPATCH_DRIVER_BUSY', sqlerrm); end $$;
select public.dispatch_assign((select id from _ids where k = 'Later service'), 'a7e1c0de-0019-4b2c-9d3e-4f5a6b7c8d01',
                              '5eed0000-0000-4000-8000-00000000d001');
insert into _t select 'same vehicle later in the day is fine',
  (select status = 'assigned' from public.dispatch_jobs where id = (select id from _ids where k = 'Later service')), null;
insert into _t select 'dispatch_busy lists vehicle and driver',
  (select count(*) = 2 from public.dispatch_busy(date_trunc('hour', now()) + interval '2 hours',
     date_trunc('hour', now()) + interval '4 hours', (select id from _ids where k = 'Overlapping pickup'))), null;
do $$ begin
  update public.dispatch_jobs set window_end = date_trunc('hour', now()) + interval '5 hours 30 minutes'
   where id = (select id from _ids where k = 'Deliver pallets');
  insert into _t values ('moving a busy window cannot double-book', false, null);
exception when others then insert into _t values ('moving a busy window cannot double-book', sqlerrm = 'DISPATCH_VEHICLE_BUSY', sqlerrm); end $$;

-- Unassign then re-assign
update public.dispatch_jobs set status = 'new' where id = (select id from _ids where k = 'Later service');
insert into _t select 'unassign clears vehicle and driver',
  (select status = 'new' and vehicle_id is null and driver_id is null and assigned_at is null
   from public.dispatch_jobs where id = (select id from _ids where k = 'Later service')), null;

do $$ begin
  update public.dispatch_jobs set status = 'on_site' where id = (select id from _ids where k = 'Deliver pallets');
  insert into _t values ('cannot skip en route', false, null);
exception when others then insert into _t values ('cannot skip en route', sqlerrm = 'ILLEGAL_DISPATCH_TRANSITION', sqlerrm); end $$;
update public.dispatch_jobs set status = 'en_route' where id = (select id from _ids where k = 'Deliver pallets');
update public.dispatch_jobs set status = 'on_site' where id = (select id from _ids where k = 'Deliver pallets');
do $$ begin
  update public.dispatch_jobs set status = 'new' where id = (select id from _ids where k = 'Deliver pallets');
  insert into _t values ('on site cannot be unassigned', false, null);
exception when others then insert into _t values ('on site cannot be unassigned', sqlerrm = 'ILLEGAL_DISPATCH_TRANSITION', sqlerrm); end $$;
update public.dispatch_jobs set status = 'completed', completion_notes = 'Signed by store manager'
 where id = (select id from _ids where k = 'Deliver pallets');
insert into _t select 'step times stamped',
  (select en_route_at is not null and on_site_at is not null and completed_at is not null
   from public.dispatch_jobs where id = (select id from _ids where k = 'Deliver pallets')), null;
reset role;
insert into _t select 'events assigned and completed',
  (select count(*) = 2 from public.domain_events where entity_id = (select id from _ids where k = 'Deliver pallets')
     and event in ('dispatch_job.assigned', 'dispatch_job.completed')), null;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);

do $$ begin
  update public.dispatch_jobs set title = 'changed' where id = (select id from _ids where k = 'Deliver pallets');
  insert into _t values ('completed job locked', false, null);
exception when others then insert into _t values ('completed job locked', sqlerrm = 'DISPATCH_JOB_LOCKED', sqlerrm); end $$;
update public.dispatch_jobs set notes = 'Invoice sent' where id = (select id from _ids where k = 'Deliver pallets');
insert into _t select 'notes editable after completion',
  (select notes = 'Invoice sent' from public.dispatch_jobs where id = (select id from _ids where k = 'Deliver pallets')), null;
do $$ begin
  delete from public.dispatch_jobs where id = (select id from _ids where k = 'Deliver pallets');
  insert into _t values ('completed job not deletable', false, null);
exception when others then insert into _t values ('completed job not deletable', sqlerrm = 'DISPATCH_NOT_DELETABLE', sqlerrm); end $$;
do $$ begin
  perform public.dispatch_assign((select id from _ids where k = 'Deliver pallets'), 'a7e1c0de-0019-4b2c-9d3e-4f5a6b7c8d02', null);
  insert into _t values ('completed job cannot be re-assigned', false, null);
exception when others then insert into _t values ('completed job cannot be re-assigned', sqlerrm = 'ILLEGAL_DISPATCH_TRANSITION', sqlerrm); end $$;

update public.dispatch_jobs set status = 'canceled', cancel_reason = 'Customer closed' where id = (select id from _ids where k = 'Overlapping pickup');
insert into _t select 'new job canceled with reason',
  (select status = 'canceled' and canceled_at is not null from public.dispatch_jobs where id = (select id from _ids where k = 'Overlapping pickup')), null;
delete from public.dispatch_jobs where id = (select id from _ids where k = 'Later service');
insert into _t select 'new job deletable', not exists (select 1 from public.dispatch_jobs where id = (select id from _ids where k = 'Later service')), null;
reset role;

-- Viewer
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"5eed0000-0000-4000-8000-00000000a003","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"viewer"}}', true);
insert into _t select 'viewer reads jobs', (select count(*) = 2 from public.dispatch_jobs where id in (select id from _ids)), null;
do $$ begin
  insert into public.dispatch_jobs (title, window_start, window_end) values ('viewer', now(), now() + interval '1 hour');
  insert into _t values ('viewer cannot create jobs', false, null);
exception when others then insert into _t values ('viewer cannot create jobs', sqlstate = '42501', sqlerrm); end $$;
do $$ begin
  perform public.dispatch_assign((select id from _ids where k = 'Overlapping pickup'), 'a7e1c0de-0019-4b2c-9d3e-4f5a6b7c8d02', null);
  insert into _t values ('viewer cannot assign', false, null);
exception when others then insert into _t values ('viewer cannot assign', sqlerrm = 'FORBIDDEN', sqlerrm); end $$;
reset role;

-- Other tenant
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"5eed0000-0000-4000-8000-00000000b001","role":"authenticated","app_metadata":{"tenant_id":"5eed0000-0000-4000-8000-0000000000b1","role":"owner"}}', true);
insert into _t select 'cross-tenant isolation', (select count(*) = 0 from public.dispatch_jobs), null;
reset role;

-- @print
select name, ok, detail from _t order by ok, name;
rollback;
