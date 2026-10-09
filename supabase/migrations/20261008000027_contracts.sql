-- Contracts (module contracts): customer contracts (leases, rentals, service
-- and maintenance agreements, SLAs), the vehicles they cover, recurring
-- billing into draft invoices, renewals and expiry.
--
-- 1) contracts: numbered CTR-00001 (doc type 'contract'). status draft →
--    active → expired | terminated | renewed; expired → renewed (late
--    renewal). Activating sets next_billing_date to the start date unless
--    one is given. Terminating needs a reason (CONTRACT_TERMINATION_REASON_
--    REQUIRED) and stamps terminated_at. 'renewed' is reached only through
--    contract_renew, which records renewed_to. Closed contracts (expired,
--    terminated, renewed) are locked except notes (CONTRACT_LOCKED); only
--    drafts can be deleted (CONTRACT_NOT_DELETABLE). app.contract_guard
--    enforces it (ILLEGAL_CONTRACT_TRANSITION, INVALID_CONTRACT_DATES).
--    recurring_amount is billed once per billing period; currency is the
--    tenant's, snapshotted on insert. tax_rate null = the sales default.
-- 2) contract_vehicles: vehicles a contract covers, each optionally billed
--    at its own rate per period (rate_override). Locked with the contract.
-- 3) contract_invoices: one row per billed period (unique per contract and
--    period start), written by contract_bill_period only.
-- 4) public.contract_bill_period(contract) makes a DRAFT invoice for the
--    next period (one line for recurring_amount, one per vehicle with a rate
--    override) and advances next_billing_date; it runs as the caller, so
--    invoice RLS, numbering and line math apply (needs billing;
--    CONTRACT_NOT_BILLABLE, CONTRACT_NOTHING_TO_BILL).
--    public.contracts_bill_due() bills every active contract whose
--    next_billing_date has come, returning how many invoices it made.
-- 5) public.contract_renew(contract, end_date, recurring_amount) opens the
--    next term as a new active contract with the same terms and vehicles,
--    starting the day after the current end date (CONTRACT_NOT_RENEWABLE,
--    CONTRACT_NO_END_DATE).
-- 6) Scanner app.scan_due_contracts: contracts ending within their notice
--    period, 30 or 7 days → managers (contracts.expiring); billing due →
--    managers once a day (contracts.billing_due); contracts past their end
--    date are renewed when auto_renew is set, else marked expired.
-- 7) Automation events: contract.activated, contract.terminated,
--    contract.renewed.
--
-- Raised codes: ILLEGAL_CONTRACT_TRANSITION, INVALID_CONTRACT_DATES,
-- CONTRACT_TERMINATION_REASON_REQUIRED, CONTRACT_LOCKED,
-- CONTRACT_NOT_DELETABLE, CONTRACT_NOT_FOUND, CONTRACT_NOT_BILLABLE,
-- CONTRACT_NOTHING_TO_BILL, CONTRACT_NOT_RENEWABLE, CONTRACT_NO_END_DATE
-- (+ MODULE_DISABLED, CROSS_TENANT_REFERENCE, FORBIDDEN). Additive only.

set local lock_timeout = '3s';
set local statement_timeout = '60s';

-- ============================================================
-- Tables
-- ============================================================
create table public.contracts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  number integer,
  doc_number text,
  customer_id uuid not null references public.customers(id) on delete restrict,
  contract_type text not null default 'service'
    check (contract_type in ('lease', 'rental', 'service', 'maintenance', 'sla', 'speed_limiter_service', 'other')),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  start_date date not null,
  end_date date,
  status text not null default 'draft' check (status in ('draft', 'active', 'expired', 'terminated', 'renewed')),
  billing_frequency text not null default 'monthly'
    check (billing_frequency in ('monthly', 'quarterly', 'semi_annual', 'annual', 'one_time')),
  recurring_amount numeric(14,3) not null default 0 check (recurring_amount >= 0),
  currency text not null default 'USD',
  tax_rate numeric(5,2) check (tax_rate is null or tax_rate between 0 and 100),
  auto_renew boolean not null default false,
  notice_days integer not null default 30 check (notice_days between 0 and 365),
  next_billing_date date,
  terms text check (terms is null or char_length(terms) <= 10000),
  signed_at date,
  signed_by_name text check (signed_by_name is null or char_length(signed_by_name) <= 200),
  activated_at timestamptz,
  terminated_at timestamptz,
  termination_reason text check (termination_reason is null or char_length(termination_reason) <= 1000),
  renewed_to uuid references public.contracts(id) on delete set null,
  renewed_from uuid references public.contracts(id) on delete set null,
  notes text check (notes is null or char_length(notes) <= 4000),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contracts_dates_ck check (end_date is null or end_date >= start_date)
);
create unique index contracts_tenant_number_uk on public.contracts (tenant_id, number);
create unique index contracts_tenant_doc_number_uk on public.contracts (tenant_id, doc_number);
create index contracts_tenant_status_idx on public.contracts (tenant_id, status, end_date);
create index contracts_tenant_billing_idx on public.contracts (tenant_id, next_billing_date) where status = 'active';
create index contracts_customer_idx on public.contracts (customer_id);
create index contracts_renewed_to_idx on public.contracts (renewed_to) where renewed_to is not null;
create index contracts_renewed_from_idx on public.contracts (renewed_from) where renewed_from is not null;

create table public.contract_vehicles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  contract_id uuid not null references public.contracts(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  rate_override numeric(14,3) check (rate_override is null or rate_override >= 0),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index contract_vehicles_uk on public.contract_vehicles (contract_id, vehicle_id);
create index contract_vehicles_vehicle_idx on public.contract_vehicles (vehicle_id);
create index contract_vehicles_tenant_idx on public.contract_vehicles (tenant_id);

create table public.contract_invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  contract_id uuid not null references public.contracts(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint contract_invoices_period_ck check (period_end >= period_start)
);
create unique index contract_invoices_period_uk on public.contract_invoices (contract_id, period_start);
create index contract_invoices_invoice_idx on public.contract_invoices (invoice_id);
create index contract_invoices_tenant_idx on public.contract_invoices (tenant_id);

alter table public.contracts enable row level security;
alter table public.contract_vehicles enable row level security;
alter table public.contract_invoices enable row level security;
revoke all on public.contracts from anon;
revoke all on public.contract_vehicles from anon;
revoke all on public.contract_invoices from anon;
-- Numbers, stamps, currency and the renewal links are server-side.
revoke insert, update on public.contracts from authenticated;
grant insert (customer_id, contract_type, title, start_date, end_date, billing_frequency, recurring_amount, tax_rate,
              auto_renew, notice_days, next_billing_date, terms, signed_at, signed_by_name, notes)
  on public.contracts to authenticated;
grant update (customer_id, contract_type, title, start_date, end_date, billing_frequency, recurring_amount, tax_rate,
              auto_renew, notice_days, next_billing_date, terms, signed_at, signed_by_name, notes, status,
              termination_reason)
  on public.contracts to authenticated;
revoke insert, update on public.contract_vehicles from authenticated;
grant insert (contract_id, vehicle_id, rate_override) on public.contract_vehicles to authenticated;
grant update (rate_override) on public.contract_vehicles to authenticated;
revoke insert, update, delete on public.contract_invoices from authenticated;

-- ============================================================
-- Contract lifecycle
-- ============================================================
create or replace function app.contract_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client boolean := coalesce(nullif(current_setting('role', true), ''), 'none') in ('authenticated', 'anon')
                      and pg_trigger_depth() <= 1;
begin
  if tg_op = 'DELETE' then
    if v_client and old.status <> 'draft' then
      raise exception 'CONTRACT_NOT_DELETABLE';
    end if;
    return old;
  end if;

  if new.end_date is not null and new.end_date < new.start_date then
    raise exception 'INVALID_CONTRACT_DATES';
  end if;

  if tg_op = 'INSERT' then
    if v_client then
      new.status := 'draft';
      new.activated_at := null;
      new.terminated_at := null;
      new.termination_reason := null;
      new.renewed_to := null;
      new.renewed_from := null;
    end if;
    select t.currency into new.currency from public.tenants t where t.id = new.tenant_id;
    new.currency := coalesce(new.currency, 'USD');
    if new.status = 'active' then
      new.activated_at := coalesce(new.activated_at, now());
      new.next_billing_date := coalesce(new.next_billing_date, new.start_date);
    end if;
    return new;
  end if;

  if v_client and new.currency is distinct from old.currency then
    raise exception 'FORBIDDEN';
  end if;
  -- Gated on client writes so FK actions (a deleted renewal) still apply;
  -- renewing an expired contract changes only its status and link.
  if v_client and old.status in ('expired', 'terminated', 'renewed')
     and (to_jsonb(new) - array['notes', 'updated_at', 'updated_by', 'status', 'renewed_to'])
         is distinct from (to_jsonb(old) - array['notes', 'updated_at', 'updated_by', 'status', 'renewed_to']) then
    raise exception 'CONTRACT_LOCKED';
  end if;
  if v_client and old.status in ('terminated', 'renewed')
     and (new.status is distinct from old.status or new.renewed_to is distinct from old.renewed_to) then
    raise exception 'CONTRACT_LOCKED';
  end if;

  if new.status is distinct from old.status then
    if new.status = 'renewed' then
      -- Only contract_renew gets here, with the contract it opened.
      if old.status not in ('active', 'expired') or new.renewed_to is null then
        raise exception 'ILLEGAL_CONTRACT_TRANSITION';
      end if;
    elsif not ((old.status = 'draft' and new.status = 'active')
               or (old.status = 'active' and new.status in ('expired', 'terminated'))) then
      raise exception 'ILLEGAL_CONTRACT_TRANSITION';
    end if;
    if new.status = 'active' then
      new.activated_at := now();
      new.next_billing_date := coalesce(new.next_billing_date, new.start_date);
    elsif new.status = 'terminated' then
      if nullif(btrim(new.termination_reason), '') is null then
        raise exception 'CONTRACT_TERMINATION_REASON_REQUIRED';
      end if;
      new.terminated_at := now();
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function app.contract_guard() from public, anon, authenticated;

create or replace function app.contract_after()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('active', 'terminated') and (tg_op = 'INSERT' or new.status is distinct from old.status) then
    perform app.emit_event(new.tenant_id, 'contract.' || case new.status when 'active' then 'activated' else 'terminated' end,
      'contract', new.id,
      jsonb_build_object('contract_id', new.id, 'doc_number', new.doc_number, 'customer_id', new.customer_id,
        'contract_type', new.contract_type, 'title', new.title, 'start_date', new.start_date, 'end_date', new.end_date,
        'billing_frequency', new.billing_frequency, 'recurring_amount', new.recurring_amount, 'currency', new.currency,
        'termination_reason', new.termination_reason, 'renewed_from', new.renewed_from),
      'contract.' || new.status || ':' || new.id);
  end if;
  return null;
end;
$$;
revoke execute on function app.contract_after() from public, anon, authenticated;

create trigger contracts_number
  before insert or update of number, doc_number on public.contracts
  for each row execute function app.assign_doc_number('contract', 'CTR');
create trigger contracts_guard before insert or update or delete on public.contracts
  for each row execute function app.contract_guard();
create trigger contracts_stamp_actor before insert or update on public.contracts
  for each row execute function app.stamp_actor();
create trigger contracts_same_tenant before insert or update of customer_id on public.contracts
  for each row execute function app.assert_same_tenant('customer_id', 'customers');
create trigger contracts_after after insert or update of status on public.contracts
  for each row execute function app.contract_after();
create trigger contracts_audit after insert or update or delete on public.contracts
  for each row execute function app.log_audit();

-- Covered vehicles follow their contract's lock.
create or replace function app.contract_vehicle_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(nullif(current_setting('role', true), ''), 'none') in ('authenticated', 'anon') and pg_trigger_depth() <= 1
     and exists (select 1 from public.contracts c
                 where c.id = case when tg_op = 'DELETE' then old.contract_id else new.contract_id end
                   and c.status in ('expired', 'terminated', 'renewed')) then
    raise exception 'CONTRACT_LOCKED';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;
revoke execute on function app.contract_vehicle_guard() from public, anon, authenticated;
create trigger contract_vehicles_guard before insert or update or delete on public.contract_vehicles
  for each row execute function app.contract_vehicle_guard();
create trigger contract_vehicles_stamp_actor before insert or update on public.contract_vehicles
  for each row execute function app.stamp_actor();
create trigger contract_vehicles_same_tenant before insert on public.contract_vehicles
  for each row execute function app.assert_same_tenant('contract_id', 'contracts', 'vehicle_id', 'vehicles');
create trigger contract_vehicles_audit after insert or update or delete on public.contract_vehicles
  for each row execute function app.log_audit();

-- ============================================================
-- Billing
-- ============================================================
create or replace function app.contract_period_months(p_frequency text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_frequency
    when 'monthly' then 1
    when 'quarterly' then 3
    when 'semi_annual' then 6
    when 'annual' then 12
    else null
  end;
$$;

-- The billing record is not client-writable: this stores it once the caller
-- has drafted the invoice (same tenant, same customer) and moves the
-- contract on to its next period.
create or replace function app.contract_record_billing(
  p_contract_id uuid, p_invoice_id uuid, p_period_start date, p_period_end date, p_next date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id();
begin
  if not exists (select 1 from public.invoices i join public.contracts c on c.customer_id = i.customer_id
                 where i.id = p_invoice_id and c.id = p_contract_id
                   and i.tenant_id = v_tenant and c.tenant_id = v_tenant) then
    raise exception 'CROSS_TENANT_REFERENCE: invoice_id';
  end if;
  insert into public.contract_invoices (tenant_id, contract_id, invoice_id, period_start, period_end, created_by)
  values (v_tenant, p_contract_id, p_invoice_id, p_period_start, p_period_end, auth.uid());
  update public.contracts set next_billing_date = p_next where id = p_contract_id and tenant_id = v_tenant;
end;
$$;
revoke execute on function app.contract_record_billing(uuid, uuid, date, date, date) from public, anon;
grant execute on function app.contract_record_billing(uuid, uuid, date, date, date) to authenticated;

create or replace function public.contract_bill_period(p_contract_id uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_tenant uuid := app.require_module('contracts', 'manager');
  v_c public.contracts%rowtype;
  v_months integer;
  v_start date;
  v_end date;
  v_next date;
  v_terms integer;
  v_default_tax numeric;
  v_tax numeric;
  v_invoice uuid;
  v_sort integer := 0;
  v_label text;
  r record;
begin
  if not app.module_enabled('billing') then
    raise exception 'MODULE_DISABLED';
  end if;
  select * into v_c from public.contracts c where c.id = p_contract_id and c.tenant_id = v_tenant for update;
  if not found then
    raise exception 'CONTRACT_NOT_FOUND';
  end if;
  if v_c.status <> 'active' then
    raise exception 'CONTRACT_NOT_BILLABLE';
  end if;
  if v_c.next_billing_date is null or (v_c.end_date is not null and v_c.next_billing_date > v_c.end_date) then
    raise exception 'CONTRACT_NOTHING_TO_BILL';
  end if;

  v_months := app.contract_period_months(v_c.billing_frequency);
  v_start := v_c.next_billing_date;
  if v_months is null then
    -- One-time: the whole term in one invoice, nothing after it.
    v_end := coalesce(v_c.end_date, v_start);
    v_next := null;
  else
    v_next := (v_start + make_interval(months => v_months))::date;
    v_end := v_next - 1;
    if v_c.end_date is not null and v_end > v_c.end_date then
      v_end := v_c.end_date;
    end if;
  end if;

  select ss.payment_terms_days, ss.default_tax_rate into v_terms, v_default_tax
    from public.sales_settings ss where ss.tenant_id = v_tenant;
  v_tax := coalesce(v_c.tax_rate, v_default_tax, 0);
  v_label := to_char(v_start, 'YYYY-MM-DD') || ' – ' || to_char(v_end, 'YYYY-MM-DD');

  insert into public.invoices (customer_id, due_date, title, customer_reference)
  values (v_c.customer_id, current_date + coalesce(v_terms, 30),
          left(v_c.title || ' (' || v_label || ')', 200), v_c.doc_number)
  returning id into v_invoice;

  if v_c.recurring_amount > 0 then
    insert into public.invoice_lines (invoice_id, sort_order, description, quantity, unit, unit_price, discount_percent, tax_rate)
    values (v_invoice, v_sort, left(v_c.title || ', ' || v_label, 500), 1, null, v_c.recurring_amount, 0, v_tax);
    v_sort := v_sort + 1;
  end if;
  for r in
    select cv.rate_override, v.id as vehicle_id, v.name, v.license_plate
    from public.contract_vehicles cv join public.vehicles v on v.id = cv.vehicle_id
    where cv.contract_id = v_c.id and cv.rate_override is not null and cv.rate_override > 0
    order by v.name
  loop
    insert into public.invoice_lines (invoice_id, sort_order, description, quantity, unit, unit_price, discount_percent,
                                      tax_rate, vehicle_id)
    values (v_invoice, v_sort,
            left(r.name || coalesce(' (' || nullif(r.license_plate, '') || ')', '') || ', ' || v_label, 500),
            1, null, r.rate_override, 0, v_tax, r.vehicle_id);
    v_sort := v_sort + 1;
  end loop;
  if v_sort = 0 then
    raise exception 'CONTRACT_NOTHING_TO_BILL';
  end if;

  perform app.contract_record_billing(v_c.id, v_invoice, v_start, v_end, v_next);
  return v_invoice;
end;
$$;
revoke execute on function public.contract_bill_period(uuid) from public, anon;
grant execute on function public.contract_bill_period(uuid) to authenticated;

create or replace function public.contracts_bill_due()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_tenant uuid := app.require_module('contracts', 'manager');
  v_today date;
  v_count integer := 0;
  r record;
begin
  if not app.module_enabled('billing') then
    raise exception 'MODULE_DISABLED';
  end if;
  select (now() at time zone coalesce(t.timezone, 'UTC'))::date into v_today from public.tenants t where t.id = v_tenant;
  for r in
    select c.id from public.contracts c
    where c.tenant_id = v_tenant and c.status = 'active' and c.next_billing_date <= v_today
      and (c.end_date is null or c.next_billing_date <= c.end_date)
    order by c.next_billing_date
  loop
    -- Bill every period that has come due (a contract can be several behind).
    loop
      begin
        perform public.contract_bill_period(r.id);
        v_count := v_count + 1;
      exception when others then
        if sqlerrm in ('CONTRACT_NOTHING_TO_BILL', 'CONTRACT_NOT_BILLABLE') then
          exit;
        end if;
        raise;
      end;
      exit when not exists (select 1 from public.contracts c where c.id = r.id and c.next_billing_date <= v_today
                              and (c.end_date is null or c.next_billing_date <= c.end_date));
    end loop;
  end loop;
  return v_count;
end;
$$;
revoke execute on function public.contracts_bill_due() from public, anon;
grant execute on function public.contracts_bill_due() to authenticated;

-- ============================================================
-- Renewal
-- ============================================================
-- Opens the next term: a new active contract with the same terms and
-- vehicles. Callers check the tenant and role first.
create or replace function app.contract_renew_core(p_tenant uuid, p_contract_id uuid, p_end_date date, p_amount numeric)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.contracts%rowtype;
  v_start date;
  v_end date;
  v_new uuid;
begin
  select * into v_c from public.contracts c where c.id = p_contract_id and c.tenant_id = p_tenant for update;
  if not found then
    raise exception 'CONTRACT_NOT_FOUND';
  end if;
  if v_c.status not in ('active', 'expired') or v_c.renewed_to is not null then
    raise exception 'CONTRACT_NOT_RENEWABLE';
  end if;
  if v_c.end_date is null then
    raise exception 'CONTRACT_NO_END_DATE';
  end if;
  v_start := v_c.end_date + 1;
  v_end := coalesce(p_end_date, v_start + (v_c.end_date - v_c.start_date));
  if v_end < v_start then
    raise exception 'INVALID_CONTRACT_DATES';
  end if;

  insert into public.contracts (tenant_id, customer_id, contract_type, title, start_date, end_date, billing_frequency,
                                recurring_amount, tax_rate, auto_renew, notice_days, next_billing_date, terms,
                                renewed_from, notes)
  values (v_c.tenant_id, v_c.customer_id, v_c.contract_type, v_c.title, v_start, v_end, v_c.billing_frequency,
          coalesce(p_amount, v_c.recurring_amount), v_c.tax_rate, v_c.auto_renew, v_c.notice_days,
          case when v_c.billing_frequency = 'one_time' then v_start
               else greatest(v_start, coalesce(v_c.next_billing_date, v_start)) end,
          v_c.terms, v_c.id, null)
  returning id into v_new;
  -- A client session inserts drafts (and cannot set renewed_from); this
  -- definer sets both explicitly, then activates.
  update public.contracts set renewed_from = v_c.id where id = v_new;
  update public.contracts set status = 'active' where id = v_new and status = 'draft';

  insert into public.contract_vehicles (tenant_id, contract_id, vehicle_id, rate_override)
  select cv.tenant_id, v_new, cv.vehicle_id, cv.rate_override
  from public.contract_vehicles cv where cv.contract_id = v_c.id;

  update public.contracts set status = 'renewed', renewed_to = v_new where id = v_c.id;
  perform app.emit_event(v_c.tenant_id, 'contract.renewed', 'contract', v_c.id,
    jsonb_build_object('contract_id', v_c.id, 'doc_number', v_c.doc_number, 'renewed_to', v_new,
      'customer_id', v_c.customer_id, 'start_date', v_start, 'end_date', v_end,
      'recurring_amount', coalesce(p_amount, v_c.recurring_amount), 'currency', v_c.currency),
    'contract.renewed:' || v_c.id);
  return v_new;
end;
$$;
revoke execute on function app.contract_renew_core(uuid, uuid, date, numeric) from public, anon, authenticated;

create or replace function public.contract_renew(p_contract_id uuid, p_end_date date default null,
                                                 p_recurring_amount numeric default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.require_module('contracts', 'manager');
begin
  if p_recurring_amount is not null and p_recurring_amount < 0 then
    raise exception 'FORBIDDEN';
  end if;
  return app.contract_renew_core(v_tenant, p_contract_id, p_end_date, p_recurring_amount);
end;
$$;
revoke execute on function public.contract_renew(uuid, date, numeric) from public, anon;
grant execute on function public.contract_renew(uuid, date, numeric) to authenticated;

-- ============================================================
-- Scanner
-- ============================================================
create or replace function app.scan_due_contracts(p_tenant uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date;
  v_total integer := 0;
  v_due integer;
  v_amount numeric;
  r record;
begin
  if p_tenant is null or not app.tenant_module_enabled(p_tenant, 'contracts') then
    return 0;
  end if;
  select (now() at time zone coalesce(t.timezone, 'UTC'))::date into v_today
  from public.tenants t where t.id = p_tenant;
  if v_today is null then
    return 0;
  end if;

  -- End of term: renew or expire.
  for r in
    select c.id, c.auto_renew from public.contracts c
    where c.tenant_id = p_tenant and c.status = 'active' and c.end_date < v_today
    order by c.end_date
  loop
    if r.auto_renew then
      perform app.contract_renew_core(p_tenant, r.id, null, null);
    else
      update public.contracts set status = 'expired' where id = r.id;
    end if;
  end loop;

  -- Ending soon.
  for r in
    select c.id, c.doc_number, c.title, c.end_date, c.auto_renew, c.notice_days, cu.name as customer,
           case
             when c.end_date - v_today <= 7 then 'd7'
             when c.end_date - v_today <= 30 then 'd30'
             else 'notice'
           end as stage
    from public.contracts c join public.customers cu on cu.id = c.customer_id
    where c.tenant_id = p_tenant and c.status = 'active' and c.end_date is not null
      and c.end_date >= v_today and c.end_date - v_today <= greatest(c.notice_days, 30)
  loop
    v_total := v_total + coalesce(app.notify(
      p_tenant,
      'managers',
      'contracts.expiring',
      case when r.stage = 'd7' then 'critical' else 'warning' end,
      'contract',
      r.id,
      '/contracts/c/' || r.id,
      jsonb_build_object('doc_number', r.doc_number, 'title', r.title, 'customer', r.customer, 'end_date', r.end_date,
                         'days', r.end_date - v_today, 'stage', r.stage, 'auto_renew', r.auto_renew),
      -- English fallbacks; the SPA localizes by kind + params.
      'Contract ' || coalesce(r.doc_number, '') || ' ends ' || to_char(r.end_date, 'YYYY-MM-DD'),
      r.customer || ': ' || r.title || case when r.auto_renew then ' (renews automatically)' else '' end,
      'contracts.expiring:' || r.id || ':' || r.stage || ':' || r.end_date
    ), 0);
  end loop;

  -- Billing due, once a day.
  select count(*)::integer, coalesce(sum(c.recurring_amount), 0) into v_due, v_amount
  from public.contracts c
  where c.tenant_id = p_tenant and c.status = 'active' and c.next_billing_date <= v_today
    and (c.end_date is null or c.next_billing_date <= c.end_date);
  if v_due > 0 then
    v_total := v_total + coalesce(app.notify(
      p_tenant,
      'managers',
      'contracts.billing_due',
      'info',
      null,
      null,
      '/contracts?billing=due',
      jsonb_build_object('count', v_due),
      v_due || case when v_due = 1 then ' contract is' else ' contracts are' end || ' due for billing',
      null,
      'contracts.billing_due:' || v_today
    ), 0);
  end if;
  return v_total;
end;
$$;
revoke execute on function app.scan_due_contracts(uuid) from public, anon, authenticated;

-- ============================================================
-- RLS: members read; managers write. Billing records are read-only.
-- ============================================================
set local lock_timeout = '1s';
do $$
declare
  t text;
begin
  foreach t in array array['contracts', 'contract_vehicles'] loop
    execute format('create policy %1$s_select on public.%1$I for select to authenticated
      using (tenant_id = (select app.tenant_id()) and (select app.module_enabled(''contracts'')))', t);
    execute format('create policy %1$s_insert on public.%1$I for insert to authenticated
      with check (tenant_id = (select app.tenant_id()) and (select app.is_manager())
                  and (select app.module_enabled(''contracts'')))', t);
    execute format('create policy %1$s_update on public.%1$I for update to authenticated
      using (tenant_id = (select app.tenant_id()) and (select app.is_manager())
             and (select app.module_enabled(''contracts'')))
      with check (tenant_id = (select app.tenant_id()) and (select app.is_manager())
                  and (select app.module_enabled(''contracts'')))', t);
    execute format('create policy %1$s_delete on public.%1$I for delete to authenticated
      using (tenant_id = (select app.tenant_id()) and (select app.is_manager())
             and (select app.module_enabled(''contracts'')))', t);
  end loop;
end;
$$;
create policy contract_invoices_select on public.contract_invoices for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.module_enabled('contracts')));
