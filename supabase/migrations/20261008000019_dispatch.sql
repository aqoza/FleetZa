-- Dispatch (module dispatch): jobs a dispatcher assigns to a vehicle and
-- driver and follows to completion.
--
-- 1) dispatch_jobs: numbered DSP-00001 (app.assign_doc_number, doc type
--    'dispatch_job'). status new → assigned → en_route → on_site → completed;
--    new | assigned | en_route | on_site → canceled; assigned → new
--    (unassign, clears vehicle and driver). app.dispatch_job_guard enforces it
--    (ILLEGAL_DISPATCH_TRANSITION), stamps the step times, locks completed and
--    canceled jobs (DISPATCH_JOB_LOCKED, notes stay editable) and allows
--    deleting only new jobs (DISPATCH_NOT_DELETABLE).
-- 2) public.dispatch_assign(job, vehicle, driver) is the only way to set the
--    vehicle and driver: the vehicle must be active
--    (DISPATCH_VEHICLE_UNAVAILABLE) and neither it nor the driver may hold
--    another assigned / en route / on site job in an overlapping window
--    (DISPATCH_VEHICLE_BUSY / DISPATCH_DRIVER_BUSY). Re-assigning an assigned
--    job is allowed. public.dispatch_busy lists who is busy for a window.
-- 3) A new urgent job notifies managers (dispatch.urgent_job). Automation
--    events dispatch_job.assigned and dispatch_job.completed.
--
-- Raised codes: ILLEGAL_DISPATCH_TRANSITION, DISPATCH_JOB_LOCKED,
-- DISPATCH_NOT_DELETABLE, DISPATCH_NOT_ASSIGNED, DISPATCH_VEHICLE_UNAVAILABLE,
-- DISPATCH_VEHICLE_BUSY, DISPATCH_DRIVER_BUSY, DISPATCH_JOB_NOT_FOUND
-- (+ CROSS_TENANT_REFERENCE, FORBIDDEN). Additive only.

set local lock_timeout = '3s';
set local statement_timeout = '60s';

-- ============================================================
-- Table
-- ============================================================
create table public.dispatch_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  number integer,
  doc_number text,
  customer_id uuid references public.customers(id) on delete set null,
  contact_name text check (contact_name is null or char_length(contact_name) <= 120),
  contact_phone text check (contact_phone is null or char_length(contact_phone) <= 40),
  job_type text not null default 'delivery' check (job_type in ('pickup', 'delivery', 'service', 'transfer', 'other')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  pickup_address text check (pickup_address is null or char_length(pickup_address) <= 500),
  pickup_lat numeric(9,6) check (pickup_lat is null or pickup_lat between -90 and 90),
  pickup_lng numeric(9,6) check (pickup_lng is null or pickup_lng between -180 and 180),
  dropoff_address text check (dropoff_address is null or char_length(dropoff_address) <= 500),
  dropoff_lat numeric(9,6) check (dropoff_lat is null or dropoff_lat between -90 and 90),
  dropoff_lng numeric(9,6) check (dropoff_lng is null or dropoff_lng between -180 and 180),
  window_start timestamptz not null,
  window_end timestamptz not null,
  status text not null default 'new'
    check (status in ('new', 'assigned', 'en_route', 'on_site', 'completed', 'canceled')),
  vehicle_id uuid references public.vehicles(id) on delete set null,
  driver_id uuid references public.drivers(id) on delete set null,
  assigned_at timestamptz,
  en_route_at timestamptz,
  on_site_at timestamptz,
  completed_at timestamptz,
  canceled_at timestamptz,
  notes text check (notes is null or char_length(notes) <= 4000),
  completion_notes text check (completion_notes is null or char_length(completion_notes) <= 4000),
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 1000),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dispatch_jobs_window_ck check (window_end > window_start),
  constraint dispatch_jobs_pickup_ck check ((pickup_lat is null) = (pickup_lng is null)),
  constraint dispatch_jobs_dropoff_ck check ((dropoff_lat is null) = (dropoff_lng is null))
);
create unique index dispatch_jobs_tenant_number_uk on public.dispatch_jobs (tenant_id, number);
create unique index dispatch_jobs_tenant_doc_number_uk on public.dispatch_jobs (tenant_id, doc_number);
create index dispatch_jobs_tenant_status_idx on public.dispatch_jobs (tenant_id, status, window_end);
create index dispatch_jobs_tenant_window_idx on public.dispatch_jobs (tenant_id, window_start);
create index dispatch_jobs_vehicle_idx on public.dispatch_jobs (vehicle_id, window_start) where vehicle_id is not null;
create index dispatch_jobs_driver_idx on public.dispatch_jobs (driver_id, window_start) where driver_id is not null;
create index dispatch_jobs_customer_idx on public.dispatch_jobs (customer_id) where customer_id is not null;

alter table public.dispatch_jobs enable row level security;
revoke all on public.dispatch_jobs from anon;
-- Numbers, stamps and the assignment are server-side.
revoke insert, update on public.dispatch_jobs from authenticated;
grant insert (customer_id, contact_name, contact_phone, job_type, priority, title, pickup_address, pickup_lat, pickup_lng,
              dropoff_address, dropoff_lat, dropoff_lng, window_start, window_end, notes)
  on public.dispatch_jobs to authenticated;
grant update (customer_id, contact_name, contact_phone, job_type, priority, title, pickup_address, pickup_lat, pickup_lng,
              dropoff_address, dropoff_lat, dropoff_lng, window_start, window_end, notes, status, completion_notes,
              cancel_reason)
  on public.dispatch_jobs to authenticated;

-- ============================================================
-- Helpers
-- ============================================================

-- Another busy job (assigned / en route / on site) holding the vehicle or
-- driver in an overlapping window: its doc number, or null.
create or replace function app.dispatch_busy_job(
  p_tenant uuid, p_job uuid, p_vehicle uuid, p_driver uuid, p_start timestamptz, p_end timestamptz, p_kind text
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select j.doc_number
  from public.dispatch_jobs j
  where j.tenant_id = p_tenant and j.id is distinct from p_job
    and j.status in ('assigned', 'en_route', 'on_site')
    and j.window_start < p_end and p_start < j.window_end
    and case p_kind when 'vehicle' then j.vehicle_id = p_vehicle else j.driver_id = p_driver end
  order by j.window_start
  limit 1;
$$;
revoke execute on function app.dispatch_busy_job(uuid, uuid, uuid, uuid, timestamptz, timestamptz, text)
  from public, anon, authenticated;

-- ============================================================
-- State machine
-- ============================================================
create or replace function app.dispatch_job_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Client sessions only; cascades and trusted sessions pass.
  v_client boolean := coalesce(nullif(current_setting('role', true), ''), 'none') in ('authenticated', 'anon')
                      and pg_trigger_depth() <= 1;
begin
  if tg_op = 'DELETE' then
    if v_client and old.status <> 'new' then
      raise exception 'DISPATCH_NOT_DELETABLE';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if v_client then
      new.status := 'new';
      new.vehicle_id := null;
      new.driver_id := null;
      new.assigned_at := null;
      new.en_route_at := null;
      new.on_site_at := null;
      new.completed_at := null;
      new.canceled_at := null;
    end if;
    new.updated_at := now();
    return new;
  end if;

  if old.status in ('completed', 'canceled') and v_client and (
       new.status is distinct from old.status or new.customer_id is distinct from old.customer_id
       or new.contact_name is distinct from old.contact_name or new.contact_phone is distinct from old.contact_phone
       or new.job_type is distinct from old.job_type or new.priority is distinct from old.priority
       or new.title is distinct from old.title
       or new.pickup_address is distinct from old.pickup_address or new.pickup_lat is distinct from old.pickup_lat
       or new.pickup_lng is distinct from old.pickup_lng or new.dropoff_address is distinct from old.dropoff_address
       or new.dropoff_lat is distinct from old.dropoff_lat or new.dropoff_lng is distinct from old.dropoff_lng
       or new.window_start is distinct from old.window_start or new.window_end is distinct from old.window_end
       or new.vehicle_id is distinct from old.vehicle_id or new.driver_id is distinct from old.driver_id
       or new.completion_notes is distinct from old.completion_notes
       or new.cancel_reason is distinct from old.cancel_reason) then
    raise exception 'DISPATCH_JOB_LOCKED';
  end if;

  if new.status is distinct from old.status then
    if not (
         (old.status = 'new' and new.status in ('assigned', 'canceled'))
      or (old.status = 'assigned' and new.status in ('en_route', 'new', 'canceled'))
      or (old.status = 'en_route' and new.status in ('on_site', 'canceled'))
      or (old.status = 'on_site' and new.status in ('completed', 'canceled'))) then
      raise exception 'ILLEGAL_DISPATCH_TRANSITION';
    end if;
    case new.status
      when 'assigned' then
        new.assigned_at := now();
      when 'new' then
        new.vehicle_id := null;
        new.driver_id := null;
        new.assigned_at := null;
      when 'en_route' then
        new.en_route_at := now();
      when 'on_site' then
        new.on_site_at := now();
      when 'completed' then
        new.completed_at := now();
      when 'canceled' then
        new.canceled_at := now();
      else
        null;
    end case;
  end if;

  if new.status in ('assigned', 'en_route', 'on_site', 'completed') and new.vehicle_id is null then
    raise exception 'DISPATCH_NOT_ASSIGNED';
  end if;

  -- Moving a busy job's window must not double-book its vehicle or driver.
  if new.status in ('assigned', 'en_route', 'on_site')
     and (new.window_start is distinct from old.window_start or new.window_end is distinct from old.window_end) then
    if app.dispatch_busy_job(new.tenant_id, new.id, new.vehicle_id, null, new.window_start, new.window_end, 'vehicle') is not null then
      raise exception 'DISPATCH_VEHICLE_BUSY';
    end if;
    if new.driver_id is not null
       and app.dispatch_busy_job(new.tenant_id, new.id, null, new.driver_id, new.window_start, new.window_end, 'driver') is not null then
      raise exception 'DISPATCH_DRIVER_BUSY';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function app.dispatch_job_guard() from public, anon, authenticated;

-- Notifications and automation events.
create or replace function app.dispatch_job_after()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.priority = 'urgent' then
      perform app.notify(new.tenant_id, 'managers', 'dispatch.urgent_job', 'critical', 'dispatch_job', new.id,
        '/dispatch/jobs/' || new.id,
        jsonb_build_object('doc_number', new.doc_number, 'title', new.title, 'window_end', new.window_end),
        'Urgent job ' || coalesce(new.doc_number, '') || ': ' || new.title,
        'Needs a vehicle before ' || to_char(new.window_end at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC.',
        'dispatch.urgent_job:' || new.id);
    end if;
    return null;
  end if;
  if new.status = 'assigned' and (old.status is distinct from 'assigned' or new.vehicle_id is distinct from old.vehicle_id
                                  or new.driver_id is distinct from old.driver_id) then
    perform app.emit_event(new.tenant_id, 'dispatch_job.assigned', 'dispatch_job', new.id,
      jsonb_build_object('dispatch_job_id', new.id, 'doc_number', new.doc_number, 'vehicle_id', new.vehicle_id,
        'driver_id', new.driver_id, 'job_type', new.job_type, 'priority', new.priority, 'title', new.title,
        'window_end', new.window_end),
      'dispatch_job.assigned:' || new.id || ':' || new.vehicle_id || ':' || coalesce(new.driver_id::text, ''));
  elsif new.status = 'completed' and old.status is distinct from 'completed' then
    perform app.emit_event(new.tenant_id, 'dispatch_job.completed', 'dispatch_job', new.id,
      jsonb_build_object('dispatch_job_id', new.id, 'doc_number', new.doc_number, 'vehicle_id', new.vehicle_id,
        'driver_id', new.driver_id, 'job_type', new.job_type, 'priority', new.priority, 'title', new.title,
        'on_time', new.completed_at <= new.window_end),
      'dispatch_job.completed:' || new.id);
  end if;
  return null;
end;
$$;
revoke execute on function app.dispatch_job_after() from public, anon, authenticated;

create trigger dispatch_jobs_number
  before insert or update of number, doc_number on public.dispatch_jobs
  for each row execute function app.assign_doc_number('dispatch_job', 'DSP');
create trigger dispatch_jobs_guard before insert or update or delete on public.dispatch_jobs
  for each row execute function app.dispatch_job_guard();
create trigger dispatch_jobs_stamp_actor before insert or update on public.dispatch_jobs
  for each row execute function app.stamp_actor();
create trigger dispatch_jobs_same_tenant before insert or update of customer_id, vehicle_id, driver_id on public.dispatch_jobs
  for each row execute function app.assert_same_tenant('customer_id', 'customers', 'vehicle_id', 'vehicles',
                                                      'driver_id', 'drivers');
create trigger dispatch_jobs_after after insert or update of status, vehicle_id, driver_id on public.dispatch_jobs
  for each row execute function app.dispatch_job_after();
create trigger dispatch_jobs_audit after insert or update or delete on public.dispatch_jobs
  for each row execute function app.log_audit();

-- ============================================================
-- RPCs
-- ============================================================

-- Assign (or re-assign) a new or assigned job to a vehicle and optional driver.
create or replace function public.dispatch_assign(p_job_id uuid, p_vehicle_id uuid, p_driver_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.require_module('dispatch', 'manager');
  v_job public.dispatch_jobs%rowtype;
  v_vstatus text;
begin
  select * into v_job from public.dispatch_jobs j where j.id = p_job_id and j.tenant_id = v_tenant for update;
  if not found then
    raise exception 'DISPATCH_JOB_NOT_FOUND';
  end if;
  if v_job.status not in ('new', 'assigned') then
    raise exception 'ILLEGAL_DISPATCH_TRANSITION';
  end if;
  select v.status into v_vstatus from public.vehicles v where v.id = p_vehicle_id and v.tenant_id = v_tenant;
  if v_vstatus is null then
    raise exception 'CROSS_TENANT_REFERENCE: vehicle_id';
  end if;
  if v_vstatus <> 'active' then
    raise exception 'DISPATCH_VEHICLE_UNAVAILABLE';
  end if;
  if app.dispatch_busy_job(v_tenant, p_job_id, p_vehicle_id, null, v_job.window_start, v_job.window_end, 'vehicle') is not null then
    raise exception 'DISPATCH_VEHICLE_BUSY';
  end if;
  if p_driver_id is not null
     and app.dispatch_busy_job(v_tenant, p_job_id, null, p_driver_id, v_job.window_start, v_job.window_end, 'driver') is not null then
    raise exception 'DISPATCH_DRIVER_BUSY';
  end if;
  update public.dispatch_jobs
     set status = 'assigned', vehicle_id = p_vehicle_id, driver_id = p_driver_id,
         assigned_at = case when v_job.status = 'assigned' then now() else assigned_at end
   where id = p_job_id;
end;
$$;
revoke execute on function public.dispatch_assign(uuid, uuid, uuid) from public, anon;
grant execute on function public.dispatch_assign(uuid, uuid, uuid) to authenticated;

-- Vehicles and drivers already on a busy job in the window (for the assign
-- dialog). Runs under RLS.
create or replace function public.dispatch_busy(p_start timestamptz, p_end timestamptz, p_exclude uuid default null)
returns table (kind text, resource_id uuid, job_id uuid, doc_number text, status text)
language sql
stable
set search_path = ''
as $$
  select 'vehicle', j.vehicle_id, j.id, j.doc_number, j.status
  from public.dispatch_jobs j
  where j.vehicle_id is not null and j.status in ('assigned', 'en_route', 'on_site')
    and (p_exclude is null or j.id <> p_exclude)
    and j.window_start < p_end and p_start < j.window_end
  union all
  select 'driver', j.driver_id, j.id, j.doc_number, j.status
  from public.dispatch_jobs j
  where j.driver_id is not null and j.status in ('assigned', 'en_route', 'on_site')
    and (p_exclude is null or j.id <> p_exclude)
    and j.window_start < p_end and p_start < j.window_end
  limit 500;
$$;
revoke execute on function public.dispatch_busy(timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.dispatch_busy(timestamptz, timestamptz, uuid) to authenticated;

-- ============================================================
-- RLS: members read; managers write.
-- ============================================================
set local lock_timeout = '1s';
create policy dispatch_jobs_select on public.dispatch_jobs for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.module_enabled('dispatch')));
create policy dispatch_jobs_insert on public.dispatch_jobs for insert to authenticated
  with check (tenant_id = (select app.tenant_id()) and (select app.is_manager())
              and (select app.module_enabled('dispatch')));
create policy dispatch_jobs_update on public.dispatch_jobs for update to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_manager())
         and (select app.module_enabled('dispatch')))
  with check (tenant_id = (select app.tenant_id()) and (select app.is_manager())
              and (select app.module_enabled('dispatch')));
create policy dispatch_jobs_delete on public.dispatch_jobs for delete to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_manager())
         and (select app.module_enabled('dispatch')));
