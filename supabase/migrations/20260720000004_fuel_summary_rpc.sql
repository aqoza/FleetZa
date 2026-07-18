-- Fuel summary aggregation as an invoker-rights RPC. PostgREST aggregate
-- functions are disabled on this project (PGRST123), so the FuelPage summary
-- cards aggregate here instead of fetching the whole table client-side.
create or replace function public.fuel_summary(p_vehicle_id uuid default null)
returns table (
  total_cost numeric,
  total_liters numeric,
  fill_count bigint
)
language sql
security invoker
set search_path = ''
as $$
  select coalesce(sum(f.total_cost), 0),
         coalesce(sum(f.volume), 0),
         count(*)
  from public.fuel_logs f
  where (p_vehicle_id is null or f.vehicle_id = p_vehicle_id);
$$;
revoke execute on function public.fuel_summary(uuid) from public, anon;
