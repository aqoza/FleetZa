-- HR & payroll (module payroll_hr). Builds on the foundation employees table
-- (salary structure, hire/termination dates, linked app user).
--
-- 1) hr_settings: one row per tenant. Weekend days (0 = Sunday .. 6 =
--    Saturday; the SPA proposes them from the tenant's country on first
--    use), standard daily hours, overtime multiplier and the social
--    insurance rates (applied to basic + housing; to nationals only when
--    social_nationals_only, a national being an employee whose nationality
--    is the tenant's country). Written through save_hr_settings only.
-- 2) Leave: leave_types (seeded by hr_seed: annual, sick, unpaid, maternity,
--    hajj, compassionate; managers edit them), leave_requests (days counted
--    server-side excluding the weekend; pending -> approved | rejected |
--    canceled, approved -> canceled; an overlap with another pending or
--    approved request raises LEAVE_OVERLAP). Requests are written through
--    request_leave (an employee for themselves via employees.user_id, a
--    manager for anyone) and leave_transition; leave_balances computes
--    entitlement - taken.
--    Public holidays are not modelled: a holiday inside a leave counts as a
--    leave day unless it falls on the weekend.
-- 3) Attendance: attendance_records, one per employee and day, written by
--    managers through attendance_set (the daily sheet). Hours are computed.
-- 4) Payroll: payroll_runs (PAY numbering; draft -> calculated -> approved
--    -> paid, draft | calculated -> canceled; currency snapshot; totals) and
--    payslips (computed by payroll_calculate from each employee's salary
--    structure, pro-rated for joiners and leavers inside the period, with
--    unpaid leave deducted at basic / 30 per day and overtime at the hourly
--    rate x the multiplier; bonus, other deductions and overtime hours stay
--    editable until the run is approved, then everything is locked).
--    Employees read their own payslips once the run is approved.
--    WPS / SIF bank files are out of scope.
--
-- Notifications: hr.leave_requested (managers), hr.leave_decided (the
-- employee's app user). Events: leave_request.approved, payroll_run.approved,
-- payroll_run.paid.
--
-- Raised codes: HR_INVALID_SETTING, LEAVE_OVERLAP, LEAVE_NO_WORKDAYS,
-- LEAVE_INVALID_DATES, LEAVE_TYPE_INACTIVE, LEAVE_NOT_FOUND,
-- ILLEGAL_LEAVE_TRANSITION, NO_EMPLOYEE_PROFILE, EMPLOYEE_NOT_FOUND,
-- ATTENDANCE_INVALID, PAYROLL_NOT_FOUND, ILLEGAL_PAYROLL_TRANSITION,
-- PAYSLIP_NEGATIVE_NET, PAYROLL_INVALID_PERIOD (+ the existing DOC_LOCKED,
-- DOC_NOT_DELETABLE, EMPTY_DOCUMENT).
-- Additive only: no existing table, trigger or policy changes.

set local lock_timeout = '3s';
set local statement_timeout = '60s';

-- ============================================================
-- 1) Settings
-- ============================================================
create table public.hr_settings (
  tenant_id uuid primary key default app.tenant_id() references public.tenants(id) on delete cascade,
  id uuid not null unique default gen_random_uuid(), -- app.log_audit keys rows by id
  weekend_days smallint[] not null default '{5,6}'
    check (weekend_days <@ '{0,1,2,3,4,5,6}'::smallint[] and cardinality(weekend_days) <= 3),
  standard_daily_hours numeric(4, 2) not null default 8 check (standard_daily_hours between 1 and 24),
  overtime_multiplier numeric(4, 2) not null default 1.25 check (overtime_multiplier between 1 and 5),
  social_employee_pct numeric(5, 2) not null default 0 check (social_employee_pct between 0 and 50),
  social_employer_pct numeric(5, 2) not null default 0 check (social_employer_pct between 0 and 50),
  social_nationals_only boolean not null default true,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table public.hr_settings enable row level security;
revoke all on public.hr_settings from anon;
revoke insert, update, delete, truncate on public.hr_settings from authenticated;

create trigger hr_settings_updated_at before update on public.hr_settings
  for each row execute function app.set_updated_at();
create trigger hr_settings_audit after insert or update or delete on public.hr_settings
  for each row execute function app.log_audit();

-- The tenant's settings, with defaults when no row exists yet.
create or replace function app.hr_config(p_tenant uuid)
returns public.hr_settings
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.hr_settings;
begin
  select * into v from public.hr_settings where tenant_id = p_tenant;
  if not found then
    v.tenant_id := p_tenant;
    v.weekend_days := '{5,6}';
    v.standard_daily_hours := 8;
    v.overtime_multiplier := 1.25;
    v.social_employee_pct := 0;
    v.social_employer_pct := 0;
    v.social_nationals_only := true;
  end if;
  return v;
end;
$$;
revoke execute on function app.hr_config(uuid) from public, anon, authenticated;

-- Working days in [p_start, p_end] for a weekend set.
create or replace function app.hr_workdays(p_weekend smallint[], p_start date, p_end date)
returns integer
language sql
immutable
set search_path = ''
as $$
  select count(*)::integer
  from generate_series(p_start, p_end, interval '1 day') d
  where not (extract(dow from d)::smallint = any (coalesce(p_weekend, '{}'::smallint[])));
$$;

create or replace function public.save_hr_settings(
  p_weekend_days integer[],
  p_standard_daily_hours numeric,
  p_overtime_multiplier numeric,
  p_social_employee_pct numeric,
  p_social_employer_pct numeric,
  p_social_nationals_only boolean
)
returns public.hr_settings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.require_module('payroll_hr', 'manager');
  v_row public.hr_settings;
  v_weekend smallint[];
begin
  select coalesce(array_agg(distinct d order by d), '{}') into v_weekend
  from unnest(coalesce(p_weekend_days, '{}'::integer[])) d;
  if not v_weekend <@ '{0,1,2,3,4,5,6}'::smallint[] or cardinality(v_weekend) > 3
     or coalesce(p_standard_daily_hours, 0) not between 1 and 24
     or coalesce(p_overtime_multiplier, 0) not between 1 and 5
     or coalesce(p_social_employee_pct, -1) not between 0 and 50
     or coalesce(p_social_employer_pct, -1) not between 0 and 50 then
    raise exception 'HR_INVALID_SETTING';
  end if;
  insert into public.hr_settings as s
    (tenant_id, weekend_days, standard_daily_hours, overtime_multiplier,
     social_employee_pct, social_employer_pct, social_nationals_only, updated_by)
  values (v_tenant, v_weekend, p_standard_daily_hours, p_overtime_multiplier,
          p_social_employee_pct, p_social_employer_pct, coalesce(p_social_nationals_only, true), auth.uid())
  on conflict (tenant_id) do update
    set weekend_days = excluded.weekend_days,
        standard_daily_hours = excluded.standard_daily_hours,
        overtime_multiplier = excluded.overtime_multiplier,
        social_employee_pct = excluded.social_employee_pct,
        social_employer_pct = excluded.social_employer_pct,
        social_nationals_only = excluded.social_nationals_only,
        updated_by = excluded.updated_by
  returning * into v_row;
  return v_row;
end;
$$;
revoke execute on function public.save_hr_settings(integer[], numeric, numeric, numeric, numeric, boolean)
  from public, anon;
grant execute on function public.save_hr_settings(integer[], numeric, numeric, numeric, numeric, boolean)
  to authenticated;

-- The signed-in member's employee record in their tenant, if linked.
create or replace function app.my_employee_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.id from public.employees e
  where e.user_id = auth.uid() and e.tenant_id = app.tenant_id()
  limit 1;
$$;
revoke execute on function app.my_employee_id() from public, anon;
grant execute on function app.my_employee_id() to authenticated;

-- ============================================================
-- 2) Leave
-- ============================================================
create table public.leave_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  code text not null check (code ~ '^[a-z][a-z0-9_]{1,30}$'),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  name_ar text check (name_ar is null or char_length(name_ar) <= 100),
  -- null = not tracked against an annual entitlement (e.g. unpaid).
  days_per_year numeric(5, 1) check (days_per_year is null or days_per_year between 0 and 366),
  paid boolean not null default true,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index leave_types_tenant_code_uk on public.leave_types (tenant_id, code);
alter table public.leave_types enable row level security;
revoke all on public.leave_types from anon;

create trigger leave_types_updated_at before update on public.leave_types
  for each row execute function app.set_updated_at();
create trigger leave_types_stamp_actor before insert or update on public.leave_types
  for each row execute function app.stamp_actor();
create trigger leave_types_audit after insert or update or delete on public.leave_types
  for each row execute function app.log_audit();

create table public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  leave_type_id uuid not null references public.leave_types(id) on delete restrict,
  start_date date not null,
  end_date date not null,
  days numeric(5, 1) not null default 0,
  reason text check (reason is null or char_length(reason) <= 1000),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'canceled')),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) <= 1000),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);
create index leave_requests_tenant_status_idx on public.leave_requests (tenant_id, status, start_date desc);
create index leave_requests_employee_idx on public.leave_requests (employee_id, start_date);
create index leave_requests_type_idx on public.leave_requests (leave_type_id);
alter table public.leave_requests enable row level security;
revoke all on public.leave_requests from anon;
-- Written through request_leave / leave_transition only.
revoke insert, update, delete, truncate on public.leave_requests from authenticated;

create trigger leave_requests_updated_at before update on public.leave_requests
  for each row execute function app.set_updated_at();
create trigger leave_requests_stamp_actor before insert or update on public.leave_requests
  for each row execute function app.stamp_actor();
create trigger leave_requests_audit after insert or update or delete on public.leave_requests
  for each row execute function app.log_audit();
create trigger leave_requests_same_tenant
  before insert or update of employee_id, leave_type_id on public.leave_requests
  for each row execute function app.assert_same_tenant(
    'employee_id', 'employees', 'leave_type_id', 'leave_types');

-- Days, legal moves and the overlap guard, whoever writes the row.
create or replace function app.leave_request_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if not (
      (old.status = 'pending'  and new.status in ('approved', 'rejected', 'canceled')) or
      (old.status = 'approved' and new.status = 'canceled')
    ) then
      raise exception 'ILLEGAL_LEAVE_TRANSITION: % -> %', old.status, new.status;
    end if;
  end if;

  if tg_op = 'INSERT' or new.start_date is distinct from old.start_date
     or new.end_date is distinct from old.end_date then
    new.days := app.hr_workdays((app.hr_config(new.tenant_id)).weekend_days, new.start_date, new.end_date);
    if new.days = 0 then
      raise exception 'LEAVE_NO_WORKDAYS';
    end if;
  end if;

  if new.status in ('pending', 'approved') then
    -- Serialize per employee so two approvals cannot both pass the check.
    perform 1 from public.employees e where e.id = new.employee_id for update;
    if exists (
      select 1 from public.leave_requests r
      where r.employee_id = new.employee_id
        and r.id <> new.id
        and r.status in ('pending', 'approved')
        and daterange(r.start_date, r.end_date, '[]') && daterange(new.start_date, new.end_date, '[]')
    ) then
      raise exception 'LEAVE_OVERLAP';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function app.leave_request_guard() from public, anon, authenticated;

create trigger leave_requests_guard
  before insert or update of status, start_date, end_date, employee_id on public.leave_requests
  for each row execute function app.leave_request_guard();

-- Seed the default leave types (idempotent) and, the first time, the
-- settings row with the weekend the SPA proposes from the tenant's country.
create or replace function public.hr_seed(p_weekend_days integer[] default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.require_module('payroll_hr', 'manager');
  v_count integer;
  v_weekend smallint[];
begin
  if p_weekend_days is not null then
    select coalesce(array_agg(distinct d order by d), '{}') into v_weekend
    from unnest(p_weekend_days) d where d between 0 and 6;
    if cardinality(v_weekend) <= 3 then
      insert into public.hr_settings (tenant_id, weekend_days, updated_by)
      values (v_tenant, v_weekend, auth.uid())
      on conflict (tenant_id) do nothing;
    end if;
  end if;

  insert into public.leave_types (tenant_id, code, name, name_ar, days_per_year, paid, sort_order)
  select v_tenant, s.code, s.name, s.name_ar, s.days, s.paid, s.ord
  from (values
    ('annual',        'Annual leave',        'إجازة سنوية',  30::numeric, true,  1),
    ('sick',          'Sick leave',          'إجازة مرضية',  15::numeric, true,  2),
    ('unpaid',        'Unpaid leave',        'إجازة بدون راتب', null::numeric, false, 3),
    ('maternity',     'Maternity leave',     'إجازة أمومة',  60::numeric, true,  4),
    ('hajj',          'Hajj leave',          'إجازة حج',     10::numeric, true,  5),
    ('compassionate', 'Compassionate leave', 'إجازة عزاء',   5::numeric,  true,  6)
  ) as s(code, name, name_ar, days, paid, ord)
  on conflict (tenant_id, code) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke execute on function public.hr_seed(integer[]) from public, anon;
grant execute on function public.hr_seed(integer[]) to authenticated;

-- An employee requests leave for themselves (p_employee null), or a manager
-- files it for anyone.
create or replace function public.request_leave(
  p_employee uuid,
  p_leave_type uuid,
  p_start date,
  p_end date,
  p_reason text default null
)
returns public.leave_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.require_module('payroll_hr', 'member');
  v_me uuid := app.my_employee_id();
  v_employee uuid := coalesce(p_employee, v_me);
  v_row public.leave_requests;
  v_name text;
  v_type text;
begin
  if v_employee is null then
    raise exception 'NO_EMPLOYEE_PROFILE';
  end if;
  if v_employee is distinct from v_me and not coalesce(app.is_manager(), false) then
    raise exception 'FORBIDDEN';
  end if;
  select btrim(concat_ws(' ', e.first_name, e.last_name)) into v_name
  from public.employees e where e.id = v_employee and e.tenant_id = v_tenant;
  if not found then
    raise exception 'EMPLOYEE_NOT_FOUND';
  end if;
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 366 then
    raise exception 'LEAVE_INVALID_DATES';
  end if;
  select t.name into v_type from public.leave_types t
  where t.id = p_leave_type and t.tenant_id = v_tenant and t.active;
  if not found then
    raise exception 'LEAVE_TYPE_INACTIVE';
  end if;

  insert into public.leave_requests (tenant_id, employee_id, leave_type_id, start_date, end_date, reason)
  values (v_tenant, v_employee, p_leave_type, p_start, p_end, nullif(btrim(coalesce(p_reason, '')), ''))
  returning * into v_row;

  perform app.notify(
    v_tenant, 'managers', 'hr.leave_requested', 'info', 'leave_request', v_row.id, '/hr/leave',
    jsonb_build_object('employee', v_name, 'type', v_type, 'start', v_row.start_date,
                       'end', v_row.end_date, 'days', v_row.days),
    v_name || ' requested ' || v_row.days || ' day(s) of ' || v_type,
    to_char(v_row.start_date, 'YYYY-MM-DD') || ' – ' || to_char(v_row.end_date, 'YYYY-MM-DD'),
    'hr.leave_requested:' || v_row.id);
  return v_row;
end;
$$;
revoke execute on function public.request_leave(uuid, uuid, date, date, text) from public, anon;
grant execute on function public.request_leave(uuid, uuid, date, date, text) to authenticated;

-- Approve / reject (managers), cancel (managers, or the employee while pending).
create or replace function public.leave_transition(p_id uuid, p_to text, p_note text default null)
returns public.leave_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.require_module('payroll_hr', 'member');
  v_row public.leave_requests;
  v_user uuid;
  v_name text;
  v_type text;
begin
  select * into v_row from public.leave_requests r where r.id = p_id and r.tenant_id = v_tenant for update;
  if not found then
    raise exception 'LEAVE_NOT_FOUND';
  end if;
  if not coalesce(app.is_manager(), false) then
    -- Employees may only withdraw their own pending request.
    if v_row.employee_id is distinct from app.my_employee_id() then
      raise exception 'LEAVE_NOT_FOUND';
    end if;
    if p_to <> 'canceled' or v_row.status <> 'pending' then
      raise exception 'FORBIDDEN';
    end if;
  end if;

  update public.leave_requests
     set status = p_to,
         decided_by = auth.uid(),
         decided_at = now(),
         decision_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_id
  returning * into v_row;

  select e.user_id, btrim(concat_ws(' ', e.first_name, e.last_name)) into v_user, v_name
  from public.employees e where e.id = v_row.employee_id;
  select t.name into v_type from public.leave_types t where t.id = v_row.leave_type_id;

  if p_to in ('approved', 'rejected') and v_user is not null and v_user is distinct from auth.uid() then
    perform app.notify(
      v_tenant, null, 'hr.leave_decided', case when p_to = 'approved' then 'info' else 'warning' end,
      'leave_request', v_row.id, '/hr/leave',
      jsonb_build_object('decision', p_to, 'type', v_type, 'start', v_row.start_date,
                         'end', v_row.end_date, 'days', v_row.days),
      'Your ' || v_type || ' request was ' || p_to,
      to_char(v_row.start_date, 'YYYY-MM-DD') || ' – ' || to_char(v_row.end_date, 'YYYY-MM-DD'),
      'hr.leave_decided:' || v_row.id || ':' || p_to,
      v_user);
  end if;
  if p_to = 'approved' then
    perform app.emit_event(v_tenant, 'leave_request.approved', 'leave_request', v_row.id,
      jsonb_build_object('id', v_row.id, 'employee_id', v_row.employee_id, 'employee', v_name,
                         'leave_type', v_type, 'start_date', v_row.start_date,
                         'end_date', v_row.end_date, 'days', v_row.days));
  end if;
  return v_row;
end;
$$;
revoke execute on function public.leave_transition(uuid, text, text) from public, anon;
grant execute on function public.leave_transition(uuid, text, text) to authenticated;

-- Entitlement - taken per employee and tracked type for a calendar year.
-- Leave is attributed to the year it starts in. Entitlement is pro-rated in
-- the year an employee joins. Non-managers only ever get their own rows.
create or replace function public.leave_balances(p_year integer, p_employee uuid default null)
returns table (
  employee_id uuid,
  leave_type_id uuid,
  entitled numeric,
  taken numeric,
  pending numeric,
  remaining numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.require_module('payroll_hr', 'member');
  v_employee uuid := p_employee;
  v_from date := make_date(p_year, 1, 1);
  v_to date := make_date(p_year, 12, 31);
begin
  if not coalesce(app.is_manager(), false) then
    v_employee := app.my_employee_id();
    if v_employee is null then
      return;
    end if;
  end if;
  return query
  with emp as (
    select e.id, e.hire_date from public.employees e
    where e.tenant_id = v_tenant
      and (v_employee is null or e.id = v_employee)
      and (v_employee is not null or e.status <> 'terminated')
  ),
  used as (
    select r.employee_id, r.leave_type_id,
           sum(r.days) filter (where r.status = 'approved') as taken,
           sum(r.days) filter (where r.status = 'pending') as pending
    from public.leave_requests r
    where r.tenant_id = v_tenant and r.start_date between v_from and v_to
      and r.status in ('approved', 'pending')
    group by r.employee_id, r.leave_type_id
  )
  select emp.id, t.id,
         ent.v,
         coalesce(u.taken, 0)::numeric,
         coalesce(u.pending, 0)::numeric,
         (ent.v - coalesce(u.taken, 0))::numeric
  from emp
  cross join public.leave_types t
  left join used u on u.employee_id = emp.id and u.leave_type_id = t.id
  cross join lateral (
    select case
      when emp.hire_date is not null and emp.hire_date > v_to then 0::numeric
      when emp.hire_date is not null and emp.hire_date > v_from
        then round(t.days_per_year * ((v_to - emp.hire_date + 1)::numeric / (v_to - v_from + 1)), 1)
      else t.days_per_year
    end as v
  ) ent
  where t.tenant_id = v_tenant and t.days_per_year is not null
    and (t.active or u.taken is not null or u.pending is not null)
  order by emp.id, t.sort_order;
end;
$$;
revoke execute on function public.leave_balances(integer, uuid) from public, anon;
grant execute on function public.leave_balances(integer, uuid) to authenticated;

-- ============================================================
-- 3) Attendance
-- ============================================================
create table public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  work_date date not null,
  status text not null default 'present'
    check (status in ('present', 'absent', 'late', 'half_day', 'on_leave', 'holiday')),
  check_in time,
  check_out time,
  hours numeric(5, 2),
  note text check (note is null or char_length(note) <= 500),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index attendance_records_employee_date_uk on public.attendance_records (tenant_id, employee_id, work_date);
create index attendance_records_tenant_date_idx on public.attendance_records (tenant_id, work_date);
create index attendance_records_employee_idx on public.attendance_records (employee_id, work_date);
alter table public.attendance_records enable row level security;
revoke all on public.attendance_records from anon;
revoke insert, update, delete, truncate on public.attendance_records from authenticated;

create trigger attendance_records_updated_at before update on public.attendance_records
  for each row execute function app.set_updated_at();
create trigger attendance_records_stamp_actor before insert or update on public.attendance_records
  for each row execute function app.stamp_actor();
create trigger attendance_records_same_tenant
  before insert or update of employee_id on public.attendance_records
  for each row execute function app.assert_same_tenant('employee_id', 'employees');

-- Hours from the clock times; a check-out before the check-in is overnight.
create or replace function app.attendance_hours()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.check_in is not null and new.check_out is not null then
    new.hours := round((extract(epoch from (new.check_out - new.check_in))::numeric / 3600
                        + case when new.check_out < new.check_in then 24 else 0 end), 2);
  elsif new.status in ('absent', 'on_leave', 'holiday') then
    new.hours := 0;
  else
    new.hours := null;
  end if;
  return new;
end;
$$;
revoke execute on function app.attendance_hours() from public, anon, authenticated;

create trigger attendance_records_hours
  before insert or update of check_in, check_out, status on public.attendance_records
  for each row execute function app.attendance_hours();

-- The daily sheet: upserts one row per employee for p_date; a null status
-- clears that employee's row. p_rows: [{employee_id, status, check_in,
-- check_out, note}]. Returns the number of rows written or cleared.
create or replace function public.attendance_set(p_date date, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.require_module('payroll_hr', 'manager');
  r jsonb;
  v_emp uuid;
  v_count integer := 0;
begin
  if p_date is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 1000 then
    raise exception 'ATTENDANCE_INVALID';
  end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    if coalesce(r ->> 'employee_id', '') !~ '^[0-9a-f-]{36}$' then
      raise exception 'ATTENDANCE_INVALID';
    end if;
    v_emp := (r ->> 'employee_id')::uuid;
    if not exists (select 1 from public.employees e where e.id = v_emp and e.tenant_id = v_tenant) then
      raise exception 'EMPLOYEE_NOT_FOUND';
    end if;
    if nullif(r ->> 'status', '') is null then
      delete from public.attendance_records a
      where a.tenant_id = v_tenant and a.employee_id = v_emp and a.work_date = p_date;
    else
      if r ->> 'status' not in ('present', 'absent', 'late', 'half_day', 'on_leave', 'holiday')
         or coalesce(r ->> 'check_in', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$|^$'
         or coalesce(r ->> 'check_out', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$|^$' then
        raise exception 'ATTENDANCE_INVALID';
      end if;
      insert into public.attendance_records as a
        (tenant_id, employee_id, work_date, status, check_in, check_out, note)
      values (v_tenant, v_emp, p_date, r ->> 'status',
              nullif(r ->> 'check_in', '')::time, nullif(r ->> 'check_out', '')::time,
              nullif(btrim(coalesce(r ->> 'note', '')), ''))
      on conflict (tenant_id, employee_id, work_date) do update
        set status = excluded.status,
            check_in = excluded.check_in,
            check_out = excluded.check_out,
            note = excluded.note;
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke execute on function public.attendance_set(date, jsonb) from public, anon;
grant execute on function public.attendance_set(date, jsonb) to authenticated;

-- ============================================================
-- 4) Payroll
-- ============================================================
create table public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  number integer,
  doc_number text,
  period_start date not null,
  period_end date not null,
  pay_date date,
  status text not null default 'draft'
    check (status in ('draft', 'calculated', 'approved', 'paid', 'canceled')),
  currency text,
  currency_decimals smallint not null default 2,
  employee_count integer not null default 0,
  total_gross numeric(16, 3) not null default 0,
  total_deductions numeric(16, 3) not null default 0,
  total_net numeric(16, 3) not null default 0,
  total_employer_cost numeric(16, 3) not null default 0,
  notes text check (notes is null or char_length(notes) <= 2000),
  calculated_at timestamptz,
  approved_at timestamptz,
  approved_by uuid,
  paid_at date,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end >= period_start and period_end - period_start <= 62)
);
create unique index payroll_runs_tenant_number_uk on public.payroll_runs (tenant_id, number);
create unique index payroll_runs_tenant_doc_number_uk on public.payroll_runs (tenant_id, doc_number);
create index payroll_runs_tenant_period_idx on public.payroll_runs (tenant_id, period_start desc);
alter table public.payroll_runs enable row level security;
revoke all on public.payroll_runs from anon;
-- Status, totals and the snapshot belong to the RPCs.
revoke insert, update on public.payroll_runs from authenticated;
grant insert (period_start, period_end, pay_date, notes) on public.payroll_runs to authenticated;
grant update (period_start, period_end, pay_date, notes) on public.payroll_runs to authenticated;

create trigger payroll_runs_number
  before insert or update of number, doc_number on public.payroll_runs
  for each row execute function app.assign_doc_number('payroll_run', 'PAY');
create trigger payroll_runs_updated_at before update on public.payroll_runs
  for each row execute function app.set_updated_at();
create trigger payroll_runs_stamp_actor before insert or update on public.payroll_runs
  for each row execute function app.stamp_actor();
create trigger payroll_runs_audit
  after insert or delete or update of period_start, period_end, pay_date, status, notes on public.payroll_runs
  for each row execute function app.log_audit();

create or replace function app.payroll_run_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status not in ('draft', 'canceled') then
      raise exception 'DOC_NOT_DELETABLE';
    end if;
    return old;
  end if;
  if new.period_end < new.period_start or new.period_end - new.period_start > 62 then
    raise exception 'PAYROLL_INVALID_PERIOD';
  end if;
  if tg_op = 'INSERT' then
    new.status := 'draft';
    select t.currency, t.currency_decimals into new.currency, new.currency_decimals
    from public.tenants t where t.id = new.tenant_id;
    return new;
  end if;
  if new.status is distinct from old.status then
    if not (
      (old.status = 'draft'      and new.status in ('calculated', 'canceled')) or
      (old.status = 'calculated' and new.status in ('draft', 'approved', 'canceled')) or
      (old.status = 'approved'   and new.status = 'paid')
    ) then
      raise exception 'ILLEGAL_PAYROLL_TRANSITION: % -> %', old.status, new.status;
    end if;
  elsif old.status not in ('draft', 'calculated')
        and (new.period_start is distinct from old.period_start
             or new.period_end is distinct from old.period_end
             or new.pay_date is distinct from old.pay_date
             or new.notes is distinct from old.notes) then
    raise exception 'DOC_LOCKED';
  end if;
  -- A changed period invalidates the payslips: back to draft.
  if old.status = 'calculated' and new.status = 'calculated'
     and (new.period_start is distinct from old.period_start or new.period_end is distinct from old.period_end) then
    new.status := 'draft';
  end if;
  return new;
end;
$$;
revoke execute on function app.payroll_run_guard() from public, anon, authenticated;

create trigger payroll_runs_guard before insert or update or delete on public.payroll_runs
  for each row execute function app.payroll_run_guard();

create table public.payslips (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  run_id uuid not null references public.payroll_runs(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete restrict,
  -- Snapshot at calculation time: the slip reads the same after HR edits,
  -- and an employee can read their slip without access to payroll_runs.
  run_number text,
  period_start date not null,
  period_end date not null,
  pay_date date,
  currency text,
  employee_name text not null,
  employee_number text,
  job_title text,
  bank_name text,
  iban text,
  paid_days integer not null default 0,     -- calendar days employed in the period
  period_days integer not null default 0,   -- calendar days in the period
  basic numeric(14, 3) not null default 0,
  housing numeric(14, 3) not null default 0,
  transport numeric(14, 3) not null default 0,
  other_allowances numeric(14, 3) not null default 0,
  hourly_rate numeric(14, 4) not null default 0,
  overtime_multiplier numeric(4, 2) not null default 1.25,
  overtime_hours numeric(6, 2) not null default 0 check (overtime_hours between 0 and 400),
  overtime_amount numeric(14, 3) not null default 0,
  bonus numeric(14, 3) not null default 0 check (bonus >= 0),
  deductions numeric(14, 3) not null default 0 check (deductions >= 0),
  deduction_note text check (deduction_note is null or char_length(deduction_note) <= 500),
  unpaid_leave_days numeric(5, 1) not null default 0,
  unpaid_leave_deduction numeric(14, 3) not null default 0,
  social_insurance_employee numeric(14, 3) not null default 0,
  social_insurance_employer numeric(14, 3) not null default 0,
  gross numeric(14, 3) not null default 0,
  net numeric(14, 3) not null default 0,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index payslips_run_employee_uk on public.payslips (run_id, employee_id);
create index payslips_employee_idx on public.payslips (employee_id);
create index payslips_tenant_idx on public.payslips (tenant_id);
alter table public.payslips enable row level security;
revoke all on public.payslips from anon;
revoke insert, update, delete, truncate on public.payslips from authenticated;
-- The manual adjustments; everything else is computed.
grant update (overtime_hours, bonus, deductions, deduction_note) on public.payslips to authenticated;

-- Whether a run's slips are visible to the employees on it (payroll_runs
-- itself is manager-only, so the payslips policy cannot read it directly).
create or replace function app.payroll_run_released(p_run uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.payroll_runs r
                 where r.id = p_run and r.status in ('approved', 'paid'));
$$;
revoke execute on function app.payroll_run_released(uuid) from public, anon;
grant execute on function app.payroll_run_released(uuid) to authenticated;

create trigger payslips_updated_at before update on public.payslips
  for each row execute function app.set_updated_at();
create trigger payslips_audit
  after update of overtime_hours, bonus, deductions, deduction_note on public.payslips
  for each row execute function app.log_audit();

-- Recompute the derived amounts on every write; refuse edits once locked.
create or replace function app.payslip_compute()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.payroll_runs;
  v_dec integer;
begin
  select * into v_run from public.payroll_runs r where r.id = new.run_id;
  if v_run.status not in ('draft', 'calculated') then
    raise exception 'DOC_LOCKED';
  end if;
  v_dec := coalesce(v_run.currency_decimals, 2);
  new.updated_by := auth.uid();
  new.overtime_amount := round(new.overtime_hours * new.hourly_rate * new.overtime_multiplier, v_dec);
  new.gross := round(new.basic + new.housing + new.transport + new.other_allowances
                     + new.overtime_amount + new.bonus, v_dec);
  new.net := new.gross - new.unpaid_leave_deduction - new.social_insurance_employee - new.deductions;
  if new.net < 0 then
    raise exception 'PAYSLIP_NEGATIVE_NET';
  end if;
  return new;
end;
$$;
revoke execute on function app.payslip_compute() from public, anon, authenticated;

create trigger payslips_compute before insert or update on public.payslips
  for each row execute function app.payslip_compute();

create or replace function app.payroll_refresh_totals(p_run uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.payroll_runs r
     set employee_count = s.n,
         total_gross = s.gross,
         total_deductions = s.ded,
         total_net = s.net,
         total_employer_cost = s.gross + s.employer
    from (
      select count(*)::integer as n,
             coalesce(sum(p.gross), 0) as gross,
             coalesce(sum(p.unpaid_leave_deduction + p.social_insurance_employee + p.deductions), 0) as ded,
             coalesce(sum(p.net), 0) as net,
             coalesce(sum(p.social_insurance_employer), 0) as employer
      from public.payslips p where p.run_id = p_run
    ) s
   where r.id = p_run;
$$;
revoke execute on function app.payroll_refresh_totals(uuid) from public, anon, authenticated;

create or replace function app.trg_payslip_totals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- payroll_calculate refreshes once at the end instead of per slip.
  if coalesce(current_setting('app.payroll_calculating', true), '') = 'on' then
    return null;
  end if;
  perform app.payroll_refresh_totals(coalesce(new.run_id, old.run_id));
  return null;
end;
$$;
revoke execute on function app.trg_payslip_totals() from public, anon, authenticated;

create trigger payslips_totals after insert or update or delete on public.payslips
  for each row execute function app.trg_payslip_totals();

-- Build (or rebuild) the payslips of a draft / calculated run. Manual
-- bonus, deductions and the deduction note survive a recalculation;
-- overtime hours are re-read from attendance.
create or replace function public.payroll_calculate(p_run uuid)
returns public.payroll_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.require_module('payroll_hr', 'manager');
  v_run public.payroll_runs;
  v_cfg public.hr_settings;
  v_country text;
  v_dec integer;
  v_period_days integer;
  emp record;
  v_from date;
  v_to date;
  v_paid_days integer;
  v_factor numeric;
  v_basic numeric;
  v_housing numeric;
  v_hourly numeric;
  v_unpaid numeric;
  v_ot numeric;
  v_social_base numeric;
  v_insured boolean;
begin
  select * into v_run from public.payroll_runs r where r.id = p_run and r.tenant_id = v_tenant for update;
  if not found then
    raise exception 'PAYROLL_NOT_FOUND';
  end if;
  if v_run.status not in ('draft', 'calculated') then
    raise exception 'DOC_LOCKED';
  end if;
  v_cfg := app.hr_config(v_tenant);
  select t.country into v_country from public.tenants t where t.id = v_tenant;
  v_dec := coalesce(v_run.currency_decimals, 2);
  v_period_days := v_run.period_end - v_run.period_start + 1;

  perform set_config('app.payroll_calculating', 'on', true);

  -- Employees who no longer qualify drop out of the run.
  delete from public.payslips p
  where p.run_id = p_run
    and not exists (
      select 1 from public.employees x2
      where x2.id = p.employee_id and x2.tenant_id = v_tenant
        and x2.status in ('active', 'on_leave') and x2.basic_salary is not null
        and (x2.hire_date is null or x2.hire_date <= v_run.period_end)
        and (x2.termination_date is null or x2.termination_date >= v_run.period_start));

  for emp in
    select * from public.employees x
    where x.tenant_id = v_tenant
      and x.status in ('active', 'on_leave') and x.basic_salary is not null
      and (x.hire_date is null or x.hire_date <= v_run.period_end)
      and (x.termination_date is null or x.termination_date >= v_run.period_start)
    order by x.first_name, x.last_name
  loop
    v_from := greatest(v_run.period_start, coalesce(emp.hire_date, v_run.period_start));
    v_to := least(v_run.period_end, coalesce(emp.termination_date, v_run.period_end));
    v_paid_days := v_to - v_from + 1;
    v_factor := v_paid_days::numeric / v_period_days;

    v_basic := round(coalesce(emp.basic_salary, 0) * v_factor, v_dec);
    v_housing := round(coalesce(emp.housing_allowance, 0) * v_factor, v_dec);
    v_hourly := coalesce(emp.hourly_rate,
                         round(coalesce(emp.basic_salary, 0) / 30 / v_cfg.standard_daily_hours, 4));

    -- Approved unpaid leave: working days inside the employed part of the period.
    select coalesce(sum(app.hr_workdays(v_cfg.weekend_days,
                                        greatest(r.start_date, v_from), least(r.end_date, v_to))), 0)
      into v_unpaid
    from public.leave_requests r
    join public.leave_types t on t.id = r.leave_type_id
    where r.employee_id = emp.id and r.status = 'approved' and not t.paid
      and r.start_date <= v_to and r.end_date >= v_from;

    select coalesce(sum(greatest(a.hours - v_cfg.standard_daily_hours, 0)), 0) into v_ot
    from public.attendance_records a
    where a.employee_id = emp.id and a.work_date between v_from and v_to
      and a.status in ('present', 'late') and a.hours is not null;

    v_insured := not v_cfg.social_nationals_only
                 or (emp.nationality is not null and upper(emp.nationality) = upper(coalesce(v_country, '')));
    v_social_base := case when v_insured then v_basic + v_housing else 0 end;

    insert into public.payslips as p (
      tenant_id, run_id, run_number, period_start, period_end, pay_date, currency,
      employee_id, employee_name, employee_number, job_title, bank_name, iban,
      paid_days, period_days, basic, housing, transport, other_allowances, hourly_rate,
      overtime_multiplier, overtime_hours, unpaid_leave_days, unpaid_leave_deduction,
      social_insurance_employee, social_insurance_employer
    ) values (
      v_tenant, p_run, v_run.doc_number, v_run.period_start, v_run.period_end, v_run.pay_date, v_run.currency,
      emp.id, btrim(concat_ws(' ', emp.first_name, emp.last_name)), emp.doc_number, emp.job_title,
      emp.bank_name, emp.iban, v_paid_days, v_period_days, v_basic, v_housing,
      round(coalesce(emp.transport_allowance, 0) * v_factor, v_dec),
      round(coalesce(emp.other_allowance, 0) * v_factor, v_dec),
      v_hourly, v_cfg.overtime_multiplier, least(round(v_ot, 2), 400), v_unpaid,
      least(round(coalesce(emp.basic_salary, 0) / 30 * v_unpaid, v_dec), v_basic),
      round(v_social_base * v_cfg.social_employee_pct / 100, v_dec),
      round(v_social_base * v_cfg.social_employer_pct / 100, v_dec)
    )
    on conflict (run_id, employee_id) do update
      set run_number = excluded.run_number,
          period_start = excluded.period_start,
          period_end = excluded.period_end,
          pay_date = excluded.pay_date,
          currency = excluded.currency,
          employee_name = excluded.employee_name,
          employee_number = excluded.employee_number,
          job_title = excluded.job_title,
          bank_name = excluded.bank_name,
          iban = excluded.iban,
          paid_days = excluded.paid_days,
          period_days = excluded.period_days,
          basic = excluded.basic,
          housing = excluded.housing,
          transport = excluded.transport,
          other_allowances = excluded.other_allowances,
          hourly_rate = excluded.hourly_rate,
          overtime_multiplier = excluded.overtime_multiplier,
          overtime_hours = excluded.overtime_hours,
          unpaid_leave_days = excluded.unpaid_leave_days,
          unpaid_leave_deduction = excluded.unpaid_leave_deduction,
          social_insurance_employee = excluded.social_insurance_employee,
          social_insurance_employer = excluded.social_insurance_employer;
  end loop;

  perform set_config('app.payroll_calculating', 'off', true);
  perform app.payroll_refresh_totals(p_run);

  update public.payroll_runs
     set status = 'calculated', calculated_at = now()
   where id = p_run
  returning * into v_run;
  return v_run;
end;
$$;
revoke execute on function public.payroll_calculate(uuid) from public, anon;
grant execute on function public.payroll_calculate(uuid) to authenticated;

create or replace function public.payroll_approve(p_run uuid)
returns public.payroll_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.require_module('payroll_hr', 'manager');
  v_run public.payroll_runs;
begin
  select * into v_run from public.payroll_runs r where r.id = p_run and r.tenant_id = v_tenant for update;
  if not found then
    raise exception 'PAYROLL_NOT_FOUND';
  end if;
  if not exists (select 1 from public.payslips p where p.run_id = p_run) then
    raise exception 'EMPTY_DOCUMENT';
  end if;
  -- The pay date may have been edited after calculation; slips lock next.
  perform set_config('app.payroll_calculating', 'on', true);
  update public.payslips set pay_date = v_run.pay_date
   where run_id = p_run and pay_date is distinct from v_run.pay_date;
  perform set_config('app.payroll_calculating', 'off', true);
  update public.payroll_runs
     set status = 'approved', approved_at = now(), approved_by = auth.uid()
   where id = p_run
  returning * into v_run;
  perform app.emit_event(v_tenant, 'payroll_run.approved', 'payroll_run', v_run.id,
    jsonb_build_object('id', v_run.id, 'doc_number', v_run.doc_number, 'period_start', v_run.period_start,
                       'period_end', v_run.period_end, 'employee_count', v_run.employee_count,
                       'total_net', v_run.total_net, 'currency', v_run.currency));
  return v_run;
end;
$$;
revoke execute on function public.payroll_approve(uuid) from public, anon;
grant execute on function public.payroll_approve(uuid) to authenticated;

create or replace function public.payroll_mark_paid(p_run uuid, p_paid_at date default null)
returns public.payroll_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.require_module('payroll_hr', 'manager');
  v_run public.payroll_runs;
begin
  select * into v_run from public.payroll_runs r where r.id = p_run and r.tenant_id = v_tenant for update;
  if not found then
    raise exception 'PAYROLL_NOT_FOUND';
  end if;
  update public.payroll_runs
     set status = 'paid', paid_at = coalesce(p_paid_at, v_run.pay_date, current_date)
   where id = p_run
  returning * into v_run;
  perform app.emit_event(v_tenant, 'payroll_run.paid', 'payroll_run', v_run.id,
    jsonb_build_object('id', v_run.id, 'doc_number', v_run.doc_number, 'paid_at', v_run.paid_at,
                       'employee_count', v_run.employee_count, 'total_net', v_run.total_net,
                       'currency', v_run.currency));
  return v_run;
end;
$$;
revoke execute on function public.payroll_mark_paid(uuid, date) from public, anon;
grant execute on function public.payroll_mark_paid(uuid, date) to authenticated;

create or replace function public.payroll_cancel(p_run uuid)
returns public.payroll_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.require_module('payroll_hr', 'manager');
  v_run public.payroll_runs;
begin
  select * into v_run from public.payroll_runs r where r.id = p_run and r.tenant_id = v_tenant for update;
  if not found then
    raise exception 'PAYROLL_NOT_FOUND';
  end if;
  update public.payroll_runs set status = 'canceled' where id = p_run returning * into v_run;
  return v_run;
end;
$$;
revoke execute on function public.payroll_cancel(uuid) from public, anon;
grant execute on function public.payroll_cancel(uuid) to authenticated;

-- ============================================================
-- 5) RLS policies, LAST.
-- ============================================================
set local lock_timeout = '1s';

create policy hr_settings_select on public.hr_settings for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.module_enabled('payroll_hr')));

create policy leave_types_select on public.leave_types for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.module_enabled('payroll_hr')));
create policy leave_types_insert on public.leave_types for insert to authenticated
  with check (tenant_id = (select app.tenant_id()) and (select app.is_manager())
              and (select app.module_enabled('payroll_hr')));
create policy leave_types_update on public.leave_types for update to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_manager())
         and (select app.module_enabled('payroll_hr')))
  with check (tenant_id = (select app.tenant_id()) and (select app.is_manager())
              and (select app.module_enabled('payroll_hr')));
create policy leave_types_delete on public.leave_types for delete to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_manager())
         and (select app.module_enabled('payroll_hr')));

-- Managers see everyone's; a member sees their own.
create policy leave_requests_select on public.leave_requests for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.module_enabled('payroll_hr'))
         and ((select app.is_manager()) or employee_id = (select app.my_employee_id())));

create policy attendance_records_select on public.attendance_records for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.module_enabled('payroll_hr'))
         and ((select app.is_manager()) or employee_id = (select app.my_employee_id())));

create policy payroll_runs_select on public.payroll_runs for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.module_enabled('payroll_hr'))
         and (select app.is_manager()));
create policy payroll_runs_insert on public.payroll_runs for insert to authenticated
  with check (tenant_id = (select app.tenant_id()) and (select app.is_manager())
              and (select app.module_enabled('payroll_hr')));
create policy payroll_runs_update on public.payroll_runs for update to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_manager())
         and (select app.module_enabled('payroll_hr')))
  with check (tenant_id = (select app.tenant_id()) and (select app.is_manager())
              and (select app.module_enabled('payroll_hr')));
create policy payroll_runs_delete on public.payroll_runs for delete to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_manager())
         and (select app.module_enabled('payroll_hr')));

-- Managers see every slip; an employee sees their own once the run is approved.
create policy payslips_select on public.payslips for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.module_enabled('payroll_hr'))
         and ((select app.is_manager())
              or (employee_id = (select app.my_employee_id()) and app.payroll_run_released(run_id))));
create policy payslips_update on public.payslips for update to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_manager())
         and (select app.module_enabled('payroll_hr')))
  with check (tenant_id = (select app.tenant_id()) and (select app.is_manager())
              and (select app.module_enabled('payroll_hr')));
