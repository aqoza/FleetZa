-- Speed Limiter enterprise platform: customers, contacts, device registry,
-- job workflows, certificate numbering + public verification. Additive.

-- ---------------------------------------------------------------------------
-- Customers (client organizations of the tenant's service business)
-- ---------------------------------------------------------------------------
create table public.sl_customers (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null default app.tenant_id() references public.tenants (id) on delete cascade,
  name          text not null,
  cr_number     text,                 -- commercial registration / trade license
  tax_number    text,
  email         text,
  phone         text,
  website       text,
  address       text,
  city          text,
  country       text,
  billing_terms text,                 -- e.g. "Net 30"
  credit_limit  numeric(14,2),
  status        text not null default 'active' check (status in ('active', 'inactive')),
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index sl_customers_tenant_idx on public.sl_customers (tenant_id, status);

create table public.sl_contacts (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default app.tenant_id() references public.tenants (id) on delete cascade,
  customer_id uuid not null references public.sl_customers (id) on delete cascade,
  name        text not null,
  title       text,                   -- Fleet Manager, Operations, Finance, ...
  department  text,
  email       text,
  phone       text,
  whatsapp    text,
  is_primary  boolean not null default false,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index sl_contacts_customer_idx on public.sl_contacts (customer_id);
create index sl_contacts_tenant_idx on public.sl_contacts (tenant_id);

-- Vehicles can now belong to a customer (null = the tenant's own fleet).
alter table public.vehicles
  add column customer_id uuid references public.sl_customers (id) on delete set null,
  add column chassis_number text,
  add column fleet_number text;
create index vehicles_customer_idx on public.vehicles (customer_id);

-- ---------------------------------------------------------------------------
-- Device registry (physical speed limiter units, full lifecycle)
-- ---------------------------------------------------------------------------
create table public.sl_devices (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null default app.tenant_id() references public.tenants (id) on delete cascade,
  serial           text not null,
  manufacturer     text,
  model            text,
  firmware_version text,
  imei             text,
  purchase_date    date,
  purchase_price   numeric(14,2),
  supplier         text,
  warranty_until   date,
  status           text not null default 'in_stock'
                   check (status in ('in_stock', 'installed', 'faulty', 'retired')),
  current_vehicle_id uuid references public.vehicles (id) on delete set null,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (tenant_id, serial)
);
create index sl_devices_tenant_status_idx on public.sl_devices (tenant_id, status);
create index sl_devices_vehicle_idx on public.sl_devices (current_vehicle_id);

-- ---------------------------------------------------------------------------
-- Technicians
-- ---------------------------------------------------------------------------
create table public.sl_technicians (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null default app.tenant_id() references public.tenants (id) on delete cascade,
  name       text not null,
  phone      text,
  email      text,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sl_technicians_tenant_idx on public.sl_technicians (tenant_id, active);

-- ---------------------------------------------------------------------------
-- Jobs (structured service workflow: install / inspect / maintain / remove /
-- replace / emergency) with per-tenant sequential numbering
-- ---------------------------------------------------------------------------
create table public.sl_jobs (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null default app.tenant_id() references public.tenants (id) on delete cascade,
  number           int not null,
  job_type         text not null default 'installation'
                   check (job_type in ('installation', 'inspection', 'maintenance', 'removal', 'replacement', 'emergency')),
  customer_id      uuid references public.sl_customers (id) on delete set null,
  vehicle_id       uuid not null references public.vehicles (id) on delete cascade,
  device_id        uuid references public.sl_devices (id) on delete set null,
  technician_id    uuid references public.sl_technicians (id) on delete set null,
  status           text not null default 'scheduled'
                   check (status in ('scheduled', 'in_progress', 'completed', 'qc_approved', 'closed', 'canceled')),
  scheduled_date   date,
  set_speed_kmh    int check (set_speed_kmh between 30 and 160),
  -- [{ "id": "mounting", "label": "...", "done": true }, ...]
  checklist        jsonb not null default '[]',
  location         text,
  started_at       timestamptz,
  completed_at     timestamptz,
  duration_minutes int,
  qc_by            uuid references auth.users (id) on delete set null,
  qc_at            timestamptz,
  customer_signed  boolean not null default false,
  technician_signed boolean not null default false,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (tenant_id, number)
);
create index sl_jobs_tenant_status_idx on public.sl_jobs (tenant_id, status);
create index sl_jobs_customer_idx on public.sl_jobs (customer_id);
create index sl_jobs_vehicle_idx on public.sl_jobs (vehicle_id);
create index sl_jobs_device_idx on public.sl_jobs (device_id);
create index sl_jobs_technician_idx on public.sl_jobs (technician_id);

create or replace function app.next_sl_job_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.number is null or new.number = 0 then
    select coalesce(max(number), 0) + 1 into new.number
    from public.sl_jobs where tenant_id = new.tenant_id;
  end if;
  return new;
end;
$$;
create trigger sl_jobs_number before insert on public.sl_jobs
  for each row execute function app.next_sl_job_number();

-- ---------------------------------------------------------------------------
-- Link installations & certificates into the enterprise model
-- ---------------------------------------------------------------------------
alter table public.speed_limiter_installations
  add column customer_id uuid references public.sl_customers (id) on delete set null,
  add column device_id uuid references public.sl_devices (id) on delete set null,
  add column job_id uuid references public.sl_jobs (id) on delete set null;
create index sl_installations_customer_idx on public.speed_limiter_installations (customer_id);
create index sl_installations_device_idx on public.speed_limiter_installations (device_id);

alter table public.speed_limiter_certificates
  add column customer_id uuid references public.sl_customers (id) on delete set null,
  add column job_id uuid references public.sl_jobs (id) on delete set null,
  add column device_id uuid references public.sl_devices (id) on delete set null,
  add column set_speed_kmh int,
  add column status text not null default 'valid' check (status in ('valid', 'revoked')),
  add column revoked_at timestamptz,
  add column revoked_reason text;
create index sl_certificates_customer_idx on public.speed_limiter_certificates (customer_id);
create index sl_certificates_status_idx on public.speed_limiter_certificates (tenant_id, status);

-- ---------------------------------------------------------------------------
-- Per-tenant certificate settings + atomic numbering
-- ---------------------------------------------------------------------------
create table public.sl_settings (
  tenant_id            uuid primary key default app.tenant_id() references public.tenants (id) on delete cascade,
  cert_prefix          text not null default 'SLC',
  cert_next_number     int not null default 1,
  cert_validity_months int not null default 12 check (cert_validity_months between 1 and 60),
  updated_at           timestamptz not null default now()
);

insert into public.sl_settings (tenant_id)
select id from public.tenants
on conflict do nothing;

-- Atomically reserve the next certificate number for the caller's tenant.
-- Runs as invoker: RLS on sl_settings (managers) gates who can issue.
create or replace function public.next_certificate_number()
returns text
language plpgsql
set search_path = public
as $$
declare
  n int;
  prefix text;
begin
  update public.sl_settings
     set cert_next_number = cert_next_number + 1, updated_at = now()
   where tenant_id = app.tenant_id()
   returning cert_next_number - 1, cert_prefix into n, prefix;
  if n is null then
    insert into public.sl_settings (tenant_id) values (app.tenant_id())
    on conflict (tenant_id) do update set cert_next_number = public.sl_settings.cert_next_number + 1
    returning cert_next_number - 1, cert_prefix into n, prefix;
    if n = 0 then n := 1; end if;
  end if;
  return prefix || '-' || lpad(n::text, 5, '0');
end;
$$;
revoke execute on function public.next_certificate_number() from anon;

-- ---------------------------------------------------------------------------
-- updated_at triggers + RLS for all new tables
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['sl_customers', 'sl_contacts', 'sl_devices', 'sl_technicians', 'sl_jobs'] loop
    execute format(
      'create trigger %I_updated_at before update on public.%I
         for each row execute function app.set_updated_at()', t, t);
    execute format('alter table public.%I enable row level security', t);
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

alter table public.sl_settings enable row level security;
create policy sl_settings_select on public.sl_settings
  for select to authenticated
  using (tenant_id = (select app.tenant_id()));
create policy sl_settings_insert on public.sl_settings
  for insert to authenticated
  with check (tenant_id = (select app.tenant_id()) and (select app.is_manager()));
create policy sl_settings_update on public.sl_settings
  for update to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_manager()))
  with check (tenant_id = (select app.tenant_id()) and (select app.is_manager()));
