-- Dry-run tests for 20261008000022_workshop.sql (PGlite replica:
-- node docs/buildout/pglite/harness.mjs run docs/buildout/tests/workshop_tests.sql).
begin;
create temp table _t (name text, ok boolean, detail text);
grant all on _t to authenticated, service_role;

insert into public.tenant_modules (tenant_id, module_id, enabled) values
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'employees', true)
on conflict (tenant_id, module_id) do update set enabled = true;

insert into public.employees (id, tenant_id, first_name, last_name, hourly_rate, status, user_id) values
  ('a7e1c0de-0022-4b2c-9d3e-4f5a6b7c8e01', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Imran', 'Khan', 4.5, 'active', null),
  ('a7e1c0de-0022-4b2c-9d3e-4f5a6b7c8e02', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Viewer', 'Tech', 3, 'active', '5eed0000-0000-4000-8000-00000000a003'),
  ('a7e1c0de-0022-4b2c-9d3e-4f5a6b7c8e03', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Gone', null, 3, 'terminated', null);
insert into public.work_orders (id, tenant_id, vehicle_id, number, title, status) values
  ('a7e1c0de-0022-4b2c-9d3e-4f5a6b7c8f01', '170d2d86-5c22-4bcb-9d74-420c879419b2', '5eed0000-0000-4000-8000-00000000e001', 9101, 'Brake job', 'open'),
  ('a7e1c0de-0022-4b2c-9d3e-4f5a6b7c8f02', '170d2d86-5c22-4bcb-9d74-420c879419b2', '5eed0000-0000-4000-8000-00000000e002', 9102, 'Old job', 'completed');
insert into public.warehouses (id, tenant_id, name) values
  ('a7e1c0de-0022-4b2c-9d3e-4f5a6b7c8a01', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Main store');
insert into public.inventory_items (id, tenant_id, name, sku) values
  ('a7e1c0de-0022-4b2c-9d3e-4f5a6b7c8a02', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Brake pads', 'BP-1');
select app.post_stock_move('170d2d86-5c22-4bcb-9d74-420c879419b2', 'a7e1c0de-0022-4b2c-9d3e-4f5a6b7c8a02',
  'a7e1c0de-0022-4b2c-9d3e-4f5a6b7c8a01', 'receipt', 10, 12.5, null, null, null);

-- Module off
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
do $$ begin
  insert into public.workshop_bays (name) values ('Bay 1');
  insert into _t values ('module off: insert refused', false, null);
exception when others then insert into _t values ('module off: insert refused', sqlstate = '42501', sqlerrm); end $$;
reset role;
insert into public.tenant_modules (tenant_id, module_id, enabled)
values ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'workshop', true)
on conflict (tenant_id, module_id) do update set enabled = true;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);

insert into public.workshop_bays (name, code, bay_type) values ('Lift 1', 'L1', 'lift'), ('Wash', 'W1', 'wash');
create temp table _b on commit drop as select id, code from public.workshop_bays where code in ('L1', 'W1');
grant all on _b to authenticated;
do $$ begin
  insert into public.workshop_bays (name, code) values ('Dup', 'l1');
  insert into _t values ('bay code unique per tenant', false, null);
exception when others then insert into _t values ('bay code unique per tenant', sqlstate = '23505', sqlerrm); end $$;

-- Bookings
insert into public.workshop_bookings (bay_id, work_order_id, starts_at, ends_at, notes)
values ((select id from _b where code = 'L1'), 'a7e1c0de-0022-4b2c-9d3e-4f5a6b7c8f01',
        date_trunc('hour', now()) + interval '1 hour', date_trunc('hour', now()) + interval '3 hours', 'k1');
insert into _t select 'booking scheduled', (select status = 'scheduled' and started_at is null from public.workshop_bookings where notes = 'k1'), null;
do $$ begin
  insert into public.workshop_bookings (bay_id, work_order_id, starts_at, ends_at)
  values ((select id from _b where code = 'L1'), 'a7e1c0de-0022-4b2c-9d3e-4f5a6b7c8f01',
          date_trunc('hour', now()) + interval '2 hours', date_trunc('hour', now()) + interval '4 hours');
  insert into _t values ('overlap in the same bay refused', false, null);
exception when others then insert into _t values ('overlap in the same bay refused', sqlerrm = 'WORKSHOP_BAY_CONFLICT', sqlerrm); end $$;
insert into public.workshop_bookings (bay_id, work_order_id, starts_at, ends_at, notes)
values ((select id from _b where code = 'L1'), 'a7e1c0de-0022-4b2c-9d3e-4f5a6b7c8f01',
        date_trunc('hour', now()) + interval '3 hours', date_trunc('hour', now()) + interval '4 hours', 'k2');
insert into _t select 'back-to-back slot allowed', exists (select 1 from public.workshop_bookings where notes = 'k2'), null;
insert into public.workshop_bookings (bay_id, work_order_id, starts_at, ends_at, notes)
values ((select id from _b where code = 'W1'), 'a7e1c0de-0022-4b2c-9d3e-4f5a6b7c8f01',
        date_trunc('hour', now()) + interval '2 hours', date_trunc('hour', now()) + interval '3 hours', 'k3');
insert into _t select 'same time in another bay allowed', exists (select 1 from public.workshop_bookings where notes = 'k3'), null;
do $$ begin
  insert into public.workshop_bookings (bay_id, work_order_id, starts_at, ends_at)
  values ((select id from _b where code = 'W1'), 'a7e1c0de-0022-4b2c-9d3e-4f5a6b7c8f02', now() + interval '1 day', now() + interval '25 hours');
  insert into _t values ('closed work order cannot be booked', false, null);
exception when others then insert into _t values ('closed work order cannot be booked', sqlerrm = 'WORK_ORDER_CLOSED', sqlerrm); end $$;
do $$ begin
  insert into public.workshop_bookings (bay_id, work_order_id, starts_at, ends_at)
  values ((select id from _b where code = 'W1'), 'a7e1c0de-0022-4b2c-9d3e-4f5a6b7c8f01', now() + interval '2 days', now() + interval '1 day');
  insert into _t values ('end after start', false, null);
exception when others then insert into _t values ('end after start', sqlstate = '23514', sqlerrm); end $$;
update public.workshop_bays set status = 'out_of_service' where code = 'W1';
do $$ begin
  insert into public.workshop_bookings (bay_id, work_order_id, starts_at, ends_at)
  values ((select id from _b where code = 'W1'), 'a7e1c0de-0022-4b2c-9d3e-4f5a6b7c8f01', now() + interval '3 days', now() + interval '73 hours');
  insert into _t values ('out-of-service bay cannot be booked', false, null);
exception when others then insert into _t values ('out-of-service bay cannot be booked', sqlerrm = 'WORKSHOP_BAY_UNAVAILABLE', sqlerrm); end $$;
update public.workshop_bays set status = 'available' where code = 'W1';
do $$ begin
  update public.workshop_bookings set started_at = now() where notes = 'k1';
  insert into _t values ('stamps not client-writable', false, null);
exception when others then insert into _t values ('stamps not client-writable', sqlstate = '42501', sqlerrm); end $$;
do $$ begin
  update public.workshop_bookings set status = 'done' where notes = 'k1';
  insert into _t values ('cannot finish before starting', false, null);
exception when others then insert into _t values ('cannot finish before starting', sqlerrm = 'ILLEGAL_BOOKING_TRANSITION', sqlerrm); end $$;

update public.workshop_bookings set status = 'in_progress' where notes = 'k1';
insert into _t select 'starting occupies the bay and starts the work order',
  (select status = 'occupied' from public.workshop_bays where code = 'L1')
  and (select status = 'in_progress' from public.work_orders where id = 'a7e1c0de-0022-4b2c-9d3e-4f5a6b7c8f01')
  and (select started_at is not null from public.workshop_bookings where notes = 'k1'), null;
do $$ begin
  update public.workshop_bookings set status = 'in_progress' where notes = 'k2';
  insert into _t values ('second booking cannot start in a busy bay', false, null);
exception when others then insert into _t values ('second booking cannot start in a busy bay', sqlerrm = 'WORKSHOP_BAY_BUSY', sqlerrm); end $$;
do $$ begin
  delete from public.workshop_bookings where notes = 'k1';
  insert into _t values ('started booking not deletable', false, null);
exception when others then insert into _t values ('started booking not deletable', sqlerrm = 'BOOKING_NOT_DELETABLE', sqlerrm); end $$;
update public.workshop_bookings set status = 'done' where notes = 'k1';
insert into _t select 'finishing frees the bay',
  (select status = 'available' from public.workshop_bays where code = 'L1')
  and (select finished_at is not null from public.workshop_bookings where notes = 'k1'), null;
do $$ begin
  update public.workshop_bookings set ends_at = ends_at + interval '1 hour' where notes = 'k1';
  insert into _t values ('done booking locked', false, null);
exception when others then insert into _t values ('done booking locked', sqlerrm = 'BOOKING_LOCKED', sqlerrm); end $$;
update public.workshop_bookings set status = 'canceled' where notes = 'k3';
delete from public.workshop_bookings where notes = 'k3';
insert into _t select 'canceled booking deletable', not exists (select 1 from public.workshop_bookings where notes = 'k3'), null;

-- Labor
select public.workshop_clock_on('a7e1c0de-0022-4b2c-9d3e-4f5a6b7c8f01', 'a7e1c0de-0022-4b2c-9d3e-4f5a6b7c8e01');
insert into _t select 'clock on snapshots the rate',
  (select hourly_rate = 4.5 and ended_at is null and hours is null from public.work_order_labor
    where employee_id = 'a7e1c0de-0022-4b2c-9d3e-4f5a6b7c8e01'), null;
do $$ begin
  perform public.workshop_clock_on('a7e1c0de-0022-4b2c-9d3e-4f5a6b7c8f01', 'a7e1c0de-0022-4b2c-9d3e-4f5a6b7c8e01');
  insert into _t values ('cannot clock on twice', false, null);
exception when others then insert into _t values ('cannot clock on twice', sqlerrm = 'LABOR_ALREADY_CLOCKED_ON', sqlerrm); end $$;
do $$ begin
  perform public.workshop_clock_on('a7e1c0de-0022-4b2c-9d3e-4f5a6b7c8f01', 'a7e1c0de-0022-4b2c-9d3e-4f5a6b7c8e03');
  insert into _t values ('terminated employee cannot clock on', false, null);
exception when others then insert into _t values ('terminated employee cannot clock on', sqlerrm = 'EMPLOYEE_NOT_ACTIVE', sqlerrm); end $$;
do $$ begin
  perform public.workshop_clock_on('a7e1c0de-0022-4b2c-9d3e-4f5a6b7c8f02', 'a7e1c0de-0022-4b2c-9d3e-4f5a6b7c8e02');
  insert into _t values ('cannot clock onto a completed work order', false, null);
exception when others then insert into _t values ('cannot clock onto a completed work order', sqlerrm = 'WORK_ORDER_CLOSED', sqlerrm); end $$;
-- Pretend the shift began 2.5 hours ago, then clock off.
reset role;
update public.work_order_labor set started_at = now() - interval '150 minutes'
 where employee_id = 'a7e1c0de-0022-4b2c-9d3e-4f5a6b7c8e01' and ended_at is null;
set local role authenticated;
select public.workshop_clock_off((select id from public.work_order_labor
  where employee_id = 'a7e1c0de-0022-4b2c-9d3e-4f5a6b7c8e01' and ended_at is null), 'Front pads');
insert into _t select 'clock off computes hours, cost and a labor line',
  (select l.hours = 2.5 and l.cost = 11.25 and l.notes = 'Front pads' and w.category = 'labor' and w.quantity = 2.5
          and w.unit_cost = 4.5 and w.description = 'Imran Khan'
     from public.work_order_labor l join public.work_order_lines w on w.id = l.work_order_line_id
    where l.employee_id = 'a7e1c0de-0022-4b2c-9d3e-4f5a6b7c8e01'), null;
insert into public.work_order_labor (work_order_id, employee_id, started_at, ended_at, hours, notes)
values ('a7e1c0de-0022-4b2c-9d3e-4f5a6b7c8f01', 'a7e1c0de-0022-4b2c-9d3e-4f5a6b7c8e01', now() - interval '1 day',
        now() - interval '1 day' + interval '1 hour', 1.75, 'manual');
insert into _t select 'manual entry keeps entered hours',
  (select hours = 1.75 and hourly_rate = 4.5 and work_order_line_id is not null from public.work_order_labor where notes = 'manual'), null;
update public.work_order_labor set hours = 2 where notes = 'manual';
insert into _t select 'editing hours updates the line',
  (select w.quantity = 2 from public.work_order_labor l join public.work_order_lines w on w.id = l.work_order_line_id where l.notes = 'manual'), null;
do $$ begin
  update public.work_order_labor set hourly_rate = 99 where notes = 'manual';
  insert into _t values ('rate not client-writable', false, null);
exception when others then insert into _t values ('rate not client-writable', sqlstate = '42501', sqlerrm); end $$;
do $$ begin
  update public.work_order_labor set ended_at = null where notes = 'manual';
  insert into _t values ('cannot reopen a finished entry', false, null);
exception when others then insert into _t values ('cannot reopen a finished entry', sqlerrm = 'INVALID_LABOR_TIME', sqlerrm); end $$;
do $$ begin
  insert into public.work_order_labor (work_order_id, employee_id, started_at, ended_at)
  values ('a7e1c0de-0022-4b2c-9d3e-4f5a6b7c8f01', 'a7e1c0de-0022-4b2c-9d3e-4f5a6b7c8e01', now(), now() + interval '1 day');
  insert into _t values ('future end refused', false, null);
exception when others then insert into _t values ('future end refused', sqlerrm = 'INVALID_LABOR_TIME', sqlerrm); end $$;
create temp table _line on commit drop as select work_order_line_id id from public.work_order_labor where notes = 'manual';
grant all on _line to authenticated;
delete from public.work_order_labor where notes = 'manual';
insert into _t select 'deleting an entry removes its line', not exists (select 1 from public.work_order_lines where id = (select id from _line)), null;

-- Parts
do $$ begin
  perform public.workshop_issue_part('a7e1c0de-0022-4b2c-9d3e-4f5a6b7c8f01', 'a7e1c0de-0022-4b2c-9d3e-4f5a6b7c8a02',
                                     'a7e1c0de-0022-4b2c-9d3e-4f5a6b7c8a01', 2);
  insert into _t values ('parts need inventory on', false, null);
exception when others then insert into _t values ('parts need inventory on', sqlerrm = 'INVENTORY_DISABLED', sqlerrm); end $$;
reset role;
insert into public.tenant_modules (tenant_id, module_id, enabled)
values ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'inventory', true)
on conflict (tenant_id, module_id) do update set enabled = true;
set local role authenticated;
select public.workshop_issue_part('a7e1c0de-0022-4b2c-9d3e-4f5a6b7c8f01', 'a7e1c0de-0022-4b2c-9d3e-4f5a6b7c8a02',
                                  'a7e1c0de-0022-4b2c-9d3e-4f5a6b7c8a01', 4);
insert into _t select 'issuing a part moves stock and adds a part line at cost',
  (select on_hand = 6 from public.stock_levels where item_id = 'a7e1c0de-0022-4b2c-9d3e-4f5a6b7c8a02')
  and (select count(*) = 1 from public.work_order_lines where work_order_id = 'a7e1c0de-0022-4b2c-9d3e-4f5a6b7c8f01'
         and category = 'part' and quantity = 4 and unit_cost = 12.5 and description = 'Brake pads (BP-1)'), null;
do $$ begin
  perform public.workshop_issue_part('a7e1c0de-0022-4b2c-9d3e-4f5a6b7c8f01', 'a7e1c0de-0022-4b2c-9d3e-4f5a6b7c8a02',
                                     'a7e1c0de-0022-4b2c-9d3e-4f5a6b7c8a01', 50);
  insert into _t values ('cannot issue more than on hand', false, null);
exception when others then insert into _t values ('cannot issue more than on hand', sqlerrm like 'INSUFFICIENT_STOCK%', sqlerrm); end $$;
do $$ begin
  perform public.workshop_issue_part('a7e1c0de-0022-4b2c-9d3e-4f5a6b7c8f02', 'a7e1c0de-0022-4b2c-9d3e-4f5a6b7c8a02',
                                     'a7e1c0de-0022-4b2c-9d3e-4f5a6b7c8a01', 1);
  insert into _t values ('no parts on a completed work order', false, null);
exception when others then insert into _t values ('no parts on a completed work order', sqlerrm = 'WORK_ORDER_CLOSED', sqlerrm); end $$;
reset role;

-- Viewer: may clock themselves, nobody else; cannot book.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"5eed0000-0000-4000-8000-00000000a003","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"viewer"}}', true);
insert into _t select 'viewer reads bays, bookings and labor',
  (select count(*) = 2 from public.workshop_bays) and (select count(*) = 2 from public.workshop_bookings)
  and (select count(*) = 1 from public.work_order_labor), null;
select public.workshop_clock_on('a7e1c0de-0022-4b2c-9d3e-4f5a6b7c8f01', 'a7e1c0de-0022-4b2c-9d3e-4f5a6b7c8e02');
insert into _t select 'viewer clocks themselves on',
  exists (select 1 from public.work_order_labor where employee_id = 'a7e1c0de-0022-4b2c-9d3e-4f5a6b7c8e02' and ended_at is null), null;
select public.workshop_clock_off((select id from public.work_order_labor
  where employee_id = 'a7e1c0de-0022-4b2c-9d3e-4f5a6b7c8e02' and ended_at is null));
insert into _t select 'viewer clocks themselves off',
  exists (select 1 from public.work_order_labor where employee_id = 'a7e1c0de-0022-4b2c-9d3e-4f5a6b7c8e02' and ended_at is not null), null;
do $$ begin
  perform public.workshop_clock_on('a7e1c0de-0022-4b2c-9d3e-4f5a6b7c8f01', 'a7e1c0de-0022-4b2c-9d3e-4f5a6b7c8e01');
  insert into _t values ('viewer cannot clock someone else', false, null);
exception when others then insert into _t values ('viewer cannot clock someone else', sqlerrm = 'FORBIDDEN', sqlerrm); end $$;
do $$ begin
  insert into public.workshop_bookings (bay_id, work_order_id, starts_at, ends_at)
  values ((select id from _b where code = 'W1'), 'a7e1c0de-0022-4b2c-9d3e-4f5a6b7c8f01', now() + interval '5 days', now() + interval '121 hours');
  insert into _t values ('viewer cannot book', false, null);
exception when others then insert into _t values ('viewer cannot book', sqlstate = '42501', sqlerrm); end $$;
do $$ begin
  perform public.workshop_issue_part('a7e1c0de-0022-4b2c-9d3e-4f5a6b7c8f01', 'a7e1c0de-0022-4b2c-9d3e-4f5a6b7c8a02',
                                     'a7e1c0de-0022-4b2c-9d3e-4f5a6b7c8a01', 1);
  insert into _t values ('viewer cannot issue parts', false, null);
exception when others then insert into _t values ('viewer cannot issue parts', sqlerrm = 'FORBIDDEN', sqlerrm); end $$;
reset role;

-- Completing the work order freezes its labor.
update public.work_orders set status = 'completed' where id = 'a7e1c0de-0022-4b2c-9d3e-4f5a6b7c8f01';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
do $$ begin
  update public.work_order_labor set hours = 9 where employee_id = 'a7e1c0de-0022-4b2c-9d3e-4f5a6b7c8e01';
  insert into _t values ('labor frozen on a completed work order', false, null);
exception when others then insert into _t values ('labor frozen on a completed work order', sqlerrm = 'WORK_ORDER_CLOSED', sqlerrm); end $$;
reset role;

-- Other tenant
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"5eed0000-0000-4000-8000-00000000b001","role":"authenticated","app_metadata":{"tenant_id":"5eed0000-0000-4000-8000-0000000000b1","role":"owner"}}', true);
insert into _t select 'cross-tenant isolation',
  (select count(*) = 0 from public.workshop_bays) and (select count(*) = 0 from public.workshop_bookings)
  and (select count(*) = 0 from public.work_order_labor), null;
do $$ begin
  perform public.workshop_clock_on('a7e1c0de-0022-4b2c-9d3e-4f5a6b7c8f01', 'a7e1c0de-0022-4b2c-9d3e-4f5a6b7c8e01');
  insert into _t values ('other tenant cannot clock here', false, null);
exception when others then insert into _t values ('other tenant cannot clock here', sqlerrm in ('FORBIDDEN', 'MODULE_DISABLED', 'WORK_ORDER_NOT_FOUND'), sqlerrm); end $$;
reset role;

-- @print
select name, ok, detail from _t order by ok, name;
rollback;
