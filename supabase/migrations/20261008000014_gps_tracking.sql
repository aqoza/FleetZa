-- GPS tracking (module gps_tracking): position history, the live "last fix per
-- vehicle" table, geofences and the enter / exit events they produce.
--
-- 1) gps_positions: one row per fix (vehicle, recorded_at unique). Written by
--    the public API (POST /api/v1/positions, service role, source 'api') or by
--    managers (manual entry and CSV import, source 'manual' | 'import').
--    Fixes are immutable; managers may delete a bad one. A fix with no driver
--    takes the vehicle's assigned driver at recorded_at.
-- 2) vehicle_last_positions: server-maintained, one row per vehicle holding
--    its newest fix, so the live map is one query. Deleting that fix cascades
--    the row away and the after-delete trigger puts back the newest remaining.
-- 3) geofences: circle (center + radius) or polygon ([[lat, lng], ...]).
--    Containment is computed here (haversine / ray casting).
-- 4) geofence_events: written by the position trigger when a vehicle's newest
--    fix crosses a boundary (compared with its previous newest fix; a
--    vehicle's very first fix counts as coming from outside). Optional
--    notifications (gps.geofence_alert) and automation events
--    (geofence.entered / geofence.exited).
-- 5) A newer fix carrying odometer_km raises vehicles.odometer, never lowers
--    it (same rule as app.bump_vehicle_odometer).
--
-- Raised codes: INVALID_POSITION_TIME (+ CROSS_TENANT_REFERENCE, FORBIDDEN).
-- Additive only.

set local lock_timeout = '3s';
set local statement_timeout = '60s';

-- ============================================================
-- Tables
-- ============================================================
create table public.gps_positions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  driver_id uuid references public.drivers(id) on delete set null,
  recorded_at timestamptz not null,
  lat numeric(9, 6) not null check (lat between -90 and 90),
  lng numeric(9, 6) not null check (lng between -180 and 180),
  speed_kmh numeric(6, 1) check (speed_kmh is null or speed_kmh between 0 and 400),
  heading smallint check (heading is null or heading between 0 and 359),
  altitude_m numeric(8, 1) check (altitude_m is null or altitude_m between -500 and 9000),
  odometer_km numeric(12, 1) check (odometer_km is null or odometer_km >= 0),
  ignition boolean,
  source text not null default 'manual' check (source in ('api', 'manual', 'import')),
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (vehicle_id, recorded_at)
);
create index gps_positions_vehicle_idx on public.gps_positions (vehicle_id, recorded_at desc);
create index gps_positions_tenant_idx on public.gps_positions (tenant_id, recorded_at desc);
create index gps_positions_driver_idx on public.gps_positions (driver_id);
alter table public.gps_positions enable row level security;
revoke all on public.gps_positions from anon;
revoke insert, update on public.gps_positions from authenticated;
grant insert (vehicle_id, driver_id, recorded_at, lat, lng, speed_kmh, heading, altitude_m, odometer_km,
              ignition, source)
  on public.gps_positions to authenticated;

create table public.vehicle_last_positions (
  vehicle_id uuid primary key references public.vehicles(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  position_id uuid not null references public.gps_positions(id) on delete cascade,
  driver_id uuid references public.drivers(id) on delete set null,
  recorded_at timestamptz not null,
  lat numeric(9, 6) not null,
  lng numeric(9, 6) not null,
  speed_kmh numeric(6, 1),
  heading smallint,
  ignition boolean,
  updated_at timestamptz not null default now()
);
create index vehicle_last_positions_tenant_idx on public.vehicle_last_positions (tenant_id);
create index vehicle_last_positions_position_idx on public.vehicle_last_positions (position_id);
alter table public.vehicle_last_positions enable row level security;
revoke all on public.vehicle_last_positions from anon;
revoke insert, update, delete on public.vehicle_last_positions from authenticated;

create table public.geofences (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  kind text not null default 'circle' check (kind in ('circle', 'polygon')),
  center_lat numeric(9, 6) check (center_lat is null or center_lat between -90 and 90),
  center_lng numeric(9, 6) check (center_lng is null or center_lng between -180 and 180),
  radius_m integer check (radius_m is null or radius_m between 10 and 100000),
  polygon jsonb,
  color text not null default 'blue' check (color in ('blue', 'teal', 'amber', 'red')),
  active boolean not null default true,
  alert_on_enter boolean not null default false,
  alert_on_exit boolean not null default false,
  notes text check (notes is null or char_length(notes) <= 2000),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint geofences_shape check (
    (kind = 'circle' and center_lat is not null and center_lng is not null and radius_m is not null)
    or (kind = 'polygon' and coalesce(jsonb_typeof(polygon) = 'array'
        and jsonb_array_length(polygon) between 3 and 200, false))
  )
);
create index geofences_tenant_idx on public.geofences (tenant_id, active);
alter table public.geofences enable row level security;
revoke all on public.geofences from anon;
revoke insert, update on public.geofences from authenticated;
grant insert (name, kind, center_lat, center_lng, radius_m, polygon, color, active, alert_on_enter,
              alert_on_exit, notes)
  on public.geofences to authenticated;
grant update (name, kind, center_lat, center_lng, radius_m, polygon, color, active, alert_on_enter,
              alert_on_exit, notes)
  on public.geofences to authenticated;

create table public.geofence_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  geofence_id uuid not null references public.geofences(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  event text not null check (event in ('enter', 'exit')),
  at timestamptz not null,
  position_id uuid references public.gps_positions(id) on delete set null,
  created_at timestamptz not null default now()
);
create index geofence_events_tenant_idx on public.geofence_events (tenant_id, at desc);
create index geofence_events_geofence_idx on public.geofence_events (geofence_id, at desc);
create index geofence_events_vehicle_idx on public.geofence_events (vehicle_id, at desc);
create index geofence_events_position_idx on public.geofence_events (position_id);
alter table public.geofence_events enable row level security;
revoke all on public.geofence_events from anon;
revoke insert, update on public.geofence_events from authenticated;

-- ============================================================
-- Geometry
-- ============================================================
-- Great-circle distance in metres (haversine, mean Earth radius).
create or replace function app.geo_distance_m(p_lat1 numeric, p_lng1 numeric, p_lat2 numeric, p_lng2 numeric)
returns double precision
language sql
immutable
parallel safe
set search_path = ''
as $$
  select 2 * 6371008.8 * asin(least(1, sqrt(
    power(sin(radians((p_lat2 - p_lat1)::double precision) / 2), 2)
    + cos(radians(p_lat1::double precision)) * cos(radians(p_lat2::double precision))
      * power(sin(radians((p_lng2 - p_lng1)::double precision) / 2), 2)
  )));
$$;

-- Ray casting over [[lat, lng], ...]; fine for geofence-sized shapes.
create or replace function app.point_in_polygon(p_lat numeric, p_lng numeric, p_polygon jsonb)
returns boolean
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  n integer := coalesce(jsonb_array_length(p_polygon), 0);
  i integer;
  j integer;
  yi double precision;
  xi double precision;
  yj double precision;
  xj double precision;
  inside boolean := false;
begin
  if n < 3 then
    return false;
  end if;
  j := n - 1;
  for i in 0 .. n - 1 loop
    yi := (p_polygon -> i ->> 0)::double precision;
    xi := (p_polygon -> i ->> 1)::double precision;
    yj := (p_polygon -> j ->> 0)::double precision;
    xj := (p_polygon -> j ->> 1)::double precision;
    if ((yi > p_lat) <> (yj > p_lat))
       and (p_lng < (xj - xi) * (p_lat - yi) / (yj - yi) + xi) then
      inside := not inside;
    end if;
    j := i;
  end loop;
  return inside;
end;
$$;

create or replace function app.geofence_contains(p_fence public.geofences, p_lat numeric, p_lng numeric)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_lat is null or p_lng is null then false
    when p_fence.kind = 'circle' then
      app.geo_distance_m(p_fence.center_lat, p_fence.center_lng, p_lat, p_lng) <= p_fence.radius_m
    else app.point_in_polygon(p_lat, p_lng, p_fence.polygon)
  end;
$$;
grant execute on function app.geo_distance_m(numeric, numeric, numeric, numeric) to authenticated, service_role;
grant execute on function app.point_in_polygon(numeric, numeric, jsonb) to authenticated, service_role;
grant execute on function app.geofence_contains(public.geofences, numeric, numeric) to authenticated, service_role;

-- ============================================================
-- Position triggers
-- ============================================================
-- Before insert: API-only source, sane time, driver from the vehicle's
-- assignment at that moment. Invoker, so current_user is the writing role.
create or replace function app.gps_position_before()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.source = 'api' and current_user::text = 'authenticated' then
    raise exception 'FORBIDDEN';
  end if;
  if new.recorded_at > now() + interval '10 minutes' or new.recorded_at < timestamptz '2000-01-01' then
    raise exception 'INVALID_POSITION_TIME';
  end if;
  new.created_by := coalesce(new.created_by, auth.uid());
  if new.driver_id is null then
    select va.driver_id into new.driver_id
      from public.vehicle_assignments va
     where va.vehicle_id = new.vehicle_id
       and va.tenant_id = new.tenant_id
       and va.started_at <= new.recorded_at
       and (va.ended_at is null or va.ended_at > new.recorded_at)
     order by va.started_at desc
     limit 1;
  end if;
  return new;
end;
$$;
revoke execute on function app.gps_position_before() from public, anon, authenticated;

-- After insert: refresh the vehicle's newest fix, raise its odometer, and
-- detect geofence crossings. Older (backfilled) fixes are history only.
create or replace function app.gps_position_after()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev public.vehicle_last_positions;
  v_fence public.geofences;
  v_was boolean;
  v_now boolean;
  v_event uuid;
  v_kind text;
  v_vehicle text;
begin
  select * into v_prev from public.vehicle_last_positions where vehicle_id = new.vehicle_id;
  if v_prev.vehicle_id is not null and v_prev.recorded_at >= new.recorded_at then
    return null;
  end if;

  insert into public.vehicle_last_positions as l
    (vehicle_id, tenant_id, position_id, driver_id, recorded_at, lat, lng, speed_kmh, heading, ignition, updated_at)
  values
    (new.vehicle_id, new.tenant_id, new.id, new.driver_id, new.recorded_at, new.lat, new.lng, new.speed_kmh,
     new.heading, new.ignition, now())
  on conflict (vehicle_id) do update
     set position_id = excluded.position_id, driver_id = excluded.driver_id,
         recorded_at = excluded.recorded_at, lat = excluded.lat, lng = excluded.lng,
         speed_kmh = excluded.speed_kmh, heading = excluded.heading, ignition = excluded.ignition,
         updated_at = now()
   where l.recorded_at < excluded.recorded_at;

  if new.odometer_km is not null and new.odometer_km > 0 then
    update public.vehicles v
       set odometer = new.odometer_km,
           odometer_updated_at = now()
     where v.id = new.vehicle_id
       and v.tenant_id = new.tenant_id
       and v.odometer < new.odometer_km;
  end if;

  for v_fence in
    select * from public.geofences g where g.tenant_id = new.tenant_id and g.active
  loop
    v_was := v_prev.vehicle_id is not null and app.geofence_contains(v_fence, v_prev.lat, v_prev.lng);
    v_now := app.geofence_contains(v_fence, new.lat, new.lng);
    continue when v_was = v_now;
    v_kind := case when v_now then 'enter' else 'exit' end;

    insert into public.geofence_events (tenant_id, geofence_id, vehicle_id, event, at, position_id)
    values (new.tenant_id, v_fence.id, new.vehicle_id, v_kind, new.recorded_at, new.id)
    returning id into v_event;

    if v_vehicle is null then
      select v.name into v_vehicle from public.vehicles v where v.id = new.vehicle_id;
    end if;

    if (v_now and v_fence.alert_on_enter) or (not v_now and v_fence.alert_on_exit) then
      perform app.notify(
        new.tenant_id, 'managers', 'gps.geofence_alert', 'info',
        'geofence', v_fence.id, '/gps/events',
        jsonb_build_object('event', v_kind, 'geofence', v_fence.name, 'vehicle', v_vehicle,
                           'vehicle_id', new.vehicle_id, 'at', new.recorded_at),
        v_vehicle || case when v_now then ' entered ' else ' left ' end || v_fence.name,
        to_char(new.recorded_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC',
        'gps.geofence_alert:' || v_event);
    end if;

    perform app.emit_event(
      new.tenant_id, case when v_now then 'geofence.entered' else 'geofence.exited' end,
      'geofence_event', v_event,
      jsonb_build_object('geofence_id', v_fence.id, 'geofence', v_fence.name,
                         'vehicle_id', new.vehicle_id, 'vehicle', v_vehicle,
                         'lat', new.lat, 'lng', new.lng, 'at', new.recorded_at),
      'geofence_event:' || v_event);
  end loop;
  return null;
end;
$$;
revoke execute on function app.gps_position_after() from public, anon, authenticated;

-- After delete: the cascade has already removed the vehicle's last-position
-- row if it pointed at this fix; put back the newest remaining one.
create or replace function app.gps_position_after_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.vehicle_last_positions as l
    (vehicle_id, tenant_id, position_id, driver_id, recorded_at, lat, lng, speed_kmh, heading, ignition, updated_at)
  select p.vehicle_id, p.tenant_id, p.id, p.driver_id, p.recorded_at, p.lat, p.lng, p.speed_kmh, p.heading,
         p.ignition, now()
    from public.gps_positions p
   where p.vehicle_id = old.vehicle_id
   order by p.recorded_at desc
   limit 1
  on conflict (vehicle_id) do nothing;
  return null;
end;
$$;
revoke execute on function app.gps_position_after_delete() from public, anon, authenticated;

create trigger gps_positions_before before insert on public.gps_positions
  for each row execute function app.gps_position_before();
create trigger gps_positions_same_tenant before insert on public.gps_positions
  for each row execute function app.assert_same_tenant('vehicle_id', 'vehicles', 'driver_id', 'drivers');
create trigger gps_positions_after after insert on public.gps_positions
  for each row execute function app.gps_position_after();
create trigger gps_positions_after_delete after delete on public.gps_positions
  for each row execute function app.gps_position_after_delete();

create trigger geofences_stamp_actor before insert or update on public.geofences
  for each row execute function app.stamp_actor();
create trigger geofences_audit after insert or update or delete on public.geofences
  for each row execute function app.log_audit();

-- ============================================================
-- RLS: members read; managers write positions and geofences. The derived
-- tables (last positions, geofence events) are read-only to clients.
-- ============================================================
set local lock_timeout = '1s';
do $$
declare
  t text;
begin
  foreach t in array array['gps_positions', 'vehicle_last_positions', 'geofences', 'geofence_events'] loop
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (tenant_id = (select app.tenant_id()) and (select app.module_enabled(''gps_tracking'')))',
      t || '_select', t);
  end loop;
  foreach t in array array['gps_positions', 'geofences'] loop
    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check (tenant_id = (select app.tenant_id()) and (select app.is_manager())
                     and (select app.module_enabled(''gps_tracking'')))',
      t || '_insert', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated
         using (tenant_id = (select app.tenant_id()) and (select app.is_manager())
                and (select app.module_enabled(''gps_tracking'')))',
      t || '_delete', t);
  end loop;
  execute
    'create policy geofences_update on public.geofences for update to authenticated
       using (tenant_id = (select app.tenant_id()) and (select app.is_manager())
              and (select app.module_enabled(''gps_tracking'')))
       with check (tenant_id = (select app.tenant_id()) and (select app.is_manager())
                   and (select app.module_enabled(''gps_tracking'')))';
end;
$$;
