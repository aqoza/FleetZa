-- Driver behavior (module driver_behavior): safety events, scores and coaching.
--
-- 1) driving_events: harsh braking / acceleration / cornering, speeding,
--    idling, seatbelt, phone use, fatigue, collision warnings. Written by the
--    public API (POST /api/v1/driving-events, service role, source 'api') or
--    by managers (source 'manual'). An event with no driver takes the
--    vehicle's assigned driver at occurred_at. A high-severity fatigue or
--    collision warning notifies managers (driver_behavior.critical_event) and
--    every event emits driving_event.created for automation.
-- 2) driver_coaching_sessions: a coach (member) meets a driver about topics
--    and specific events; scheduled | completed | canceled, optional follow up.
-- 3) public.driver_scores(p_from, p_to): one row per driver with events or
--    distance in the period, mirroring shared/driverScore.ts:
--      penalty = Σ weight(type) × multiplier(severity)
--      score   = max(0, 100 − penalty × 100 / max(km, 100)), grade A–F
--    Distance per driver: GPS (consecutive fixes attributed to the driver)
--    when there is any, else the odometer span of their fuel logs.
--
-- Raised codes: INVALID_EVENT_TIME, INVALID_PERIOD (+ CROSS_TENANT_REFERENCE, FORBIDDEN,
-- MODULE_DISABLED). Builds on 20261008000014_gps_tracking.sql (gps_positions).
-- Additive only.

set local lock_timeout = '3s';
set local statement_timeout = '60s';

-- ============================================================
-- Tables
-- ============================================================
create table public.driving_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  driver_id uuid references public.drivers(id) on delete set null,
  occurred_at timestamptz not null,
  event_type text not null check (event_type in ('harsh_braking', 'harsh_acceleration', 'harsh_cornering',
    'speeding', 'idling', 'seatbelt', 'phone_use', 'fatigue', 'collision_warning')),
  severity text not null default 'medium' check (severity in ('low', 'medium', 'high')),
  speed_kmh numeric(6, 1) check (speed_kmh is null or speed_kmh between 0 and 400),
  speed_limit_kmh numeric(6, 1) check (speed_limit_kmh is null or speed_limit_kmh between 0 and 400),
  duration_s integer check (duration_s is null or duration_s between 0 and 86400),
  lat numeric(9, 6) check (lat is null or lat between -90 and 90),
  lng numeric(9, 6) check (lng is null or lng between -180 and 180),
  source text not null default 'manual' check (source in ('api', 'manual')),
  notes text check (notes is null or char_length(notes) <= 2000),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index driving_events_tenant_idx on public.driving_events (tenant_id, occurred_at desc);
create index driving_events_driver_idx on public.driving_events (driver_id, occurred_at desc);
create index driving_events_vehicle_idx on public.driving_events (vehicle_id, occurred_at desc);
alter table public.driving_events enable row level security;
revoke all on public.driving_events from anon;
revoke insert, update on public.driving_events from authenticated;
grant insert (vehicle_id, driver_id, occurred_at, event_type, severity, speed_kmh, speed_limit_kmh, duration_s,
              lat, lng, source, notes)
  on public.driving_events to authenticated;
-- Managers may correct the attribution and the notes; the facts stay as recorded.
grant update (driver_id, severity, notes) on public.driving_events to authenticated;

create table public.driver_coaching_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  driver_id uuid not null references public.drivers(id) on delete cascade,
  coach_id uuid default auth.uid() references public.profiles(id) on delete set null,
  session_date date not null default current_date,
  topics text[] not null default '{}'
    check (cardinality(topics) <= 12 and topics <@ array['harsh_braking', 'harsh_acceleration', 'harsh_cornering',
      'speeding', 'idling', 'seatbelt', 'phone_use', 'fatigue', 'collision_warning', 'defensive_driving',
      'fuel_economy', 'other']::text[]),
  notes text check (notes is null or char_length(notes) <= 4000),
  event_ids uuid[] not null default '{}' check (cardinality(event_ids) <= 100),
  follow_up_date date,
  status text not null default 'scheduled' check (status in ('scheduled', 'completed', 'canceled')),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index driver_coaching_tenant_idx on public.driver_coaching_sessions (tenant_id, session_date desc);
create index driver_coaching_driver_idx on public.driver_coaching_sessions (driver_id, session_date desc);
create index driver_coaching_coach_idx on public.driver_coaching_sessions (coach_id);
alter table public.driver_coaching_sessions enable row level security;
revoke all on public.driver_coaching_sessions from anon;
revoke insert, update on public.driver_coaching_sessions from authenticated;
grant insert (driver_id, coach_id, session_date, topics, notes, event_ids, follow_up_date, status)
  on public.driver_coaching_sessions to authenticated;
grant update (coach_id, session_date, topics, notes, event_ids, follow_up_date, status)
  on public.driver_coaching_sessions to authenticated;

-- ============================================================
-- Triggers
-- ============================================================
-- Before insert: API-only source, sane time, driver from the assignment.
-- Invoker, so current_user is the writing role.
create or replace function app.driving_event_before()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.source = 'api' and current_user::text = 'authenticated' then
    raise exception 'FORBIDDEN';
  end if;
  if new.occurred_at > now() + interval '10 minutes' or new.occurred_at < timestamptz '2000-01-01' then
    raise exception 'INVALID_EVENT_TIME';
  end if;
  if new.driver_id is null then
    select va.driver_id into new.driver_id
      from public.vehicle_assignments va
     where va.vehicle_id = new.vehicle_id
       and va.tenant_id = new.tenant_id
       and va.started_at <= new.occurred_at
       and (va.ended_at is null or va.ended_at > new.occurred_at)
     order by va.started_at desc
     limit 1;
  end if;
  return new;
end;
$$;
revoke execute on function app.driving_event_before() from public, anon, authenticated;

-- Event ids in a coaching session must be this tenant's driving events.
create or replace function app.coaching_session_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if cardinality(new.event_ids) > 0 and exists (
    select 1 from unnest(new.event_ids) as e(id)
     where not exists (select 1 from public.driving_events d where d.id = e.id and d.tenant_id = new.tenant_id)
  ) then
    raise exception 'CROSS_TENANT_REFERENCE: event_ids';
  end if;
  if new.coach_id is not null and not exists (
    select 1 from public.profiles p where p.id = new.coach_id and p.tenant_id = new.tenant_id
  ) then
    raise exception 'CROSS_TENANT_REFERENCE: coach_id';
  end if;
  return new;
end;
$$;
revoke execute on function app.coaching_session_guard() from public, anon, authenticated;

-- After insert: notify on critical events, emit for automation.
create or replace function app.driving_event_after()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vehicle text;
  v_driver text;
begin
  select v.name into v_vehicle from public.vehicles v where v.id = new.vehicle_id;
  if new.driver_id is not null then
    select btrim(d.first_name || ' ' || coalesce(d.last_name, '')) into v_driver
      from public.drivers d where d.id = new.driver_id;
  end if;

  if new.severity = 'high' and new.event_type in ('collision_warning', 'fatigue') then
    perform app.notify(
      new.tenant_id, 'managers', 'driver_behavior.critical_event', 'critical',
      'driving_event', new.id, '/driver-behavior/events',
      jsonb_build_object('event_type', new.event_type, 'vehicle', v_vehicle, 'driver', v_driver,
                         'driver_id', new.driver_id, 'at', new.occurred_at, 'speed_kmh', new.speed_kmh),
      initcap(replace(new.event_type, '_', ' ')) || ': ' || coalesce(v_driver, v_vehicle, ''),
      coalesce(v_vehicle, '') || ' at ' || to_char(new.occurred_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC',
      'driver_behavior.critical_event:' || new.id);
  end if;

  perform app.emit_event(
    new.tenant_id, 'driving_event.created', 'driving_event', new.id,
    jsonb_build_object('event_type', new.event_type, 'severity', new.severity, 'vehicle_id', new.vehicle_id,
                       'vehicle', v_vehicle, 'driver_id', new.driver_id, 'driver', v_driver,
                       'speed_kmh', new.speed_kmh, 'speed_limit_kmh', new.speed_limit_kmh,
                       'occurred_at', new.occurred_at),
    'driving_event:' || new.id);
  return null;
end;
$$;
revoke execute on function app.driving_event_after() from public, anon, authenticated;

create trigger driving_events_before before insert on public.driving_events
  for each row execute function app.driving_event_before();
create trigger driving_events_stamp_actor before insert or update on public.driving_events
  for each row execute function app.stamp_actor();
create trigger driving_events_same_tenant before insert or update of vehicle_id, driver_id on public.driving_events
  for each row execute function app.assert_same_tenant('vehicle_id', 'vehicles', 'driver_id', 'drivers');
create trigger driving_events_after after insert on public.driving_events
  for each row execute function app.driving_event_after();

create trigger driver_coaching_guard before insert or update of event_ids, coach_id on public.driver_coaching_sessions
  for each row execute function app.coaching_session_guard();
create trigger driver_coaching_stamp_actor before insert or update on public.driver_coaching_sessions
  for each row execute function app.stamp_actor();
create trigger driver_coaching_same_tenant before insert or update of driver_id on public.driver_coaching_sessions
  for each row execute function app.assert_same_tenant('driver_id', 'drivers');
create trigger driver_coaching_audit after insert or update or delete on public.driver_coaching_sessions
  for each row execute function app.log_audit();

-- ============================================================
-- Scores (mirror of shared/driverScore.ts)
-- ============================================================
create or replace function app.driving_event_penalty(p_type text, p_severity text)
returns integer
language sql
immutable
parallel safe
set search_path = ''
as $$
  select (case p_type
            when 'harsh_braking' then 3 when 'harsh_acceleration' then 2 when 'harsh_cornering' then 2
            when 'speeding' then 4 when 'idling' then 1 when 'seatbelt' then 5 when 'phone_use' then 6
            when 'fatigue' then 6 when 'collision_warning' then 8 else 0 end)
       * (case p_severity when 'low' then 1 when 'medium' then 2 when 'high' then 3 else 0 end);
$$;
grant execute on function app.driving_event_penalty(text, text) to authenticated, service_role;

create or replace function public.driver_scores(p_from timestamptz, p_to timestamptz)
returns table (
  driver_id uuid,
  events integer,
  high_events integer,
  penalty integer,
  distance_km numeric,
  score numeric,
  grade text
)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_tenant uuid := app.require_module('driver_behavior', 'member');
begin
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '400 days' then
    raise exception 'INVALID_PERIOD';
  end if;
  return query
  with ev as (
    select e.driver_id,
           count(*)::integer as events,
           (count(*) filter (where e.severity = 'high'))::integer as high_events,
           sum(app.driving_event_penalty(e.event_type, e.severity))::integer as penalty
      from public.driving_events e
     where e.tenant_id = v_tenant and e.driver_id is not null
       and e.occurred_at >= p_from and e.occurred_at < p_to
     group by e.driver_id
  ),
  fixes as (
    select p.driver_id, p.lat, p.lng,
           lag(p.lat) over w as plat, lag(p.lng) over w as plng, lag(p.driver_id) over w as pdriver
      from public.gps_positions p
     where p.tenant_id = v_tenant and p.recorded_at >= p_from and p.recorded_at < p_to
     window w as (partition by p.vehicle_id order by p.recorded_at)
  ),
  gps as (
    select f.driver_id, sum(app.geo_distance_m(f.plat, f.plng, f.lat, f.lng)) / 1000.0 as km
      from fixes f
     where f.driver_id is not null and f.pdriver = f.driver_id
     group by f.driver_id
  ),
  fuel as (
    select s.driver_id, sum(s.span) as km
      from (
        select fl.driver_id, max(fl.odometer) - min(fl.odometer) as span
          from public.fuel_logs fl
         where fl.tenant_id = v_tenant and fl.driver_id is not null and fl.odometer > 0
           and fl.filled_at >= p_from and fl.filled_at < p_to
         group by fl.driver_id, fl.vehicle_id
      ) s
     group by s.driver_id
  ),
  drivers as (
    select x.driver_id from ev x
    union select g.driver_id from gps g where g.km > 0
    union select u.driver_id from fuel u where u.km > 0
  ),
  scored as (
    select d.driver_id,
           coalesce(ev.events, 0) as events,
           coalesce(ev.high_events, 0) as high_events,
           coalesce(ev.penalty, 0) as penalty,
           round(coalesce(nullif(gps.km, 0), fuel.km, 0)::numeric, 1) as km
      from drivers d
      left join ev on ev.driver_id = d.driver_id
      left join gps on gps.driver_id = d.driver_id
      left join fuel on fuel.driver_id = d.driver_id
  )
  select s.driver_id, s.events, s.high_events, s.penalty, s.km,
         greatest(0, round(100 - s.penalty * 100.0 / greatest(s.km, 100), 1)),
         case
           when greatest(0, round(100 - s.penalty * 100.0 / greatest(s.km, 100), 1)) >= 90 then 'A'
           when greatest(0, round(100 - s.penalty * 100.0 / greatest(s.km, 100), 1)) >= 80 then 'B'
           when greatest(0, round(100 - s.penalty * 100.0 / greatest(s.km, 100), 1)) >= 70 then 'C'
           when greatest(0, round(100 - s.penalty * 100.0 / greatest(s.km, 100), 1)) >= 60 then 'D'
           else 'F'
         end
    from scored s
    join public.drivers dr on dr.id = s.driver_id and dr.tenant_id = v_tenant;
end;
$$;
revoke execute on function public.driver_scores(timestamptz, timestamptz) from public, anon;
grant execute on function public.driver_scores(timestamptz, timestamptz) to authenticated;

-- ============================================================
-- RLS: members read; managers write.
-- ============================================================
set local lock_timeout = '1s';
do $$
declare
  t text;
begin
  foreach t in array array['driving_events', 'driver_coaching_sessions'] loop
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (tenant_id = (select app.tenant_id()) and (select app.module_enabled(''driver_behavior'')))',
      t || '_select', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check (tenant_id = (select app.tenant_id()) and (select app.is_manager())
                     and (select app.module_enabled(''driver_behavior'')))',
      t || '_insert', t);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (tenant_id = (select app.tenant_id()) and (select app.is_manager())
                and (select app.module_enabled(''driver_behavior'')))
         with check (tenant_id = (select app.tenant_id()) and (select app.is_manager())
                     and (select app.module_enabled(''driver_behavior'')))',
      t || '_update', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated
         using (tenant_id = (select app.tenant_id()) and (select app.is_manager())
                and (select app.module_enabled(''driver_behavior'')))',
      t || '_delete', t);
  end loop;
end;
$$;
