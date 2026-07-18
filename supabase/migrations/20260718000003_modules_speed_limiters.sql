-- Modular platform: per-tenant module subscriptions + the first add-on
-- modules (speed limiter installations & certificates). Purely additive.

-- ---------------------------------------------------------------------------
-- Tenant module subscriptions
-- ---------------------------------------------------------------------------
create table public.tenant_modules (
  tenant_id  uuid not null default app.tenant_id() references public.tenants (id) on delete cascade,
  module_id  text not null,
  enabled    boolean not null default true,
  enabled_at timestamptz not null default now(),
  enabled_by uuid references auth.users (id) on delete set null,
  primary key (tenant_id, module_id)
);

alter table public.tenant_modules enable row level security;

create policy tenant_modules_select on public.tenant_modules
  for select to authenticated
  using (tenant_id = (select app.tenant_id()));
create policy tenant_modules_insert on public.tenant_modules
  for insert to authenticated
  with check (tenant_id = (select app.tenant_id()) and (select app.is_admin()));
create policy tenant_modules_update on public.tenant_modules
  for update to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_admin()))
  with check (tenant_id = (select app.tenant_id()) and (select app.is_admin()));
create policy tenant_modules_delete on public.tenant_modules
  for delete to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_admin()));

-- Backfill: every existing tenant gets the default module set.
insert into public.tenant_modules (tenant_id, module_id)
select t.id, d.module_id
from public.tenants t
cross join unnest(array[
  'fleet','drivers','fuel','maintenance','preventive','inspections','issues','renewals','reports'
]) as d (module_id)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Speed limiter installations
-- ---------------------------------------------------------------------------
create table public.speed_limiter_installations (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null default app.tenant_id() references public.tenants (id) on delete cascade,
  vehicle_id    uuid not null references public.vehicles (id) on delete cascade,
  device_serial text not null,
  brand         text,
  model         text,
  set_speed_kmh int check (set_speed_kmh between 30 and 160),
  installed_at  date not null default current_date,
  technician    text,
  status        text not null default 'active' check (status in ('active', 'maintenance', 'removed')),
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index sl_installations_tenant_idx on public.speed_limiter_installations (tenant_id, status);
create index sl_installations_vehicle_idx on public.speed_limiter_installations (vehicle_id);

-- ---------------------------------------------------------------------------
-- Speed limiter certificates
-- ---------------------------------------------------------------------------
create table public.speed_limiter_certificates (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null default app.tenant_id() references public.tenants (id) on delete cascade,
  installation_id    uuid references public.speed_limiter_installations (id) on delete set null,
  vehicle_id         uuid not null references public.vehicles (id) on delete cascade,
  certificate_number text not null,
  issuing_authority  text,
  issued_at          date not null default current_date,
  expires_at         date not null,
  renewed_from       uuid references public.speed_limiter_certificates (id) on delete set null,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index sl_certificates_tenant_expiry_idx on public.speed_limiter_certificates (tenant_id, expires_at);
create index sl_certificates_vehicle_idx on public.speed_limiter_certificates (vehicle_id);
create index sl_certificates_installation_idx on public.speed_limiter_certificates (installation_id);

-- updated_at triggers + tenant RLS (members read, managers write) for both
do $$
declare t text;
begin
  foreach t in array array['speed_limiter_installations', 'speed_limiter_certificates'] loop
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
