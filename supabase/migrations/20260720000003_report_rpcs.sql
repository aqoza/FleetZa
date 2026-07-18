-- Report aggregation moves into Postgres (docs/ARCHITECTURE_REVIEW.md §11 Wave 2 /
-- Phase 2): the SPA previously fetched entire fuel/work-order tables and reduced
-- client-side, which silently truncates at PostgREST's 1,000-row cap. Both
-- functions are SECURITY INVOKER, so RLS scopes them to the caller's tenant.
-- p_ownership: null = all vehicles, else filter vehicles.ownership.

create or replace function public.report_cost_by_vehicle(
  p_from date,
  p_to date,
  p_ownership text default null
)
returns table (
  vehicle_id uuid,
  vehicle_name text,
  fuel_cost numeric,
  maintenance_net numeric,
  maintenance_tax numeric,
  total_cost numeric
)
language sql
security invoker
set search_path = ''
as $$
  with fuel as (
    select f.vehicle_id as vid, sum(f.total_cost) as c
    from public.fuel_logs f
    where f.filled_at >= p_from and f.filled_at < (p_to + 1)
    group by f.vehicle_id
  ),
  maint as (
    select w.vehicle_id as vid,
           sum(l.quantity * l.unit_cost) as net,
           sum(l.quantity * l.unit_cost * w.tax_rate / 100.0) as tax
    from public.work_orders w
    join public.work_order_lines l on l.work_order_id = w.id
    where w.status = 'completed'
      and w.completed_at >= p_from and w.completed_at < (p_to + 1)
    group by w.vehicle_id
  )
  select v.id,
         v.name,
         coalesce(fuel.c, 0),
         coalesce(maint.net, 0),
         coalesce(maint.tax, 0),
         coalesce(fuel.c, 0) + coalesce(maint.net, 0) + coalesce(maint.tax, 0)
  from public.vehicles v
  left join fuel on fuel.vid = v.id
  left join maint on maint.vid = v.id
  where (p_ownership is null or v.ownership = p_ownership)
    and (coalesce(fuel.c, 0) + coalesce(maint.net, 0) + coalesce(maint.tax, 0)) > 0
  order by 6 desc;
$$;
revoke execute on function public.report_cost_by_vehicle(date, date, text) from public, anon;

-- Full-tank-to-full-tank efficiency, mirroring the SPA algorithm: partial-fill
-- volumes accumulate between consecutive full tanks; distance comes from the
-- odometer delta between those full tanks; per-vehicle figure is
-- distance-weighted (sum of volumes / sum of distances).
create or replace function public.report_fuel_efficiency(
  p_from date,
  p_to date,
  p_ownership text default null
)
returns table (
  vehicle_id uuid,
  vehicle_name text,
  total_km numeric,
  total_liters numeric,
  liters_per_100km numeric
)
language sql
security invoker
set search_path = ''
as $$
  with logs as (
    select f.vehicle_id as vid, f.filled_at, f.odometer, f.volume, f.is_full_tank,
           sum(f.volume) over (
             partition by f.vehicle_id order by f.filled_at, f.id
           ) as cumvol
    from public.fuel_logs f
    join public.vehicles v on v.id = f.vehicle_id
    where f.filled_at >= p_from and f.filled_at < (p_to + 1)
      and f.odometer is not null
      and (p_ownership is null or v.ownership = p_ownership)
  ),
  fulls as (
    select vid, odometer, cumvol,
           lag(odometer) over (partition by vid order by filled_at) as prev_odo,
           lag(cumvol) over (partition by vid order by filled_at) as prev_cum
    from logs
    where is_full_tank
  ),
  pairs as (
    select vid, odometer - prev_odo as dist, cumvol - prev_cum as vol
    from fulls
    where prev_odo is not null and odometer > prev_odo
  )
  select p.vid, v.name,
         sum(p.dist),
         sum(p.vol),
         round(sum(p.vol) / nullif(sum(p.dist), 0) * 100, 2)
  from pairs p
  join public.vehicles v on v.id = p.vid
  group by p.vid, v.name
  order by 5 asc nulls last;
$$;
revoke execute on function public.report_fuel_efficiency(date, date, text) from public, anon;
