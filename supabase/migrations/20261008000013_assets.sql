-- Assets (module assets): register of non-vehicle assets (equipment, tools,
-- IT, furniture, trailers, containers, generators) with an event history,
-- assignment to an employee or vehicle, disposal, and depreciation inputs.
--
-- 1) assets (AST): master data. Status in_service | in_storage | in_repair |
--    lost are set freely; disposed only through asset_dispose and is final
--    (a disposed asset is read-only). Assignment columns are written only by
--    asset_assign / asset_return / asset_dispose so the history stays true.
-- 2) asset_events: timeline (assigned, returned, moved, serviced, inspected,
--    repaired, disposed, note). The flow RPCs write theirs; managers add the
--    rest by hand. Events of a disposed asset are frozen too.
-- 3) Depreciation (straight line / declining balance / none) is computed in
--    src/lib/depreciation.ts from purchase_date, purchase_cost,
--    useful_life_months and salvage_value; nothing is stored.
-- 4) Scanner app.scan_due_assets: warranties expiring within 30 / 7 days or
--    lapsed in the last 30 days -> managers (assets.warranty_expiring).
--
-- Raised codes: ASSET_NOT_FOUND, ASSET_DISPOSED, ASSET_ASSIGNEE_REQUIRED,
-- ASSET_NOT_ASSIGNED, INVALID_ASSET_STATUS (+ CROSS_TENANT_REFERENCE,
-- FORBIDDEN, MODULE_DISABLED).
-- Additive only.

set local lock_timeout = '3s';
set local statement_timeout = '60s';

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  number integer,
  doc_number text,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  category text not null default 'equipment'
    check (category in ('equipment', 'tool', 'it', 'furniture', 'trailer', 'container', 'generator', 'other')),
  serial_number text check (serial_number is null or char_length(serial_number) <= 100),
  model text check (model is null or char_length(model) <= 100),
  manufacturer text check (manufacturer is null or char_length(manufacturer) <= 100),
  status text not null default 'in_service'
    check (status in ('in_service', 'in_storage', 'in_repair', 'disposed', 'lost')),
  location text check (location is null or char_length(location) <= 200),
  warehouse_id uuid references public.warehouses(id) on delete set null,
  branch_id uuid references public.branches(id) on delete set null,
  assigned_employee_id uuid references public.employees(id) on delete set null,
  assigned_vehicle_id uuid references public.vehicles(id) on delete set null,
  assigned_at timestamptz,
  purchase_date date,
  purchase_cost numeric(14, 4) check (purchase_cost is null or purchase_cost >= 0),
  supplier_id uuid references public.suppliers(id) on delete set null,
  warranty_expiry date,
  depreciation_method text not null default 'straight_line'
    check (depreciation_method in ('straight_line', 'declining_balance', 'none')),
  useful_life_months integer check (useful_life_months is null or useful_life_months between 1 and 1200),
  salvage_value numeric(14, 4) not null default 0 check (salvage_value >= 0),
  disposed_at date,
  disposal_value numeric(14, 4) check (disposal_value is null or disposal_value >= 0),
  notes text check (notes is null or char_length(notes) <= 4000),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (purchase_cost is null or salvage_value <= purchase_cost)
);
create unique index assets_tenant_number_uk on public.assets (tenant_id, number);
create unique index assets_tenant_doc_number_uk on public.assets (tenant_id, doc_number);
create index assets_tenant_status_idx on public.assets (tenant_id, status, name);
create index assets_tenant_category_idx on public.assets (tenant_id, category);
create index assets_tenant_warranty_idx on public.assets (tenant_id, warranty_expiry)
  where warranty_expiry is not null and status <> 'disposed';
create index assets_employee_idx on public.assets (assigned_employee_id);
create index assets_vehicle_idx on public.assets (assigned_vehicle_id);
create index assets_warehouse_idx on public.assets (warehouse_id);
create index assets_branch_idx on public.assets (branch_id);
create index assets_supplier_idx on public.assets (supplier_id);
alter table public.assets enable row level security;
revoke all on public.assets from anon;
revoke insert, update on public.assets from authenticated;
grant insert (name, category, serial_number, model, manufacturer, status, location, warehouse_id, branch_id,
              purchase_date, purchase_cost, supplier_id, warranty_expiry, depreciation_method,
              useful_life_months, salvage_value, notes)
  on public.assets to authenticated;
grant update (name, category, serial_number, model, manufacturer, status, location, warehouse_id, branch_id,
              purchase_date, purchase_cost, supplier_id, warranty_expiry, depreciation_method,
              useful_life_months, salvage_value, notes)
  on public.assets to authenticated;

create table public.asset_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  event_type text not null
    check (event_type in ('assigned', 'returned', 'moved', 'serviced', 'inspected', 'repaired', 'disposed', 'note')),
  at timestamptz not null default now(),
  detail text check (detail is null or char_length(detail) <= 2000),
  cost numeric(14, 4) check (cost is null or cost >= 0),
  employee_id uuid references public.employees(id) on delete set null,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index asset_events_asset_idx on public.asset_events (asset_id, at desc);
create index asset_events_tenant_idx on public.asset_events (tenant_id, at desc);
create index asset_events_employee_idx on public.asset_events (employee_id);
create index asset_events_vehicle_idx on public.asset_events (vehicle_id);
alter table public.asset_events enable row level security;
revoke all on public.asset_events from anon;
revoke insert, update on public.asset_events from authenticated;
-- The flow event types belong to the RPCs; the client logs the others.
grant insert (asset_id, event_type, at, detail, cost) on public.asset_events to authenticated;
grant update (at, detail, cost) on public.asset_events to authenticated;

-- ============================================================
-- Guards
-- ============================================================
create or replace function app.asset_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_flow boolean := coalesce(current_setting('app.asset_flow', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if new.status = 'disposed' then
      raise exception 'INVALID_ASSET_STATUS';
    end if;
    return new;
  end if;
  if old.status = 'disposed' then
    raise exception 'ASSET_DISPOSED';
  end if;
  if new.status = 'disposed' and not v_flow then
    raise exception 'INVALID_ASSET_STATUS';
  end if;
  return new;
end;
$$;
revoke execute on function app.asset_guard() from public, anon, authenticated;

create or replace function app.asset_event_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_flow boolean := coalesce(current_setting('app.asset_flow', true), '') = 'on';
  v_asset uuid := case when tg_op = 'DELETE' then old.asset_id else new.asset_id end;
  v_type text := case when tg_op = 'DELETE' then old.event_type else new.event_type end;
  v_status text;
begin
  select a.status into v_status from public.assets a where a.id = v_asset;
  if v_status = 'disposed' and not v_flow then
    raise exception 'ASSET_DISPOSED';
  end if;
  if tg_op = 'INSERT' and not v_flow and v_type in ('assigned', 'returned', 'disposed') then
    raise exception 'FORBIDDEN';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke execute on function app.asset_event_guard() from public, anon, authenticated;

create trigger assets_doc_number
  before insert or update of number, doc_number on public.assets
  for each row execute function app.assign_doc_number('asset', 'AST');
create trigger assets_guard before insert or update on public.assets
  for each row execute function app.asset_guard();
create trigger assets_stamp_actor before insert or update on public.assets
  for each row execute function app.stamp_actor();
create trigger assets_audit after insert or update or delete on public.assets
  for each row execute function app.log_audit();
create trigger assets_same_tenant
  before insert or update of warehouse_id, branch_id, supplier_id, assigned_employee_id, assigned_vehicle_id
  on public.assets
  for each row execute function app.assert_same_tenant(
    'warehouse_id', 'warehouses', 'branch_id', 'branches', 'supplier_id', 'suppliers',
    'assigned_employee_id', 'employees', 'assigned_vehicle_id', 'vehicles');

create trigger asset_events_guard before insert or update or delete on public.asset_events
  for each row execute function app.asset_event_guard();
create trigger asset_events_stamp_actor before insert or update on public.asset_events
  for each row execute function app.stamp_actor();
create trigger asset_events_same_tenant
  before insert or update of asset_id, employee_id, vehicle_id on public.asset_events
  for each row execute function app.assert_same_tenant(
    'asset_id', 'assets', 'employee_id', 'employees', 'vehicle_id', 'vehicles');

-- ============================================================
-- Flows. Definer, because the assignment columns are not client-writable;
-- app.asset_for_flow re-checks module, manager role and tenant first.
-- ============================================================
create or replace function app.asset_for_flow(p_asset uuid)
returns public.assets
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset public.assets;
begin
  perform app.require_module('assets');
  if not app.is_manager() then
    raise exception 'FORBIDDEN';
  end if;
  select * into v_asset from public.assets a
  where a.id = p_asset and a.tenant_id = app.tenant_id()
  for update;
  if v_asset.id is null then
    raise exception 'ASSET_NOT_FOUND';
  end if;
  if v_asset.status = 'disposed' then
    raise exception 'ASSET_DISPOSED';
  end if;
  perform set_config('app.asset_flow', 'on', true);
  return v_asset;
end;
$$;
revoke execute on function app.asset_for_flow(uuid) from public, anon, authenticated;

create or replace function public.asset_assign(
  p_asset uuid,
  p_employee uuid default null,
  p_vehicle uuid default null,
  p_location text default null,
  p_note text default null
)
returns public.assets
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset public.assets;
begin
  v_asset := app.asset_for_flow(p_asset);
  if p_employee is null and p_vehicle is null then
    raise exception 'ASSET_ASSIGNEE_REQUIRED';
  end if;
  update public.assets
     set assigned_employee_id = p_employee,
         assigned_vehicle_id = p_vehicle,
         assigned_at = now(),
         status = case when status in ('in_storage', 'lost') then 'in_service' else status end,
         location = coalesce(nullif(btrim(p_location), ''), location)
   where id = v_asset.id
  returning * into v_asset;
  insert into public.asset_events (asset_id, event_type, detail, employee_id, vehicle_id)
  values (v_asset.id, 'assigned', nullif(btrim(coalesce(p_note, '')), ''), p_employee, p_vehicle);
  perform set_config('app.asset_flow', 'off', true);
  return v_asset;
end;
$$;
revoke execute on function public.asset_assign(uuid, uuid, uuid, text, text) from public, anon;
grant execute on function public.asset_assign(uuid, uuid, uuid, text, text) to authenticated;

create or replace function public.asset_return(
  p_asset uuid,
  p_warehouse uuid default null,
  p_location text default null,
  p_note text default null
)
returns public.assets
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset public.assets;
  v_employee uuid;
  v_vehicle uuid;
begin
  v_asset := app.asset_for_flow(p_asset);
  if v_asset.assigned_employee_id is null and v_asset.assigned_vehicle_id is null then
    raise exception 'ASSET_NOT_ASSIGNED';
  end if;
  v_employee := v_asset.assigned_employee_id;
  v_vehicle := v_asset.assigned_vehicle_id;
  update public.assets
     set assigned_employee_id = null,
         assigned_vehicle_id = null,
         assigned_at = null,
         status = case when status = 'in_service' then 'in_storage' else status end,
         warehouse_id = coalesce(p_warehouse, warehouse_id),
         location = coalesce(nullif(btrim(p_location), ''), location)
   where id = v_asset.id
  returning * into v_asset;
  insert into public.asset_events (asset_id, event_type, detail, employee_id, vehicle_id)
  values (v_asset.id, 'returned', nullif(btrim(coalesce(p_note, '')), ''), v_employee, v_vehicle);
  perform set_config('app.asset_flow', 'off', true);
  return v_asset;
end;
$$;
revoke execute on function public.asset_return(uuid, uuid, text, text) from public, anon;
grant execute on function public.asset_return(uuid, uuid, text, text) to authenticated;

create or replace function public.asset_dispose(
  p_asset uuid,
  p_disposed_at date default null,
  p_value numeric default null,
  p_note text default null
)
returns public.assets
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset public.assets;
begin
  v_asset := app.asset_for_flow(p_asset);
  if p_value is not null and p_value < 0 then
    raise exception 'INVALID_QUANTITY';
  end if;
  insert into public.asset_events (asset_id, event_type, at, detail, cost, employee_id, vehicle_id)
  values (v_asset.id, 'disposed', coalesce(p_disposed_at::timestamptz, now()),
          nullif(btrim(coalesce(p_note, '')), ''), p_value,
          v_asset.assigned_employee_id, v_asset.assigned_vehicle_id);
  update public.assets
     set status = 'disposed',
         disposed_at = coalesce(p_disposed_at, current_date),
         disposal_value = p_value,
         assigned_employee_id = null,
         assigned_vehicle_id = null,
         assigned_at = null
   where id = v_asset.id
  returning * into v_asset;
  perform set_config('app.asset_flow', 'off', true);
  return v_asset;
end;
$$;
revoke execute on function public.asset_dispose(uuid, date, numeric, text) from public, anon;
grant execute on function public.asset_dispose(uuid, date, numeric, text) to authenticated;

-- ============================================================
-- Scanner: warranties
-- ============================================================
create or replace function app.scan_due_assets(p_tenant uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date;
  v_total integer := 0;
  r record;
begin
  if p_tenant is null or not app.tenant_module_enabled(p_tenant, 'assets') then
    return 0;
  end if;
  select (now() at time zone coalesce(t.timezone, 'UTC'))::date into v_today
  from public.tenants t where t.id = p_tenant;
  if v_today is null then
    return 0;
  end if;

  for r in
    select a.id, a.name, a.doc_number, a.warranty_expiry,
           (a.warranty_expiry - v_today) as days_left,
           case
             when a.warranty_expiry < v_today then 'expired'
             when a.warranty_expiry - v_today <= 7 then 'd7'
             else 'd30'
           end as stage
    from public.assets a
    where a.tenant_id = p_tenant
      and a.status <> 'disposed'
      and a.warranty_expiry between v_today - 30 and v_today + 30
    order by a.warranty_expiry
    limit 500
  loop
    v_total := v_total + coalesce(app.notify(
      p_tenant, 'managers', 'assets.warranty_expiring',
      case when r.stage = 'd30' then 'info' else 'warning' end,
      'asset', r.id, '/assets/' || r.id,
      jsonb_build_object('asset', r.name, 'number', r.doc_number, 'expiry', r.warranty_expiry,
                         'days', r.days_left, 'stage', r.stage),
      case when r.stage = 'expired' then 'Warranty expired: ' || r.name
           else 'Warranty ends in ' || r.days_left || ' days: ' || r.name end,
      'Warranty end: ' || to_char(r.warranty_expiry, 'YYYY-MM-DD'),
      'assets.warranty_expiring:' || r.id || ':' || r.warranty_expiry || ':' || r.stage), 0);
  end loop;
  return v_total;
end;
$$;
revoke execute on function app.scan_due_assets(uuid) from public, anon, authenticated;

-- ============================================================
-- RLS policies, LAST. Members read, managers write.
-- ============================================================
set local lock_timeout = '1s';

do $$
declare
  t text;
begin
  foreach t in array array['assets', 'asset_events'] loop
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (tenant_id = (select app.tenant_id()) and (select app.module_enabled(''assets'')))',
      t || '_select', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check (tenant_id = (select app.tenant_id()) and (select app.is_manager())
                     and (select app.module_enabled(''assets'')))',
      t || '_insert', t);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (tenant_id = (select app.tenant_id()) and (select app.is_manager())
                and (select app.module_enabled(''assets'')))
         with check (tenant_id = (select app.tenant_id()) and (select app.is_manager())
                     and (select app.module_enabled(''assets'')))',
      t || '_update', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated
         using (tenant_id = (select app.tenant_id()) and (select app.is_manager())
                and (select app.module_enabled(''assets'')))',
      t || '_delete', t);
  end loop;
end;
$$;
