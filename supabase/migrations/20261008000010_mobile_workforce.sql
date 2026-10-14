-- Field workforce (module mobile_workforce).
--
-- 1) field_tasks (TSK numbering): a job for one employee, optionally for a
--    customer and/or vehicle, with an address and coordinates, a schedule,
--    a checklist and, on completion, notes and a signature. Status:
--    assigned -> accepted -> in_progress -> completed; any non-terminal
--    status -> canceled. Managers create and edit tasks (task fields only);
--    every status change and the on-site fields (checklist ticks, notes,
--    signature) go through field_task_transition, which lets the assignee
--    (employees.user_id = auth.uid()) act on their own tasks, whatever their
--    role, and managers act on any.
-- 2) field_checkins: check-in / check-out with optional coordinates and
--    accuracy, written through field_checkin (an employee for themselves, a
--    manager for anyone).
-- 3) Notifications: field.task_assigned (the assignee's app user),
--    field.task_overdue (assignee + managers, from app.scan_due_field).
--    Event: field_task.completed.
--
-- Raised codes: FIELD_TASK_NOT_FOUND, ILLEGAL_FIELD_TASK_TRANSITION,
-- FIELD_INVALID_CHECKLIST, FIELD_INVALID_SIGNATURE, FIELD_INVALID_LOCATION,
-- FIELD_NO_EMPLOYEE_PROFILE, FIELD_EMPLOYEE_NOT_FOUND (+ the existing DOC_LOCKED,
-- FORBIDDEN, CROSS_TENANT_REFERENCE).
-- Additive only. app.my_employee_id() is (re)defined with the same body the
-- payroll_hr migration uses, so either can ship first.

set local lock_timeout = '3s';
set local statement_timeout = '60s';

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
-- 1) Tasks
-- ============================================================
create table public.field_tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  number integer,
  doc_number text,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text check (description is null or char_length(description) <= 4000),
  employee_id uuid not null references public.employees(id) on delete restrict,
  customer_id uuid references public.customers(id) on delete set null,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  address text check (address is null or char_length(address) <= 500),
  lat numeric(9, 6) check (lat between -90 and 90),
  lng numeric(9, 6) check (lng between -180 and 180),
  scheduled_start timestamptz,
  due_at timestamptz,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  status text not null default 'assigned'
    check (status in ('assigned', 'accepted', 'in_progress', 'completed', 'canceled')),
  checklist jsonb not null default '[]'::jsonb check (jsonb_typeof(checklist) = 'array'),
  completion_notes text check (completion_notes is null or char_length(completion_notes) <= 4000),
  -- A PNG data URL from the signature pad; ~200 KB is far above a real one.
  signature_data text check (signature_data is null
    or (signature_data like 'data:image/png;base64,%' and char_length(signature_data) <= 200000)),
  accepted_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  canceled_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((lat is null) = (lng is null))
);
create unique index field_tasks_tenant_number_uk on public.field_tasks (tenant_id, number);
create unique index field_tasks_tenant_doc_number_uk on public.field_tasks (tenant_id, doc_number);
create index field_tasks_tenant_status_idx on public.field_tasks (tenant_id, status, due_at);
create index field_tasks_employee_idx on public.field_tasks (employee_id, status, scheduled_start);
create index field_tasks_customer_idx on public.field_tasks (customer_id);
create index field_tasks_vehicle_idx on public.field_tasks (vehicle_id);
alter table public.field_tasks enable row level security;
revoke all on public.field_tasks from anon;
-- Managers write the task itself; status and on-site fields go through the RPC.
revoke insert, update on public.field_tasks from authenticated;
grant insert (title, description, employee_id, customer_id, vehicle_id, address, lat, lng,
              scheduled_start, due_at, priority, checklist) on public.field_tasks to authenticated;
grant update (title, description, employee_id, customer_id, vehicle_id, address, lat, lng,
              scheduled_start, due_at, priority, checklist) on public.field_tasks to authenticated;

create trigger field_tasks_number
  before insert or update of number, doc_number on public.field_tasks
  for each row execute function app.assign_doc_number('field_task', 'TSK');
create trigger field_tasks_updated_at before update on public.field_tasks
  for each row execute function app.set_updated_at();
create trigger field_tasks_stamp_actor before insert or update on public.field_tasks
  for each row execute function app.stamp_actor();
create trigger field_tasks_audit
  after insert or delete or update of title, description, employee_id, customer_id, vehicle_id, address,
    lat, lng, scheduled_start, due_at, priority, status on public.field_tasks
  for each row execute function app.log_audit();
create trigger field_tasks_same_tenant
  before insert or update of employee_id, customer_id, vehicle_id on public.field_tasks
  for each row execute function app.assert_same_tenant(
    'employee_id', 'employees', 'customer_id', 'customers', 'vehicle_id', 'vehicles');

-- [{label, done}], at most 50 items.
create or replace function app.valid_field_checklist(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p) = 'array'
     and jsonb_array_length(p) <= 50
     and not exists (
       select 1 from jsonb_array_elements(p) i
       where jsonb_typeof(i.value) <> 'object'
          or char_length(btrim(coalesce(i.value ->> 'label', ''))) not between 1 and 200
          or jsonb_typeof(coalesce(i.value -> 'done', 'false'::jsonb)) <> 'boolean'
     );
$$;

create or replace function app.field_task_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not app.valid_field_checklist(new.checklist) then
    raise exception 'FIELD_INVALID_CHECKLIST';
  end if;
  if tg_op = 'INSERT' then
    new.status := 'assigned';
    return new;
  end if;
  if new.status is distinct from old.status then
    if not (
      (old.status = 'assigned'    and new.status in ('accepted', 'canceled')) or
      (old.status = 'accepted'    and new.status in ('in_progress', 'canceled')) or
      (old.status = 'in_progress' and new.status in ('completed', 'canceled'))
    ) then
      raise exception 'ILLEGAL_FIELD_TASK_TRANSITION: % -> %', old.status, new.status;
    end if;
    case new.status
      when 'accepted' then new.accepted_at := now();
      when 'in_progress' then new.started_at := now();
      when 'completed' then new.completed_at := now();
      when 'canceled' then new.canceled_at := now();
      else null;
    end case;
  elsif old.status in ('completed', 'canceled') then
    raise exception 'DOC_LOCKED';
  end if;
  return new;
end;
$$;
revoke execute on function app.field_task_guard() from public, anon, authenticated;

create trigger field_tasks_guard before insert or update on public.field_tasks
  for each row execute function app.field_task_guard();

-- Tell the assignee about a new or re-assigned task (no-op unless the
-- notifications module is on and the employee has an app login).
create or replace function app.trg_field_task_assigned()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  if tg_op = 'UPDATE' and new.employee_id is not distinct from old.employee_id then
    return null;
  end if;
  begin
    select e.user_id into v_user from public.employees e where e.id = new.employee_id;
    if v_user is not null and v_user is distinct from auth.uid() then
      perform app.notify(
        new.tenant_id, null, 'field.task_assigned', 'info', 'field_task', new.id,
        '/field/tasks/' || new.id,
        jsonb_build_object('number', new.doc_number, 'title', new.title, 'due_at', new.due_at,
                           'scheduled_start', new.scheduled_start),
        'New task: ' || new.title, new.doc_number,
        'field.task_assigned:' || new.id || ':' || new.employee_id, v_user);
    end if;
  exception when others then
    null; -- never block the write
  end;
  return null;
end;
$$;
revoke execute on function app.trg_field_task_assigned() from public, anon, authenticated;

create trigger field_tasks_assigned after insert or update of employee_id on public.field_tasks
  for each row execute function app.trg_field_task_assigned();

-- Accept / start / complete / cancel, or (p_to null) save on-site progress.
-- p_payload: {checklist: [{label, done}], completion_notes, signature_data}.
-- The assignee may only tick the existing checklist; managers may replace it.
create or replace function public.field_task_transition(p_task uuid, p_to text, p_payload jsonb default '{}'::jsonb)
returns public.field_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.require_module('mobile_workforce', 'member');
  v_manager boolean := coalesce(app.is_manager(), false);
  v_task public.field_tasks;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_checklist jsonb;
  v_name text;
begin
  select * into v_task from public.field_tasks t where t.id = p_task and t.tenant_id = v_tenant for update;
  if not found or (not v_manager and v_task.employee_id is distinct from app.my_employee_id()) then
    raise exception 'FIELD_TASK_NOT_FOUND';
  end if;
  if p_to is not null and p_to = 'canceled' and not v_manager then
    raise exception 'FORBIDDEN';
  end if;

  v_checklist := v_task.checklist;
  if v_payload ? 'checklist' then
    if not app.valid_field_checklist(v_payload -> 'checklist') then
      raise exception 'FIELD_INVALID_CHECKLIST';
    end if;
    if not v_manager and (
      jsonb_array_length(v_payload -> 'checklist') <> jsonb_array_length(v_task.checklist)
      or exists (
        select 1
        from jsonb_array_elements(v_payload -> 'checklist') with ordinality n(v, i)
        join jsonb_array_elements(v_task.checklist) with ordinality o(v, i) using (i)
        where n.v ->> 'label' is distinct from o.v ->> 'label')
    ) then
      raise exception 'FIELD_INVALID_CHECKLIST';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('label', btrim(x.v ->> 'label'),
                                                 'done', coalesce((x.v ->> 'done')::boolean, false))
                              order by x.i), '[]'::jsonb)
      into v_checklist
    from jsonb_array_elements(v_payload -> 'checklist') with ordinality x(v, i);
  end if;
  if v_payload ? 'signature_data' and nullif(v_payload ->> 'signature_data', '') is not null
     and ((v_payload ->> 'signature_data') not like 'data:image/png;base64,%'
          or char_length(v_payload ->> 'signature_data') > 200000) then
    raise exception 'FIELD_INVALID_SIGNATURE';
  end if;

  update public.field_tasks t
     set status = coalesce(p_to, t.status),
         checklist = v_checklist,
         completion_notes = case when v_payload ? 'completion_notes'
                                 then nullif(btrim(v_payload ->> 'completion_notes'), '')
                                 else t.completion_notes end,
         signature_data = case when v_payload ? 'signature_data'
                               then nullif(v_payload ->> 'signature_data', '')
                               else t.signature_data end
   where t.id = p_task
  returning * into v_task;

  if p_to = 'completed' then
    select btrim(concat_ws(' ', e.first_name, e.last_name)) into v_name
    from public.employees e where e.id = v_task.employee_id;
    perform app.emit_event(v_tenant, 'field_task.completed', 'field_task', v_task.id,
      jsonb_build_object('id', v_task.id, 'doc_number', v_task.doc_number, 'title', v_task.title,
                         'employee_id', v_task.employee_id, 'employee', v_name,
                         'customer_id', v_task.customer_id, 'vehicle_id', v_task.vehicle_id,
                         'priority', v_task.priority, 'completed_at', v_task.completed_at,
                         'signed', v_task.signature_data is not null));
  end if;
  return v_task;
end;
$$;
revoke execute on function public.field_task_transition(uuid, text, jsonb) from public, anon;
grant execute on function public.field_task_transition(uuid, text, jsonb) to authenticated;

-- ============================================================
-- 2) Check-ins
-- ============================================================
create table public.field_checkins (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  task_id uuid references public.field_tasks(id) on delete set null,
  kind text not null check (kind in ('check_in', 'check_out')),
  at timestamptz not null default now(),
  lat numeric(9, 6) check (lat between -90 and 90),
  lng numeric(9, 6) check (lng between -180 and 180),
  accuracy_m numeric(8, 1) check (accuracy_m >= 0),
  note text check (note is null or char_length(note) <= 500),
  created_by uuid,
  check ((lat is null) = (lng is null))
);
create index field_checkins_tenant_at_idx on public.field_checkins (tenant_id, at desc);
create index field_checkins_employee_idx on public.field_checkins (employee_id, at desc);
create index field_checkins_task_idx on public.field_checkins (task_id);
alter table public.field_checkins enable row level security;
revoke all on public.field_checkins from anon;
revoke insert, update, delete, truncate on public.field_checkins from authenticated;

create or replace function public.field_checkin(
  p_kind text,
  p_task uuid default null,
  p_lat numeric default null,
  p_lng numeric default null,
  p_accuracy numeric default null,
  p_note text default null,
  p_employee uuid default null
)
returns public.field_checkins
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.require_module('mobile_workforce', 'member');
  v_me uuid := app.my_employee_id();
  v_employee uuid := coalesce(p_employee, v_me);
  v_row public.field_checkins;
begin
  if v_employee is null then
    raise exception 'FIELD_NO_EMPLOYEE_PROFILE';
  end if;
  if v_employee is distinct from v_me and not coalesce(app.is_manager(), false) then
    raise exception 'FORBIDDEN';
  end if;
  if not exists (select 1 from public.employees e where e.id = v_employee and e.tenant_id = v_tenant) then
    raise exception 'FIELD_EMPLOYEE_NOT_FOUND';
  end if;
  if p_task is not null and not exists (
    select 1 from public.field_tasks t where t.id = p_task and t.tenant_id = v_tenant and t.employee_id = v_employee
  ) then
    raise exception 'FIELD_TASK_NOT_FOUND';
  end if;
  if (p_lat is null) <> (p_lng is null) or p_lat not between -90 and 90 or p_lng not between -180 and 180
     or p_accuracy < 0 then
    raise exception 'FIELD_INVALID_LOCATION';
  end if;
  if p_kind not in ('check_in', 'check_out') then
    raise exception 'FIELD_INVALID_LOCATION';
  end if;
  insert into public.field_checkins (tenant_id, employee_id, task_id, kind, lat, lng, accuracy_m, note, created_by)
  values (v_tenant, v_employee, p_task, p_kind, round(p_lat, 6), round(p_lng, 6),
          round(least(p_accuracy, 9999999), 1), nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  returning * into v_row;
  return v_row;
end;
$$;
revoke execute on function public.field_checkin(text, uuid, numeric, numeric, numeric, text, uuid) from public, anon;
grant execute on function public.field_checkin(text, uuid, numeric, numeric, numeric, text, uuid) to authenticated;

-- ============================================================
-- 3) Overdue scanner (run by refresh_notifications)
-- ============================================================
create or replace function app.scan_due_field(p_tenant uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total integer := 0;
  r record;
begin
  if p_tenant is null or not app.tenant_module_enabled(p_tenant, 'mobile_workforce') then
    return 0;
  end if;
  for r in
    select t.id, t.doc_number, t.title, t.due_at, e.user_id,
           btrim(concat_ws(' ', e.first_name, e.last_name)) as employee
    from public.field_tasks t
    join public.employees e on e.id = t.employee_id
    where t.tenant_id = p_tenant
      and t.status in ('assigned', 'accepted', 'in_progress')
      and t.due_at is not null and t.due_at < now()
    order by t.due_at
    limit 500
  loop
    v_total := v_total + coalesce(app.notify(
      p_tenant, 'managers', 'field.task_overdue', 'warning', 'field_task', r.id, '/field/tasks/' || r.id,
      jsonb_build_object('number', r.doc_number, 'title', r.title, 'employee', r.employee, 'due_at', r.due_at),
      'Overdue: ' || r.title, r.employee, 'field.task_overdue:' || r.id), 0);
    if r.user_id is not null then
      v_total := v_total + coalesce(app.notify(
        p_tenant, null, 'field.task_overdue', 'warning', 'field_task', r.id, '/field/tasks/' || r.id,
        jsonb_build_object('number', r.doc_number, 'title', r.title, 'employee', r.employee, 'due_at', r.due_at),
        'Overdue: ' || r.title, r.employee, 'field.task_overdue:' || r.id, r.user_id), 0);
    end if;
  end loop;
  return v_total;
end;
$$;
revoke execute on function app.scan_due_field(uuid) from public, anon, authenticated;

-- ============================================================
-- 4) RLS policies, LAST.
-- ============================================================
set local lock_timeout = '1s';

-- Managers see every task; a member sees the tasks assigned to them.
create policy field_tasks_select on public.field_tasks for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.module_enabled('mobile_workforce'))
         and ((select app.is_manager()) or employee_id = (select app.my_employee_id())));
create policy field_tasks_insert on public.field_tasks for insert to authenticated
  with check (tenant_id = (select app.tenant_id()) and (select app.is_manager())
              and (select app.module_enabled('mobile_workforce')));
create policy field_tasks_update on public.field_tasks for update to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_manager())
         and (select app.module_enabled('mobile_workforce')))
  with check (tenant_id = (select app.tenant_id()) and (select app.is_manager())
              and (select app.module_enabled('mobile_workforce')));
create policy field_tasks_delete on public.field_tasks for delete to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_manager())
         and (select app.module_enabled('mobile_workforce')));

create policy field_checkins_select on public.field_checkins for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.module_enabled('mobile_workforce'))
         and ((select app.is_manager()) or employee_id = (select app.my_employee_id())));
