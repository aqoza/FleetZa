-- BI analytics (module bi_analytics): custom dashboards of charts and KPIs
-- over the tenant's own operational data.
--
-- 1) bi_dashboards: a named dashboard, shared with the whole team or private
--    to its owner. Managers create and edit dashboards; members read the
--    shared ones (and any they own).
-- 2) bi_widgets: one tile on a dashboard: a metric from the whitelisted
--    catalog, grouped by a dimension, over a period, drawn as a KPI, bar,
--    line, pie or table, in a small / medium / large slot.
-- 3) public.bi_metric(metric, dimension, from, to) returns (key, label,
--    value) rows. It is security invoker, so RLS decides what is read. Each
--    metric is a static query in app.bi_facts (never dynamic SQL from user
--    input) and declares its valid dimensions in app.bi_metric_dimensions,
--    which shared/bi.ts mirrors (a unit test compares the two). Metrics of
--    newer modules (incidents, trips, deliveries, shipments, expenses,
--    payroll, point of sale) return no rows until that module's table exists;
--    their fixed query text runs through EXECUTE so this function does not
--    depend on those tables.
-- 4) public.bi_create_default_dashboard(name) creates a "Fleet overview"
--    dashboard with a starter set of widgets.
--
-- Raised codes: BI_UNKNOWN_METRIC, BI_INVALID_DIMENSION, BI_INVALID_PERIOD
-- (+ FORBIDDEN, MODULE_DISABLED, NO_TENANT). Additive only.

set local lock_timeout = '3s';
set local statement_timeout = '60s';

-- ============================================================
-- Tables
-- ============================================================
create table public.bi_dashboards (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  description text check (description is null or char_length(description) <= 500),
  is_shared boolean not null default true,
  owner_id uuid default auth.uid() references public.profiles(id) on delete set null,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index bi_dashboards_tenant_idx on public.bi_dashboards (tenant_id, name);
create index bi_dashboards_owner_idx on public.bi_dashboards (owner_id) where owner_id is not null;

create table public.bi_widgets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  dashboard_id uuid not null references public.bi_dashboards(id) on delete cascade,
  title text check (title is null or char_length(btrim(title)) between 1 and 80),
  widget_type text not null default 'bar' check (widget_type in ('kpi', 'bar', 'line', 'pie', 'table')),
  metric text not null check (metric ~ '^[a-z_]{1,40}$'),
  dimension text not null default 'month'
    check (dimension in ('none', 'month', 'week', 'vehicle', 'driver', 'customer', 'category', 'status')),
  period text not null default 'last_12_months'
    check (period in ('last_30_days', 'last_90_days', 'this_year', 'last_12_months', 'custom')),
  date_from date,
  date_to date,
  position integer not null default 0,
  size text not null default 'medium' check (size in ('small', 'medium', 'large')),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period <> 'custom' or (date_from is not null and date_to is not null and date_from <= date_to))
);
create index bi_widgets_dashboard_idx on public.bi_widgets (dashboard_id, position);
create index bi_widgets_tenant_idx on public.bi_widgets (tenant_id);

alter table public.bi_dashboards enable row level security;
alter table public.bi_widgets enable row level security;
revoke all on public.bi_dashboards, public.bi_widgets from anon;
revoke insert, update on public.bi_dashboards, public.bi_widgets from authenticated;
grant insert (name, description, is_shared) on public.bi_dashboards to authenticated;
grant update (name, description, is_shared) on public.bi_dashboards to authenticated;
grant insert (dashboard_id, title, widget_type, metric, dimension, period, date_from, date_to, position, size)
  on public.bi_widgets to authenticated;
grant update (title, widget_type, metric, dimension, period, date_from, date_to, position, size)
  on public.bi_widgets to authenticated;

-- ============================================================
-- Metric catalog
-- ============================================================
-- Valid dimensions per metric. shared/bi.ts mirrors this list one to one.
create or replace function app.bi_metric_dimensions(p_metric text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_metric
    when 'fuel_cost' then array['none', 'month', 'week', 'vehicle', 'driver']
    when 'fuel_liters' then array['none', 'month', 'week', 'vehicle', 'driver']
    when 'distance_km' then array['none', 'month', 'week', 'vehicle']
    when 'maintenance_cost' then array['none', 'month', 'week', 'vehicle', 'category']
    when 'work_orders_count' then array['none', 'month', 'week', 'vehicle', 'category', 'status']
    when 'issues_count' then array['none', 'month', 'week', 'vehicle', 'category', 'status']
    when 'inspections_failed' then array['none', 'month', 'week', 'vehicle', 'driver']
    when 'vehicles_count' then array['none', 'category', 'status']
    when 'revenue_invoiced' then array['none', 'month', 'week', 'customer', 'vehicle', 'status']
    when 'payments_received' then array['none', 'month', 'week', 'customer', 'category']
    when 'quotes_count' then array['none', 'month', 'week', 'customer', 'status']
    when 'certificates_issued' then array['none', 'month', 'week', 'customer', 'vehicle', 'status']
    when 'incidents_count' then array['none', 'month', 'week', 'vehicle', 'driver', 'category', 'status']
    when 'trips_completed' then array['none', 'month', 'week', 'vehicle', 'driver', 'customer']
    when 'deliveries_delivered' then array['none', 'month', 'week', 'customer']
    when 'shipments_revenue' then array['none', 'month', 'week', 'customer', 'vehicle', 'driver']
    when 'expenses_total' then array['none', 'month', 'week', 'vehicle', 'category']
    when 'payroll_net' then array['none', 'month']
    when 'pos_sales' then array['none', 'month', 'week', 'customer']
  end
$$;
grant execute on function app.bi_metric_dimensions(text) to authenticated;

-- One row per fact in the period: its day (tenant time zone), value and the
-- attributes the dimensions group by. Static SQL per metric; RLS applies.
create or replace function app.bi_facts(p_metric text, p_from date, p_to date)
returns table (d date, v numeric, vehicle_id uuid, driver_id uuid, customer_id uuid, category text, status text)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_tz text := coalesce((select t.timezone from public.tenants t where t.id = app.tenant_id()), 'UTC');
  v_lo timestamptz := (p_from::timestamp at time zone v_tz);
  v_hi timestamptz := ((p_to + 1)::timestamp at time zone v_tz);
begin
  if p_metric in ('fuel_cost', 'fuel_liters') then
    return query
      select (f.filled_at at time zone v_tz)::date, (case when p_metric = 'fuel_cost' then f.total_cost else f.volume end)::numeric,
             f.vehicle_id, f.driver_id, null::uuid, null::text, null::text
      from public.fuel_logs f
      where f.filled_at >= v_lo and f.filled_at < v_hi;

  elsif p_metric = 'distance_km' then
    -- Odometer deltas between consecutive fuel logs, booked on the later log's day.
    return query
      select (x.filled_at at time zone v_tz)::date, (x.odometer - x.prev)::numeric, x.vehicle_id, null::uuid, null::uuid, null::text, null::text
      from (
        select f.filled_at, f.odometer, f.vehicle_id,
               lag(f.odometer) over (partition by f.vehicle_id order by f.filled_at, f.id) as prev
        from public.fuel_logs f
        where f.filled_at < v_hi and f.odometer is not null
      ) x
      where x.filled_at >= v_lo and x.prev is not null and x.odometer > x.prev and x.odometer - x.prev < 5000;

  elsif p_metric = 'maintenance_cost' then
    return query
      select (w.completed_at at time zone v_tz)::date, (l.quantity * l.unit_cost)::numeric, w.vehicle_id, null::uuid, null::uuid,
             l.category, w.status
      from public.work_orders w
      join public.work_order_lines l on l.work_order_id = w.id
      where w.status = 'completed' and w.completed_at >= v_lo and w.completed_at < v_hi;

  elsif p_metric = 'work_orders_count' then
    return query
      select (w.created_at at time zone v_tz)::date, 1::numeric, w.vehicle_id, null::uuid, null::uuid, w.priority, w.status
      from public.work_orders w
      where w.created_at >= v_lo and w.created_at < v_hi;

  elsif p_metric = 'issues_count' then
    return query
      select (i.reported_at at time zone v_tz)::date, 1::numeric, i.vehicle_id, null::uuid, null::uuid, i.priority, i.status
      from public.issues i
      where i.reported_at >= v_lo and i.reported_at < v_hi;

  elsif p_metric = 'inspections_failed' then
    return query
      select (i.performed_at at time zone v_tz)::date, 1::numeric, i.vehicle_id, i.driver_id, null::uuid, null::text, i.status
      from public.inspections i
      where i.status = 'fail' and i.performed_at >= v_lo and i.performed_at < v_hi;

  elsif p_metric = 'vehicles_count' then
    -- A snapshot: every vehicle today, whatever the period.
    return query
      select null::date, 1::numeric, ve.id, null::uuid, ve.customer_id, ve.vehicle_type, ve.status
      from public.vehicles ve;

  elsif p_metric = 'revenue_invoiced' then
    return query
      select iv.issue_date, iv.total::numeric, iv.vehicle_id, null::uuid, iv.customer_id, null::text, iv.status
      from public.invoices iv
      where iv.status in ('issued', 'partially_paid', 'paid') and iv.issue_date between p_from and p_to;

  elsif p_metric = 'payments_received' then
    return query
      select p.paid_at::date, p.amount::numeric, null::uuid, null::uuid, iv.customer_id, p.method, null::text
      from public.payments p
      left join public.invoices iv on iv.id = p.invoice_id
      where p.paid_at::date between p_from and p_to;

  elsif p_metric = 'quotes_count' then
    return query
      select q.issue_date, 1::numeric, q.vehicle_id, null::uuid, q.customer_id, null::text, q.status
      from public.quotes q
      where q.issue_date between p_from and p_to;

  elsif p_metric = 'certificates_issued' then
    return query
      select (c.issued_at at time zone v_tz)::date, 1::numeric, c.vehicle_id, null::uuid, c.customer_id, null::text, c.status
      from public.speed_limiter_certificates c
      where c.issued_at >= v_lo and c.issued_at < v_hi;

  -- Metrics of newer modules: no rows until the module's table exists.
  elsif p_metric = 'incidents_count' then
    if to_regclass('public.incidents') is null then return; end if;
    return query execute
      'select (x.occurred_at at time zone $1)::date, 1::numeric, x.vehicle_id, x.driver_id, null::uuid, x.incident_type, x.status
       from public.incidents x where x.occurred_at >= $2 and x.occurred_at < $3'
      using v_tz, v_lo, v_hi;

  elsif p_metric = 'trips_completed' then
    if to_regclass('public.trips') is null then return; end if;
    return query execute
      'select (x.completed_at at time zone $1)::date, 1::numeric, x.vehicle_id, x.driver_id, x.customer_id, null::text, x.status
       from public.trips x where x.status = ''completed'' and x.completed_at >= $2 and x.completed_at < $3'
      using v_tz, v_lo, v_hi;

  elsif p_metric = 'deliveries_delivered' then
    if to_regclass('public.deliveries') is null then return; end if;
    return query execute
      'select (x.delivered_at at time zone $1)::date, 1::numeric, null::uuid, null::uuid, x.customer_id, null::text, x.status
       from public.deliveries x where x.status = ''delivered'' and x.delivered_at >= $2 and x.delivered_at < $3'
      using v_tz, v_lo, v_hi;

  elsif p_metric = 'shipments_revenue' then
    if to_regclass('public.shipments') is null then return; end if;
    return query execute
      'select (x.delivered_at at time zone $1)::date, x.total_charge::numeric, x.vehicle_id, x.driver_id, x.customer_id, null::text, x.status
       from public.shipments x where x.status in (''delivered'', ''closed'') and x.delivered_at >= $2 and x.delivered_at < $3'
      using v_tz, v_lo, v_hi;

  elsif p_metric = 'expenses_total' then
    if to_regclass('public.expenses') is null or to_regclass('public.gl_accounts') is null then return; end if;
    return query execute
      'select x.expense_date, x.total::numeric, x.vehicle_id, null::uuid, null::uuid, a.name, x.status
       from public.expenses x left join public.gl_accounts a on a.id = x.category_account_id
       where x.status in (''approved'', ''posted'') and x.expense_date between $1 and $2'
      using p_from, p_to;

  elsif p_metric = 'payroll_net' then
    if to_regclass('public.payroll_runs') is null then return; end if;
    return query execute
      'select coalesce(x.paid_at, x.pay_date, x.period_end), x.total_net::numeric, null::uuid, null::uuid, null::uuid, null::text, x.status
       from public.payroll_runs x
       where x.status = ''paid'' and coalesce(x.paid_at, x.pay_date, x.period_end) between $1 and $2'
      using p_from, p_to;

  elsif p_metric = 'pos_sales' then
    if to_regclass('public.pos_orders') is null then return; end if;
    return query execute
      'select (x.completed_at at time zone $1)::date, x.total::numeric, null::uuid, null::uuid, x.customer_id, null::text, x.status
       from public.pos_orders x where x.status <> ''voided'' and x.completed_at >= $2 and x.completed_at < $3'
      using v_tz, v_lo, v_hi;
  end if;
end;
$$;
revoke execute on function app.bi_facts(text, date, date) from public, anon;
grant execute on function app.bi_facts(text, date, date) to authenticated;

-- ============================================================
-- Public RPCs
-- ============================================================
create or replace function public.bi_metric(p_metric text, p_dimension text, p_from date, p_to date)
returns table (key text, label text, value numeric)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_dims text[];
begin
  perform app.require_module('bi_analytics', 'member');
  v_dims := app.bi_metric_dimensions(p_metric);
  if v_dims is null then
    raise exception 'BI_UNKNOWN_METRIC';
  end if;
  if not (p_dimension = any (v_dims)) then
    raise exception 'BI_INVALID_DIMENSION';
  end if;
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 1100 then
    raise exception 'BI_INVALID_PERIOD';
  end if;

  if p_dimension = 'none' then
    return query select 'total'::text, 'total'::text, coalesce(sum(f.v), 0) from app.bi_facts(p_metric, p_from, p_to) f;
  elsif p_dimension = 'month' then
    return query
      select to_char(f.d, 'YYYY-MM'), to_char(f.d, 'YYYY-MM'), sum(f.v)
      from app.bi_facts(p_metric, p_from, p_to) f where f.d is not null group by 1 order by 1;
  elsif p_dimension = 'week' then
    return query
      select to_char(date_trunc('week', f.d)::date, 'YYYY-MM-DD'), to_char(date_trunc('week', f.d)::date, 'YYYY-MM-DD'), sum(f.v)
      from app.bi_facts(p_metric, p_from, p_to) f where f.d is not null group by 1 order by 1;
  elsif p_dimension = 'vehicle' then
    return query
      select coalesce(f.vehicle_id::text, ''), coalesce(min(ve.license_plate), min(ve.name), ''), sum(f.v)
      from app.bi_facts(p_metric, p_from, p_to) f left join public.vehicles ve on ve.id = f.vehicle_id
      group by f.vehicle_id order by 3 desc nulls last limit 25;
  elsif p_dimension = 'driver' then
    return query
      select coalesce(f.driver_id::text, ''), coalesce(min(btrim(dr.first_name || ' ' || coalesce(dr.last_name, ''))), ''), sum(f.v)
      from app.bi_facts(p_metric, p_from, p_to) f left join public.drivers dr on dr.id = f.driver_id
      group by f.driver_id order by 3 desc nulls last limit 25;
  elsif p_dimension = 'customer' then
    return query
      select coalesce(f.customer_id::text, ''), coalesce(min(cu.name), ''), sum(f.v)
      from app.bi_facts(p_metric, p_from, p_to) f left join public.customers cu on cu.id = f.customer_id
      group by f.customer_id order by 3 desc nulls last limit 25;
  elsif p_dimension = 'category' then
    return query
      select coalesce(f.category, ''), coalesce(f.category, ''), sum(f.v)
      from app.bi_facts(p_metric, p_from, p_to) f group by f.category order by 3 desc nulls last limit 25;
  else
    return query
      select coalesce(f.status, ''), coalesce(f.status, ''), sum(f.v)
      from app.bi_facts(p_metric, p_from, p_to) f group by f.status order by 3 desc nulls last limit 25;
  end if;
end;
$$;
revoke execute on function public.bi_metric(text, text, date, date) from public, anon;
grant execute on function public.bi_metric(text, text, date, date) to authenticated;

-- A starter "Fleet overview" dashboard. Titles stay null so the app names
-- each widget in the reader's language.
create or replace function public.bi_create_default_dashboard(p_name text default 'Fleet overview')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.require_module('bi_analytics', 'manager');
  v_id uuid;
begin
  insert into public.bi_dashboards (tenant_id, name, description, is_shared, owner_id)
  values (v_tenant, coalesce(nullif(btrim(coalesce(p_name, '')), ''), 'Fleet overview'), null, true, auth.uid())
  returning id into v_id;

  insert into public.bi_widgets (tenant_id, dashboard_id, widget_type, metric, dimension, period, position, size)
  values
    (v_tenant, v_id, 'kpi', 'fuel_cost', 'none', 'last_30_days', 1, 'small'),
    (v_tenant, v_id, 'kpi', 'maintenance_cost', 'none', 'last_30_days', 2, 'small'),
    (v_tenant, v_id, 'kpi', 'distance_km', 'none', 'last_30_days', 3, 'small'),
    (v_tenant, v_id, 'kpi', 'issues_count', 'none', 'last_30_days', 4, 'small'),
    (v_tenant, v_id, 'bar', 'fuel_cost', 'month', 'last_12_months', 5, 'medium'),
    (v_tenant, v_id, 'line', 'distance_km', 'month', 'last_12_months', 6, 'medium'),
    (v_tenant, v_id, 'bar', 'maintenance_cost', 'vehicle', 'last_90_days', 7, 'medium'),
    (v_tenant, v_id, 'table', 'work_orders_count', 'status', 'last_90_days', 8, 'medium');
  return v_id;
end;
$$;
revoke execute on function public.bi_create_default_dashboard(text) from public, anon;
grant execute on function public.bi_create_default_dashboard(text) to authenticated;

-- ============================================================
-- Triggers
-- ============================================================
create or replace function app.bi_dashboard_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.name := btrim(new.name);
  if tg_op = 'UPDATE' then
    new.owner_id := old.owner_id;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function app.bi_dashboard_guard() from public, anon, authenticated;

create or replace function app.bi_widget_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dims text[] := app.bi_metric_dimensions(new.metric);
begin
  if v_dims is null then
    raise exception 'BI_UNKNOWN_METRIC';
  end if;
  if not (new.dimension = any (v_dims)) then
    raise exception 'BI_INVALID_DIMENSION';
  end if;
  if new.period = 'custom' and (new.date_from is null or new.date_to is null or new.date_from > new.date_to
                                or new.date_to - new.date_from > 1100) then
    raise exception 'BI_INVALID_PERIOD';
  end if;
  if new.period <> 'custom' then
    new.date_from := null;
    new.date_to := null;
  end if;
  new.title := nullif(btrim(coalesce(new.title, '')), '');
  if tg_op = 'UPDATE' then
    new.dashboard_id := old.dashboard_id;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function app.bi_widget_guard() from public, anon, authenticated;

create trigger bi_dashboards_guard before insert or update on public.bi_dashboards
  for each row execute function app.bi_dashboard_guard();
create trigger bi_dashboards_stamp_actor before insert or update on public.bi_dashboards
  for each row execute function app.stamp_actor();
create trigger bi_dashboards_audit after insert or update or delete on public.bi_dashboards
  for each row execute function app.log_audit();

create trigger bi_widgets_guard before insert or update on public.bi_widgets
  for each row execute function app.bi_widget_guard();
create trigger bi_widgets_stamp_actor before insert or update on public.bi_widgets
  for each row execute function app.stamp_actor();
create trigger bi_widgets_same_tenant before insert or update of dashboard_id on public.bi_widgets
  for each row execute function app.assert_same_tenant('dashboard_id', 'bi_dashboards');

-- ============================================================
-- RLS: members read shared dashboards (and their own); managers write.
-- A private dashboard is visible to its owner and to admins.
-- ============================================================
set local lock_timeout = '1s';
create policy bi_dashboards_select on public.bi_dashboards for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.module_enabled('bi_analytics'))
         and (is_shared or owner_id = (select auth.uid()) or (select app.is_admin())));
create policy bi_dashboards_insert on public.bi_dashboards for insert to authenticated
  with check (tenant_id = (select app.tenant_id()) and (select app.is_manager()) and (select app.module_enabled('bi_analytics')));
create policy bi_dashboards_update on public.bi_dashboards for update to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_manager()) and (select app.module_enabled('bi_analytics'))
         and (is_shared or owner_id = (select auth.uid()) or (select app.is_admin())))
  with check (tenant_id = (select app.tenant_id()) and (select app.is_manager()) and (select app.module_enabled('bi_analytics')));
create policy bi_dashboards_delete on public.bi_dashboards for delete to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_manager()) and (select app.module_enabled('bi_analytics'))
         and (is_shared or owner_id = (select auth.uid()) or (select app.is_admin())));

-- Widgets follow their dashboard's visibility.
create policy bi_widgets_select on public.bi_widgets for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.module_enabled('bi_analytics'))
         and exists (select 1 from public.bi_dashboards d where d.id = dashboard_id));
create policy bi_widgets_insert on public.bi_widgets for insert to authenticated
  with check (tenant_id = (select app.tenant_id()) and (select app.is_manager()) and (select app.module_enabled('bi_analytics'))
              and exists (select 1 from public.bi_dashboards d where d.id = dashboard_id));
create policy bi_widgets_update on public.bi_widgets for update to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_manager()) and (select app.module_enabled('bi_analytics'))
         and exists (select 1 from public.bi_dashboards d where d.id = dashboard_id))
  with check (tenant_id = (select app.tenant_id()) and (select app.is_manager()) and (select app.module_enabled('bi_analytics')));
create policy bi_widgets_delete on public.bi_widgets for delete to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_manager()) and (select app.module_enabled('bi_analytics'))
         and exists (select 1 from public.bi_dashboards d where d.id = dashboard_id));
