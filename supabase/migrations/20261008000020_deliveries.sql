-- Deliveries (module logistics_delivery): last-mile routes, proof of delivery
-- and cash on delivery.
--
-- 1) delivery_routes: numbered RTE-00001 (doc type 'delivery_route'). One
--    vehicle (driver optional) for one day. status planned → out_for_delivery
--    → completed; planned → canceled. app.delivery_route_guard enforces it
--    (ILLEGAL_ROUTE_TRANSITION), refuses to start an empty route (ROUTE_EMPTY)
--    or complete one with stops still out (ROUTE_HAS_OPEN_STOPS), locks
--    completed and canceled routes (ROUTE_LOCKED, notes stay editable) and
--    deletes only planned routes (ROUTE_NOT_DELETABLE). Starting a route sends
--    its assigned deliveries out; canceling or deleting it puts them back to
--    pending.
-- 2) deliveries: numbered DLV-00001 (doc type 'delivery'). status pending →
--    assigned → out_for_delivery → delivered | failed; failed →
--    out_for_delivery (retry, while the route is out) | returned | pending
--    (back to the queue); assigned → pending. Only
--    public.delivery_route_plan() puts a delivery on a route (route_id and
--    sequence are not client-writable). Delivering needs the recipient's name
--    (POD_NAME_REQUIRED) and failing a reason (FAILURE_REASON_REQUIRED); both
--    count an attempt. Delivered and returned deliveries are locked
--    (DELIVERY_LOCKED); only pending ones can be deleted
--    (DELIVERY_NOT_DELETABLE). tracking_token is the public capability for
--    /track/:token, read by the worker with the service role.
-- 3) public.deliveries_import(rows jsonb) inserts up to 500 deliveries in one
--    go under RLS (IMPORT_TOO_LARGE). Automation events delivery.delivered and
--    delivery.failed.
--
-- Raised codes: ILLEGAL_ROUTE_TRANSITION, ROUTE_EMPTY, ROUTE_HAS_OPEN_STOPS,
-- ROUTE_LOCKED, ROUTE_NOT_DELETABLE, ROUTE_NOT_PLANNED, ROUTE_NOT_FOUND,
-- ILLEGAL_DELIVERY_TRANSITION, DELIVERY_NOT_ON_ROUTE, DELIVERY_ROUTE_NOT_OUT,
-- DELIVERY_NOT_AVAILABLE, POD_NAME_REQUIRED, FAILURE_REASON_REQUIRED,
-- DELIVERY_LOCKED, DELIVERY_NOT_DELETABLE, IMPORT_TOO_LARGE
-- (+ CROSS_TENANT_REFERENCE, FORBIDDEN). Additive only.

set local lock_timeout = '3s';
set local statement_timeout = '60s';

-- ============================================================
-- Tables
-- ============================================================
create table public.delivery_routes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  number integer,
  doc_number text,
  route_date date not null,
  vehicle_id uuid not null references public.vehicles(id) on delete restrict,
  driver_id uuid references public.drivers(id) on delete set null,
  status text not null default 'planned'
    check (status in ('planned', 'out_for_delivery', 'completed', 'canceled')),
  depot_name text check (depot_name is null or char_length(depot_name) <= 200),
  depot_lat numeric(9,6) check (depot_lat is null or depot_lat between -90 and 90),
  depot_lng numeric(9,6) check (depot_lng is null or depot_lng between -180 and 180),
  started_at timestamptz,
  completed_at timestamptz,
  canceled_at timestamptz,
  notes text check (notes is null or char_length(notes) <= 4000),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint delivery_routes_depot_ck check ((depot_lat is null) = (depot_lng is null))
);
create unique index delivery_routes_tenant_number_uk on public.delivery_routes (tenant_id, number);
create unique index delivery_routes_tenant_doc_number_uk on public.delivery_routes (tenant_id, doc_number);
create index delivery_routes_tenant_date_idx on public.delivery_routes (tenant_id, route_date desc);
create index delivery_routes_vehicle_idx on public.delivery_routes (vehicle_id, route_date);
create index delivery_routes_driver_idx on public.delivery_routes (driver_id) where driver_id is not null;

create table public.deliveries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  number integer,
  doc_number text,
  customer_id uuid references public.customers(id) on delete set null,
  reference text check (reference is null or char_length(reference) <= 100),
  route_id uuid references public.delivery_routes(id) on delete set null,
  sequence integer check (sequence is null or sequence between 1 and 10000),
  recipient_name text not null check (char_length(btrim(recipient_name)) between 1 and 200),
  recipient_phone text check (recipient_phone is null or char_length(recipient_phone) <= 40),
  address text not null check (char_length(btrim(address)) between 1 and 500),
  city text check (city is null or char_length(city) <= 100),
  lat numeric(9,6) check (lat is null or lat between -90 and 90),
  lng numeric(9,6) check (lng is null or lng between -180 and 180),
  parcels integer not null default 1 check (parcels between 1 and 9999),
  weight_kg numeric(10,2) check (weight_kg is null or weight_kg >= 0),
  cod_amount numeric(14,3) not null default 0 check (cod_amount >= 0),
  cod_collected numeric(14,3) check (cod_collected is null or cod_collected >= 0),
  instructions text check (instructions is null or char_length(instructions) <= 2000),
  status text not null default 'pending'
    check (status in ('pending', 'assigned', 'out_for_delivery', 'delivered', 'failed', 'returned')),
  attempts integer not null default 0,
  delivered_at timestamptz,
  failed_at timestamptz,
  returned_at timestamptz,
  pod_name text check (pod_name is null or char_length(pod_name) <= 200),
  -- A PNG data URL from the signature pad; capped so a row stays small.
  pod_signature text check (pod_signature is null
                            or (pod_signature like 'data:image/%' and char_length(pod_signature) <= 300000)),
  pod_photo_path text check (pod_photo_path is null or char_length(pod_photo_path) <= 500),
  failure_reason text check (failure_reason is null
                             or failure_reason in ('not_home', 'refused', 'wrong_address', 'damaged', 'other')),
  failure_note text check (failure_note is null or char_length(failure_note) <= 1000),
  tracking_token uuid not null default gen_random_uuid(),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deliveries_coords_ck check ((lat is null) = (lng is null))
);
create unique index deliveries_tenant_number_uk on public.deliveries (tenant_id, number);
create unique index deliveries_tenant_doc_number_uk on public.deliveries (tenant_id, doc_number);
create unique index deliveries_tracking_token_uk on public.deliveries (tracking_token);
create index deliveries_tenant_status_idx on public.deliveries (tenant_id, status, created_at desc);
create index deliveries_route_idx on public.deliveries (route_id, sequence) where route_id is not null;
create index deliveries_customer_idx on public.deliveries (customer_id) where customer_id is not null;
create index deliveries_tenant_delivered_idx on public.deliveries (tenant_id, delivered_at) where delivered_at is not null;

alter table public.delivery_routes enable row level security;
alter table public.deliveries enable row level security;
revoke all on public.delivery_routes from anon;
revoke all on public.deliveries from anon;
-- Numbers, stamps, the route plan and the tracking token are server-side.
revoke insert, update on public.delivery_routes from authenticated;
grant insert (route_date, vehicle_id, driver_id, depot_name, depot_lat, depot_lng, notes)
  on public.delivery_routes to authenticated;
grant update (route_date, vehicle_id, driver_id, depot_name, depot_lat, depot_lng, notes, status)
  on public.delivery_routes to authenticated;
revoke insert, update on public.deliveries from authenticated;
grant insert (customer_id, reference, recipient_name, recipient_phone, address, city, lat, lng, parcels, weight_kg,
              cod_amount, instructions)
  on public.deliveries to authenticated;
grant update (customer_id, reference, recipient_name, recipient_phone, address, city, lat, lng, parcels, weight_kg,
              cod_amount, instructions, status, cod_collected, pod_name, pod_signature, pod_photo_path,
              failure_reason, failure_note)
  on public.deliveries to authenticated;

-- ============================================================
-- Route state machine
-- ============================================================
create or replace function app.delivery_route_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client boolean := coalesce(nullif(current_setting('role', true), ''), 'none') in ('authenticated', 'anon')
                      and pg_trigger_depth() <= 1;
begin
  if tg_op = 'DELETE' then
    if v_client and old.status <> 'planned' then
      raise exception 'ROUTE_NOT_DELETABLE';
    end if;
    -- Its stops go back to the queue.
    update public.deliveries set status = 'pending'
     where route_id = old.id and status = 'assigned';
    return old;
  end if;

  if tg_op = 'INSERT' then
    if v_client then
      new.status := 'planned';
      new.started_at := null;
      new.completed_at := null;
      new.canceled_at := null;
    end if;
    new.updated_at := now();
    return new;
  end if;

  if old.status in ('completed', 'canceled') and v_client and (
       new.status is distinct from old.status or new.route_date is distinct from old.route_date
       or new.vehicle_id is distinct from old.vehicle_id or new.driver_id is distinct from old.driver_id
       or new.depot_name is distinct from old.depot_name or new.depot_lat is distinct from old.depot_lat
       or new.depot_lng is distinct from old.depot_lng) then
    raise exception 'ROUTE_LOCKED';
  end if;

  if new.status is distinct from old.status then
    if not (
         (old.status = 'planned' and new.status in ('out_for_delivery', 'canceled'))
      or (old.status = 'out_for_delivery' and new.status = 'completed')) then
      raise exception 'ILLEGAL_ROUTE_TRANSITION';
    end if;
    case new.status
      when 'out_for_delivery' then
        if not exists (select 1 from public.deliveries d where d.route_id = new.id and d.status = 'assigned') then
          raise exception 'ROUTE_EMPTY';
        end if;
        new.started_at := now();
      when 'completed' then
        if exists (select 1 from public.deliveries d where d.route_id = new.id and d.status = 'out_for_delivery') then
          raise exception 'ROUTE_HAS_OPEN_STOPS';
        end if;
        new.completed_at := now();
      when 'canceled' then
        new.canceled_at := now();
      else
        null;
    end case;
  end if;

  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function app.delivery_route_guard() from public, anon, authenticated;

-- Starting a route sends its stops out; canceling it returns them to the queue.
create or replace function app.delivery_route_after()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'out_for_delivery' and old.status = 'planned' then
    update public.deliveries set status = 'out_for_delivery'
     where route_id = new.id and status = 'assigned';
  elsif new.status = 'canceled' and old.status = 'planned' then
    update public.deliveries set status = 'pending'
     where route_id = new.id and status = 'assigned';
  end if;
  return null;
end;
$$;
revoke execute on function app.delivery_route_after() from public, anon, authenticated;

create trigger delivery_routes_number
  before insert or update of number, doc_number on public.delivery_routes
  for each row execute function app.assign_doc_number('delivery_route', 'RTE');
create trigger delivery_routes_guard before insert or update or delete on public.delivery_routes
  for each row execute function app.delivery_route_guard();
create trigger delivery_routes_stamp_actor before insert or update on public.delivery_routes
  for each row execute function app.stamp_actor();
create trigger delivery_routes_same_tenant before insert or update of vehicle_id, driver_id on public.delivery_routes
  for each row execute function app.assert_same_tenant('vehicle_id', 'vehicles', 'driver_id', 'drivers');
create trigger delivery_routes_after after update of status on public.delivery_routes
  for each row execute function app.delivery_route_after();
create trigger delivery_routes_audit after insert or update or delete on public.delivery_routes
  for each row execute function app.log_audit();

-- ============================================================
-- Delivery state machine
-- ============================================================
create or replace function app.delivery_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client boolean := coalesce(nullif(current_setting('role', true), ''), 'none') in ('authenticated', 'anon')
                      and pg_trigger_depth() <= 1;
  v_route_status text;
begin
  if tg_op = 'DELETE' then
    if v_client and old.status <> 'pending' then
      raise exception 'DELIVERY_NOT_DELETABLE';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if v_client then
      new.status := 'pending';
      new.route_id := null;
      new.sequence := null;
      new.attempts := 0;
      new.cod_collected := null;
      new.delivered_at := null;
      new.failed_at := null;
      new.returned_at := null;
      new.pod_name := null;
      new.pod_signature := null;
      new.pod_photo_path := null;
      new.failure_reason := null;
      new.failure_note := null;
      new.tracking_token := gen_random_uuid();
    end if;
    new.updated_at := now();
    return new;
  end if;

  if v_client and new.tracking_token is distinct from old.tracking_token then
    raise exception 'FORBIDDEN';
  end if;

  if old.status in ('delivered', 'returned') and v_client and (
       new.status is distinct from old.status or new.customer_id is distinct from old.customer_id
       or new.reference is distinct from old.reference or new.recipient_name is distinct from old.recipient_name
       or new.recipient_phone is distinct from old.recipient_phone or new.address is distinct from old.address
       or new.city is distinct from old.city or new.lat is distinct from old.lat or new.lng is distinct from old.lng
       or new.parcels is distinct from old.parcels or new.weight_kg is distinct from old.weight_kg
       or new.cod_amount is distinct from old.cod_amount or new.cod_collected is distinct from old.cod_collected
       or new.instructions is distinct from old.instructions or new.pod_name is distinct from old.pod_name
       or new.pod_signature is distinct from old.pod_signature or new.pod_photo_path is distinct from old.pod_photo_path
       or new.failure_reason is distinct from old.failure_reason or new.failure_note is distinct from old.failure_note) then
    raise exception 'DELIVERY_LOCKED';
  end if;

  if new.status is distinct from old.status then
    if not (
         (old.status = 'pending' and new.status = 'assigned')
      or (old.status = 'assigned' and new.status in ('pending', 'out_for_delivery'))
      or (old.status = 'out_for_delivery' and new.status in ('delivered', 'failed'))
      or (old.status = 'failed' and new.status in ('out_for_delivery', 'returned', 'pending'))) then
      raise exception 'ILLEGAL_DELIVERY_TRANSITION';
    end if;
    case new.status
      when 'pending' then
        new.route_id := null;
        new.sequence := null;
        new.failure_reason := null;
        new.failure_note := null;
      when 'out_for_delivery' then
        select r.status into v_route_status from public.delivery_routes r where r.id = new.route_id;
        if v_route_status is distinct from 'out_for_delivery' then
          raise exception 'DELIVERY_ROUTE_NOT_OUT';
        end if;
        -- A retry starts a fresh attempt.
        new.failure_reason := null;
        new.failure_note := null;
        new.failed_at := null;
      when 'delivered' then
        if new.pod_name is null or btrim(new.pod_name) = '' then
          raise exception 'POD_NAME_REQUIRED';
        end if;
        new.attempts := old.attempts + 1;
        new.delivered_at := now();
        new.cod_collected := coalesce(new.cod_collected, 0);
      when 'failed' then
        if new.failure_reason is null then
          raise exception 'FAILURE_REASON_REQUIRED';
        end if;
        new.attempts := old.attempts + 1;
        new.failed_at := now();
      when 'returned' then
        new.returned_at := now();
      else
        null;
    end case;
  elsif v_client and new.status <> 'delivered' and (
         new.cod_collected is distinct from old.cod_collected or new.pod_name is distinct from old.pod_name
         or new.pod_signature is distinct from old.pod_signature or new.pod_photo_path is distinct from old.pod_photo_path) then
    -- Proof of delivery is written with the delivered step, not on its own.
    raise exception 'ILLEGAL_DELIVERY_TRANSITION';
  end if;

  if new.status in ('assigned', 'out_for_delivery') and new.route_id is null then
    raise exception 'DELIVERY_NOT_ON_ROUTE';
  end if;

  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function app.delivery_guard() from public, anon, authenticated;

create or replace function app.delivery_after()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = old.status then
    return null;
  end if;
  if new.status = 'delivered' then
    perform app.emit_event(new.tenant_id, 'delivery.delivered', 'delivery', new.id,
      jsonb_build_object('delivery_id', new.id, 'doc_number', new.doc_number, 'route_id', new.route_id,
        'customer_id', new.customer_id, 'reference', new.reference, 'city', new.city, 'attempts', new.attempts,
        'cod_amount', new.cod_amount, 'cod_collected', new.cod_collected, 'pod_name', new.pod_name),
      'delivery.delivered:' || new.id);
  elsif new.status = 'failed' then
    perform app.emit_event(new.tenant_id, 'delivery.failed', 'delivery', new.id,
      jsonb_build_object('delivery_id', new.id, 'doc_number', new.doc_number, 'route_id', new.route_id,
        'customer_id', new.customer_id, 'reference', new.reference, 'city', new.city, 'attempts', new.attempts,
        'failure_reason', new.failure_reason),
      'delivery.failed:' || new.id || ':' || new.attempts);
  end if;
  return null;
end;
$$;
revoke execute on function app.delivery_after() from public, anon, authenticated;

create trigger deliveries_number
  before insert or update of number, doc_number on public.deliveries
  for each row execute function app.assign_doc_number('delivery', 'DLV');
create trigger deliveries_guard before insert or update or delete on public.deliveries
  for each row execute function app.delivery_guard();
create trigger deliveries_stamp_actor before insert or update on public.deliveries
  for each row execute function app.stamp_actor();
create trigger deliveries_same_tenant before insert or update of customer_id, route_id on public.deliveries
  for each row execute function app.assert_same_tenant('customer_id', 'customers', 'route_id', 'delivery_routes');
create trigger deliveries_after after update of status on public.deliveries
  for each row execute function app.delivery_after();
create trigger deliveries_audit after insert or update or delete on public.deliveries
  for each row execute function app.log_audit();

-- ============================================================
-- RPCs
-- ============================================================

-- Set a planned route's stops, in order. Deliveries left off the list go back
-- to pending; the ones on it must be pending or already on this route.
create or replace function public.delivery_route_plan(p_route_id uuid, p_delivery_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.require_module('logistics_delivery', 'manager');
  v_status text;
  v_ids uuid[] := coalesce(p_delivery_ids, '{}');
begin
  select r.status into v_status from public.delivery_routes r
   where r.id = p_route_id and r.tenant_id = v_tenant for update;
  if v_status is null then
    raise exception 'ROUTE_NOT_FOUND';
  end if;
  if v_status <> 'planned' then
    raise exception 'ROUTE_NOT_PLANNED';
  end if;
  if cardinality(v_ids) <> (select count(distinct x) from unnest(v_ids) x) then
    raise exception 'DELIVERY_NOT_AVAILABLE';
  end if;
  if exists (
    select 1 from unnest(v_ids) x
    where not exists (
      select 1 from public.deliveries d
      where d.id = x and d.tenant_id = v_tenant
        and (d.status = 'pending' or (d.status = 'assigned' and d.route_id = p_route_id)))) then
    raise exception 'DELIVERY_NOT_AVAILABLE';
  end if;

  update public.deliveries d set status = 'pending'
   where d.route_id = p_route_id and d.status = 'assigned' and not (d.id = any (v_ids));

  update public.deliveries d
     set route_id = p_route_id, sequence = x.ord, status = 'assigned'
    from unnest(v_ids) with ordinality as x(id, ord)
   where d.id = x.id;
end;
$$;
revoke execute on function public.delivery_route_plan(uuid, uuid[]) from public, anon;
grant execute on function public.delivery_route_plan(uuid, uuid[]) to authenticated;

-- Bulk import from the CSV screen. Runs under RLS and the column grants, so a
-- viewer gets the row-level security error and nothing is inserted.
create or replace function public.deliveries_import(p_rows jsonb)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'IMPORT_TOO_LARGE';
  end if;
  if jsonb_array_length(p_rows) > 500 then
    raise exception 'IMPORT_TOO_LARGE';
  end if;
  insert into public.deliveries (customer_id, reference, recipient_name, recipient_phone, address, city, lat, lng,
                                 parcels, weight_kg, cod_amount, instructions)
  select r.customer_id, nullif(btrim(r.reference), ''), btrim(r.recipient_name), nullif(btrim(r.recipient_phone), ''),
         btrim(r.address), nullif(btrim(r.city), ''), r.lat, r.lng, coalesce(r.parcels, 1), r.weight_kg,
         coalesce(r.cod_amount, 0), nullif(btrim(r.instructions), '')
  from jsonb_to_recordset(p_rows) as r(customer_id uuid, reference text, recipient_name text, recipient_phone text,
                                       address text, city text, lat numeric, lng numeric, parcels integer,
                                       weight_kg numeric, cod_amount numeric, instructions text);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke execute on function public.deliveries_import(jsonb) from public, anon;
grant execute on function public.deliveries_import(jsonb) to authenticated;

-- ============================================================
-- RLS: members read; managers write.
-- ============================================================
set local lock_timeout = '1s';
create policy delivery_routes_select on public.delivery_routes for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.module_enabled('logistics_delivery')));
create policy delivery_routes_insert on public.delivery_routes for insert to authenticated
  with check (tenant_id = (select app.tenant_id()) and (select app.is_manager())
              and (select app.module_enabled('logistics_delivery')));
create policy delivery_routes_update on public.delivery_routes for update to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_manager())
         and (select app.module_enabled('logistics_delivery')))
  with check (tenant_id = (select app.tenant_id()) and (select app.is_manager())
              and (select app.module_enabled('logistics_delivery')));
create policy delivery_routes_delete on public.delivery_routes for delete to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_manager())
         and (select app.module_enabled('logistics_delivery')));

create policy deliveries_select on public.deliveries for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.module_enabled('logistics_delivery')));
create policy deliveries_insert on public.deliveries for insert to authenticated
  with check (tenant_id = (select app.tenant_id()) and (select app.is_manager())
              and (select app.module_enabled('logistics_delivery')));
create policy deliveries_update on public.deliveries for update to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_manager())
         and (select app.module_enabled('logistics_delivery')))
  with check (tenant_id = (select app.tenant_id()) and (select app.is_manager())
              and (select app.module_enabled('logistics_delivery')));
create policy deliveries_delete on public.deliveries for delete to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_manager())
         and (select app.module_enabled('logistics_delivery')));
