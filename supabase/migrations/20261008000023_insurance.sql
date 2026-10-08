-- Insurance (module insurance_mgmt): policies, the vehicles they cover, and
-- claims against them.
--
-- 1) insurance_policies: insurer from Suppliers or a free-text name, type,
--    coverage, premium (+ frequency), deductible, term. The status is derived
--    (shared/insurance.ts policyStatus: upcoming | active | expiring |
--    expired | canceled); only canceled_at is stored. Canceling is setting
--    canceled_at (not in the future, not before the start); clearing it
--    reinstates. Currency is the tenant's, snapshotted on insert.
-- 2) insurance_policy_vehicles: which vehicles a policy covers and when
--    (added_on / removed_on). One open row per policy + vehicle; a canceled
--    policy takes no new vehicles (POLICY_CANCELED).
-- 3) insurance_claims: numbered CLM-00001 (doc type 'insurance_claim').
--    status draft → submitted → under_review → approved | rejected;
--    approved → settled; draft | submitted → withdrawn. app.claim_guard
--    enforces it (ILLEGAL_CLAIM_TRANSITION) and stamps each step. The loss
--    must fall inside the policy term and before any cancellation
--    (CLAIM_OUTSIDE_POLICY); when the policy lists vehicles, the claim's
--    vehicle must be on it at the loss date (CLAIM_VEHICLE_NOT_COVERED).
--    Approving needs amount_approved (CLAIM_AMOUNT_REQUIRED); settling
--    defaults amount_paid to the approved amount. Settled, rejected and
--    withdrawn claims are locked except notes (CLAIM_LOCKED); only drafts can
--    be deleted (CLAIM_NOT_DELETABLE). incident_id is a plain uuid here: the
--    Incidents module adds its foreign key.
-- 4) public.insurance_renew_policy(policy) copies a policy into the next term
--    (same length, starting the day after it ends) with its current vehicles.
--    public.insurance_uninsured_vehicles() lists company vehicles in service
--    with no active policy covering them today.
-- 5) Scanner app.scan_due_insurance: policies ending in 60 / 30 / 7 / 0 days
--    or lapsed in the last 30 days → managers (insurance.policy_expiring),
--    skipped once a later policy of the same type and insurer covers the
--    vehicles' next term (a renewal).
-- 6) Automation event insurance_claim.status_changed.
--
-- Raised codes: POLICY_CANCELED, INVALID_POLICY_CANCEL, POLICY_NOT_FOUND,
-- ILLEGAL_CLAIM_TRANSITION, CLAIM_OUTSIDE_POLICY, CLAIM_VEHICLE_NOT_COVERED,
-- CLAIM_AMOUNT_REQUIRED, CLAIM_LOCKED, CLAIM_NOT_DELETABLE
-- (+ MODULE_DISABLED, CROSS_TENANT_REFERENCE, FORBIDDEN). Additive only.

set local lock_timeout = '3s';
set local statement_timeout = '60s';

-- ============================================================
-- Tables
-- ============================================================
create table public.insurance_policies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  policy_number text not null check (char_length(btrim(policy_number)) between 1 and 100),
  insurer_supplier_id uuid references public.suppliers(id) on delete set null,
  insurer_name text check (insurer_name is null or char_length(insurer_name) <= 200),
  policy_type text not null default 'comprehensive'
    check (policy_type in ('comprehensive', 'third_party', 'third_party_fire_theft', 'cargo', 'liability',
                           'workers_comp', 'other')),
  coverage_amount numeric(16,3) check (coverage_amount is null or coverage_amount >= 0),
  premium numeric(14,3) not null default 0 check (premium >= 0),
  premium_frequency text not null default 'annual'
    check (premium_frequency in ('annual', 'semi_annual', 'quarterly', 'monthly')),
  deductible numeric(14,3) check (deductible is null or deductible >= 0),
  currency text not null default 'USD',
  start_date date not null,
  end_date date not null,
  auto_renew boolean not null default false,
  broker text check (broker is null or char_length(broker) <= 200),
  canceled_at date,
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 1000),
  notes text check (notes is null or char_length(notes) <= 4000),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint insurance_policies_term_ck check (end_date >= start_date and end_date <= start_date + 3660),
  constraint insurance_policies_insurer_ck check (insurer_supplier_id is not null or nullif(btrim(insurer_name), '') is not null)
);
create index insurance_policies_tenant_end_idx on public.insurance_policies (tenant_id, end_date);
create index insurance_policies_tenant_number_idx on public.insurance_policies (tenant_id, lower(policy_number));
create index insurance_policies_supplier_idx on public.insurance_policies (insurer_supplier_id)
  where insurer_supplier_id is not null;

create table public.insurance_policy_vehicles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  policy_id uuid not null references public.insurance_policies(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  added_on date not null default current_date,
  removed_on date,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint insurance_policy_vehicles_dates_ck check (removed_on is null or removed_on >= added_on)
);
create unique index insurance_policy_vehicles_open_uk on public.insurance_policy_vehicles (policy_id, vehicle_id)
  where removed_on is null;
create index insurance_policy_vehicles_vehicle_idx on public.insurance_policy_vehicles (vehicle_id);
create index insurance_policy_vehicles_tenant_idx on public.insurance_policy_vehicles (tenant_id);

create table public.insurance_claims (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  number integer,
  doc_number text,
  policy_id uuid not null references public.insurance_policies(id),
  vehicle_id uuid references public.vehicles(id) on delete set null,
  incident_id uuid,
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'under_review', 'approved', 'rejected', 'settled', 'withdrawn')),
  claim_date date not null default current_date,
  loss_date date not null,
  description text not null check (char_length(btrim(description)) between 1 and 4000),
  amount_claimed numeric(14,3) not null default 0 check (amount_claimed >= 0),
  amount_approved numeric(14,3) check (amount_approved is null or amount_approved >= 0),
  amount_paid numeric(14,3) check (amount_paid is null or amount_paid >= 0),
  deductible_applied numeric(14,3) check (deductible_applied is null or deductible_applied >= 0),
  currency text not null default 'USD',
  insurer_reference text check (insurer_reference is null or char_length(insurer_reference) <= 100),
  adjuster_name text check (adjuster_name is null or char_length(adjuster_name) <= 200),
  adjuster_phone text check (adjuster_phone is null or char_length(adjuster_phone) <= 50),
  submitted_at timestamptz,
  decided_at timestamptz,
  settled_at date,
  withdrawn_at timestamptz,
  rejection_reason text check (rejection_reason is null or char_length(rejection_reason) <= 1000),
  notes text check (notes is null or char_length(notes) <= 4000),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint insurance_claims_dates_ck check (loss_date <= claim_date)
);
create unique index insurance_claims_tenant_number_uk on public.insurance_claims (tenant_id, number);
create unique index insurance_claims_tenant_doc_number_uk on public.insurance_claims (tenant_id, doc_number);
create index insurance_claims_tenant_status_idx on public.insurance_claims (tenant_id, status, claim_date desc);
create index insurance_claims_policy_idx on public.insurance_claims (policy_id);
create index insurance_claims_vehicle_idx on public.insurance_claims (vehicle_id) where vehicle_id is not null;
create index insurance_claims_incident_idx on public.insurance_claims (incident_id) where incident_id is not null;
create index insurance_claims_tenant_settled_idx on public.insurance_claims (tenant_id, settled_at)
  where settled_at is not null;

alter table public.insurance_policies enable row level security;
alter table public.insurance_policy_vehicles enable row level security;
alter table public.insurance_claims enable row level security;
revoke all on public.insurance_policies from anon;
revoke all on public.insurance_policy_vehicles from anon;
revoke all on public.insurance_claims from anon;
-- Currency, numbers and stamps are server-side.
revoke insert, update on public.insurance_policies from authenticated;
grant insert (policy_number, insurer_supplier_id, insurer_name, policy_type, coverage_amount, premium,
              premium_frequency, deductible, start_date, end_date, auto_renew, broker, notes)
  on public.insurance_policies to authenticated;
grant update (policy_number, insurer_supplier_id, insurer_name, policy_type, coverage_amount, premium,
              premium_frequency, deductible, start_date, end_date, auto_renew, broker, notes, canceled_at,
              cancel_reason)
  on public.insurance_policies to authenticated;
revoke insert, update on public.insurance_policy_vehicles from authenticated;
grant insert (policy_id, vehicle_id, added_on, removed_on) on public.insurance_policy_vehicles to authenticated;
grant update (added_on, removed_on) on public.insurance_policy_vehicles to authenticated;
revoke insert, update on public.insurance_claims from authenticated;
grant insert (policy_id, vehicle_id, incident_id, claim_date, loss_date, description, amount_claimed,
              deductible_applied, insurer_reference, adjuster_name, adjuster_phone, notes)
  on public.insurance_claims to authenticated;
grant update (policy_id, vehicle_id, incident_id, claim_date, loss_date, description, amount_claimed,
              amount_approved, amount_paid, deductible_applied, insurer_reference, adjuster_name, adjuster_phone,
              status, settled_at, rejection_reason, notes)
  on public.insurance_claims to authenticated;

-- ============================================================
-- Policies
-- ============================================================
create or replace function app.insurance_policy_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client boolean := coalesce(nullif(current_setting('role', true), ''), 'none') in ('authenticated', 'anon')
                      and pg_trigger_depth() <= 1;
begin
  new.insurer_name := nullif(btrim(new.insurer_name), '');
  new.policy_number := btrim(new.policy_number);
  if new.canceled_at is null then
    new.cancel_reason := null;
  elsif v_client and (tg_op = 'INSERT' or new.canceled_at is distinct from old.canceled_at)
        and (new.canceled_at > current_date or new.canceled_at < new.start_date) then
    raise exception 'INVALID_POLICY_CANCEL';
  end if;

  if tg_op = 'INSERT' then
    if v_client then
      new.canceled_at := null;
      new.cancel_reason := null;
    end if;
    select t.currency into new.currency from public.tenants t where t.id = new.tenant_id;
    new.currency := coalesce(new.currency, 'USD');
    return new;
  end if;

  if v_client and new.currency is distinct from old.currency then
    raise exception 'FORBIDDEN';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function app.insurance_policy_guard() from public, anon, authenticated;
create trigger insurance_policies_guard before insert or update on public.insurance_policies
  for each row execute function app.insurance_policy_guard();
create trigger insurance_policies_stamp_actor before insert or update on public.insurance_policies
  for each row execute function app.stamp_actor();
create trigger insurance_policies_same_tenant
  before insert or update of insurer_supplier_id on public.insurance_policies
  for each row execute function app.assert_same_tenant('insurer_supplier_id', 'suppliers');
create trigger insurance_policies_audit after insert or update or delete on public.insurance_policies
  for each row execute function app.log_audit();

create or replace function app.insurance_policy_vehicle_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if exists (select 1 from public.insurance_policies p where p.id = new.policy_id and p.canceled_at is not null) then
      raise exception 'POLICY_CANCELED';
    end if;
  else
    new.updated_at := now();
  end if;
  return new;
end;
$$;
revoke execute on function app.insurance_policy_vehicle_guard() from public, anon, authenticated;
create trigger insurance_policy_vehicles_guard before insert or update on public.insurance_policy_vehicles
  for each row execute function app.insurance_policy_vehicle_guard();
create trigger insurance_policy_vehicles_stamp_actor before insert or update on public.insurance_policy_vehicles
  for each row execute function app.stamp_actor();
create trigger insurance_policy_vehicles_same_tenant before insert on public.insurance_policy_vehicles
  for each row execute function app.assert_same_tenant('policy_id', 'insurance_policies', 'vehicle_id', 'vehicles');
create trigger insurance_policy_vehicles_audit after insert or update or delete on public.insurance_policy_vehicles
  for each row execute function app.log_audit();

-- ============================================================
-- Claims
-- ============================================================
create or replace function app.claim_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client boolean := coalesce(nullif(current_setting('role', true), ''), 'none') in ('authenticated', 'anon')
                      and pg_trigger_depth() <= 1;
  v_p public.insurance_policies%rowtype;
  v_ok boolean;
begin
  if tg_op = 'DELETE' then
    if v_client and old.status <> 'draft' then
      raise exception 'CLAIM_NOT_DELETABLE';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if v_client then
      new.status := 'draft';
      new.amount_approved := null;
      new.amount_paid := null;
      new.submitted_at := null;
      new.decided_at := null;
      new.settled_at := null;
      new.withdrawn_at := null;
      new.rejection_reason := null;
    end if;
  else
    if v_client and new.currency is distinct from old.currency then
      raise exception 'FORBIDDEN';
    end if;
    -- Closed claims: only notes may change.
    if v_client and old.status in ('settled', 'rejected', 'withdrawn')
       and (to_jsonb(new) - array['notes', 'updated_at', 'updated_by'])
           is distinct from (to_jsonb(old) - array['notes', 'updated_at', 'updated_by']) then
      raise exception 'CLAIM_LOCKED';
    end if;
    if new.status is distinct from old.status then
      if not ((old.status = 'draft' and new.status in ('submitted', 'withdrawn'))
              or (old.status = 'submitted' and new.status in ('under_review', 'withdrawn'))
              or (old.status = 'under_review' and new.status in ('approved', 'rejected'))
              or (old.status = 'approved' and new.status = 'settled')) then
        raise exception 'ILLEGAL_CLAIM_TRANSITION';
      end if;
      case new.status
        when 'submitted' then new.submitted_at := now();
        when 'approved' then
          if new.amount_approved is null then
            raise exception 'CLAIM_AMOUNT_REQUIRED';
          end if;
          new.decided_at := now();
        when 'rejected' then new.decided_at := now();
        when 'settled' then
          new.amount_paid := coalesce(new.amount_paid, new.amount_approved);
          new.settled_at := least(coalesce(new.settled_at, current_date), current_date);
        when 'withdrawn' then new.withdrawn_at := now();
        else null;
      end case;
    end if;
  end if;

  if new.status <> 'rejected' then
    new.rejection_reason := null;
  end if;
  if new.status <> 'settled' then
    new.settled_at := null;
    if new.status <> 'approved' then
      new.amount_paid := null;
    end if;
  end if;
  if v_client and new.status in ('draft', 'submitted', 'withdrawn', 'rejected') then
    new.amount_approved := null;
  end if;

  -- The loss must fall inside the policy's cover.
  if tg_op = 'INSERT' or new.policy_id is distinct from old.policy_id or new.loss_date is distinct from old.loss_date
     or new.vehicle_id is distinct from old.vehicle_id then
    select * into v_p from public.insurance_policies p where p.id = new.policy_id;
    if not found then
      raise exception 'POLICY_NOT_FOUND';
    end if;
    if new.loss_date < v_p.start_date or new.loss_date > v_p.end_date
       or (v_p.canceled_at is not null and new.loss_date > v_p.canceled_at) then
      raise exception 'CLAIM_OUTSIDE_POLICY';
    end if;
    if new.vehicle_id is not null
       and exists (select 1 from public.insurance_policy_vehicles pv where pv.policy_id = new.policy_id) then
      select exists (select 1 from public.insurance_policy_vehicles pv
                     where pv.policy_id = new.policy_id and pv.vehicle_id = new.vehicle_id
                       and pv.added_on <= new.loss_date and (pv.removed_on is null or pv.removed_on >= new.loss_date))
        into v_ok;
      if not v_ok then
        raise exception 'CLAIM_VEHICLE_NOT_COVERED';
      end if;
    end if;
    new.currency := v_p.currency;
  end if;

  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;
revoke execute on function app.claim_guard() from public, anon, authenticated;

create or replace function app.claim_after()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is not distinct from old.status then
    return null;
  end if;
  perform app.emit_event(new.tenant_id, 'insurance_claim.status_changed', 'insurance_claim', new.id,
    jsonb_build_object('claim_id', new.id, 'doc_number', new.doc_number, 'policy_id', new.policy_id,
      'vehicle_id', new.vehicle_id, 'from_status', old.status, 'to_status', new.status,
      'amount_claimed', new.amount_claimed, 'amount_approved', new.amount_approved, 'amount_paid', new.amount_paid),
    'insurance_claim.status_changed:' || new.id || ':' || new.status || ':'
      || (extract(epoch from clock_timestamp()) * 1000000)::bigint);
  return null;
end;
$$;
revoke execute on function app.claim_after() from public, anon, authenticated;

create trigger insurance_claims_number
  before insert or update of number, doc_number on public.insurance_claims
  for each row execute function app.assign_doc_number('insurance_claim', 'CLM');
create trigger insurance_claims_guard before insert or update or delete on public.insurance_claims
  for each row execute function app.claim_guard();
create trigger insurance_claims_stamp_actor before insert or update on public.insurance_claims
  for each row execute function app.stamp_actor();
create trigger insurance_claims_same_tenant
  before insert or update of policy_id, vehicle_id on public.insurance_claims
  for each row execute function app.assert_same_tenant('policy_id', 'insurance_policies', 'vehicle_id', 'vehicles');
create trigger insurance_claims_after after update of status on public.insurance_claims
  for each row execute function app.claim_after();
create trigger insurance_claims_audit after insert or update or delete on public.insurance_claims
  for each row execute function app.log_audit();

-- ============================================================
-- RPCs
-- ============================================================
-- Next term of a policy: same length, starting the day after it ends, with
-- the vehicles still on it. Runs as the caller, so RLS and grants apply.
create or replace function public.insurance_renew_policy(p_policy_id uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_tenant uuid := app.require_module('insurance_mgmt', 'manager');
  v_p public.insurance_policies%rowtype;
  v_start date;
  v_new uuid;
begin
  select * into v_p from public.insurance_policies p where p.id = p_policy_id and p.tenant_id = v_tenant;
  if not found then
    raise exception 'POLICY_NOT_FOUND';
  end if;
  if v_p.canceled_at is not null then
    raise exception 'POLICY_CANCELED';
  end if;
  v_start := v_p.end_date + 1;
  insert into public.insurance_policies (policy_number, insurer_supplier_id, insurer_name, policy_type,
    coverage_amount, premium, premium_frequency, deductible, start_date, end_date, auto_renew, broker)
  values (v_p.policy_number, v_p.insurer_supplier_id, v_p.insurer_name, v_p.policy_type, v_p.coverage_amount,
    v_p.premium, v_p.premium_frequency, v_p.deductible, v_start, v_start + (v_p.end_date - v_p.start_date),
    v_p.auto_renew, v_p.broker)
  returning id into v_new;
  insert into public.insurance_policy_vehicles (policy_id, vehicle_id, added_on)
  select v_new, pv.vehicle_id, v_start
  from public.insurance_policy_vehicles pv
  where pv.policy_id = p_policy_id and (pv.removed_on is null or pv.removed_on >= v_p.end_date);
  return v_new;
end;
$$;
revoke execute on function public.insurance_renew_policy(uuid) from public, anon;
grant execute on function public.insurance_renew_policy(uuid) to authenticated;

-- Company vehicles in service with no active policy covering them on p_on
-- (the tenant's today by default). Runs as the caller (RLS applies).
create or replace function public.insurance_uninsured_vehicles(p_on date default null)
returns table (id uuid, name text, license_plate text, status text)
language sql
stable
set search_path = ''
as $$
  with d as (
    select coalesce(p_on, (now() at time zone coalesce(t.timezone, 'UTC'))::date) as on_date
    from public.tenants t where t.id = app.tenant_id()
  )
  select v.id, v.name, v.license_plate, v.status
  from public.vehicles v, d
  where v.tenant_id = app.tenant_id()
    and v.status <> 'retired'
    and v.ownership = 'company'
    and not exists (
      select 1
      from public.insurance_policy_vehicles pv
      join public.insurance_policies p on p.id = pv.policy_id
      where pv.vehicle_id = v.id
        and pv.added_on <= d.on_date and (pv.removed_on is null or pv.removed_on >= d.on_date)
        and p.start_date <= d.on_date and p.end_date >= d.on_date
        and (p.canceled_at is null or p.canceled_at > d.on_date)
    )
  order by v.name
  limit 500;
$$;
revoke execute on function public.insurance_uninsured_vehicles(date) from public, anon;
grant execute on function public.insurance_uninsured_vehicles(date) to authenticated;

-- ============================================================
-- Scanner: policies ending soon
-- ============================================================
create or replace function app.scan_due_insurance(p_tenant uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date;
  v_total integer := 0;
  r record;
begin
  if p_tenant is null or not app.tenant_module_enabled(p_tenant, 'insurance_mgmt') then
    return 0;
  end if;
  select (now() at time zone coalesce(t.timezone, 'UTC'))::date into v_today
  from public.tenants t where t.id = p_tenant;
  if v_today is null then
    return 0;
  end if;

  for r in
    select p.id, p.policy_number, p.end_date, p.policy_type,
           coalesce(s.name, p.insurer_name) as insurer,
           (p.end_date - v_today) as days_left,
           case
             when p.end_date < v_today then 'expired'
             when p.end_date = v_today then 'd0'
             when p.end_date - v_today <= 7 then 'd7'
             when p.end_date - v_today <= 30 then 'd30'
             else 'd60'
           end as stage
    from public.insurance_policies p
    left join public.suppliers s on s.id = p.insurer_supplier_id
    where p.tenant_id = p_tenant
      and p.canceled_at is null
      and p.end_date between v_today - 30 and v_today + 60
      -- Already renewed: a later policy of the same type and insurer.
      and not exists (
        select 1 from public.insurance_policies n
        where n.tenant_id = p.tenant_id and n.id <> p.id and n.canceled_at is null
          and n.policy_type = p.policy_type
          and n.start_date > p.start_date and n.end_date > p.end_date
          and (n.insurer_supplier_id = p.insurer_supplier_id
               or (n.insurer_supplier_id is null and p.insurer_supplier_id is null
                   and lower(n.insurer_name) = lower(p.insurer_name)))
      )
  loop
    v_total := v_total + coalesce(app.notify(
      p_tenant,
      'managers',
      'insurance.policy_expiring',
      case when r.stage in ('expired', 'd0', 'd7') then 'critical' else 'warning' end,
      'insurance_policy',
      r.id,
      '/insurance/policies/' || r.id,
      jsonb_build_object('policy', r.policy_number, 'insurer', r.insurer, 'expiry', r.end_date,
                         'days', r.days_left, 'stage', r.stage),
      -- English fallbacks; the SPA localizes by kind + params.
      case when r.stage = 'expired' then 'Policy ' || r.policy_number || ' expired'
           when r.stage = 'd0' then 'Policy ' || r.policy_number || ' ends today'
           else 'Policy ' || r.policy_number || ' ends in ' || r.days_left || ' day'
                || case when r.days_left = 1 then '' else 's' end
      end,
      'End date: ' || to_char(r.end_date, 'YYYY-MM-DD'),
      'insurance.policy_expiring:' || r.id || ':' || r.end_date || ':' || r.stage
    ), 0);
  end loop;
  return v_total;
end;
$$;
revoke execute on function app.scan_due_insurance(uuid) from public, anon, authenticated;

-- ============================================================
-- RLS: members read; managers write.
-- ============================================================
set local lock_timeout = '1s';
do $$
declare
  t text;
begin
  foreach t in array array['insurance_policies', 'insurance_policy_vehicles', 'insurance_claims'] loop
    execute format('create policy %1$s_select on public.%1$I for select to authenticated
      using (tenant_id = (select app.tenant_id()) and (select app.module_enabled(''insurance_mgmt'')))', t);
    execute format('create policy %1$s_insert on public.%1$I for insert to authenticated
      with check (tenant_id = (select app.tenant_id()) and (select app.is_manager())
                  and (select app.module_enabled(''insurance_mgmt'')))', t);
    execute format('create policy %1$s_update on public.%1$I for update to authenticated
      using (tenant_id = (select app.tenant_id()) and (select app.is_manager())
             and (select app.module_enabled(''insurance_mgmt'')))
      with check (tenant_id = (select app.tenant_id()) and (select app.is_manager())
                  and (select app.module_enabled(''insurance_mgmt'')))', t);
    execute format('create policy %1$s_delete on public.%1$I for delete to authenticated
      using (tenant_id = (select app.tenant_id()) and (select app.is_manager())
             and (select app.module_enabled(''insurance_mgmt'')))', t);
  end loop;
end;
$$;
