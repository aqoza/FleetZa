-- Trip planning (module trip_planning): multi-stop trips per vehicle and
-- driver, with double-booking checks and plan-versus-actual figures.
--
-- 1) trips: numbered TRP-00001 (app.assign_doc_number, doc type 'trip').
--    status planned → dispatched → in_progress → completed, and
--    planned | dispatched → canceled (app.trip_guard; ILLEGAL_TRIP_TRANSITION).
--    Dispatching (and editing a dispatched or running trip) is refused when
--    the vehicle or driver is already on another dispatched or running trip
--    in an overlapping planned window (TRIP_VEHICLE_CONFLICT /
--    TRIP_DRIVER_CONFLICT), or the vehicle is retired / out of service
--    (VEHICLE_NOT_AVAILABLE). Planned trips only warn: public.trip_conflicts.
--    Starting stamps actual_start and takes the vehicle's odometer as
--    start_odometer unless given; completing stamps actual_end, and an
--    end_odometer raises the vehicle odometer (same rule as
--    app.bump_vehicle_odometer). Completed and canceled trips are locked
--    except for notes (TRIP_LOCKED); only planned trips can be deleted
--    (TRIP_NOT_DELETABLE).
--    estimated_fuel_l / estimated_cost are server-computed from the planned
--    distance and the vehicle's last 180 days of fuel logs
--    (app.trip_fuel_rate, mirrored by shared/trips.ts fuelRate()).
-- 2) trip_stops: ordered stops (sequence unique per trip, deferrable so
--    public.trip_stops_reorder can renumber in one statement). Stop status
--    pending → arrived → departed, or pending → skipped, only while the trip
--    is in progress (STOP_TRIP_NOT_STARTED / ILLEGAL_STOP_TRANSITION).
-- 3) Automation events trip.dispatched and trip.completed.
--
-- Guards apply to client sessions (authenticated); cascades from a tenant or
-- trip delete and trusted sessions are not blocked.
--
-- Raised codes: ILLEGAL_TRIP_TRANSITION, TRIP_LOCKED, TRIP_NOT_DELETABLE,
-- TRIP_VEHICLE_CONFLICT, TRIP_DRIVER_CONFLICT, VEHICLE_NOT_AVAILABLE,
-- INVALID_TRIP_ODOMETER, INVALID_TRIP_TIMES, ILLEGAL_STOP_TRANSITION,
-- STOP_TRIP_NOT_STARTED, STOP_LIST_MISMATCH (+ CROSS_TENANT_REFERENCE).
-- Additive only.

set local lock_timeout = '3s';
set local statement_timeout = '60s';

-- ============================================================
-- Tables
-- ============================================================
create table public.trips (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  number integer,
  doc_number text,
  vehicle_id uuid not null references public.vehicles(id) on delete restrict,
  driver_id uuid references public.drivers(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  status text not null default 'planned'
    check (status in ('planned', 'dispatched', 'in_progress', 'completed', 'canceled')),
  purpose text not null check (char_length(btrim(purpose)) between 1 and 200),
  planned_start timestamptz not null,
  planned_end timestamptz not null,
  actual_start timestamptz,
  actual_end timestamptz,
  start_odometer numeric(12,1) check (start_odometer is null or start_odometer >= 0),
  end_odometer numeric(12,1) check (end_odometer is null or end_odometer >= 0),
  planned_distance_km numeric(10,1) check (planned_distance_km is null or planned_distance_km between 0 and 100000),
  actual_distance_km numeric(12,1) generated always as (
    case when start_odometer is not null and end_odometer is not null then end_odometer - start_odometer end
  ) stored,
  estimated_fuel_l numeric(10,1),
  estimated_cost numeric(14,2),
  notes text check (notes is null or char_length(notes) <= 4000),
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 1000),
  dispatched_at timestamptz,
  completed_at timestamptz,
  canceled_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trips_window_ck check (planned_end > planned_start)
);
create unique index trips_tenant_number_uk on public.trips (tenant_id, number);
create unique index trips_tenant_doc_number_uk on public.trips (tenant_id, doc_number);
create index trips_tenant_start_idx on public.trips (tenant_id, planned_start desc);
create index trips_vehicle_idx on public.trips (vehicle_id, planned_start);
create index trips_driver_idx on public.trips (driver_id, planned_start) where driver_id is not null;
create index trips_customer_idx on public.trips (customer_id) where customer_id is not null;

create table public.trip_stops (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  trip_id uuid not null references public.trips(id) on delete cascade,
  sequence integer not null check (sequence between 1 and 1000),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  address text check (address is null or char_length(address) <= 500),
  lat numeric(9,6) check (lat is null or lat between -90 and 90),
  lng numeric(9,6) check (lng is null or lng between -180 and 180),
  planned_arrival timestamptz,
  actual_arrival timestamptz,
  actual_departure timestamptz,
  status text not null default 'pending' check (status in ('pending', 'arrived', 'departed', 'skipped')),
  notes text check (notes is null or char_length(notes) <= 2000),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trip_stops_trip_seq_uk unique (trip_id, sequence) deferrable initially immediate,
  constraint trip_stops_latlng_ck check ((lat is null) = (lng is null))
);
create index trip_stops_tenant_idx on public.trip_stops (tenant_id);

alter table public.trips enable row level security;
alter table public.trip_stops enable row level security;
revoke all on public.trips, public.trip_stops from anon;
-- Numbers, stamps and estimates are server-side: clients write only these columns.
revoke insert, update on public.trips from authenticated;
grant insert (vehicle_id, driver_id, customer_id, purpose, planned_start, planned_end, planned_distance_km, notes)
  on public.trips to authenticated;
grant update (vehicle_id, driver_id, customer_id, purpose, planned_start, planned_end, planned_distance_km, notes,
              status, actual_start, actual_end, start_odometer, end_odometer, cancel_reason)
  on public.trips to authenticated;
revoke insert, update on public.trip_stops from authenticated;
grant insert (trip_id, sequence, name, address, lat, lng, planned_arrival, notes) on public.trip_stops to authenticated;
grant update (sequence, name, address, lat, lng, planned_arrival, status, actual_arrival, actual_departure, notes)
  on public.trip_stops to authenticated;

-- ============================================================
-- Helpers
-- ============================================================

-- True for PostgREST client sessions; migrations, service role and cascades
-- run as trusted.
create or replace function app.trip_client_session()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(nullif(current_setting('role', true), ''), 'none') in ('authenticated', 'anon')
     and pg_trigger_depth() <= 1;
$$;
revoke execute on function app.trip_client_session() from public, anon, authenticated;

-- Liters per 100 km and price per liter from a vehicle's last 180 days of
-- fuel logs. Mirrors shared/trips.ts fuelRate(): liters of every fill after
-- the lowest-odometer one over the odometer span (≥ 100 km, ≥ 2 fills).
create or replace function app.trip_fuel_rate(p_vehicle uuid, out l_per_100km numeric, out price_per_l numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_liters numeric;
  v_cost numeric;
  v_min numeric;
  v_max numeric;
  v_n integer;
  v_first numeric;
begin
  select sum(f.volume), sum(f.total_cost) into v_liters, v_cost
  from public.fuel_logs f
  where f.vehicle_id = p_vehicle and f.volume > 0 and f.filled_at >= now() - interval '180 days';
  price_per_l := case when v_liters > 0 and v_cost > 0 then round(v_cost / v_liters, 3) end;

  select min(f.odometer), max(f.odometer), count(*) into v_min, v_max, v_n
  from public.fuel_logs f
  where f.vehicle_id = p_vehicle and f.volume > 0 and f.odometer > 0 and f.filled_at >= now() - interval '180 days';
  if v_n < 2 or v_max - v_min < 100 then
    l_per_100km := null;
    return;
  end if;
  select f.volume into v_first
  from public.fuel_logs f
  where f.vehicle_id = p_vehicle and f.volume > 0 and f.odometer > 0 and f.filled_at >= now() - interval '180 days'
  order by f.odometer, f.filled_at
  limit 1;
  select round((sum(f.volume) - v_first) / (v_max - v_min) * 100, 1) into l_per_100km
  from public.fuel_logs f
  where f.vehicle_id = p_vehicle and f.volume > 0 and f.odometer > 0 and f.filled_at >= now() - interval '180 days';
end;
$$;
revoke execute on function app.trip_fuel_rate(uuid) from public, anon, authenticated;

-- Another dispatched or running trip holding the vehicle (or driver) in an
-- overlapping window: 'vehicle', 'driver' or null.
create or replace function app.trip_hard_conflict(
  p_tenant uuid, p_trip uuid, p_vehicle uuid, p_driver uuid, p_start timestamptz, p_end timestamptz
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (select 1 from public.trips t
                 where t.tenant_id = p_tenant and t.id <> p_trip and t.vehicle_id = p_vehicle
                   and t.status in ('dispatched', 'in_progress')
                   and t.planned_start < p_end and p_start < t.planned_end) then 'vehicle'
    when p_driver is not null and exists (select 1 from public.trips t
                 where t.tenant_id = p_tenant and t.id <> p_trip and t.driver_id = p_driver
                   and t.status in ('dispatched', 'in_progress')
                   and t.planned_start < p_end and p_start < t.planned_end) then 'driver'
  end;
$$;
revoke execute on function app.trip_hard_conflict(uuid, uuid, uuid, uuid, timestamptz, timestamptz)
  from public, anon, authenticated;

-- ============================================================
-- trips: state machine, stamps, estimates
-- ============================================================
create or replace function app.trip_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client boolean := app.trip_client_session();
  v_rate record;
  v_conflict text;
  v_vstatus text;
  v_odo numeric;
begin
  if tg_op = 'DELETE' then
    if v_client and old.status <> 'planned' then
      raise exception 'TRIP_NOT_DELETABLE';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if v_client then
      new.status := 'planned';
      new.actual_start := null;
      new.actual_end := null;
      new.start_odometer := null;
      new.end_odometer := null;
      new.dispatched_at := null;
      new.completed_at := null;
      new.canceled_at := null;
    end if;
  else
    if old.status in ('completed', 'canceled') and v_client and (
         new.status is distinct from old.status or new.vehicle_id is distinct from old.vehicle_id
         or new.driver_id is distinct from old.driver_id or new.customer_id is distinct from old.customer_id
         or new.purpose is distinct from old.purpose or new.planned_start is distinct from old.planned_start
         or new.planned_end is distinct from old.planned_end or new.actual_start is distinct from old.actual_start
         or new.actual_end is distinct from old.actual_end or new.start_odometer is distinct from old.start_odometer
         or new.end_odometer is distinct from old.end_odometer
         or new.planned_distance_km is distinct from old.planned_distance_km
         or new.cancel_reason is distinct from old.cancel_reason) then
      raise exception 'TRIP_LOCKED';
    end if;
    if old.status = 'in_progress' and new.vehicle_id is distinct from old.vehicle_id then
      raise exception 'TRIP_LOCKED';
    end if;

    if new.status is distinct from old.status then
      if not (
           (old.status = 'planned' and new.status in ('dispatched', 'canceled'))
        or (old.status = 'dispatched' and new.status in ('in_progress', 'canceled'))
        or (old.status = 'in_progress' and new.status = 'completed')) then
        raise exception 'ILLEGAL_TRIP_TRANSITION';
      end if;
      case new.status
        when 'dispatched' then
          new.dispatched_at := now();
        when 'in_progress' then
          new.actual_start := coalesce(new.actual_start, now());
          if new.start_odometer is null then
            select v.odometer into v_odo from public.vehicles v where v.id = new.vehicle_id;
            new.start_odometer := nullif(v_odo, 0);
          end if;
        when 'completed' then
          new.actual_end := coalesce(new.actual_end, now());
          new.completed_at := now();
        when 'canceled' then
          new.canceled_at := now();
        else
          null;
      end case;
    end if;
  end if;

  if new.start_odometer is not null and new.end_odometer is not null and new.end_odometer < new.start_odometer then
    raise exception 'INVALID_TRIP_ODOMETER';
  end if;
  if new.actual_start is not null and new.actual_end is not null and new.actual_end < new.actual_start then
    raise exception 'INVALID_TRIP_TIMES';
  end if;

  -- Hard checks once the trip holds its vehicle and driver.
  if new.status in ('dispatched', 'in_progress') and (
       tg_op = 'INSERT' or new.status is distinct from old.status
       or new.vehicle_id is distinct from old.vehicle_id or new.driver_id is distinct from old.driver_id
       or new.planned_start is distinct from old.planned_start or new.planned_end is distinct from old.planned_end) then
    if new.status = 'dispatched' and (tg_op = 'INSERT' or old.status = 'planned' or new.vehicle_id is distinct from old.vehicle_id) then
      select v.status into v_vstatus from public.vehicles v where v.id = new.vehicle_id;
      if v_vstatus in ('retired', 'out_of_service') then
        raise exception 'VEHICLE_NOT_AVAILABLE';
      end if;
    end if;
    v_conflict := app.trip_hard_conflict(new.tenant_id, new.id, new.vehicle_id, new.driver_id,
                                         new.planned_start, new.planned_end);
    if v_conflict = 'vehicle' then
      raise exception 'TRIP_VEHICLE_CONFLICT';
    elsif v_conflict = 'driver' then
      raise exception 'TRIP_DRIVER_CONFLICT';
    end if;
  end if;

  if new.status not in ('completed', 'canceled') and (
       tg_op = 'INSERT' or new.planned_distance_km is distinct from old.planned_distance_km
       or new.vehicle_id is distinct from old.vehicle_id) then
    if new.planned_distance_km is null then
      new.estimated_fuel_l := null;
      new.estimated_cost := null;
    else
      select * into v_rate from app.trip_fuel_rate(new.vehicle_id);
      new.estimated_fuel_l := case when v_rate.l_per_100km is not null
                                   then round(new.planned_distance_km * v_rate.l_per_100km / 100, 1) end;
      new.estimated_cost := case when new.estimated_fuel_l is not null and v_rate.price_per_l is not null
                                 then round(new.estimated_fuel_l * v_rate.price_per_l, 2) end;
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function app.trip_guard() from public, anon, authenticated;

-- After a status change: raise the vehicle odometer on completion and emit
-- the automation events.
create or replace function app.trip_after()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = old.status then
    return null;
  end if;
  if new.status = 'completed' then
    if new.end_odometer is not null and new.end_odometer > 0 then
      update public.vehicles v
         set odometer = new.end_odometer, odometer_updated_at = now()
       where v.id = new.vehicle_id and v.tenant_id = new.tenant_id and v.odometer < new.end_odometer;
    end if;
    perform app.emit_event(new.tenant_id, 'trip.completed', 'trip', new.id,
      jsonb_build_object('trip_id', new.id, 'doc_number', new.doc_number, 'vehicle_id', new.vehicle_id,
        'driver_id', new.driver_id, 'purpose', new.purpose, 'planned_distance_km', new.planned_distance_km,
        'actual_distance_km', new.actual_distance_km),
      'trip.completed:' || new.id);
  elsif new.status = 'dispatched' then
    perform app.emit_event(new.tenant_id, 'trip.dispatched', 'trip', new.id,
      jsonb_build_object('trip_id', new.id, 'doc_number', new.doc_number, 'vehicle_id', new.vehicle_id,
        'driver_id', new.driver_id, 'purpose', new.purpose, 'planned_start', new.planned_start,
        'planned_distance_km', new.planned_distance_km),
      'trip.dispatched:' || new.id);
  end if;
  return null;
end;
$$;
revoke execute on function app.trip_after() from public, anon, authenticated;

create trigger trips_number
  before insert or update of number, doc_number on public.trips
  for each row execute function app.assign_doc_number('trip', 'TRP');
create trigger trips_guard before insert or update or delete on public.trips
  for each row execute function app.trip_guard();
create trigger trips_stamp_actor before insert or update on public.trips
  for each row execute function app.stamp_actor();
create trigger trips_same_tenant before insert or update of vehicle_id, driver_id, customer_id on public.trips
  for each row execute function app.assert_same_tenant('vehicle_id', 'vehicles', 'driver_id', 'drivers',
                                                      'customer_id', 'customers');
create trigger trips_after after update of status on public.trips
  for each row execute function app.trip_after();
create trigger trips_audit after insert or update or delete on public.trips
  for each row execute function app.log_audit();

-- ============================================================
-- trip_stops: lock with the trip, stop status, sequence default
-- ============================================================
create or replace function app.trip_stop_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client boolean := app.trip_client_session();
  v_trip_status text;
begin
  select t.status into v_trip_status
  from public.trips t where t.id = case when tg_op = 'DELETE' then old.trip_id else new.trip_id end;

  if tg_op = 'DELETE' then
    if v_client and v_trip_status in ('completed', 'canceled') then
      raise exception 'TRIP_LOCKED';
    end if;
    return old;
  end if;

  if v_client and v_trip_status in ('completed', 'canceled') then
    raise exception 'TRIP_LOCKED';
  end if;

  if tg_op = 'INSERT' then
    if v_client then
      new.status := 'pending';
      new.actual_arrival := null;
      new.actual_departure := null;
    end if;
    if new.sequence is null then
      select coalesce(max(s.sequence), 0) + 1 into new.sequence from public.trip_stops s where s.trip_id = new.trip_id;
    end if;
  else
    if new.trip_id is distinct from old.trip_id then
      raise exception 'TRIP_LOCKED';
    end if;
    if new.status is distinct from old.status then
      if v_trip_status <> 'in_progress' then
        raise exception 'STOP_TRIP_NOT_STARTED';
      end if;
      if not ((old.status = 'pending' and new.status in ('arrived', 'skipped'))
              or (old.status = 'arrived' and new.status = 'departed')) then
        raise exception 'ILLEGAL_STOP_TRANSITION';
      end if;
      if new.status = 'arrived' then
        new.actual_arrival := coalesce(new.actual_arrival, now());
      elsif new.status = 'departed' then
        new.actual_departure := coalesce(new.actual_departure, now());
      end if;
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function app.trip_stop_guard() from public, anon, authenticated;

create trigger trip_stops_guard before insert or update or delete on public.trip_stops
  for each row execute function app.trip_stop_guard();
create trigger trip_stops_stamp_actor before insert or update on public.trip_stops
  for each row execute function app.stamp_actor();
create trigger trip_stops_same_tenant before insert on public.trip_stops
  for each row execute function app.assert_same_tenant('trip_id', 'trips');

-- ============================================================
-- RPCs
-- ============================================================

-- Overlapping trips that still hold the vehicle or the driver (planned,
-- dispatched or running), for the planner's warnings. Runs under RLS.
create or replace function public.trip_conflicts(
  p_vehicle_id uuid,
  p_driver_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_exclude uuid default null
)
returns table (
  trip_id uuid,
  doc_number text,
  status text,
  purpose text,
  planned_start timestamptz,
  planned_end timestamptz,
  vehicle_clash boolean,
  driver_clash boolean
)
language sql
stable
set search_path = ''
as $$
  select t.id, t.doc_number, t.status, t.purpose, t.planned_start, t.planned_end,
         t.vehicle_id = p_vehicle_id,
         p_driver_id is not null and t.driver_id is not distinct from p_driver_id
  from public.trips t
  where t.status in ('planned', 'dispatched', 'in_progress')
    and (p_exclude is null or t.id <> p_exclude)
    and t.planned_start < p_end and p_start < t.planned_end
    and (t.vehicle_id = p_vehicle_id or (p_driver_id is not null and t.driver_id = p_driver_id))
  order by t.planned_start
  limit 50;
$$;
revoke execute on function public.trip_conflicts(uuid, uuid, timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.trip_conflicts(uuid, uuid, timestamptz, timestamptz, uuid) to authenticated;

-- Renumber a trip's stops in the given order (every stop exactly once).
create or replace function public.trip_stops_reorder(p_trip_id uuid, p_stop_ids uuid[])
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform app.require_module('trip_planning', 'manager');
  select count(*) into v_count from public.trip_stops s where s.trip_id = p_trip_id;
  if p_stop_ids is null or cardinality(p_stop_ids) <> v_count
     or (select count(distinct x) from unnest(p_stop_ids) x) <> v_count
     or exists (select 1 from unnest(p_stop_ids) x
                where not exists (select 1 from public.trip_stops s where s.id = x and s.trip_id = p_trip_id)) then
    raise exception 'STOP_LIST_MISMATCH';
  end if;
  set constraints public.trip_stops_trip_seq_uk deferred;
  update public.trip_stops s
     set sequence = o.ord
    from unnest(p_stop_ids) with ordinality as o(id, ord)
   where s.id = o.id and s.trip_id = p_trip_id and s.sequence is distinct from o.ord::integer;
  set constraints public.trip_stops_trip_seq_uk immediate;
end;
$$;
revoke execute on function public.trip_stops_reorder(uuid, uuid[]) from public, anon;
grant execute on function public.trip_stops_reorder(uuid, uuid[]) to authenticated;

-- ============================================================
-- RLS: members read; managers write.
-- ============================================================
set local lock_timeout = '1s';
do $$
declare
  t text;
begin
  foreach t in array array['trips', 'trip_stops'] loop
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (tenant_id = (select app.tenant_id()) and (select app.module_enabled(''trip_planning'')))',
      t || '_select', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check (tenant_id = (select app.tenant_id()) and (select app.is_manager())
                     and (select app.module_enabled(''trip_planning'')))',
      t || '_insert', t);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (tenant_id = (select app.tenant_id()) and (select app.is_manager())
                and (select app.module_enabled(''trip_planning'')))
         with check (tenant_id = (select app.tenant_id()) and (select app.is_manager())
                     and (select app.module_enabled(''trip_planning'')))',
      t || '_update', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated
         using (tenant_id = (select app.tenant_id()) and (select app.is_manager())
                and (select app.module_enabled(''trip_planning'')))',
      t || '_delete', t);
  end loop;
end;
$$;
