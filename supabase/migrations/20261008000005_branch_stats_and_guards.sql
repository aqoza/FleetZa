-- Companies & branches: per-branch counts for the module pages, and the
-- same-tenant guard vehicles and drivers were missing.
--
-- 1) public.branch_stats() — one row per branch the caller can see, with how
--    many vehicles, drivers, employees and warehouses point at it. SECURITY
--    INVOKER: every count runs through the caller's own RLS (a member who
--    only sees their own employee row counts only that), and a tenant
--    without `multi_company` sees no branches and so gets no rows.
--
-- 2) The platform foundation added vehicles.branch_id and drivers.branch_id
--    as plain FKs. An FK only proves the branch exists, not that it belongs
--    to the same tenant, so a crafted request could point a vehicle at
--    another tenant's branch. employees and warehouses already have the
--    app.assert_same_tenant trigger; this adds it to the other two.
--
-- Additive only: one new function and two new triggers.

set local lock_timeout = '3s';
set local statement_timeout = '60s';

create or replace function public.branch_stats()
returns table (
  branch_id uuid,
  vehicle_count integer,
  driver_count integer,
  employee_count integer,
  warehouse_count integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select b.id,
         (select count(*) from public.vehicles v where v.branch_id = b.id)::integer,
         (select count(*) from public.drivers d where d.branch_id = b.id)::integer,
         (select count(*) from public.employees e where e.branch_id = b.id)::integer,
         (select count(*) from public.warehouses w where w.branch_id = b.id)::integer
  from public.branches b;
$$;

revoke execute on function public.branch_stats() from public, anon;
grant execute on function public.branch_stats() to authenticated;

drop trigger if exists vehicles_branch_same_tenant on public.vehicles;
create trigger vehicles_branch_same_tenant
  before insert or update of branch_id on public.vehicles
  for each row execute function app.assert_same_tenant('branch_id', 'branches');

drop trigger if exists drivers_branch_same_tenant on public.drivers;
create trigger drivers_branch_same_tenant
  before insert or update of branch_id on public.drivers
  for each row execute function app.assert_same_tenant('branch_id', 'branches');
