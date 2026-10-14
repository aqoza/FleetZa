-- CRM (module crm): leads, a sales pipeline of opportunities, and the calls,
-- meetings and tasks around them.
--
-- 1) crm_leads: numbered LEAD-00001 (doc type 'crm_lead'). status new →
--    contacted → qualified, any open status → unqualified, unqualified →
--    new (reopen). 'converted' is reached only through crm_convert_lead,
--    which also records the customer (and opportunity) it created; a
--    converted lead is locked except owner and notes (LEAD_LOCKED) and
--    cannot be deleted (LEAD_NOT_DELETABLE). app.crm_lead_guard enforces it
--    (ILLEGAL_LEAD_TRANSITION).
-- 2) crm_opportunities: numbered OPP-00001 (doc type 'crm_opportunity').
--    stage prospecting / qualification / proposal / negotiation move freely;
--    any open stage → won | lost; won and lost may be reopened to an open
--    stage. Probability defaults by stage (10/25/50/75; won 100, lost 0) and
--    follows a stage change unless set in the same write. Losing needs a
--    reason (OPPORTUNITY_LOST_REASON_REQUIRED). won_at / lost_at are stamped
--    here. Amounts are in the tenant currency, snapshotted on insert.
-- 3) crm_activities: calls, emails, meetings, tasks, notes and WhatsApp
--    messages, linked to a lead, opportunity and/or customer; done_at marks
--    a task done.
-- 4) public.crm_convert_lead(lead, create_opportunity) creates the customer,
--    its primary contact and optionally an opportunity, then marks the lead
--    converted (LEAD_ALREADY_CONVERTED on a second call). It runs as the
--    caller, so the Customers module's RLS applies.
-- 5) Scanner app.scan_due_crm: each owner with open activities past due gets
--    one notification a day (crm.activities_overdue).
-- 6) Automation events: crm_lead.converted, crm_opportunity.won,
--    crm_opportunity.lost.
--
-- Raised codes: ILLEGAL_LEAD_TRANSITION, LEAD_LOCKED, LEAD_NOT_DELETABLE,
-- LEAD_NOT_FOUND, LEAD_ALREADY_CONVERTED, ILLEGAL_OPPORTUNITY_TRANSITION,
-- OPPORTUNITY_LOST_REASON_REQUIRED (+ MODULE_DISABLED, CROSS_TENANT_REFERENCE,
-- FORBIDDEN). Additive only.

set local lock_timeout = '3s';
set local statement_timeout = '60s';

-- ============================================================
-- Tables
-- ============================================================
create table public.crm_leads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  number integer,
  doc_number text,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  company_name text check (company_name is null or char_length(company_name) <= 200),
  email text check (email is null or char_length(email) <= 200),
  phone text check (phone is null or char_length(phone) <= 50),
  source text not null default 'other'
    check (source in ('website', 'referral', 'walk_in', 'phone', 'email', 'social', 'event', 'partner', 'other')),
  status text not null default 'new'
    check (status in ('new', 'contacted', 'qualified', 'converted', 'unqualified')),
  owner_id uuid references public.profiles(id) on delete set null,
  estimated_value numeric(14,3) check (estimated_value is null or estimated_value >= 0),
  currency text not null default 'USD',
  fleet_size integer check (fleet_size is null or fleet_size between 0 and 100000),
  interest text check (interest is null or char_length(interest) <= 500),
  notes text check (notes is null or char_length(notes) <= 4000),
  converted_customer_id uuid references public.customers(id) on delete set null,
  converted_opportunity_id uuid,
  converted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index crm_leads_tenant_number_uk on public.crm_leads (tenant_id, number);
create unique index crm_leads_tenant_doc_number_uk on public.crm_leads (tenant_id, doc_number);
create index crm_leads_tenant_status_idx on public.crm_leads (tenant_id, status, created_at desc);
create index crm_leads_owner_idx on public.crm_leads (owner_id) where owner_id is not null;
create index crm_leads_customer_idx on public.crm_leads (converted_customer_id) where converted_customer_id is not null;

create table public.crm_opportunities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  number integer,
  doc_number text,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  customer_id uuid references public.customers(id) on delete restrict,
  lead_id uuid references public.crm_leads(id) on delete set null,
  stage text not null default 'prospecting'
    check (stage in ('prospecting', 'qualification', 'proposal', 'negotiation', 'won', 'lost')),
  amount numeric(14,3) not null default 0 check (amount >= 0),
  currency text not null default 'USD',
  probability integer not null check (probability between 0 and 100),
  expected_close_date date,
  owner_id uuid references public.profiles(id) on delete set null,
  lost_reason text check (lost_reason is null or char_length(lost_reason) <= 1000),
  quote_id uuid references public.quotes(id) on delete set null,
  won_at timestamptz,
  lost_at timestamptz,
  notes text check (notes is null or char_length(notes) <= 4000),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index crm_opportunities_tenant_number_uk on public.crm_opportunities (tenant_id, number);
create unique index crm_opportunities_tenant_doc_number_uk on public.crm_opportunities (tenant_id, doc_number);
create index crm_opportunities_tenant_stage_idx on public.crm_opportunities (tenant_id, stage, expected_close_date);
create index crm_opportunities_customer_idx on public.crm_opportunities (customer_id) where customer_id is not null;
create index crm_opportunities_lead_idx on public.crm_opportunities (lead_id) where lead_id is not null;
create index crm_opportunities_owner_idx on public.crm_opportunities (owner_id) where owner_id is not null;
create index crm_opportunities_quote_idx on public.crm_opportunities (quote_id) where quote_id is not null;

alter table public.crm_leads
  add constraint crm_leads_converted_opportunity_id_fkey foreign key (converted_opportunity_id)
  references public.crm_opportunities(id) on delete set null;
create index crm_leads_opportunity_idx on public.crm_leads (converted_opportunity_id)
  where converted_opportunity_id is not null;

create table public.crm_activities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  activity_type text not null default 'task'
    check (activity_type in ('call', 'email', 'meeting', 'task', 'note', 'whatsapp')),
  subject text not null check (char_length(btrim(subject)) between 1 and 200),
  body text check (body is null or char_length(body) <= 4000),
  due_at timestamptz,
  done_at timestamptz,
  owner_id uuid references public.profiles(id) on delete set null,
  lead_id uuid references public.crm_leads(id) on delete cascade,
  opportunity_id uuid references public.crm_opportunities(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete cascade,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index crm_activities_tenant_due_idx on public.crm_activities (tenant_id, due_at) where done_at is null;
create index crm_activities_tenant_created_idx on public.crm_activities (tenant_id, created_at desc);
create index crm_activities_owner_idx on public.crm_activities (owner_id, due_at) where owner_id is not null;
create index crm_activities_lead_idx on public.crm_activities (lead_id) where lead_id is not null;
create index crm_activities_opportunity_idx on public.crm_activities (opportunity_id) where opportunity_id is not null;
create index crm_activities_customer_idx on public.crm_activities (customer_id) where customer_id is not null;

alter table public.crm_leads enable row level security;
alter table public.crm_opportunities enable row level security;
alter table public.crm_activities enable row level security;
revoke all on public.crm_leads from anon;
revoke all on public.crm_opportunities from anon;
revoke all on public.crm_activities from anon;
-- Numbers, stamps, currency and the conversion record are server-side.
revoke insert, update on public.crm_leads from authenticated;
grant insert (name, company_name, email, phone, source, owner_id, estimated_value, fleet_size, interest, notes)
  on public.crm_leads to authenticated;
grant update (name, company_name, email, phone, source, status, owner_id, estimated_value, fleet_size, interest, notes)
  on public.crm_leads to authenticated;
revoke insert, update on public.crm_opportunities from authenticated;
grant insert (title, customer_id, lead_id, stage, amount, probability, expected_close_date, owner_id, lost_reason,
              quote_id, notes)
  on public.crm_opportunities to authenticated;
grant update (title, customer_id, lead_id, stage, amount, probability, expected_close_date, owner_id, lost_reason,
              quote_id, notes)
  on public.crm_opportunities to authenticated;
revoke insert, update on public.crm_activities from authenticated;
grant insert (activity_type, subject, body, due_at, done_at, owner_id, lead_id, opportunity_id, customer_id)
  on public.crm_activities to authenticated;
grant update (activity_type, subject, body, due_at, done_at, owner_id, lead_id, opportunity_id, customer_id)
  on public.crm_activities to authenticated;

-- ============================================================
-- Lead lifecycle
-- ============================================================
create or replace function app.crm_lead_guard()
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
    if v_client and old.status = 'converted' then
      raise exception 'LEAD_NOT_DELETABLE';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if v_client then
      new.status := 'new';
      new.converted_customer_id := null;
      new.converted_opportunity_id := null;
      new.converted_at := null;
    end if;
    select t.currency into new.currency from public.tenants t where t.id = new.tenant_id;
    new.currency := coalesce(new.currency, 'USD');
    return new;
  end if;

  if v_client and new.currency is distinct from old.currency then
    raise exception 'FORBIDDEN';
  end if;
  -- Gated on client writes so FK actions (a deleted customer) still apply.
  if v_client and old.status = 'converted'
     and (to_jsonb(new) - array['notes', 'owner_id', 'updated_at', 'updated_by'])
         is distinct from (to_jsonb(old) - array['notes', 'owner_id', 'updated_at', 'updated_by']) then
    raise exception 'LEAD_LOCKED';
  end if;

  if new.status is distinct from old.status then
    if new.status = 'converted' then
      -- Only crm_convert_lead gets here, with the customer it created.
      if new.converted_customer_id is null then
        raise exception 'ILLEGAL_LEAD_TRANSITION';
      end if;
      new.converted_at := now();
    elsif not ((old.status = 'new' and new.status in ('contacted', 'qualified', 'unqualified'))
               or (old.status = 'contacted' and new.status in ('qualified', 'unqualified'))
               or (old.status = 'qualified' and new.status in ('contacted', 'unqualified'))
               or (old.status = 'unqualified' and new.status = 'new')) then
      raise exception 'ILLEGAL_LEAD_TRANSITION';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function app.crm_lead_guard() from public, anon, authenticated;

create trigger crm_leads_number
  before insert or update of number, doc_number on public.crm_leads
  for each row execute function app.assign_doc_number('crm_lead', 'LEAD');
create trigger crm_leads_guard before insert or update or delete on public.crm_leads
  for each row execute function app.crm_lead_guard();
create trigger crm_leads_stamp_actor before insert or update on public.crm_leads
  for each row execute function app.stamp_actor();
create trigger crm_leads_same_tenant before insert or update of owner_id on public.crm_leads
  for each row execute function app.assert_same_tenant('owner_id', 'profiles');
create trigger crm_leads_audit after insert or update or delete on public.crm_leads
  for each row execute function app.log_audit();

-- ============================================================
-- Opportunity pipeline
-- ============================================================
create or replace function app.crm_stage_probability(p_stage text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_stage
    when 'prospecting' then 10
    when 'qualification' then 25
    when 'proposal' then 50
    when 'negotiation' then 75
    when 'won' then 100
    else 0
  end;
$$;

create or replace function app.crm_opportunity_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client boolean := coalesce(nullif(current_setting('role', true), ''), 'none') in ('authenticated', 'anon')
                      and pg_trigger_depth() <= 1;
begin
  if tg_op = 'INSERT' then
    if v_client then
      new.won_at := null;
      new.lost_at := null;
    end if;
    if new.stage = 'won' then
      new.won_at := coalesce(new.won_at, now());
      new.probability := 100;
    elsif new.stage = 'lost' then
      if nullif(btrim(new.lost_reason), '') is null then
        raise exception 'OPPORTUNITY_LOST_REASON_REQUIRED';
      end if;
      new.lost_at := coalesce(new.lost_at, now());
      new.probability := 0;
    else
      new.probability := coalesce(new.probability, app.crm_stage_probability(new.stage));
    end if;
    select t.currency into new.currency from public.tenants t where t.id = new.tenant_id;
    new.currency := coalesce(new.currency, 'USD');
    return new;
  end if;

  if v_client and (new.currency is distinct from old.currency
                   or new.won_at is distinct from old.won_at
                   or new.lost_at is distinct from old.lost_at) then
    raise exception 'FORBIDDEN';
  end if;

  if new.stage is distinct from old.stage then
    -- Open stages move freely; won and lost reopen to an open stage only.
    if old.stage in ('won', 'lost') and new.stage in ('won', 'lost') then
      raise exception 'ILLEGAL_OPPORTUNITY_TRANSITION';
    end if;
    if new.stage = 'won' then
      new.won_at := now();
      new.lost_at := null;
      new.probability := 100;
    elsif new.stage = 'lost' then
      if nullif(btrim(new.lost_reason), '') is null then
        raise exception 'OPPORTUNITY_LOST_REASON_REQUIRED';
      end if;
      new.lost_at := now();
      new.won_at := null;
      new.probability := 0;
    else
      new.won_at := null;
      new.lost_at := null;
      if new.probability is not distinct from old.probability then
        new.probability := app.crm_stage_probability(new.stage);
      end if;
    end if;
  elsif new.stage in ('won', 'lost') then
    new.probability := old.probability;
    if new.stage = 'lost' and nullif(btrim(new.lost_reason), '') is null then
      raise exception 'OPPORTUNITY_LOST_REASON_REQUIRED';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function app.crm_opportunity_guard() from public, anon, authenticated;

create or replace function app.crm_opportunity_after()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.stage in ('won', 'lost') and (tg_op = 'INSERT' or new.stage is distinct from old.stage) then
    perform app.emit_event(new.tenant_id, 'crm_opportunity.' || new.stage, 'crm_opportunity', new.id,
      jsonb_build_object('opportunity_id', new.id, 'doc_number', new.doc_number, 'title', new.title,
        'customer_id', new.customer_id, 'lead_id', new.lead_id, 'amount', new.amount, 'currency', new.currency,
        'owner_id', new.owner_id, 'quote_id', new.quote_id, 'lost_reason', new.lost_reason),
      'crm_opportunity.' || new.stage || ':' || new.id || ':' || coalesce(new.won_at, new.lost_at, now()));
  end if;
  return null;
end;
$$;
revoke execute on function app.crm_opportunity_after() from public, anon, authenticated;

create trigger crm_opportunities_number
  before insert or update of number, doc_number on public.crm_opportunities
  for each row execute function app.assign_doc_number('crm_opportunity', 'OPP');
create trigger crm_opportunities_guard before insert or update on public.crm_opportunities
  for each row execute function app.crm_opportunity_guard();
create trigger crm_opportunities_stamp_actor before insert or update on public.crm_opportunities
  for each row execute function app.stamp_actor();
create trigger crm_opportunities_same_tenant
  before insert or update of customer_id, lead_id, owner_id, quote_id on public.crm_opportunities
  for each row execute function app.assert_same_tenant('customer_id', 'customers', 'lead_id', 'crm_leads',
                                                      'owner_id', 'profiles', 'quote_id', 'quotes');
create trigger crm_opportunities_after after insert or update of stage on public.crm_opportunities
  for each row execute function app.crm_opportunity_after();
create trigger crm_opportunities_audit after insert or update or delete on public.crm_opportunities
  for each row execute function app.log_audit();

-- ============================================================
-- Activities
-- ============================================================
create or replace function app.crm_activity_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function app.crm_activity_touch() from public, anon, authenticated;

create trigger crm_activities_touch before update on public.crm_activities
  for each row execute function app.crm_activity_touch();
create trigger crm_activities_stamp_actor before insert or update on public.crm_activities
  for each row execute function app.stamp_actor();
create trigger crm_activities_same_tenant
  before insert or update of owner_id, lead_id, opportunity_id, customer_id on public.crm_activities
  for each row execute function app.assert_same_tenant('owner_id', 'profiles', 'lead_id', 'crm_leads',
                                                      'opportunity_id', 'crm_opportunities',
                                                      'customer_id', 'customers');

-- ============================================================
-- Lead conversion
-- ============================================================
-- The conversion record is not client-writable: this stamps it once the
-- caller has created the customer (same tenant) for an open lead.
create or replace function app.crm_mark_lead_converted(p_lead_id uuid, p_customer_id uuid, p_opportunity_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id();
  v_lead public.crm_leads%rowtype;
begin
  if not exists (select 1 from public.customers c where c.id = p_customer_id and c.tenant_id = v_tenant) then
    raise exception 'CROSS_TENANT_REFERENCE: customer_id';
  end if;
  if p_opportunity_id is not null
     and not exists (select 1 from public.crm_opportunities o
                     where o.id = p_opportunity_id and o.tenant_id = v_tenant and o.lead_id = p_lead_id) then
    raise exception 'CROSS_TENANT_REFERENCE: opportunity_id';
  end if;
  update public.crm_leads
     set status = 'converted', converted_customer_id = p_customer_id, converted_opportunity_id = p_opportunity_id
   where id = p_lead_id and tenant_id = v_tenant and status <> 'converted'
  returning * into v_lead;
  if not found then
    raise exception 'LEAD_ALREADY_CONVERTED';
  end if;
  perform app.emit_event(v_tenant, 'crm_lead.converted', 'crm_lead', p_lead_id,
    jsonb_build_object('lead_id', p_lead_id, 'doc_number', v_lead.doc_number, 'customer_id', p_customer_id,
      'opportunity_id', p_opportunity_id, 'owner_id', v_lead.owner_id, 'estimated_value', v_lead.estimated_value,
      'fleet_size', v_lead.fleet_size, 'source', v_lead.source),
    'crm_lead.converted:' || p_lead_id);
end;
$$;
revoke execute on function app.crm_mark_lead_converted(uuid, uuid, uuid) from public, anon;
grant execute on function app.crm_mark_lead_converted(uuid, uuid, uuid) to authenticated;

create or replace function public.crm_convert_lead(p_lead_id uuid, p_create_opportunity boolean default true)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_tenant uuid := app.require_module('crm', 'manager');
  v_lead public.crm_leads%rowtype;
  v_customer uuid;
  v_contact uuid;
  v_opportunity uuid;
begin
  if not app.module_enabled('customers') then
    raise exception 'MODULE_DISABLED';
  end if;
  select * into v_lead from public.crm_leads l where l.id = p_lead_id and l.tenant_id = v_tenant for update;
  if not found then
    raise exception 'LEAD_NOT_FOUND';
  end if;
  if v_lead.status = 'converted' then
    raise exception 'LEAD_ALREADY_CONVERTED';
  end if;
  if v_lead.status = 'unqualified' then
    raise exception 'ILLEGAL_LEAD_TRANSITION';
  end if;

  insert into public.customers (name, email, phone, notes)
  values (coalesce(nullif(btrim(v_lead.company_name), ''), v_lead.name), v_lead.email, v_lead.phone,
          nullif(btrim(concat_ws(E'\n', v_lead.interest, v_lead.notes)), ''))
  returning id into v_customer;

  insert into public.contacts (customer_id, name, email, phone, is_primary)
  values (v_customer, v_lead.name, v_lead.email, v_lead.phone, true)
  returning id into v_contact;

  if coalesce(p_create_opportunity, false) then
    insert into public.crm_opportunities (title, customer_id, lead_id, stage, amount, owner_id)
    values (left(coalesce(nullif(btrim(v_lead.interest), ''),
                          coalesce(nullif(btrim(v_lead.company_name), ''), v_lead.name)), 200),
            v_customer, v_lead.id, 'qualification', coalesce(v_lead.estimated_value, 0), v_lead.owner_id)
    returning id into v_opportunity;
  end if;

  perform app.crm_mark_lead_converted(v_lead.id, v_customer, v_opportunity);
  -- The lead's activities follow it to the new customer.
  update public.crm_activities set customer_id = v_customer
   where lead_id = v_lead.id and customer_id is null and tenant_id = v_tenant;

  return jsonb_build_object('customer_id', v_customer, 'contact_id', v_contact, 'opportunity_id', v_opportunity);
end;
$$;
revoke execute on function public.crm_convert_lead(uuid, boolean) from public, anon;
grant execute on function public.crm_convert_lead(uuid, boolean) to authenticated;

-- ============================================================
-- Scanner: overdue activities → their owner, once a day.
-- ============================================================
create or replace function app.scan_due_crm(p_tenant uuid)
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
  if p_tenant is null or not app.tenant_module_enabled(p_tenant, 'crm') then
    return 0;
  end if;
  select (now() at time zone coalesce(t.timezone, 'UTC'))::date into v_today
  from public.tenants t where t.id = p_tenant;
  if v_today is null then
    return 0;
  end if;

  for r in
    select a.owner_id, count(*)::integer as n, min(a.due_at) as oldest,
           (array_agg(a.subject order by a.due_at))[1] as subject,
           (array_agg(a.id order by a.due_at))[1] as first_id
    from public.crm_activities a
    where a.tenant_id = p_tenant
      and a.owner_id is not null
      and a.done_at is null
      and a.due_at < now()
      and a.due_at >= now() - interval '90 days'
    group by a.owner_id
  loop
    v_total := v_total + coalesce(app.notify(
      p_tenant,
      null,
      'crm.activities_overdue',
      'warning',
      'crm_activity',
      r.first_id,
      '/crm/activities?view=overdue',
      jsonb_build_object('count', r.n, 'subject', r.subject, 'oldest', r.oldest),
      -- English fallbacks; the SPA localizes by kind + params.
      r.n || case when r.n = 1 then ' overdue CRM activity' else ' overdue CRM activities' end,
      r.subject,
      'crm.activities_overdue:' || r.owner_id || ':' || v_today,
      r.owner_id
    ), 0);
  end loop;
  return v_total;
end;
$$;
revoke execute on function app.scan_due_crm(uuid) from public, anon, authenticated;

-- ============================================================
-- RLS: members read; managers write.
-- ============================================================
set local lock_timeout = '1s';
do $$
declare
  t text;
begin
  foreach t in array array['crm_leads', 'crm_opportunities', 'crm_activities'] loop
    execute format('create policy %1$s_select on public.%1$I for select to authenticated
      using (tenant_id = (select app.tenant_id()) and (select app.module_enabled(''crm'')))', t);
    execute format('create policy %1$s_insert on public.%1$I for insert to authenticated
      with check (tenant_id = (select app.tenant_id()) and (select app.is_manager())
                  and (select app.module_enabled(''crm'')))', t);
    execute format('create policy %1$s_update on public.%1$I for update to authenticated
      using (tenant_id = (select app.tenant_id()) and (select app.is_manager())
             and (select app.module_enabled(''crm'')))
      with check (tenant_id = (select app.tenant_id()) and (select app.is_manager())
                  and (select app.module_enabled(''crm'')))', t);
    execute format('create policy %1$s_delete on public.%1$I for delete to authenticated
      using (tenant_id = (select app.tenant_id()) and (select app.is_manager())
             and (select app.module_enabled(''crm'')))', t);
  end loop;
end;
$$;
