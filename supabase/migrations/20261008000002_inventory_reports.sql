-- Inventory: server-side aggregates for the module's overview, reorder list
-- and valuation report.
--
-- The stock ledger (items, warehouses, stock_levels, stock_moves) shipped in
-- the platform foundation. The module pages need totals across every item
-- and warehouse, which the client must not compute from an unbounded
-- select (PostgREST caps responses at 1,000 rows and the numbers would be
-- silently wrong). These three read-only functions do the sums in Postgres.
--
-- All three are SECURITY INVOKER: they read through the caller's RLS, so the
-- tenant and the `inventory` module gate come from the existing policies on
-- inventory_items / warehouses / stock_levels, with nothing re-implemented
-- here. A tenant without the module simply gets empty results.
--
-- Additive only: three new functions, no table or policy changes.

set local lock_timeout = '3s';
set local statement_timeout = '60s';

-- One row: headline numbers for the overview tiles.
create or replace function public.inventory_summary()
returns table (
  item_count integer,
  tracked_item_count integer,
  warehouse_count integer,
  stock_value numeric,
  low_stock_count integer,
  out_of_stock_count integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  with totals as (
    select i.id, i.track_stock, i.reorder_point, i.cost_price,
           coalesce(sum(sl.on_hand), 0) as on_hand
    from public.inventory_items i
    left join public.stock_levels sl on sl.item_id = i.id
    where i.active
    group by i.id
  )
  select
    (select count(*) from totals)::integer,
    (select count(*) from totals where track_stock)::integer,
    (select count(*) from public.warehouses w where w.active)::integer,
    coalesce((select round(sum(on_hand * cost_price), 4) from totals where track_stock), 0),
    (select count(*) from totals
       where track_stock and reorder_point is not null and on_hand <= reorder_point)::integer,
    (select count(*) from totals where track_stock and on_hand <= 0)::integer;
$$;

-- Active, tracked items whose total on hand (all warehouses) is at or below
-- their reorder point, most short first. `suggested_qty` tops the item back
-- up: the reorder quantity when set, else enough to reach the reorder point.
create or replace function public.inventory_low_stock(p_limit integer default 200)
returns table (
  item_id uuid,
  sku text,
  name text,
  name_ar text,
  uom text,
  category text,
  on_hand numeric,
  reorder_point numeric,
  reorder_qty numeric,
  suggested_qty numeric,
  cost_price numeric,
  preferred_supplier_id uuid
)
language sql
stable
security invoker
set search_path = ''
as $$
  select i.id, i.sku, i.name, i.name_ar, i.uom, i.category,
         t.on_hand, i.reorder_point, i.reorder_qty,
         greatest(coalesce(i.reorder_qty, i.reorder_point - t.on_hand), 0),
         i.cost_price, i.preferred_supplier_id
  from public.inventory_items i
  cross join lateral (
    select coalesce(sum(sl.on_hand), 0) as on_hand
    from public.stock_levels sl where sl.item_id = i.id
  ) t
  where i.active and i.track_stock and i.reorder_point is not null
    and t.on_hand <= i.reorder_point
  order by (t.on_hand - i.reorder_point), i.name
  limit least(greatest(coalesce(p_limit, 200), 1), 1000);
$$;

-- Stock value at moving-average cost, by warehouse and item category.
-- Rows with nothing on hand are left out.
create or replace function public.inventory_valuation()
returns table (
  warehouse_id uuid,
  warehouse_name text,
  category text,
  item_count integer,
  on_hand numeric,
  stock_value numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select w.id, w.name, i.category,
         count(distinct i.id)::integer,
         sum(sl.on_hand),
         round(sum(sl.on_hand * i.cost_price), 4)
  from public.stock_levels sl
  join public.inventory_items i on i.id = sl.item_id
  join public.warehouses w on w.id = sl.warehouse_id
  where i.track_stock and sl.on_hand <> 0
  group by w.id, w.name, i.category
  order by w.name, i.category nulls last;
$$;

revoke execute on function public.inventory_summary() from public, anon;
revoke execute on function public.inventory_low_stock(integer) from public, anon;
revoke execute on function public.inventory_valuation() from public, anon;
grant execute on function public.inventory_summary() to authenticated;
grant execute on function public.inventory_low_stock(integer) to authenticated;
grant execute on function public.inventory_valuation() to authenticated;
