-- FleetManage: initial schema
-- Multi-tenant fleet management. Shared schema, tenant_id + RLS on every table.
-- Tenant + role live in JWT app_metadata (user-immutable), set by the Worker API
-- via service role at signup / invitation acceptance.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Helper schema
-- ---------------------------------------------------------------------------
create schema if not exists app;
grant usage on schema app to authenticated, anon, service_role;

create or replace function app.tenant_id()
returns uuid
language sql
stable
as $$
  select nullif((auth.jwt() -> 'app_metadata') ->> 'tenant_id', '')::uuid
$$;

create or replace function app.role()
returns text
language sql
stable
as $$
  select (auth.jwt() -> 'app_metadata') ->> 'role'
$$;

-- owner > admin > manager > viewer
create or replace function app.is_manager()
returns boolean
language sql
stable
as $$
  select app.role() in ('owner', 'admin', 'manager')
$$;

create or replace function app.is_admin()
returns boolean
language sql
stable
as $$
  select app.role() in ('owner', 'admin')
$$;

create or replace function app.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tenants & membership
-- ---------------------------------------------------------------------------
create table public.tenants (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(name) between 1 and 120),
  country       text not null default 'US',   -- ISO 3166-1 alpha-2
  currency      text not null default 'USD',  -- ISO 4217
  distance_unit text not null default 'km' check (distance_unit in ('km', 'mi')),
  volume_unit   text not null default 'L' check (volume_unit in ('L', 'gal')),
  timezone      text not null default 'UTC',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  email      text not null,
  full_name  text not null default '',
  phone      text,
  role       text not null default 'viewer' check (role in ('owner', 'admin', 'manager', 'viewer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_tenant_idx on public.profiles (tenant_id);

create table public.invitations (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null default app.tenant_id() references public.tenants (id) on delete cascade,
  email      text not null,
  role       text not null default 'viewer' check (role in ('admin', 'manager', 'viewer')),
  token      uuid not null unique default gen_random_uuid(),
  status     text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  invited_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null default now() + interval '14 days',
  created_at timestamptz not null default now()
);
create index invitations_tenant_idx on public.invitations (tenant_id);

-- ---------------------------------------------------------------------------
-- Fleet core
-- ---------------------------------------------------------------------------
create table public.vehicles (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null default app.tenant_id() references public.tenants (id) on delete cascade,
  name                text not null,
  vin                 text,
  license_plate       text,
  make                text,
  model               text,
  year                int check (year between 1900 and 2100),
  vehicle_type        text not null default 'car'
                      check (vehicle_type in ('car', 'van', 'truck', 'bus', 'trailer', 'equipment', 'motorcycle', 'other')),
  status              text not null default 'active'
                      check (status in ('active', 'in_shop', 'out_of_service', 'retired')),
  fuel_type           text not null default 'gasoline'
                      check (fuel_type in ('gasoline', 'diesel', 'electric', 'hybrid', 'cng', 'lpg', 'other')),
  odometer            numeric(12,1) not null default 0,  -- canonical km
  odometer_updated_at timestamptz,
  purchase_date       date,
  purchase_price      numeric(14,2),
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index vehicles_tenant_status_idx on public.vehicles (tenant_id, status);

create table public.drivers (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null default app.tenant_id() references public.tenants (id) on delete cascade,
  first_name     text not null,
  last_name      text not null default '',
  email          text,
  phone          text,
  license_number text,
  license_class  text,
  license_expiry date,
  hire_date      date,
  status         text not null default 'active' check (status in ('active', 'inactive')),
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index drivers_tenant_status_idx on public.drivers (tenant_id, status);

create table public.vehicle_assignments (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null default app.tenant_id() references public.tenants (id) on delete cascade,
  vehicle_id uuid not null references public.vehicles (id) on delete cascade,
  driver_id  uuid not null references public.drivers (id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at   timestamptz,
  notes      text,
  created_at timestamptz not null default now()
);
create index assignments_tenant_idx on public.vehicle_assignments (tenant_id);
create index assignments_vehicle_idx on public.vehicle_assignments (vehicle_id);
-- one open assignment per vehicle
create unique index assignments_one_open_per_vehicle
  on public.vehicle_assignments (vehicle_id) where ended_at is null;

-- ---------------------------------------------------------------------------
-- Maintenance
-- ---------------------------------------------------------------------------
create table public.service_reminders (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null default app.tenant_id() references public.tenants (id) on delete cascade,
  vehicle_id        uuid not null references public.vehicles (id) on delete cascade,
  task              text not null,             -- e.g. "Oil & filter change"
  notes             text,
  interval_months   int check (interval_months > 0),
  interval_km       numeric(12,1) check (interval_km > 0),
  due_date          date,
  due_km            numeric(12,1),
  last_completed_at date,
  last_completed_km numeric(12,1),
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (interval_months is not null or interval_km is not null or due_date is not null or due_km is not null)
);
create index reminders_tenant_idx on public.service_reminders (tenant_id, active);
create index reminders_vehicle_idx on public.service_reminders (vehicle_id);

create table public.work_orders (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null default app.tenant_id() references public.tenants (id) on delete cascade,
  vehicle_id     uuid not null references public.vehicles (id) on delete cascade,
  number         int not null,
  title          text not null,
  description    text,
  status         text not null default 'open'
                 check (status in ('open', 'in_progress', 'completed', 'canceled')),
  priority       text not null default 'normal'
                 check (priority in ('low', 'normal', 'high', 'critical')),
  vendor         text,
  odometer       numeric(12,1),
  scheduled_date date,
  completed_at   timestamptz,
  issue_id       uuid,
  reminder_id    uuid references public.service_reminders (id) on delete set null,
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (tenant_id, number)
);
create index work_orders_tenant_status_idx on public.work_orders (tenant_id, status);
create index work_orders_vehicle_idx on public.work_orders (vehicle_id);

create table public.work_order_lines (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null default app.tenant_id() references public.tenants (id) on delete cascade,
  work_order_id uuid not null references public.work_orders (id) on delete cascade,
  category      text not null default 'part' check (category in ('labor', 'part', 'fee', 'other')),
  description   text not null,
  quantity      numeric(10,2) not null default 1,
  unit_cost     numeric(14,2) not null default 0,
  created_at    timestamptz not null default now()
);
create index wo_lines_tenant_idx on public.work_order_lines (tenant_id);
create index wo_lines_wo_idx on public.work_order_lines (work_order_id);

-- per-tenant sequential work order numbers
create or replace function app.next_work_order_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.number is null or new.number = 0 then
    select coalesce(max(number), 0) + 1
      into new.number
      from public.work_orders
     where tenant_id = new.tenant_id;
  end if;
  return new;
end;
$$;

create trigger work_orders_number
  before insert on public.work_orders
  for each row execute function app.next_work_order_number();

-- ---------------------------------------------------------------------------
-- Fuel
-- ---------------------------------------------------------------------------
create table public.fuel_logs (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null default app.tenant_id() references public.tenants (id) on delete cascade,
  vehicle_id   uuid not null references public.vehicles (id) on delete cascade,
  driver_id    uuid references public.drivers (id) on delete set null,
  filled_at    timestamptz not null default now(),
  odometer     numeric(12,1),                  -- canonical km
  volume       numeric(10,2) not null,         -- canonical liters
  total_cost   numeric(14,2) not null default 0,
  is_full_tank boolean not null default true,
  vendor       text,
  notes        text,
  created_at   timestamptz not null default now()
);
create index fuel_tenant_vehicle_idx on public.fuel_logs (tenant_id, vehicle_id, filled_at desc);

-- ---------------------------------------------------------------------------
-- Inspections & issues
-- ---------------------------------------------------------------------------
create table public.inspection_templates (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null default app.tenant_id() references public.tenants (id) on delete cascade,
  name       text not null,
  -- [{ "id": "brakes", "label": "Brakes", "section": "Safety" }, ...]
  items      jsonb not null default '[]',
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index insp_templates_tenant_idx on public.inspection_templates (tenant_id, active);

create table public.inspections (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null default app.tenant_id() references public.tenants (id) on delete cascade,
  vehicle_id   uuid not null references public.vehicles (id) on delete cascade,
  driver_id    uuid references public.drivers (id) on delete set null,
  template_id  uuid references public.inspection_templates (id) on delete set null,
  performed_at timestamptz not null default now(),
  odometer     numeric(12,1),
  status       text not null default 'pass' check (status in ('pass', 'fail')),
  -- [{ "item_id": "brakes", "label": "Brakes", "result": "pass"|"fail"|"na", "note": "" }, ...]
  results      jsonb not null default '[]',
  notes        text,
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index inspections_tenant_vehicle_idx on public.inspections (tenant_id, vehicle_id, performed_at desc);

create table public.issues (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null default app.tenant_id() references public.tenants (id) on delete cascade,
  vehicle_id    uuid not null references public.vehicles (id) on delete cascade,
  title         text not null,
  description   text,
  status        text not null default 'open'
                check (status in ('open', 'in_progress', 'resolved', 'closed')),
  priority      text not null default 'normal'
                check (priority in ('low', 'normal', 'high', 'critical')),
  source        text not null default 'manual' check (source in ('manual', 'inspection')),
  inspection_id uuid references public.inspections (id) on delete set null,
  work_order_id uuid references public.work_orders (id) on delete set null,
  reported_by   uuid references auth.users (id) on delete set null,
  reported_at   timestamptz not null default now(),
  resolved_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index issues_tenant_status_idx on public.issues (tenant_id, status);
create index issues_vehicle_idx on public.issues (vehicle_id);

alter table public.work_orders
  add constraint work_orders_issue_fk
  foreign key (issue_id) references public.issues (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Renewals (registration, insurance, permits, ...)
-- ---------------------------------------------------------------------------
create table public.renewals (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null default app.tenant_id() references public.tenants (id) on delete cascade,
  vehicle_id        uuid not null references public.vehicles (id) on delete cascade,
  renewal_type      text not null default 'registration'
                    check (renewal_type in ('registration', 'insurance', 'permit', 'emission_test', 'roadworthiness', 'other')),
  name              text,
  due_date          date not null,
  amount            numeric(14,2),
  recurrence_months int check (recurrence_months > 0),
  completed_at      date,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index renewals_tenant_due_idx on public.renewals (tenant_id, due_date);
create index renewals_vehicle_idx on public.renewals (vehicle_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'tenants', 'profiles', 'vehicles', 'drivers', 'service_reminders',
    'work_orders', 'inspection_templates', 'issues', 'renewals'
  ] loop
    execute format(
      'create trigger %I_updated_at before update on public.%I
         for each row execute function app.set_updated_at()', t, t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Keep vehicle odometer fresh from fuel logs / inspections / work orders
-- ---------------------------------------------------------------------------
create or replace function app.bump_vehicle_odometer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.odometer is not null and new.odometer > 0 then
    update public.vehicles v
       set odometer = new.odometer,
           odometer_updated_at = now()
     where v.id = new.vehicle_id
       and v.tenant_id = new.tenant_id
       and v.odometer < new.odometer;
  end if;
  return new;
end;
$$;

create trigger fuel_logs_bump_odometer
  after insert on public.fuel_logs
  for each row execute function app.bump_vehicle_odometer();
create trigger inspections_bump_odometer
  after insert on public.inspections
  for each row execute function app.bump_vehicle_odometer();
create trigger work_orders_bump_odometer
  after insert or update of odometer on public.work_orders
  for each row execute function app.bump_vehicle_odometer();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.tenants              enable row level security;
alter table public.profiles             enable row level security;
alter table public.invitations          enable row level security;
alter table public.vehicles             enable row level security;
alter table public.drivers              enable row level security;
alter table public.vehicle_assignments  enable row level security;
alter table public.service_reminders    enable row level security;
alter table public.work_orders          enable row level security;
alter table public.work_order_lines     enable row level security;
alter table public.fuel_logs            enable row level security;
alter table public.inspection_templates enable row level security;
alter table public.inspections          enable row level security;
alter table public.issues               enable row level security;
alter table public.renewals             enable row level security;

-- tenants: members read; admins update settings
create policy tenants_select on public.tenants
  for select to authenticated
  using (id = (select app.tenant_id()));
create policy tenants_update on public.tenants
  for update to authenticated
  using (id = (select app.tenant_id()) and (select app.is_admin()))
  with check (id = (select app.tenant_id()) and (select app.is_admin()));

-- profiles: members read all tenant profiles; users update own row
-- (column-level grants below prevent self-service role/tenant escalation)
create policy profiles_select on public.profiles
  for select to authenticated
  using (tenant_id = (select app.tenant_id()));
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

revoke update on public.profiles from authenticated;
grant update (full_name, phone) on public.profiles to authenticated;

-- invitations: admins only (accept flow goes through the Worker w/ service role)
create policy invitations_select on public.invitations
  for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_admin()));
create policy invitations_insert on public.invitations
  for insert to authenticated
  with check (tenant_id = (select app.tenant_id()) and (select app.is_admin()));
create policy invitations_update on public.invitations
  for update to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_admin()))
  with check (tenant_id = (select app.tenant_id()) and (select app.is_admin()));
create policy invitations_delete on public.invitations
  for delete to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_admin()));

-- fleet data: members read; managers+ write
do $$
declare t text;
begin
  foreach t in array array[
    'vehicles', 'drivers', 'vehicle_assignments', 'service_reminders',
    'work_orders', 'work_order_lines', 'fuel_logs', 'inspection_templates',
    'inspections', 'issues', 'renewals'
  ] loop
    execute format(
      'create policy %I_select on public.%I for select to authenticated
         using (tenant_id = (select app.tenant_id()))', t, t);
    execute format(
      'create policy %I_insert on public.%I for insert to authenticated
         with check (tenant_id = (select app.tenant_id()) and (select app.is_manager()))', t, t);
    execute format(
      'create policy %I_update on public.%I for update to authenticated
         using (tenant_id = (select app.tenant_id()) and (select app.is_manager()))
         with check (tenant_id = (select app.tenant_id()) and (select app.is_manager()))', t, t);
    execute format(
      'create policy %I_delete on public.%I for delete to authenticated
         using (tenant_id = (select app.tenant_id()) and (select app.is_manager()))', t, t);
  end loop;
end;
$$;
