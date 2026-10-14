-- Transport management (module tms): freight shipments for customers, carried
-- by an own vehicle or a third-party carrier, with tracking, charges, margin,
-- proof of delivery and lane rates.
--
-- 1) shipments: numbered SHP-00001 (doc type 'shipment'). status draft →
--    booked → dispatched → in_transit → delivered → closed; draft | booked |
--    dispatched → canceled; in_transit → exception → in_transit | delivered.
--    app.shipment_guard enforces it (ILLEGAL_SHIPMENT_TRANSITION), stamps each
--    step, needs a carrier to dispatch (SHIPMENT_CARRIER_REQUIRED: a vehicle
--    for own fleet, a supplier for third party) and the receiver's name to
--    deliver (SHIPMENT_POD_REQUIRED; delivered_at defaults to now and may not
--    be in the future, INVALID_POD_TIME). Closed and canceled shipments are
--    locked (SHIPMENT_LOCKED, notes stay editable); only drafts can be deleted
--    (SHIPMENT_NOT_DELETABLE). total_charge and margin are generated columns;
--    currency is the tenant's, snapshotted on insert.
-- 2) shipment_events: the tracking timeline. A row per status change
--    (written by the trigger) plus manual tracking updates (location / note).
--    Append-only for clients.
-- 3) freight_rates: lane prices (origin city → destination city, mode,
--    optionally one customer). public.quote_freight picks the cheapest valid
--    rate, preferring the customer's own rates; shared/tms.ts mirrors it.
-- 4) public.shipment_create_invoice(shipment) makes a DRAFT invoice with one
--    line for a delivered or closed shipment when billing is on
--    (SHIPMENT_NOT_INVOICEABLE, SHIPMENT_ALREADY_INVOICED, MODULE_DISABLED).
--    Runs as the caller, so invoice RLS, numbering and line math apply.
-- 5) Automation event shipment.status_changed.
--
-- Raised codes: ILLEGAL_SHIPMENT_TRANSITION, SHIPMENT_CARRIER_REQUIRED,
-- SHIPMENT_POD_REQUIRED, INVALID_POD_TIME, SHIPMENT_LOCKED,
-- SHIPMENT_NOT_DELETABLE, SHIPMENT_NOT_FOUND, SHIPMENT_NOT_INVOICEABLE,
-- SHIPMENT_ALREADY_INVOICED (+ MODULE_DISABLED, CROSS_TENANT_REFERENCE,
-- FORBIDDEN). Additive only.

set local lock_timeout = '3s';
set local statement_timeout = '60s';

-- ============================================================
-- Tables
-- ============================================================
create table public.shipments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  number integer,
  doc_number text,
  customer_id uuid not null references public.customers(id) on delete restrict,
  status text not null default 'draft'
    check (status in ('draft', 'booked', 'dispatched', 'in_transit', 'exception', 'delivered', 'closed', 'canceled')),
  mode text not null default 'road_ftl' check (mode in ('road_ftl', 'road_ltl', 'courier', 'other')),
  service_level text not null default 'standard' check (service_level in ('economy', 'standard', 'express')),
  origin_name text check (origin_name is null or char_length(origin_name) <= 200),
  origin_address text check (origin_address is null or char_length(origin_address) <= 500),
  origin_city text not null check (char_length(btrim(origin_city)) between 1 and 100),
  origin_country text check (origin_country is null or char_length(origin_country) <= 2),
  origin_lat numeric(9,6) check (origin_lat is null or origin_lat between -90 and 90),
  origin_lng numeric(9,6) check (origin_lng is null or origin_lng between -180 and 180),
  destination_name text check (destination_name is null or char_length(destination_name) <= 200),
  destination_address text check (destination_address is null or char_length(destination_address) <= 500),
  destination_city text not null check (char_length(btrim(destination_city)) between 1 and 100),
  destination_country text check (destination_country is null or char_length(destination_country) <= 2),
  destination_lat numeric(9,6) check (destination_lat is null or destination_lat between -90 and 90),
  destination_lng numeric(9,6) check (destination_lng is null or destination_lng between -180 and 180),
  pickup_window_start timestamptz,
  pickup_window_end timestamptz,
  delivery_window_start timestamptz,
  delivery_window_end timestamptz,
  cargo_description text check (cargo_description is null or char_length(cargo_description) <= 1000),
  pieces integer check (pieces is null or pieces between 0 and 1000000),
  weight_kg numeric(12,2) check (weight_kg is null or weight_kg >= 0),
  volume_m3 numeric(10,3) check (volume_m3 is null or volume_m3 >= 0),
  hazardous boolean not null default false,
  carrier_type text not null default 'own' check (carrier_type in ('own', 'third_party')),
  vehicle_id uuid references public.vehicles(id) on delete set null,
  driver_id uuid references public.drivers(id) on delete set null,
  carrier_supplier_id uuid references public.suppliers(id) on delete set null,
  freight_charge numeric(14,3) not null default 0 check (freight_charge >= 0),
  fuel_surcharge numeric(14,3) not null default 0 check (fuel_surcharge >= 0),
  other_charges numeric(14,3) not null default 0 check (other_charges >= 0),
  total_charge numeric(14,3) generated always as (freight_charge + fuel_surcharge + other_charges) stored,
  carrier_cost numeric(14,3) check (carrier_cost is null or carrier_cost >= 0),
  margin numeric(14,3) generated always as (freight_charge + fuel_surcharge + other_charges - carrier_cost) stored,
  currency text not null default 'USD',
  customer_ref text check (customer_ref is null or char_length(customer_ref) <= 100),
  bol_number text check (bol_number is null or char_length(bol_number) <= 100),
  booked_at timestamptz,
  dispatched_at timestamptz,
  picked_up_at timestamptz,
  delivered_at timestamptz,
  closed_at timestamptz,
  canceled_at timestamptz,
  received_by text check (received_by is null or char_length(received_by) <= 200),
  pod_notes text check (pod_notes is null or char_length(pod_notes) <= 2000),
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 1000),
  notes text check (notes is null or char_length(notes) <= 4000),
  invoice_id uuid references public.invoices(id) on delete set null,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shipments_pickup_window_ck check (pickup_window_end is null or pickup_window_start is null
                                               or pickup_window_end >= pickup_window_start),
  constraint shipments_delivery_window_ck check (delivery_window_end is null or delivery_window_start is null
                                                 or delivery_window_end >= delivery_window_start),
  constraint shipments_origin_coords_ck check ((origin_lat is null) = (origin_lng is null)),
  constraint shipments_destination_coords_ck check ((destination_lat is null) = (destination_lng is null))
);
create unique index shipments_tenant_number_uk on public.shipments (tenant_id, number);
create unique index shipments_tenant_doc_number_uk on public.shipments (tenant_id, doc_number);
create index shipments_tenant_status_idx on public.shipments (tenant_id, status, created_at desc);
create index shipments_tenant_delivered_idx on public.shipments (tenant_id, delivered_at) where delivered_at is not null;
create index shipments_customer_idx on public.shipments (customer_id);
create index shipments_vehicle_idx on public.shipments (vehicle_id) where vehicle_id is not null;
create index shipments_driver_idx on public.shipments (driver_id) where driver_id is not null;
create index shipments_carrier_idx on public.shipments (carrier_supplier_id) where carrier_supplier_id is not null;
create index shipments_invoice_idx on public.shipments (invoice_id) where invoice_id is not null;

create table public.shipment_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  -- The status entered at this point; null for a manual tracking update.
  status text check (status is null or status in ('draft', 'booked', 'dispatched', 'in_transit', 'exception',
                                                  'delivered', 'closed', 'canceled')),
  at timestamptz not null default now(),
  location text check (location is null or char_length(location) <= 200),
  note text check (note is null or char_length(note) <= 1000),
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint shipment_events_content_ck check (status is not null or location is not null or note is not null)
);
create index shipment_events_shipment_idx on public.shipment_events (shipment_id, at);
create index shipment_events_tenant_idx on public.shipment_events (tenant_id, at desc);

create table public.freight_rates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  origin_city text not null check (char_length(btrim(origin_city)) between 1 and 100),
  destination_city text not null check (char_length(btrim(destination_city)) between 1 and 100),
  mode text not null check (mode in ('road_ftl', 'road_ltl', 'courier', 'other')),
  customer_id uuid references public.customers(id) on delete cascade,
  rate_per_kg numeric(12,4) check (rate_per_kg is null or rate_per_kg >= 0),
  rate_per_trip numeric(14,3) check (rate_per_trip is null or rate_per_trip >= 0),
  min_charge numeric(14,3) not null default 0 check (min_charge >= 0),
  valid_from date not null default current_date,
  valid_to date,
  notes text check (notes is null or char_length(notes) <= 1000),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint freight_rates_price_ck check (rate_per_kg is not null or rate_per_trip is not null),
  constraint freight_rates_validity_ck check (valid_to is null or valid_to >= valid_from)
);
create index freight_rates_lane_idx on public.freight_rates
  (tenant_id, lower(btrim(origin_city)), lower(btrim(destination_city)), mode);
create index freight_rates_customer_idx on public.freight_rates (customer_id) where customer_id is not null;

alter table public.shipments enable row level security;
alter table public.shipment_events enable row level security;
alter table public.freight_rates enable row level security;
revoke all on public.shipments from anon;
revoke all on public.shipment_events from anon;
revoke all on public.freight_rates from anon;
-- Numbers, stamps, currency and the invoice link are server-side.
revoke insert, update on public.shipments from authenticated;
grant insert (customer_id, mode, service_level, origin_name, origin_address, origin_city, origin_country, origin_lat,
              origin_lng, destination_name, destination_address, destination_city, destination_country,
              destination_lat, destination_lng, pickup_window_start, pickup_window_end, delivery_window_start,
              delivery_window_end, cargo_description, pieces, weight_kg, volume_m3, hazardous, carrier_type, vehicle_id,
              driver_id, carrier_supplier_id, freight_charge, fuel_surcharge, other_charges, carrier_cost, customer_ref,
              bol_number, notes)
  on public.shipments to authenticated;
grant update (customer_id, mode, service_level, origin_name, origin_address, origin_city, origin_country, origin_lat,
              origin_lng, destination_name, destination_address, destination_city, destination_country,
              destination_lat, destination_lng, pickup_window_start, pickup_window_end, delivery_window_start,
              delivery_window_end, cargo_description, pieces, weight_kg, volume_m3, hazardous, carrier_type, vehicle_id,
              driver_id, carrier_supplier_id, freight_charge, fuel_surcharge, other_charges, carrier_cost, customer_ref,
              bol_number, notes, status, delivered_at, received_by, pod_notes, cancel_reason)
  on public.shipments to authenticated;
-- Tracking updates are append-only; the status rows come from the trigger.
revoke insert, update, delete on public.shipment_events from authenticated;
grant insert (shipment_id, at, location, note) on public.shipment_events to authenticated;

-- ============================================================
-- Shipment state machine
-- ============================================================
create or replace function app.shipment_guard()
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
    if v_client and old.status <> 'draft' then
      raise exception 'SHIPMENT_NOT_DELETABLE';
    end if;
    return old;
  end if;

  -- Own fleet carries no supplier; a third-party carrier no vehicle/driver.
  if new.carrier_type = 'own' then
    new.carrier_supplier_id := null;
  else
    new.vehicle_id := null;
    new.driver_id := null;
  end if;

  if tg_op = 'INSERT' then
    if v_client then
      new.status := 'draft';
      new.booked_at := null;
      new.dispatched_at := null;
      new.picked_up_at := null;
      new.delivered_at := null;
      new.closed_at := null;
      new.canceled_at := null;
      new.received_by := null;
      new.pod_notes := null;
      new.cancel_reason := null;
      new.invoice_id := null;
    end if;
    select t.currency into new.currency from public.tenants t where t.id = new.tenant_id;
    new.currency := coalesce(new.currency, 'USD');
    new.updated_at := now();
    return new;
  end if;

  if v_client and new.currency is distinct from old.currency then
    raise exception 'FORBIDDEN';
  end if;

  if old.status in ('closed', 'canceled') and v_client and (
       new.status is distinct from old.status or new.customer_id is distinct from old.customer_id
       or new.mode is distinct from old.mode or new.service_level is distinct from old.service_level
       or new.origin_name is distinct from old.origin_name or new.origin_address is distinct from old.origin_address
       or new.origin_city is distinct from old.origin_city or new.origin_country is distinct from old.origin_country
       or new.origin_lat is distinct from old.origin_lat or new.origin_lng is distinct from old.origin_lng
       or new.destination_name is distinct from old.destination_name
       or new.destination_address is distinct from old.destination_address
       or new.destination_city is distinct from old.destination_city
       or new.destination_country is distinct from old.destination_country
       or new.destination_lat is distinct from old.destination_lat or new.destination_lng is distinct from old.destination_lng
       or new.pickup_window_start is distinct from old.pickup_window_start
       or new.pickup_window_end is distinct from old.pickup_window_end
       or new.delivery_window_start is distinct from old.delivery_window_start
       or new.delivery_window_end is distinct from old.delivery_window_end
       or new.cargo_description is distinct from old.cargo_description or new.pieces is distinct from old.pieces
       or new.weight_kg is distinct from old.weight_kg or new.volume_m3 is distinct from old.volume_m3
       or new.hazardous is distinct from old.hazardous or new.carrier_type is distinct from old.carrier_type
       or new.vehicle_id is distinct from old.vehicle_id or new.driver_id is distinct from old.driver_id
       or new.carrier_supplier_id is distinct from old.carrier_supplier_id
       or new.freight_charge is distinct from old.freight_charge or new.fuel_surcharge is distinct from old.fuel_surcharge
       or new.other_charges is distinct from old.other_charges or new.carrier_cost is distinct from old.carrier_cost
       or new.customer_ref is distinct from old.customer_ref or new.bol_number is distinct from old.bol_number
       or new.delivered_at is distinct from old.delivered_at or new.received_by is distinct from old.received_by
       or new.pod_notes is distinct from old.pod_notes or new.cancel_reason is distinct from old.cancel_reason) then
    raise exception 'SHIPMENT_LOCKED';
  end if;

  if new.status is distinct from old.status then
    if not (
         (old.status = 'draft' and new.status in ('booked', 'canceled'))
      or (old.status = 'booked' and new.status in ('dispatched', 'canceled'))
      or (old.status = 'dispatched' and new.status in ('in_transit', 'canceled'))
      or (old.status = 'in_transit' and new.status in ('delivered', 'exception'))
      or (old.status = 'exception' and new.status in ('in_transit', 'delivered'))
      or (old.status = 'delivered' and new.status = 'closed')) then
      raise exception 'ILLEGAL_SHIPMENT_TRANSITION';
    end if;
    case new.status
      when 'booked' then
        new.booked_at := now();
      when 'dispatched' then
        if (new.carrier_type = 'own' and new.vehicle_id is null)
           or (new.carrier_type = 'third_party' and new.carrier_supplier_id is null) then
          raise exception 'SHIPMENT_CARRIER_REQUIRED';
        end if;
        new.dispatched_at := now();
      when 'in_transit' then
        new.picked_up_at := coalesce(old.picked_up_at, now());
      when 'delivered' then
        if new.received_by is null or btrim(new.received_by) = '' then
          raise exception 'SHIPMENT_POD_REQUIRED';
        end if;
        new.delivered_at := coalesce(new.delivered_at, now());
      when 'closed' then
        new.closed_at := now();
      when 'canceled' then
        new.canceled_at := now();
      else
        null;
    end case;
  elsif v_client and new.status not in ('delivered', 'closed')
        and (new.delivered_at is distinct from old.delivered_at or new.received_by is distinct from old.received_by) then
    -- Proof of delivery comes with the delivered step.
    raise exception 'ILLEGAL_SHIPMENT_TRANSITION';
  end if;

  if new.delivered_at is not null and new.delivered_at is distinct from old.delivered_at
     and (new.delivered_at > now() + interval '5 minutes'
          or (new.dispatched_at is not null and new.delivered_at < new.dispatched_at)) then
    raise exception 'INVALID_POD_TIME';
  end if;

  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function app.shipment_guard() from public, anon, authenticated;

-- Timeline row and automation event for each status change.
create or replace function app.shipment_after()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return null;
  end if;
  insert into public.shipment_events (tenant_id, shipment_id, status, at, created_by)
  values (new.tenant_id, new.id, new.status,
          case when new.status = 'delivered' then coalesce(new.delivered_at, clock_timestamp()) else clock_timestamp() end, auth.uid());
  if tg_op = 'UPDATE' then
    perform app.emit_event(new.tenant_id, 'shipment.status_changed', 'shipment', new.id,
      jsonb_build_object('shipment_id', new.id, 'doc_number', new.doc_number, 'customer_id', new.customer_id,
        'from_status', old.status, 'to_status', new.status, 'mode', new.mode, 'origin_city', new.origin_city,
        'destination_city', new.destination_city, 'total_charge', new.total_charge,
        'on_time', case when new.status = 'delivered' and new.delivery_window_end is not null
                        then new.delivered_at <= new.delivery_window_end end),
      'shipment.status_changed:' || new.id || ':' || new.status || ':' || (extract(epoch from clock_timestamp()) * 1000000)::bigint);
  end if;
  return null;
end;
$$;
revoke execute on function app.shipment_after() from public, anon, authenticated;

create trigger shipments_number
  before insert or update of number, doc_number on public.shipments
  for each row execute function app.assign_doc_number('shipment', 'SHP');
create trigger shipments_guard before insert or update or delete on public.shipments
  for each row execute function app.shipment_guard();
create trigger shipments_stamp_actor before insert or update on public.shipments
  for each row execute function app.stamp_actor();
create trigger shipments_same_tenant
  before insert or update of customer_id, vehicle_id, driver_id, carrier_supplier_id on public.shipments
  for each row execute function app.assert_same_tenant('customer_id', 'customers', 'vehicle_id', 'vehicles',
                                                      'driver_id', 'drivers', 'carrier_supplier_id', 'suppliers');
create trigger shipments_after after insert or update of status on public.shipments
  for each row execute function app.shipment_after();
create trigger shipments_audit after insert or update or delete on public.shipments
  for each row execute function app.log_audit();

-- Manual tracking updates: tenant and author are the server's.
create or replace function app.shipment_event_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(nullif(current_setting('role', true), ''), 'none') in ('authenticated', 'anon') and pg_trigger_depth() <= 1 then
    new.status := null;
    new.created_by := auth.uid();
    new.at := least(coalesce(new.at, now()), now() + interval '5 minutes');
  end if;
  return new;
end;
$$;
revoke execute on function app.shipment_event_guard() from public, anon, authenticated;
create trigger shipment_events_guard before insert on public.shipment_events
  for each row execute function app.shipment_event_guard();
create trigger shipment_events_same_tenant before insert on public.shipment_events
  for each row execute function app.assert_same_tenant('shipment_id', 'shipments');

create trigger freight_rates_updated_at before update on public.freight_rates
  for each row execute function app.set_updated_at();
create trigger freight_rates_stamp_actor before insert or update on public.freight_rates
  for each row execute function app.stamp_actor();
create trigger freight_rates_same_tenant before insert or update of customer_id on public.freight_rates
  for each row execute function app.assert_same_tenant('customer_id', 'customers');
create trigger freight_rates_audit after insert or update or delete on public.freight_rates
  for each row execute function app.log_audit();

-- ============================================================
-- RPCs
-- ============================================================

-- Cheapest valid rate for a lane: the customer's own rates win over general
-- ones when any match. Price = per-trip base + per-kg × weight, at least the
-- minimum charge. Mirrored by quoteFreight() in shared/tms.ts.
create or replace function public.quote_freight(
  p_origin_city text, p_destination_city text, p_mode text, p_weight_kg numeric,
  p_customer_id uuid default null, p_on date default current_date
)
returns table (rate_id uuid, price numeric, customer_specific boolean)
language sql
stable
set search_path = ''
as $$
  select r.id,
         round(greatest(r.min_charge, coalesce(r.rate_per_trip, 0) + coalesce(r.rate_per_kg, 0) * greatest(coalesce(p_weight_kg, 0), 0)), 3),
         r.customer_id is not null
  from public.freight_rates r
  where lower(btrim(r.origin_city)) = lower(btrim(p_origin_city))
    and lower(btrim(r.destination_city)) = lower(btrim(p_destination_city))
    and r.mode = p_mode
    and r.valid_from <= p_on and (r.valid_to is null or r.valid_to >= p_on)
    and (r.customer_id is null or r.customer_id = p_customer_id)
  order by (r.customer_id is not null) desc,
           greatest(r.min_charge, coalesce(r.rate_per_trip, 0) + coalesce(r.rate_per_kg, 0) * greatest(coalesce(p_weight_kg, 0), 0)),
           r.valid_from desc, r.id
  limit 1;
$$;
revoke execute on function public.quote_freight(text, text, text, numeric, uuid, date) from public, anon;
grant execute on function public.quote_freight(text, text, text, numeric, uuid, date) to authenticated;

-- invoice_id is not client-writable; this links the invoice the caller just
-- created (same tenant, same customer, still a draft).
create or replace function app.shipment_link_invoice(p_shipment_id uuid, p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.invoices i join public.shipments s on s.id = p_shipment_id
                 where i.id = p_invoice_id and i.tenant_id = app.tenant_id() and s.tenant_id = i.tenant_id
                   and i.customer_id = s.customer_id and i.status = 'draft') then
    raise exception 'SHIPMENT_NOT_FOUND';
  end if;
  update public.shipments set invoice_id = p_invoice_id where id = p_shipment_id;
end;
$$;
revoke execute on function app.shipment_link_invoice(uuid, uuid) from public, anon;
grant execute on function app.shipment_link_invoice(uuid, uuid) to authenticated;

-- One-line DRAFT invoice for a delivered or closed shipment.
create or replace function public.shipment_create_invoice(p_shipment_id uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_tenant uuid := app.require_module('tms', 'manager');
  v_s public.shipments%rowtype;
  v_terms integer;
  v_tax numeric;
  v_invoice uuid;
begin
  if not app.module_enabled('billing') then
    raise exception 'MODULE_DISABLED';
  end if;
  select * into v_s from public.shipments s where s.id = p_shipment_id and s.tenant_id = v_tenant for update;
  if not found then
    raise exception 'SHIPMENT_NOT_FOUND';
  end if;
  if v_s.status not in ('delivered', 'closed') or v_s.total_charge <= 0 then
    raise exception 'SHIPMENT_NOT_INVOICEABLE';
  end if;
  if v_s.invoice_id is not null
     and exists (select 1 from public.invoices i where i.id = v_s.invoice_id and i.status <> 'void') then
    raise exception 'SHIPMENT_ALREADY_INVOICED';
  end if;

  select ss.payment_terms_days, ss.default_tax_rate into v_terms, v_tax
    from public.sales_settings ss where ss.tenant_id = v_tenant;

  insert into public.invoices (customer_id, due_date, title, customer_reference)
  values (v_s.customer_id, current_date + coalesce(v_terms, 30),
          'Freight ' || coalesce(v_s.doc_number, '') || ': ' || v_s.origin_city || ' → ' || v_s.destination_city,
          coalesce(v_s.customer_ref, v_s.bol_number))
  returning id into v_invoice;

  insert into public.invoice_lines (invoice_id, sort_order, description, quantity, unit, unit_price, discount_percent, tax_rate)
  values (v_invoice, 0,
          'Freight ' || coalesce(v_s.doc_number, '') || ', ' || v_s.origin_city || ' → ' || v_s.destination_city
            || coalesce(' (' || nullif(v_s.cargo_description, '') || ')', ''),
          1, null, v_s.total_charge, 0, coalesce(v_tax, 0));

  perform app.shipment_link_invoice(p_shipment_id, v_invoice);
  return v_invoice;
end;
$$;
revoke execute on function public.shipment_create_invoice(uuid) from public, anon;
grant execute on function public.shipment_create_invoice(uuid) to authenticated;

-- ============================================================
-- RLS: members read; managers write.
-- ============================================================
set local lock_timeout = '1s';
create policy shipments_select on public.shipments for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.module_enabled('tms')));
create policy shipments_insert on public.shipments for insert to authenticated
  with check (tenant_id = (select app.tenant_id()) and (select app.is_manager()) and (select app.module_enabled('tms')));
create policy shipments_update on public.shipments for update to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_manager()) and (select app.module_enabled('tms')))
  with check (tenant_id = (select app.tenant_id()) and (select app.is_manager()) and (select app.module_enabled('tms')));
create policy shipments_delete on public.shipments for delete to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_manager()) and (select app.module_enabled('tms')));

create policy shipment_events_select on public.shipment_events for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.module_enabled('tms')));
create policy shipment_events_insert on public.shipment_events for insert to authenticated
  with check (tenant_id = (select app.tenant_id()) and (select app.is_manager()) and (select app.module_enabled('tms')));

create policy freight_rates_select on public.freight_rates for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.module_enabled('tms')));
create policy freight_rates_insert on public.freight_rates for insert to authenticated
  with check (tenant_id = (select app.tenant_id()) and (select app.is_manager()) and (select app.module_enabled('tms')));
create policy freight_rates_update on public.freight_rates for update to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_manager()) and (select app.module_enabled('tms')))
  with check (tenant_id = (select app.tenant_id()) and (select app.is_manager()) and (select app.module_enabled('tms')));
create policy freight_rates_delete on public.freight_rates for delete to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_manager()) and (select app.module_enabled('tms')));
