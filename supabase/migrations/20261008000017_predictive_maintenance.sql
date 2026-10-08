-- Predictive maintenance (module predictive_ai): deterministic, explainable
-- vehicle risk scores. No machine learning and no generative AI; every point
-- comes from a named factor. Mirrors shared/predictive.ts (change both).
--
-- 1) public.predictive_vehicle_health(): one row per vehicle that isn't
--    retired, with usage (least-squares km/day over 180 days of odometer
--    readings from fuel logs, work orders, inspections and the vehicle's
--    current odometer, which GPS keeps current when that module is on), days
--    to the next service reminder, issue counts and rate, maintenance cost
--    trend (completed work-order lines), age, open high/critical issues, days
--    since the last inspection, the factor list, a 0–100 score and a band.
-- 2) maintenance_predictions: snapshots of those results.
--    public.predictive_snapshot() (managers) refreshes the one open
--    prediction per vehicle, or opens one; a manager then actions it (links
--    the work order they raised) or dismisses it.
--
-- Raised codes: ILLEGAL_PREDICTION_TRANSITION, WORK_ORDER_REQUIRED
-- (+ CROSS_TENANT_REFERENCE, MODULE_DISABLED, FORBIDDEN). Additive only.

set local lock_timeout = '3s';
set local statement_timeout = '60s';

-- ============================================================
-- Scoring
-- ============================================================
create or replace function public.predictive_vehicle_health()
returns table (
  vehicle_id uuid,
  odometer numeric,
  avg_daily_km numeric,
  days_to_service integer,
  service_overdue boolean,
  predicted_service_date date,
  issues_90d integer,
  issues_180d integer,
  issue_rate numeric,
  open_critical integer,
  open_high integer,
  cost_90d numeric,
  cost_prev_90d numeric,
  age_years integer,
  days_since_inspection integer,
  factors jsonb,
  risk_score integer,
  band text
)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_tenant uuid := app.require_module('predictive_ai', 'member');
begin
  return query
  with v as (
    select ve.id, ve.odometer, ve.odometer_updated_at,
           coalesce(
             extract(year from age(current_date, ve.purchase_date))::integer,
             case when ve.year is not null then extract(year from current_date)::integer - ve.year end
           ) as age_years
      from public.vehicles ve
     where ve.tenant_id = v_tenant and ve.status <> 'retired'
  ),
  readings as (
    select f.vehicle_id, f.filled_at as t, f.odometer as km
      from public.fuel_logs f
     where f.tenant_id = v_tenant and f.odometer > 0 and f.filled_at >= now() - interval '180 days'
    union all
    select w.vehicle_id, coalesce(w.completed_at, w.created_at), w.odometer
      from public.work_orders w
     where w.tenant_id = v_tenant and w.odometer > 0
       and coalesce(w.completed_at, w.created_at) >= now() - interval '180 days'
    union all
    select i.vehicle_id, i.performed_at, i.odometer
      from public.inspections i
     where i.tenant_id = v_tenant and i.odometer > 0 and i.performed_at >= now() - interval '180 days'
    union all
    select v.id, v.odometer_updated_at, v.odometer
      from v
     where v.odometer > 0 and v.odometer_updated_at >= now() - interval '180 days'
  ),
  usage as (
    select r.vehicle_id,
           case
             when count(*) >= 2
              and extract(epoch from max(r.t) - min(r.t)) / 86400.0 >= 7
              and regr_slope(r.km::double precision, extract(epoch from r.t) / 86400.0) is not null
             then greatest(0, round(regr_slope(r.km::double precision, extract(epoch from r.t) / 86400.0)::numeric, 1))
           end as avg
      from readings r
     group by r.vehicle_id
  ),
  rem as (
    select s.vehicle_id,
           bool_or(s.due_km is not null and v.odometer >= s.due_km) as overdue_km,
           min(case when s.due_km is not null and u.avg > 0 then floor((s.due_km - v.odometer) / u.avg)::integer end) as days_km,
           min(case when s.due_date is not null then s.due_date - current_date end) as days_date
      from public.service_reminders s
      join v on v.id = s.vehicle_id
      left join usage u on u.vehicle_id = s.vehicle_id
     where s.tenant_id = v_tenant and s.active
     group by s.vehicle_id
  ),
  iss as (
    select i.vehicle_id,
           (count(*) filter (where i.reported_at >= now() - interval '90 days'))::integer as n90,
           (count(*) filter (where i.reported_at >= now() - interval '180 days'))::integer as n180,
           (count(*) filter (where i.status in ('open', 'in_progress') and i.priority = 'critical'))::integer as crit,
           (count(*) filter (where i.status in ('open', 'in_progress') and i.priority = 'high'))::integer as high
      from public.issues i
     where i.tenant_id = v_tenant
     group by i.vehicle_id
  ),
  cost as (
    select w.vehicle_id,
           coalesce(sum(l.quantity * l.unit_cost) filter (where w.completed_at >= now() - interval '90 days'), 0) as c90,
           coalesce(sum(l.quantity * l.unit_cost) filter (where w.completed_at < now() - interval '90 days'), 0) as cprev
      from public.work_orders w
      join public.work_order_lines l on l.work_order_id = w.id
     where w.tenant_id = v_tenant and w.status = 'completed' and w.completed_at >= now() - interval '180 days'
     group by w.vehicle_id
  ),
  insp as (
    select i.vehicle_id, (current_date - max(i.performed_at)::date)::integer as days
      from public.inspections i
     where i.tenant_id = v_tenant
     group by i.vehicle_id
  ),
  base as (
    select v.id, v.odometer, u.avg, v.age_years,
           least(rem.days_km, rem.days_date) as days,
           coalesce(rem.overdue_km, false) or coalesce(rem.days_date < 0, false)
             or coalesce(least(rem.days_km, rem.days_date) < 0, false) as overdue,
           coalesce(iss.n90, 0) as n90, coalesce(iss.n180, 0) as n180,
           coalesce(iss.crit, 0) as crit, coalesce(iss.high, 0) as high,
           coalesce(cost.c90, 0) as c90, coalesce(cost.cprev, 0) as cprev,
           insp.days as insp_days
      from v
      left join usage u on u.vehicle_id = v.id
      left join rem on rem.vehicle_id = v.id
      left join iss on iss.vehicle_id = v.id
      left join cost on cost.vehicle_id = v.id
      left join insp on insp.vehicle_id = v.id
  ),
  rated as (
    select b.*, round(b.n180 * 1000.0 / greatest(coalesce(b.avg, 0) * 180, 500), 1) as rate
      from base b
  ),
  scored as (
    select r.*,
           coalesce(jsonb_agg(f.factor order by f.ord) filter (where f.factor is not null), '[]'::jsonb) as factors
      from rated r
      left join lateral (
        values
          (1, case
                when r.overdue then jsonb_build_object('code', 'service_overdue', 'points', 30, 'value', r.days)
                when r.days <= 14 then jsonb_build_object('code', 'service_due_14d', 'points', 20, 'value', r.days)
                when r.days <= 30 then jsonb_build_object('code', 'service_due_30d', 'points', 10, 'value', r.days)
              end),
          (2, case
                when r.crit > 0 then jsonb_build_object('code', 'open_critical_issue', 'points', 20, 'value', r.crit)
                when r.high > 0 then jsonb_build_object('code', 'open_high_issue', 'points', 10, 'value', r.high)
              end),
          (3, case when r.n90 >= 2 then jsonb_build_object('code', 'repeat_failure', 'points', 15, 'value', r.n90) end),
          (4, case
                when r.rate >= 2 then jsonb_build_object('code', 'issue_rate_high', 'points', 15, 'value', r.rate)
                when r.rate >= 1 then jsonb_build_object('code', 'issue_rate', 'points', 8, 'value', r.rate)
              end),
          (5, case
                when r.cprev > 0 and r.c90 > r.cprev * 1.5
                  then jsonb_build_object('code', 'cost_rising', 'points', 10, 'value', round(r.c90 / r.cprev, 1))
                when r.cprev = 0 and r.c90 > 0
                  then jsonb_build_object('code', 'cost_new', 'points', 5, 'value', null)
              end),
          (6, case
                when r.age_years >= 10 then jsonb_build_object('code', 'age_10y', 'points', 10, 'value', r.age_years)
                when r.age_years >= 6 then jsonb_build_object('code', 'age_6y', 'points', 5, 'value', r.age_years)
              end),
          (7, case when r.insp_days is null or r.insp_days > 90
                then jsonb_build_object('code', 'inspection_overdue', 'points', 10, 'value', r.insp_days) end)
      ) as f(ord, factor) on true
     group by r.id, r.odometer, r.avg, r.age_years, r.days, r.overdue, r.n90, r.n180, r.crit, r.high,
              r.c90, r.cprev, r.insp_days, r.rate
  ),
  totals as (
    select s.*,
           least(100, coalesce((select sum((x ->> 'points')::integer) from jsonb_array_elements(s.factors) x), 0))::integer as score
      from scored s
  )
  select t.id, t.odometer, t.avg, t.days, t.overdue,
         case when t.days is not null then current_date + greatest(t.days, 0) end,
         t.n90, t.n180, t.rate, t.crit, t.high, t.c90, t.cprev, t.age_years, t.insp_days,
         t.factors, t.score,
         case when t.score >= 60 then 'high' when t.score >= 30 then 'medium' else 'low' end
    from totals t;
end;
$$;
revoke execute on function public.predictive_vehicle_health() from public, anon;
grant execute on function public.predictive_vehicle_health() to authenticated;

-- ============================================================
-- Snapshots
-- ============================================================
create table public.maintenance_predictions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  computed_at timestamptz not null default now(),
  risk_score integer not null check (risk_score between 0 and 100),
  band text not null check (band in ('low', 'medium', 'high')),
  avg_daily_km numeric,
  days_to_service integer,
  predicted_service_date date,
  factors jsonb not null default '[]'::jsonb,
  status text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  work_order_id uuid references public.work_orders(id) on delete set null,
  note text check (note is null or char_length(note) <= 2000),
  closed_at timestamptz,
  closed_by uuid,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index maintenance_predictions_open_uidx on public.maintenance_predictions (vehicle_id) where status = 'open';
create index maintenance_predictions_tenant_idx on public.maintenance_predictions (tenant_id, status, risk_score desc);
create index maintenance_predictions_work_order_idx on public.maintenance_predictions (work_order_id);
alter table public.maintenance_predictions enable row level security;
revoke all on public.maintenance_predictions from anon;
revoke insert, update, delete on public.maintenance_predictions from authenticated;
-- Snapshots are written by predictive_snapshot(); clients only close them.
grant update (status, work_order_id, note) on public.maintenance_predictions to authenticated;

-- open → actioned (needs the work order raised for it) | dismissed.
create or replace function app.maintenance_prediction_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    if old.status <> 'open' or new.status not in ('actioned', 'dismissed') then
      raise exception 'ILLEGAL_PREDICTION_TRANSITION';
    end if;
    new.closed_at := now();
    new.closed_by := auth.uid();
  end if;
  if new.status = 'actioned' and new.work_order_id is null then
    raise exception 'WORK_ORDER_REQUIRED';
  end if;
  return new;
end;
$$;
revoke execute on function app.maintenance_prediction_guard() from public, anon, authenticated;

create trigger maintenance_predictions_guard before update on public.maintenance_predictions
  for each row execute function app.maintenance_prediction_guard();
create trigger maintenance_predictions_stamp_actor before insert or update on public.maintenance_predictions
  for each row execute function app.stamp_actor();
create trigger maintenance_predictions_same_tenant before update of work_order_id on public.maintenance_predictions
  for each row execute function app.assert_same_tenant('work_order_id', 'work_orders');
create trigger maintenance_predictions_audit after insert or update or delete on public.maintenance_predictions
  for each row execute function app.log_audit();

-- Refresh the open prediction of every vehicle at medium or high risk (or
-- that already has an open one), opening one where needed. Returns the
-- number of vehicles snapshotted.
create or replace function public.predictive_snapshot()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.require_module('predictive_ai', 'member');
  v_count integer := 0;
  r record;
begin
  if not app.is_manager() then
    raise exception 'FORBIDDEN';
  end if;
  for r in select * from public.predictive_vehicle_health() loop
    update public.maintenance_predictions p
       set computed_at = now(), risk_score = r.risk_score, band = r.band, avg_daily_km = r.avg_daily_km,
           days_to_service = r.days_to_service, predicted_service_date = r.predicted_service_date,
           factors = r.factors, updated_at = now()
     where p.tenant_id = v_tenant and p.vehicle_id = r.vehicle_id and p.status = 'open';
    if found then
      v_count := v_count + 1;
    elsif r.band <> 'low' then
      insert into public.maintenance_predictions (tenant_id, vehicle_id, risk_score, band, avg_daily_km,
                                                  days_to_service, predicted_service_date, factors)
      values (v_tenant, r.vehicle_id, r.risk_score, r.band, r.avg_daily_km, r.days_to_service,
              r.predicted_service_date, r.factors);
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;
revoke execute on function public.predictive_snapshot() from public, anon;
grant execute on function public.predictive_snapshot() to authenticated;

-- ============================================================
-- RLS: members read; managers close predictions.
-- ============================================================
set local lock_timeout = '1s';
create policy maintenance_predictions_select on public.maintenance_predictions for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.module_enabled('predictive_ai')));
create policy maintenance_predictions_update on public.maintenance_predictions for update to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_manager())
         and (select app.module_enabled('predictive_ai')))
  with check (tenant_id = (select app.tenant_id()) and (select app.is_manager())
              and (select app.module_enabled('predictive_ai')));
