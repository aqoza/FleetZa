-- Workshop (module workshop): service bays, bay bookings for work orders,
-- technician time on work orders and parts issued from stock.
--
-- 1) workshop_bays: name, code, type, status available | occupied |
--    out_of_service. "occupied" is kept by the booking trigger (a bay with a
--    booking in progress); managers set out_of_service by hand.
-- 2) workshop_bookings: a work order in a bay for a time slot. status
--    scheduled → in_progress → done; scheduled → canceled. app.workshop_booking_guard
--    refuses overlapping live bookings in one bay (WORKSHOP_BAY_CONFLICT, under
--    a per-bay advisory lock), booking an inactive or out-of-service bay
--    (WORKSHOP_BAY_UNAVAILABLE), booking a closed work order
--    (WORK_ORDER_CLOSED) and starting while another booking is in the bay
--    (WORKSHOP_BAY_BUSY). Starting a booking moves an open work order to
--    in_progress. Done and canceled bookings are locked (BOOKING_LOCKED, notes
--    stay editable); only scheduled or canceled ones can be deleted
--    (BOOKING_NOT_DELETABLE).
-- 3) work_order_labor: technician time. hourly_rate is snapshotted from the
--    employee; hours come from the clock times unless entered; cost is
--    generated. One open entry per employee (LABOR_ALREADY_CLOCKED_ON). Each
--    finished entry keeps a 'labor' work_order_lines row in sync, so work
--    order totals include labor. Entries on completed or canceled work orders
--    are frozen (WORK_ORDER_CLOSED) except clocking off.
-- 4) RPCs: workshop_clock_on(work_order, employee), workshop_clock_off(labor)
--    — a manager, or the employee linked to the caller's login, may clock;
--    workshop_issue_part(work_order, item, warehouse, qty) posts a
--    'consumption' stock move and adds a 'part' line at the item's moving
--    average cost (INVENTORY_DISABLED when inventory is off).
--
-- Raised codes: WORKSHOP_BAY_CONFLICT, WORKSHOP_BAY_UNAVAILABLE,
-- WORKSHOP_BAY_BUSY, WORK_ORDER_CLOSED, ILLEGAL_BOOKING_TRANSITION,
-- BOOKING_LOCKED, BOOKING_NOT_DELETABLE, LABOR_ALREADY_CLOCKED_ON,
-- INVALID_LABOR_TIME, EMPLOYEE_NOT_ACTIVE, WORK_ORDER_NOT_FOUND,
-- LABOR_NOT_FOUND, INVENTORY_DISABLED (+ INSUFFICIENT_STOCK and the stock
-- codes from app.post_stock_move, FORBIDDEN, MODULE_DISABLED,
-- CROSS_TENANT_REFERENCE). Additive only.

set local lock_timeout = '3s';
set local statement_timeout = '60s';

-- ============================================================
-- Tables
-- ============================================================
create table public.workshop_bays (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  code text check (code is null or char_length(code) <= 20),
  bay_type text not null default 'general'
    check (bay_type in ('general', 'lift', 'inspection', 'wash', 'tire', 'paint', 'electrical')),
  status text not null default 'available' check (status in ('available', 'occupied', 'out_of_service')),
  active boolean not null default true,
  notes text check (notes is null or char_length(notes) <= 1000),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index workshop_bays_tenant_code_uk on public.workshop_bays (tenant_id, lower(code)) where code is not null;
create index workshop_bays_tenant_name_idx on public.workshop_bays (tenant_id, name);

create table public.workshop_bookings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  bay_id uuid not null references public.workshop_bays(id) on delete restrict,
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'in_progress', 'done', 'canceled')),
  started_at timestamptz,
  finished_at timestamptz,
  notes text check (notes is null or char_length(notes) <= 1000),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workshop_bookings_slot_ck check (ends_at > starts_at and ends_at - starts_at <= interval '7 days')
);
create index workshop_bookings_bay_time_idx on public.workshop_bookings (bay_id, starts_at);
create index workshop_bookings_tenant_time_idx on public.workshop_bookings (tenant_id, starts_at);
create index workshop_bookings_work_order_idx on public.workshop_bookings (work_order_id);

create table public.work_order_labor (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete restrict,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  hours numeric(8,2) check (hours is null or (hours >= 0 and hours <= 168)),
  hourly_rate numeric(14,4) not null default 0 check (hourly_rate >= 0),
  cost numeric(14,3) generated always as (round(coalesce(hours, 0) * hourly_rate, 3)) stored,
  notes text check (notes is null or char_length(notes) <= 1000),
  work_order_line_id uuid references public.work_order_lines(id) on delete set null,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_order_labor_times_ck check (ended_at is null or ended_at >= started_at)
);
create unique index work_order_labor_open_uk on public.work_order_labor (employee_id) where ended_at is null;
create index work_order_labor_work_order_idx on public.work_order_labor (work_order_id);
create index work_order_labor_tenant_started_idx on public.work_order_labor (tenant_id, started_at desc);
create index work_order_labor_employee_idx on public.work_order_labor (employee_id, started_at desc);
create index work_order_labor_line_idx on public.work_order_labor (work_order_line_id) where work_order_line_id is not null;

alter table public.workshop_bays enable row level security;
alter table public.workshop_bookings enable row level security;
alter table public.work_order_labor enable row level security;
revoke all on public.workshop_bays from anon;
revoke all on public.workshop_bookings from anon;
revoke all on public.work_order_labor from anon;
revoke insert, update on public.workshop_bookings from authenticated;
grant insert (bay_id, work_order_id, starts_at, ends_at, notes) on public.workshop_bookings to authenticated;
grant update (bay_id, starts_at, ends_at, status, notes) on public.workshop_bookings to authenticated;
-- Rates, cost and the line link are server-side.
revoke insert, update on public.work_order_labor from authenticated;
grant insert (work_order_id, employee_id, started_at, ended_at, hours, notes) on public.work_order_labor to authenticated;
grant update (started_at, ended_at, hours, notes) on public.work_order_labor to authenticated;

-- ============================================================
-- Bookings
-- ============================================================
create or replace function app.workshop_booking_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client boolean := coalesce(nullif(current_setting('role', true), ''), 'none') in ('authenticated', 'anon')
                      and pg_trigger_depth() <= 1;
  v_bay public.workshop_bays%rowtype;
  v_wo_status text;
  v_slot_changed boolean;
begin
  if tg_op = 'DELETE' then
    if v_client and old.status not in ('scheduled', 'canceled') then
      raise exception 'BOOKING_NOT_DELETABLE';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if v_client then
      new.status := 'scheduled';
      new.started_at := null;
      new.finished_at := null;
    end if;
    select w.status into v_wo_status from public.work_orders w where w.id = new.work_order_id;
    if v_wo_status in ('completed', 'canceled') then
      raise exception 'WORK_ORDER_CLOSED';
    end if;
  else
    if v_client and new.work_order_id is distinct from old.work_order_id then
      raise exception 'FORBIDDEN';
    end if;
    if old.status in ('done', 'canceled') and v_client
       and (new.status is distinct from old.status or new.bay_id is distinct from old.bay_id
            or new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at) then
      raise exception 'BOOKING_LOCKED';
    end if;
    if new.status is distinct from old.status then
      if not ((old.status = 'scheduled' and new.status in ('in_progress', 'canceled'))
              or (old.status = 'in_progress' and new.status = 'done')) then
        raise exception 'ILLEGAL_BOOKING_TRANSITION';
      end if;
      if new.status = 'in_progress' then
        new.started_at := now();
      elsif new.status = 'done' then
        new.finished_at := now();
      end if;
    end if;
  end if;

  v_slot_changed := tg_op = 'INSERT' or new.bay_id is distinct from old.bay_id
                    or new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at
                    or (new.status is distinct from old.status and new.status = 'in_progress');
  -- (a reversed slot is left to workshop_bookings_slot_ck)
  if new.status in ('scheduled', 'in_progress') and v_slot_changed and new.ends_at > new.starts_at then
    -- Serialize bookings per bay so two sessions can't both pass the check.
    perform pg_advisory_xact_lock(hashtextextended('workshop_bay:' || new.bay_id::text, 0));
    select * into v_bay from public.workshop_bays b where b.id = new.bay_id;
    if new.status = 'scheduled' and (not v_bay.active or v_bay.status = 'out_of_service') then
      raise exception 'WORKSHOP_BAY_UNAVAILABLE';
    end if;
    if exists (select 1 from public.workshop_bookings o
               where o.bay_id = new.bay_id and o.id <> new.id and o.status in ('scheduled', 'in_progress')
                 and tstzrange(o.starts_at, o.ends_at, '[)') && tstzrange(new.starts_at, new.ends_at, '[)')) then
      raise exception 'WORKSHOP_BAY_CONFLICT';
    end if;
    if new.status = 'in_progress' and exists (
         select 1 from public.workshop_bookings o
         where o.bay_id = new.bay_id and o.id <> new.id and o.status = 'in_progress') then
      raise exception 'WORKSHOP_BAY_BUSY';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function app.workshop_booking_guard() from public, anon, authenticated;

-- Bay occupancy and the work order's status follow the bookings.
create or replace function app.workshop_booking_after()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bay uuid;
begin
  foreach v_bay in array array_remove(array[
      case when tg_op <> 'INSERT' then old.bay_id end,
      case when tg_op <> 'DELETE' then new.bay_id end], null) loop
    update public.workshop_bays b
       set status = case when exists (select 1 from public.workshop_bookings k
                                       where k.bay_id = b.id and k.status = 'in_progress') then 'occupied'
                         when b.status = 'occupied' then 'available'
                         else b.status end
     where b.id = v_bay;
  end loop;
  if tg_op = 'UPDATE' and new.status = 'in_progress' and old.status <> 'in_progress' then
    update public.work_orders w set status = 'in_progress' where w.id = new.work_order_id and w.status = 'open';
  end if;
  return null;
end;
$$;
revoke execute on function app.workshop_booking_after() from public, anon, authenticated;

create trigger workshop_bays_updated_at before update on public.workshop_bays
  for each row execute function app.set_updated_at();
create trigger workshop_bays_stamp_actor before insert or update on public.workshop_bays
  for each row execute function app.stamp_actor();
create trigger workshop_bays_audit after insert or update or delete on public.workshop_bays
  for each row execute function app.log_audit();

create trigger workshop_bookings_guard before insert or update or delete on public.workshop_bookings
  for each row execute function app.workshop_booking_guard();
create trigger workshop_bookings_stamp_actor before insert or update on public.workshop_bookings
  for each row execute function app.stamp_actor();
create trigger workshop_bookings_same_tenant before insert or update of bay_id, work_order_id on public.workshop_bookings
  for each row execute function app.assert_same_tenant('bay_id', 'workshop_bays', 'work_order_id', 'work_orders');
create trigger workshop_bookings_after after insert or update of status, bay_id or delete on public.workshop_bookings
  for each row execute function app.workshop_booking_after();
create trigger workshop_bookings_audit after insert or update or delete on public.workshop_bookings
  for each row execute function app.log_audit();

-- ============================================================
-- Labor
-- ============================================================
create or replace function app.work_order_labor_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client boolean := coalesce(nullif(current_setting('role', true), ''), 'none') in ('authenticated', 'anon')
                      and pg_trigger_depth() <= 1;
  v_wo_status text;
  v_emp public.employees%rowtype;
  v_clock_off boolean;
begin
  select w.status into v_wo_status from public.work_orders w
   where w.id = case when tg_op = 'DELETE' then old.work_order_id else new.work_order_id end;
  v_clock_off := tg_op = 'UPDATE' and old.ended_at is null and new.ended_at is not null;
  if v_client and v_wo_status in ('completed', 'canceled') and not v_clock_off then
    raise exception 'WORK_ORDER_CLOSED';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;

  if tg_op = 'INSERT' then
    select * into v_emp from public.employees e where e.id = new.employee_id;
    if v_emp.status is distinct from 'active' then
      raise exception 'EMPLOYEE_NOT_ACTIVE';
    end if;
    new.hourly_rate := coalesce(v_emp.hourly_rate, 0);
    new.work_order_line_id := null;
  else
    if v_client and (new.work_order_id is distinct from old.work_order_id or new.employee_id is distinct from old.employee_id) then
      raise exception 'FORBIDDEN';
    end if;
    if old.ended_at is not null and new.ended_at is null then
      raise exception 'INVALID_LABOR_TIME';
    end if;
  end if;

  if new.ended_at is null then
    new.hours := null;
    if (tg_op = 'INSERT' or old.ended_at is not null) and exists (
         select 1 from public.work_order_labor l where l.employee_id = new.employee_id and l.ended_at is null and l.id <> new.id) then
      raise exception 'LABOR_ALREADY_CLOCKED_ON';
    end if;
    if new.started_at > now() + interval '5 minutes' then
      raise exception 'INVALID_LABOR_TIME';
    end if;
  else
    if new.ended_at < new.started_at or new.ended_at > now() + interval '5 minutes' then
      raise exception 'INVALID_LABOR_TIME';
    end if;
    if new.hours is null or (tg_op = 'UPDATE' and new.hours is not distinct from old.hours
                             and (new.started_at is distinct from old.started_at or new.ended_at is distinct from old.ended_at)) then
      new.hours := round(extract(epoch from (new.ended_at - new.started_at)) / 3600.0, 2);
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function app.work_order_labor_guard() from public, anon, authenticated;

-- Each finished entry keeps one 'labor' line on its work order.
create or replace function app.work_order_labor_sync_line()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_line uuid;
begin
  if tg_op = 'DELETE' then
    if old.work_order_line_id is not null then
      delete from public.work_order_lines l where l.id = old.work_order_line_id;
    end if;
    return null;
  end if;
  if new.hours is null then
    return null;
  end if;
  select btrim(e.first_name || ' ' || coalesce(e.last_name, '')) into v_name from public.employees e where e.id = new.employee_id;
  update public.work_order_lines l
     set description = coalesce(v_name, 'Labor'), quantity = new.hours, unit_cost = round(new.hourly_rate, 2)
   where l.id = new.work_order_line_id
  returning l.id into v_line;
  if v_line is null then
    insert into public.work_order_lines (tenant_id, work_order_id, category, description, quantity, unit_cost)
    values (new.tenant_id, new.work_order_id, 'labor', coalesce(v_name, 'Labor'), new.hours, round(new.hourly_rate, 2))
    returning id into v_line;
    update public.work_order_labor set work_order_line_id = v_line where id = new.id;
  end if;
  return null;
end;
$$;
revoke execute on function app.work_order_labor_sync_line() from public, anon, authenticated;

create trigger work_order_labor_guard before insert or update or delete on public.work_order_labor
  for each row execute function app.work_order_labor_guard();
create trigger work_order_labor_stamp_actor before insert or update on public.work_order_labor
  for each row execute function app.stamp_actor();
create trigger work_order_labor_same_tenant before insert or update of work_order_id, employee_id on public.work_order_labor
  for each row execute function app.assert_same_tenant('work_order_id', 'work_orders', 'employee_id', 'employees');
create trigger work_order_labor_sync after insert or update of hours, hourly_rate or delete on public.work_order_labor
  for each row execute function app.work_order_labor_sync_line();
create trigger work_order_labor_audit after insert or update or delete on public.work_order_labor
  for each row execute function app.log_audit();

-- ============================================================
-- RPCs
-- ============================================================

-- A manager may clock anyone; anyone else only the employee linked to their login.
create or replace function app.workshop_may_clock(p_employee uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app.is_manager(), false)
      or exists (select 1 from public.employees e
                 where e.id = p_employee and e.tenant_id = app.tenant_id() and e.user_id = auth.uid());
$$;
revoke execute on function app.workshop_may_clock(uuid) from public, anon;
grant execute on function app.workshop_may_clock(uuid) to authenticated;

create or replace function public.workshop_clock_on(p_work_order_id uuid, p_employee_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.require_module('workshop', 'member');
  v_id uuid;
begin
  if not app.workshop_may_clock(p_employee_id) then
    raise exception 'FORBIDDEN';
  end if;
  if not exists (select 1 from public.work_orders w where w.id = p_work_order_id and w.tenant_id = v_tenant) then
    raise exception 'WORK_ORDER_NOT_FOUND';
  end if;
  if not exists (select 1 from public.employees e where e.id = p_employee_id and e.tenant_id = v_tenant) then
    raise exception 'EMPLOYEE_NOT_ACTIVE';
  end if;
  insert into public.work_order_labor (tenant_id, work_order_id, employee_id, started_at)
  values (v_tenant, p_work_order_id, p_employee_id, now())
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.workshop_clock_on(uuid, uuid) from public, anon;
grant execute on function public.workshop_clock_on(uuid, uuid) to authenticated;

create or replace function public.workshop_clock_off(p_labor_id uuid, p_notes text default null)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.require_module('workshop', 'member');
  v_l public.work_order_labor%rowtype;
  v_hours numeric;
begin
  select * into v_l from public.work_order_labor l where l.id = p_labor_id and l.tenant_id = v_tenant for update;
  if not found or v_l.ended_at is not null then
    raise exception 'LABOR_NOT_FOUND';
  end if;
  if not app.workshop_may_clock(v_l.employee_id) then
    raise exception 'FORBIDDEN';
  end if;
  update public.work_order_labor
     set ended_at = greatest(now(), v_l.started_at),
         notes = coalesce(nullif(btrim(p_notes), ''), notes)
   where id = p_labor_id
  returning hours into v_hours;
  return v_hours;
end;
$$;
revoke execute on function public.workshop_clock_off(uuid, text) from public, anon;
grant execute on function public.workshop_clock_off(uuid, text) to authenticated;

-- Parts from stock onto a work order: one consumption move and one 'part' line.
create or replace function public.workshop_issue_part(
  p_work_order_id uuid, p_item_id uuid, p_warehouse_id uuid, p_qty numeric
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.require_module('workshop', 'manager');
  v_wo_status text;
  v_item public.inventory_items%rowtype;
  v_line uuid;
begin
  if not app.tenant_module_enabled(v_tenant, 'inventory') then
    raise exception 'INVENTORY_DISABLED';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'INVALID_QUANTITY';
  end if;
  select w.status into v_wo_status from public.work_orders w where w.id = p_work_order_id and w.tenant_id = v_tenant for update;
  if not found then
    raise exception 'WORK_ORDER_NOT_FOUND';
  end if;
  if v_wo_status in ('completed', 'canceled') then
    raise exception 'WORK_ORDER_CLOSED';
  end if;

  perform app.post_stock_move(v_tenant, p_item_id, p_warehouse_id, 'consumption', -p_qty, null,
                              'work_order', p_work_order_id, null);
  -- Cost after the move (consumption doesn't change the moving average).
  select * into v_item from public.inventory_items i where i.id = p_item_id;
  insert into public.work_order_lines (tenant_id, work_order_id, category, description, quantity, unit_cost)
  values (v_tenant, p_work_order_id, 'part',
          v_item.name || coalesce(' (' || nullif(v_item.sku, '') || ')', ''), round(p_qty, 2), round(v_item.cost_price, 2))
  returning id into v_line;
  return v_line;
end;
$$;
revoke execute on function public.workshop_issue_part(uuid, uuid, uuid, numeric) from public, anon;
grant execute on function public.workshop_issue_part(uuid, uuid, uuid, numeric) to authenticated;

-- ============================================================
-- RLS: members read; managers write. Clocking goes through the RPCs.
-- ============================================================
set local lock_timeout = '1s';
create policy workshop_bays_select on public.workshop_bays for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.module_enabled('workshop')));
create policy workshop_bays_insert on public.workshop_bays for insert to authenticated
  with check (tenant_id = (select app.tenant_id()) and (select app.is_manager()) and (select app.module_enabled('workshop')));
create policy workshop_bays_update on public.workshop_bays for update to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_manager()) and (select app.module_enabled('workshop')))
  with check (tenant_id = (select app.tenant_id()) and (select app.is_manager()) and (select app.module_enabled('workshop')));
create policy workshop_bays_delete on public.workshop_bays for delete to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_manager()) and (select app.module_enabled('workshop')));

create policy workshop_bookings_select on public.workshop_bookings for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.module_enabled('workshop')));
create policy workshop_bookings_insert on public.workshop_bookings for insert to authenticated
  with check (tenant_id = (select app.tenant_id()) and (select app.is_manager()) and (select app.module_enabled('workshop')));
create policy workshop_bookings_update on public.workshop_bookings for update to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_manager()) and (select app.module_enabled('workshop')))
  with check (tenant_id = (select app.tenant_id()) and (select app.is_manager()) and (select app.module_enabled('workshop')));
create policy workshop_bookings_delete on public.workshop_bookings for delete to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_manager()) and (select app.module_enabled('workshop')));

create policy work_order_labor_select on public.work_order_labor for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.module_enabled('workshop')));
create policy work_order_labor_insert on public.work_order_labor for insert to authenticated
  with check (tenant_id = (select app.tenant_id()) and (select app.is_manager()) and (select app.module_enabled('workshop')));
create policy work_order_labor_update on public.work_order_labor for update to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_manager()) and (select app.module_enabled('workshop')))
  with check (tenant_id = (select app.tenant_id()) and (select app.is_manager()) and (select app.module_enabled('workshop')));
create policy work_order_labor_delete on public.work_order_labor for delete to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_manager()) and (select app.module_enabled('workshop')));
