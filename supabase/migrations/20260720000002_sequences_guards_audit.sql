-- Wave 2 of the platform refactor (docs/ARCHITECTURE_REVIEW.md §11):
-- 1) unified race-free per-tenant document numbering (document_sequences),
-- 2) atomic certificate issuance RPC with a DB-enforced job gate,
-- 3) DB-enforced job state machine with server-side stamps,
-- 4) delete guards protecting issued documents (certificates, completed work),
-- 5) audit substrate: created_by/updated_by everywhere + append-only audit_events.

-- ============================================================
-- 1) document_sequences — one counter per (tenant, doc type).
--    Replaces the race-prone max()+1 triggers (work orders, jobs) and
--    generalizes the sl_settings certificate counter.
-- ============================================================
create table public.document_sequences (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  doc_type text not null check (doc_type in ('work_order', 'sl_job', 'sl_certificate')),
  next_number integer not null default 1,
  primary key (tenant_id, doc_type)
);
alter table public.document_sequences enable row level security;
create policy document_sequences_select on public.document_sequences
  for select to authenticated using (tenant_id = (select app.tenant_id()));
-- No client write policies: allocation happens in SECURITY DEFINER helpers only.

-- Atomic allocator. Single upsert statement: first use seeds the row at 2 and
-- allocates 1; later uses increment and allocate — no read-then-write race
-- (same pattern that fixed the SLC-00001 double-issue bug in sl_fixes).
create or replace function app.next_doc_number(p_tenant uuid, p_doc_type text)
returns integer
language sql
security definer
set search_path = ''
as $$
  insert into public.document_sequences as ds (tenant_id, doc_type, next_number)
  values (p_tenant, p_doc_type, 2)
  on conflict (tenant_id, doc_type)
  do update set next_number = ds.next_number + 1
  returning ds.next_number - 1;
$$;
revoke execute on function app.next_doc_number(uuid, text) from public, anon, authenticated;

-- Seed counters for existing tenants so allocations continue their sequences.
insert into public.document_sequences (tenant_id, doc_type, next_number)
select tenant_id, 'work_order', coalesce(max(number), 0) + 1
from public.work_orders group by tenant_id
on conflict (tenant_id, doc_type) do nothing;

insert into public.document_sequences (tenant_id, doc_type, next_number)
select tenant_id, 'sl_job', coalesce(max(number), 0) + 1
from public.sl_jobs group by tenant_id
on conflict (tenant_id, doc_type) do nothing;

insert into public.document_sequences (tenant_id, doc_type, next_number)
select tenant_id, 'sl_certificate', cert_next_number
from public.sl_settings
on conflict (tenant_id, doc_type) do nothing;

-- Rewire the numbering triggers onto the allocator (names/bindings unchanged).
create or replace function app.next_work_order_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.number is null then
    new.number := app.next_doc_number(new.tenant_id, 'work_order');
  end if;
  return new;
end;
$$;

create or replace function app.next_sl_job_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.number is null then
    new.number := app.next_doc_number(new.tenant_id, 'sl_job');
  end if;
  return new;
end;
$$;

-- Certificate numbering moves onto the shared allocator. The legacy RPC stays
-- as a thin wrapper for one release (the previously deployed bundle calls it);
-- sl_settings keeps cert_prefix/cert_validity_months (policy, not state).
create or replace function public.next_certificate_number()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := (select app.tenant_id());
  v_prefix text;
  v_n integer;
begin
  if v_tenant is null then
    raise exception 'NO_TENANT';
  end if;
  -- DEFINER function: re-assert the role gate RLS would otherwise provide,
  -- so viewers cannot burn certificate numbers via a direct RPC call.
  if not (select app.is_manager()) then
    raise exception 'FORBIDDEN';
  end if;
  select cert_prefix into v_prefix from public.sl_settings where tenant_id = v_tenant;
  if v_prefix is null then
    insert into public.sl_settings (tenant_id) values (v_tenant)
    on conflict (tenant_id) do nothing;
    select cert_prefix into v_prefix from public.sl_settings where tenant_id = v_tenant;
  end if;
  v_n := app.next_doc_number(v_tenant, 'sl_certificate');
  return v_prefix || '-' || lpad(v_n::text, 5, '0');
end;
$$;
revoke execute on function public.next_certificate_number() from public, anon;

-- ============================================================
-- 2) issue_certificate — atomic issuance: validates the job gate, resolves
--    the job's installation, allocates the number, and inserts, all in one
--    transaction. Closes the reserve-then-insert number leak and the
--    "any manager can insert any certificate" hole. SECURITY INVOKER: the
--    insert still passes the caller's RLS (manager write policy).
-- ============================================================
create or replace function public.issue_certificate(
  p_job_id uuid,
  p_issuing_authority text default null,
  p_expires_at date default null,
  p_notes text default null
)
returns public.speed_limiter_certificates
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_job public.sl_jobs%rowtype;
  v_installation_id uuid;
  v_number text;
  v_validity integer;
  v_expires date;
  v_cert public.speed_limiter_certificates%rowtype;
begin
  select * into v_job from public.sl_jobs where id = p_job_id for update;
  if not found then
    raise exception 'JOB_NOT_FOUND';
  end if;
  -- Same gate the UI enforces today: certifiable job types, post-completion.
  if v_job.status not in ('completed', 'qc_approved')
     or v_job.job_type not in ('installation', 'replacement', 'inspection') then
    raise exception 'JOB_NOT_CERTIFIABLE';
  end if;

  select id into v_installation_id
  from public.speed_limiter_installations
  where job_id = p_job_id
  limit 1;

  v_number := public.next_certificate_number();

  if p_expires_at is not null then
    v_expires := p_expires_at;
  else
    select cert_validity_months into v_validity
    from public.sl_settings where tenant_id = v_job.tenant_id;
    v_expires := current_date + make_interval(months => coalesce(v_validity, 12));
  end if;

  insert into public.speed_limiter_certificates
    (installation_id, vehicle_id, customer_id, job_id, device_id, set_speed_kmh,
     certificate_number, issuing_authority, issued_at, expires_at, notes)
  values
    (v_installation_id, v_job.vehicle_id, v_job.customer_id, v_job.id, v_job.device_id,
     v_job.set_speed_kmh, v_number, p_issuing_authority, current_date, v_expires, p_notes)
  returning * into v_cert;

  return v_cert;
end;
$$;
revoke execute on function public.issue_certificate(uuid, text, date, text) from public, anon;

-- ============================================================
-- 3) Job state machine — legal transitions only, with server-side stamps.
--    Matches the UI's current semantics; field edits (same status) pass.
-- ============================================================
create or replace function app.enforce_job_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = old.status then
    return new;
  end if;
  if not (
    (old.status = 'scheduled'   and new.status in ('in_progress', 'canceled')) or
    (old.status = 'in_progress' and new.status in ('completed', 'canceled')) or
    (old.status = 'completed'   and new.status = 'qc_approved') or
    (old.status = 'qc_approved' and new.status = 'closed')
  ) then
    raise exception 'ILLEGAL_JOB_TRANSITION: % -> %', old.status, new.status;
  end if;
  if new.status = 'in_progress' then
    new.started_at := coalesce(new.started_at, now());
  elsif new.status = 'completed' then
    new.completed_at := coalesce(new.completed_at, now());
  elsif new.status = 'qc_approved' then
    new.qc_at := now();
    new.qc_by := coalesce(auth.uid(), new.qc_by);
  end if;
  return new;
end;
$$;

create trigger sl_jobs_transition
  before update of status on public.sl_jobs
  for each row execute function app.enforce_job_transition();

-- ============================================================
-- 4) Delete guards — issued documents outlive their entities. Retire, don't
--    delete. (Conditional protection needs triggers; FK RESTRICT would also
--    block deleting vehicles with only scheduled/canceled work.)
-- ============================================================
create or replace function app.guard_vehicle_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.speed_limiter_certificates c where c.vehicle_id = old.id) then
    raise exception 'VEHICLE_HAS_CERTIFICATES';
  end if;
  if exists (
    select 1 from public.sl_jobs j
    where j.vehicle_id = old.id and j.status in ('completed', 'qc_approved', 'closed')
  ) then
    raise exception 'VEHICLE_HAS_COMPLETED_JOBS';
  end if;
  if exists (
    select 1 from public.work_orders w
    where w.vehicle_id = old.id and w.status = 'completed'
  ) then
    raise exception 'VEHICLE_HAS_COMPLETED_WORK_ORDERS';
  end if;
  return old;
end;
$$;

create trigger vehicles_guard_delete
  before delete on public.vehicles
  for each row execute function app.guard_vehicle_delete();

create or replace function app.guard_customer_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.speed_limiter_certificates c where c.customer_id = old.id) then
    raise exception 'CUSTOMER_HAS_CERTIFICATES';
  end if;
  if exists (
    select 1 from public.sl_jobs j
    where j.customer_id = old.id and j.status in ('completed', 'qc_approved', 'closed')
  ) then
    raise exception 'CUSTOMER_HAS_COMPLETED_JOBS';
  end if;
  return old;
end;
$$;

create trigger customers_guard_delete
  before delete on public.customers
  for each row execute function app.guard_customer_delete();

-- ============================================================
-- 5) Audit substrate.
--    a) created_by/updated_by on every tenant business table (plain uuid,
--       no FK: actor ids are informational and must survive user deletion).
--    b) append-only audit_events with a SECURITY DEFINER writer trigger on
--       master-data and document tables (high-volume logs excluded for now).
-- ============================================================
create or replace function app.stamp_actor()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
  end if;
  new.updated_by := auth.uid();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'customers', 'contacts', 'vehicles', 'drivers', 'vehicle_assignments',
    'service_reminders', 'work_orders', 'work_order_lines', 'fuel_logs',
    'inspection_templates', 'inspections', 'issues', 'renewals',
    'sl_devices', 'sl_technicians', 'sl_jobs',
    'speed_limiter_installations', 'speed_limiter_certificates'
  ] loop
    execute format('alter table public.%I add column if not exists created_by uuid', t);
    execute format('alter table public.%I add column if not exists updated_by uuid', t);
    execute format(
      'create trigger %I_stamp_actor before insert or update on public.%I
         for each row execute function app.stamp_actor()', t, t);
  end loop;
end;
$$;

create table public.audit_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  table_name text not null,
  row_id uuid,
  action text not null check (action in ('insert', 'update', 'delete')),
  actor uuid,
  at timestamptz not null default now(),
  diff jsonb
);
create index audit_events_tenant_at_idx on public.audit_events (tenant_id, at desc);
create index audit_events_row_idx on public.audit_events (table_name, row_id);
alter table public.audit_events enable row level security;
create policy audit_events_select on public.audit_events
  for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_admin()));
-- Writes happen only through the SECURITY DEFINER trigger below.

create or replace function app.log_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_diff jsonb;
  v_row_id uuid;
  v_tenant uuid;
begin
  if tg_op = 'INSERT' then
    v_diff := to_jsonb(new);
    v_row_id := new.id;
    v_tenant := new.tenant_id;
  elsif tg_op = 'DELETE' then
    v_diff := to_jsonb(old);
    v_row_id := old.id;
    v_tenant := old.tenant_id;
  else
    select jsonb_object_agg(n.key, jsonb_build_object('old', o.value, 'new', n.value))
      into v_diff
    from jsonb_each(to_jsonb(old)) o
    join jsonb_each(to_jsonb(new)) n using (key)
    where o.value is distinct from n.value;
    if v_diff is null then
      return null; -- no-op update, don't log
    end if;
    v_row_id := new.id;
    v_tenant := new.tenant_id;
  end if;
  insert into public.audit_events (tenant_id, table_name, row_id, action, actor, diff)
  values (v_tenant, tg_table_name, v_row_id, lower(tg_op), auth.uid(), v_diff);
  return null;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'customers', 'contacts', 'vehicles', 'drivers',
    'sl_devices', 'sl_technicians', 'sl_jobs',
    'speed_limiter_installations', 'speed_limiter_certificates',
    'work_orders', 'renewals'
  ] loop
    execute format(
      'create trigger %I_audit after insert or update or delete on public.%I
         for each row execute function app.log_audit()', t, t);
  end loop;
end;
$$;
