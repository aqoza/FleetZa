-- Wave 1 of the platform refactor (docs/ARCHITECTURE_REVIEW.md §11):
-- customers/contacts leave the speed-limiter namespace and become global
-- master data; vehicles gain a first-class ownership model; missing FK
-- covering indexes from the live performance advisors.

-- 1) Rename the module-owned tables to their global names.
--    FKs, indexes, and triggers follow the rename automatically; the renames
--    below keep object names matching the new table names.
alter table public.sl_customers rename to customers;
alter table public.sl_contacts rename to contacts;

alter policy sl_customers_select on public.customers rename to customers_select;
alter policy sl_customers_insert on public.customers rename to customers_insert;
alter policy sl_customers_update on public.customers rename to customers_update;
alter policy sl_customers_delete on public.customers rename to customers_delete;
alter policy sl_contacts_select on public.contacts rename to contacts_select;
alter policy sl_contacts_insert on public.contacts rename to contacts_insert;
alter policy sl_contacts_update on public.contacts rename to contacts_update;
alter policy sl_contacts_delete on public.contacts rename to contacts_delete;

alter trigger sl_customers_updated_at on public.customers rename to customers_updated_at;
alter trigger sl_contacts_updated_at on public.contacts rename to contacts_updated_at;

alter table public.customers rename constraint sl_customers_pkey to customers_pkey;
alter table public.customers rename constraint sl_customers_tenant_id_fkey to customers_tenant_id_fkey;
alter table public.contacts rename constraint sl_contacts_pkey to contacts_pkey;
alter table public.contacts rename constraint sl_contacts_tenant_id_fkey to contacts_tenant_id_fkey;
alter table public.contacts rename constraint sl_contacts_customer_id_fkey to contacts_customer_id_fkey;

alter index public.sl_customers_tenant_idx rename to customers_tenant_idx;
alter index public.sl_contacts_tenant_idx rename to contacts_tenant_idx;
alter index public.sl_contacts_customer_idx rename to contacts_customer_idx;

-- 2) Compatibility views under the old names so the previously deployed
--    bundle keeps working during rollout. security_invoker so RLS applies to
--    the querying user, not the view owner. Drop these in the next release.
create view public.sl_customers with (security_invoker = true) as
  select * from public.customers;
create view public.sl_contacts with (security_invoker = true) as
  select * from public.contacts;
grant select, insert, update, delete on public.sl_customers, public.sl_contacts to authenticated;
grant select on public.sl_customers, public.sl_contacts to service_role;

-- 3) First-class vehicle ownership. 'company' = the tenant's own fleet;
--    'customer' requires customer_id (enforced below).
alter table public.vehicles add column ownership text not null default 'company'
  check (ownership in ('company', 'customer'));
update public.vehicles set ownership = 'customer' where customer_id is not null;

-- Normalize before validation: bundles predating this migration write
-- customer_id without knowing about ownership — derive it for them so the
-- CHECK constraint can never reject their writes.
create or replace function app.sync_vehicle_ownership()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.customer_id is not null and new.ownership = 'company' then
    new.ownership := 'customer';
  elsif new.customer_id is null and new.ownership = 'customer' then
    new.ownership := 'company';
  end if;
  return new;
end;
$$;

create trigger vehicles_sync_ownership
  before insert or update of customer_id, ownership on public.vehicles
  for each row execute function app.sync_vehicle_ownership();

alter table public.vehicles add constraint vehicles_ownership_customer_ck
  check ((ownership = 'customer') = (customer_id is not null));

create index vehicles_tenant_ownership_idx on public.vehicles (tenant_id, ownership);

-- 4) Missing FK covering indexes (live performance-advisor list).
create index if not exists fuel_logs_vehicle_idx on public.fuel_logs (vehicle_id);
create index if not exists fuel_logs_driver_idx on public.fuel_logs (driver_id);
create index if not exists vehicle_assignments_driver_idx on public.vehicle_assignments (driver_id);
create index if not exists inspections_vehicle_idx on public.inspections (vehicle_id);
create index if not exists inspections_driver_idx on public.inspections (driver_id);
create index if not exists inspections_template_idx on public.inspections (template_id);
create index if not exists inspections_created_by_idx on public.inspections (created_by);
create index if not exists invitations_invited_by_idx on public.invitations (invited_by);
create index if not exists issues_inspection_idx on public.issues (inspection_id);
create index if not exists issues_work_order_idx on public.issues (work_order_id);
create index if not exists issues_reported_by_idx on public.issues (reported_by);
create index if not exists work_orders_issue_idx on public.work_orders (issue_id);
create index if not exists work_orders_reminder_idx on public.work_orders (reminder_id);
create index if not exists work_orders_created_by_idx on public.work_orders (created_by);
create index if not exists sl_jobs_qc_by_idx on public.sl_jobs (qc_by);
create index if not exists sl_certificates_job_idx on public.speed_limiter_certificates (job_id);
create index if not exists sl_certificates_device_idx on public.speed_limiter_certificates (device_id);
create index if not exists sl_certificates_renewed_from_idx on public.speed_limiter_certificates (renewed_from);
create index if not exists tenant_modules_enabled_by_idx on public.tenant_modules (enabled_by);

-- 5) Subscribe tenants that run the speed-limiter suite to the new module
--    (the registry now has speed_limiters require customers).
insert into public.tenant_modules (tenant_id, module_id, enabled)
select tenant_id, 'customers', true
from public.tenant_modules
where module_id = 'speed_limiters' and enabled
on conflict (tenant_id, module_id) do update set enabled = true;
