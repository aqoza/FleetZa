-- Regulatory compliance (module regulatory): a register of the permits,
-- licenses, inspections and filings that apply to the company, its vehicles,
-- drivers and employees, and the dated obligations that track each one.
--
-- 1) compliance_requirements: code (unique per tenant), title (+ Arabic),
--    authority, country, category, what it applies to (company | vehicle |
--    driver | employee), how often it recurs (frequency_months; null =
--    one-off), the warning window (lead_days), a reference link, and
--    `verified`: templates seeded by public.regulatory_seed_templates(country)
--    start unverified until a manager has checked them against the authority.
--    A requirement with obligations can't be deleted (REQUIREMENT_IN_USE);
--    deactivate it instead.
-- 2) compliance_obligations: one requirement for one subject with a due date.
--    subject_id is polymorphic (no FK): null for the company, else a vehicle,
--    driver or employee of the tenant (OBLIGATION_SUBJECT_NOT_FOUND); the
--    subject type must match the requirement (OBLIGATION_SUBJECT_MISMATCH).
--    The requirement and subject are fixed once created (OBLIGATION_LOCKED).
--    status pending | compliant | non_compliant | waived. Compliant stamps
--    completed_on (today by default, never in the future:
--    INVALID_COMPLETION_DATE). evidence_document_id points at a document of
--    the tenant (no FK; checked).
-- 3) public.obligation_complete(obligation, completed_on, evidence, notes)
--    marks it compliant and, when the requirement recurs, creates the next
--    obligation due frequency_months after the later of the due date and the
--    completion date. public.regulatory_generate_obligations(requirement,
--    due_date) creates one for every subject in scope (company vehicles in
--    service, active drivers, employees not terminated, or the company) that
--    has no open obligation for it yet.
-- 4) Scanner app.scan_due_regulatory: open obligations entering the lead
--    window, 7 days, due today, or overdue → managers
--    (regulatory.obligation_due), one notification per requirement and stage.
--
-- Raised codes: REQUIREMENT_NOT_FOUND, REQUIREMENT_INACTIVE, REQUIREMENT_IN_USE,
-- OBLIGATION_NOT_FOUND, OBLIGATION_SUBJECT_MISMATCH,
-- OBLIGATION_SUBJECT_NOT_FOUND, OBLIGATION_LOCKED, INVALID_COMPLETION_DATE
-- (+ MODULE_DISABLED, CROSS_TENANT_REFERENCE, FORBIDDEN). Additive only.

set local lock_timeout = '3s';
set local statement_timeout = '60s';

-- ============================================================
-- Tables
-- ============================================================
create table public.compliance_requirements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  code text not null check (char_length(btrim(code)) between 1 and 40),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  title_ar text check (title_ar is null or char_length(title_ar) <= 200),
  authority text check (authority is null or char_length(authority) <= 200),
  country text check (country is null or country ~ '^[A-Z]{2}$'),
  category text not null default 'other'
    check (category in ('permit', 'license', 'tax', 'emissions', 'safety', 'tachograph', 'operating_authority',
                        'insurance', 'other')),
  applies_to text not null check (applies_to in ('company', 'vehicle', 'driver', 'employee')),
  frequency_months integer check (frequency_months is null or frequency_months between 1 and 120),
  lead_days integer not null default 30 check (lead_days between 0 and 365),
  reference_url text check (reference_url is null or (char_length(reference_url) <= 500 and reference_url ~* '^https?://')),
  description text check (description is null or char_length(description) <= 4000),
  verified boolean not null default true,
  active boolean not null default true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index compliance_requirements_code_uk on public.compliance_requirements (tenant_id, lower(code));
create index compliance_requirements_tenant_idx on public.compliance_requirements (tenant_id, active, category);

create table public.compliance_obligations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  requirement_id uuid not null references public.compliance_requirements(id) on delete cascade,
  subject_type text not null check (subject_type in ('company', 'vehicle', 'driver', 'employee')),
  subject_id uuid,
  due_date date not null,
  status text not null default 'pending' check (status in ('pending', 'compliant', 'non_compliant', 'waived')),
  completed_on date,
  evidence_document_id uuid,
  responsible_user uuid references public.profiles(id) on delete set null,
  notes text check (notes is null or char_length(notes) <= 4000),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint compliance_obligations_subject_ck check ((subject_type = 'company') = (subject_id is null)),
  constraint compliance_obligations_completed_ck check (status = 'compliant' or completed_on is null)
);
create unique index compliance_obligations_uk on public.compliance_obligations
  (requirement_id, subject_type, coalesce(subject_id, '00000000-0000-0000-0000-000000000000'::uuid), due_date);
create index compliance_obligations_tenant_due_idx on public.compliance_obligations (tenant_id, status, due_date);
create index compliance_obligations_subject_idx on public.compliance_obligations (subject_type, subject_id)
  where subject_id is not null;
create index compliance_obligations_evidence_idx on public.compliance_obligations (evidence_document_id)
  where evidence_document_id is not null;
create index compliance_obligations_responsible_idx on public.compliance_obligations (responsible_user)
  where responsible_user is not null;

alter table public.compliance_requirements enable row level security;
alter table public.compliance_obligations enable row level security;
revoke all on public.compliance_requirements from anon;
revoke all on public.compliance_obligations from anon;

revoke insert, update on public.compliance_requirements from authenticated;
grant insert (code, title, title_ar, authority, country, category, applies_to, frequency_months, lead_days,
              reference_url, description, verified, active) on public.compliance_requirements to authenticated;
grant update (code, title, title_ar, authority, country, category, applies_to, frequency_months, lead_days,
              reference_url, description, verified, active) on public.compliance_requirements to authenticated;
revoke insert, update on public.compliance_obligations from authenticated;
grant insert (requirement_id, subject_type, subject_id, due_date, status, completed_on, evidence_document_id,
              responsible_user, notes) on public.compliance_obligations to authenticated;
grant update (due_date, status, completed_on, evidence_document_id, responsible_user, notes)
  on public.compliance_obligations to authenticated;

-- ============================================================
-- Requirement rules
-- ============================================================
create or replace function app.compliance_requirement_guard()
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
    if v_client and exists (select 1 from public.compliance_obligations o where o.requirement_id = old.id) then
      raise exception 'REQUIREMENT_IN_USE';
    end if;
    return old;
  end if;
  new.code := upper(btrim(new.code));
  new.title := btrim(new.title);
  new.country := nullif(upper(btrim(new.country)), '');
  if tg_op = 'UPDATE' then
    -- Existing obligations are tied to what the requirement applies to.
    if new.applies_to is distinct from old.applies_to
       and exists (select 1 from public.compliance_obligations o where o.requirement_id = old.id) then
      raise exception 'REQUIREMENT_IN_USE';
    end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;
revoke execute on function app.compliance_requirement_guard() from public, anon, authenticated;

create trigger compliance_requirements_guard before insert or update or delete on public.compliance_requirements
  for each row execute function app.compliance_requirement_guard();
create trigger compliance_requirements_stamp_actor before insert or update on public.compliance_requirements
  for each row execute function app.stamp_actor();
create trigger compliance_requirements_audit after insert or update or delete on public.compliance_requirements
  for each row execute function app.log_audit();

-- ============================================================
-- Obligation rules
-- ============================================================
create or replace function app.compliance_obligation_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_applies text;
  v_today date;
  v_found boolean;
begin
  if tg_op = 'UPDATE' then
    if new.requirement_id is distinct from old.requirement_id
       or new.subject_type is distinct from old.subject_type
       or new.subject_id is distinct from old.subject_id then
      raise exception 'OBLIGATION_LOCKED';
    end if;
  else
    select r.applies_to into v_applies
    from public.compliance_requirements r where r.id = new.requirement_id and r.tenant_id = new.tenant_id;
    if v_applies is null then
      raise exception 'REQUIREMENT_NOT_FOUND';
    end if;
    new.subject_type := coalesce(new.subject_type, v_applies);
    if new.subject_type <> v_applies then
      raise exception 'OBLIGATION_SUBJECT_MISMATCH';
    end if;
    if new.subject_type = 'company' then
      new.subject_id := null;
    else
      v_found := case new.subject_type
        when 'vehicle' then exists (select 1 from public.vehicles v where v.id = new.subject_id and v.tenant_id = new.tenant_id)
        when 'driver' then exists (select 1 from public.drivers d where d.id = new.subject_id and d.tenant_id = new.tenant_id)
        when 'employee' then exists (select 1 from public.employees e where e.id = new.subject_id and e.tenant_id = new.tenant_id)
        else false
      end;
      if not coalesce(v_found, false) then
        raise exception 'OBLIGATION_SUBJECT_NOT_FOUND';
      end if;
    end if;
  end if;

  select (now() at time zone coalesce(t.timezone, 'UTC'))::date into v_today
  from public.tenants t where t.id = new.tenant_id;
  if new.status = 'compliant' then
    new.completed_on := coalesce(new.completed_on, v_today);
    if new.completed_on > v_today then
      raise exception 'INVALID_COMPLETION_DATE';
    end if;
  else
    new.completed_on := null;
  end if;

  if new.evidence_document_id is not null
     and (tg_op = 'INSERT' or new.evidence_document_id is distinct from old.evidence_document_id)
     and not exists (select 1 from public.documents d where d.id = new.evidence_document_id and d.tenant_id = new.tenant_id) then
    raise exception 'CROSS_TENANT_REFERENCE';
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;
revoke execute on function app.compliance_obligation_guard() from public, anon, authenticated;

create trigger compliance_obligations_guard before insert or update on public.compliance_obligations
  for each row execute function app.compliance_obligation_guard();
create trigger compliance_obligations_stamp_actor before insert or update on public.compliance_obligations
  for each row execute function app.stamp_actor();
create trigger compliance_obligations_same_tenant before insert or update on public.compliance_obligations
  for each row execute function app.assert_same_tenant('requirement_id', 'compliance_requirements',
                                                       'responsible_user', 'profiles');
create trigger compliance_obligations_audit after insert or update or delete on public.compliance_obligations
  for each row execute function app.log_audit();

-- ============================================================
-- RPCs (run as the caller, so RLS and grants apply)
-- ============================================================
-- Mark an obligation compliant; returns the next obligation's id when the
-- requirement recurs (null otherwise, or when that one already exists).
create or replace function public.obligation_complete(
  p_obligation_id uuid,
  p_completed_on date default null,
  p_evidence_document_id uuid default null,
  p_notes text default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_tenant uuid := app.require_module('regulatory', 'manager');
  v_o public.compliance_obligations%rowtype;
  v_r public.compliance_requirements%rowtype;
  v_next_due date;
  v_next uuid;
begin
  select * into v_o from public.compliance_obligations o where o.id = p_obligation_id and o.tenant_id = v_tenant for update;
  if not found then
    raise exception 'OBLIGATION_NOT_FOUND';
  end if;
  update public.compliance_obligations
     set status = 'compliant',
         completed_on = p_completed_on,
         evidence_document_id = coalesce(p_evidence_document_id, evidence_document_id),
         notes = coalesce(nullif(btrim(p_notes), ''), notes)
   where id = p_obligation_id
  returning * into v_o;

  select * into v_r from public.compliance_requirements r where r.id = v_o.requirement_id;
  if v_r.frequency_months is null or not v_r.active then
    return null;
  end if;
  v_next_due := (greatest(v_o.due_date, v_o.completed_on) + make_interval(months => v_r.frequency_months))::date;
  if exists (select 1 from public.compliance_obligations o
             where o.requirement_id = v_o.requirement_id and o.subject_type = v_o.subject_type
               and o.subject_id is not distinct from v_o.subject_id and o.due_date >= v_next_due) then
    return null;
  end if;
  insert into public.compliance_obligations (requirement_id, subject_type, subject_id, due_date, responsible_user)
  values (v_o.requirement_id, v_o.subject_type, v_o.subject_id, v_next_due, v_o.responsible_user)
  returning id into v_next;
  return v_next;
end;
$$;
revoke execute on function public.obligation_complete(uuid, date, uuid, text) from public, anon;
grant execute on function public.obligation_complete(uuid, date, uuid, text) to authenticated;

-- One obligation per subject in scope that has no open one for the
-- requirement yet. Returns how many were created.
create or replace function public.regulatory_generate_obligations(p_requirement_id uuid, p_due_date date)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_tenant uuid := app.require_module('regulatory', 'manager');
  v_r public.compliance_requirements%rowtype;
  v_count integer;
begin
  select * into v_r from public.compliance_requirements r where r.id = p_requirement_id and r.tenant_id = v_tenant;
  if not found then
    raise exception 'REQUIREMENT_NOT_FOUND';
  end if;
  if not v_r.active then
    raise exception 'REQUIREMENT_INACTIVE';
  end if;
  if p_due_date is null then
    raise exception 'FORBIDDEN';
  end if;

  with subjects as (
    select null::uuid as id where v_r.applies_to = 'company'
    union all
    select v.id from public.vehicles v
    where v_r.applies_to = 'vehicle' and v.tenant_id = v_tenant and v.ownership = 'company' and v.status <> 'retired'
    union all
    select d.id from public.drivers d
    where v_r.applies_to = 'driver' and d.tenant_id = v_tenant and d.status = 'active'
    union all
    select e.id from public.employees e
    where v_r.applies_to = 'employee' and e.tenant_id = v_tenant and e.status <> 'terminated'
  ), ins as (
    insert into public.compliance_obligations (requirement_id, subject_type, subject_id, due_date)
    select v_r.id, v_r.applies_to, s.id, p_due_date
    from subjects s
    where not exists (
      select 1 from public.compliance_obligations o
      where o.requirement_id = v_r.id and o.subject_id is not distinct from s.id
        and (o.status in ('pending', 'non_compliant') or o.due_date = p_due_date)
    )
    returning 1
  )
  select count(*) into v_count from ins;
  return v_count;
end;
$$;
revoke execute on function public.regulatory_generate_obligations(uuid, date) from public, anon;
grant execute on function public.regulatory_generate_obligations(uuid, date) to authenticated;

-- Starter requirements for a GCC country (AE, SA, OM, QA, KW, BH) or a
-- generic list for anywhere else. They are templates: seeded unverified, for
-- the tenant to check against the authority. Codes already in the register
-- are skipped. Returns how many were added.
create or replace function public.regulatory_seed_templates(p_country text default null)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_tenant uuid := app.require_module('regulatory', 'manager');
  v_country text;
  v_count integer;
begin
  select upper(coalesce(nullif(btrim(p_country), ''), t.country)) into v_country
  from public.tenants t where t.id = v_tenant;
  if v_country is null or v_country not in ('AE', 'SA', 'OM', 'QA', 'KW', 'BH') then
    v_country := 'XX';
  end if;

  with tpl (country, code, title, title_ar, authority, category, applies_to, frequency_months, lead_days, description) as (
    values
    -- Generic
    ('XX', 'GEN-VEH-REG', 'Vehicle registration renewal', 'تجديد تسجيل المركبة', 'Traffic authority', 'license', 'vehicle', 12, 30, null),
    ('XX', 'GEN-VEH-INSP', 'Periodic vehicle inspection', 'الفحص الدوري للمركبة', 'Traffic authority', 'safety', 'vehicle', 12, 30, null),
    ('XX', 'GEN-VEH-INS', 'Motor insurance renewal', 'تجديد تأمين المركبة', 'Insurer', 'insurance', 'vehicle', 12, 30, null),
    ('XX', 'GEN-VEH-EMIS', 'Emissions test', 'فحص الانبعاثات', 'Environment authority', 'emissions', 'vehicle', 12, 30, null),
    ('XX', 'GEN-DRV-LIC', 'Driving licence renewal', 'تجديد رخصة القيادة', 'Traffic authority', 'license', 'driver', null, 30,
     'Set each driver''s due date to their licence expiry.'),
    ('XX', 'GEN-DRV-MED', 'Driver medical fitness check', 'الفحص الطبي للسائق', null, 'safety', 'driver', 24, 30, null),
    ('XX', 'GEN-CO-REG', 'Commercial registration renewal', 'تجديد السجل التجاري', 'Ministry of Commerce', 'license', 'company', 12, 45, null),
    ('XX', 'GEN-CO-VAT', 'VAT return filing', 'تقديم إقرار ضريبة القيمة المضافة', 'Tax authority', 'tax', 'company', 3, 14,
     'Monthly or quarterly depending on your registration.'),
    ('XX', 'GEN-CO-FIRE', 'Premises fire safety certificate', 'شهادة السلامة من الحرائق للمنشأة', 'Civil defence', 'safety', 'company', 12, 30, null),
    ('XX', 'GEN-EMP-PERMIT', 'Work and residence permit renewal', 'تجديد تصريح العمل والإقامة', 'Labour authority', 'permit', 'employee', 24, 60, null),
    -- Saudi Arabia
    ('SA', 'SA-OPCARD', 'Operating card renewal', 'تجديد بطاقة التشغيل', 'Transport General Authority', 'operating_authority', 'vehicle', 12, 30,
     'Operating card for each commercial vehicle.'),
    ('SA', 'SA-ISTIMARA', 'Istimara (vehicle registration) renewal', 'تجديد الاستمارة', 'General Department of Traffic', 'license', 'vehicle', null, 30,
     'Set each vehicle''s due date to its registration expiry.'),
    ('SA', 'SA-FAHAS', 'Periodic technical inspection (Fahas)', 'الفحص الفني الدوري', 'Approved inspection centres', 'safety', 'vehicle', 12, 30, null),
    ('SA', 'SA-INS', 'Motor insurance renewal', 'تجديد تأمين المركبة', 'Insurer', 'insurance', 'vehicle', 12, 30, null),
    ('SA', 'SA-DRV-LIC', 'Driving licence renewal', 'تجديد رخصة القيادة', 'General Department of Traffic (Absher)', 'license', 'driver', null, 30,
     'Set each driver''s due date to their licence expiry.'),
    ('SA', 'SA-IQAMA', 'Iqama renewal', 'تجديد الإقامة', 'General Directorate of Passports', 'permit', 'employee', 12, 30, null),
    ('SA', 'SA-NITAQAT', 'Saudization (Nitaqat) review', 'مراجعة نطاقات (التوطين)', 'Ministry of Human Resources', 'other', 'company', 3, 14, null),
    ('SA', 'SA-VAT', 'ZATCA VAT return', 'إقرار ضريبة القيمة المضافة (زاتكا)', 'ZATCA', 'tax', 'company', 3, 14,
     'Monthly or quarterly depending on your registration.'),
    ('SA', 'SA-CR', 'Commercial registration renewal', 'تجديد السجل التجاري', 'Ministry of Commerce', 'license', 'company', 12, 45, null),
    -- United Arab Emirates
    ('AE', 'AE-MULKIYA', 'Mulkiya (vehicle registration) renewal', 'تجديد ملكية المركبة', 'Emirate traffic authority', 'license', 'vehicle', 12, 30, null),
    ('AE', 'AE-INSP', 'Vehicle technical inspection', 'الفحص الفني للمركبة', 'Approved test centres', 'safety', 'vehicle', 12, 30,
     'Usually due before the registration renewal.'),
    ('AE', 'AE-INS', 'Motor insurance renewal', 'تجديد تأمين المركبة', 'Insurer', 'insurance', 'vehicle', 12, 30, null),
    ('AE', 'AE-TOLL', 'Toll tag account check', 'مراجعة حساب ملصق التعرفة المرورية', 'Toll operator', 'other', 'vehicle', 12, 14, null),
    ('AE', 'AE-DRV-LIC', 'Driving licence renewal', 'تجديد رخصة القيادة', 'Emirate traffic authority', 'license', 'driver', null, 30,
     'Set each driver''s due date to their licence expiry.'),
    ('AE', 'AE-EID', 'Emirates ID renewal', 'تجديد بطاقة الهوية الإماراتية', 'Federal Authority for Identity and Citizenship', 'permit', 'employee', 24, 30, null),
    ('AE', 'AE-VISA', 'Residence visa renewal', 'تجديد تأشيرة الإقامة', 'Federal Authority for Identity and Citizenship', 'permit', 'employee', 24, 60, null),
    ('AE', 'AE-TRADE', 'Trade licence renewal', 'تجديد الرخصة التجارية', 'Department of Economic Development', 'license', 'company', 12, 45, null),
    ('AE', 'AE-VAT', 'FTA VAT return', 'إقرار ضريبة القيمة المضافة', 'Federal Tax Authority', 'tax', 'company', 3, 14,
     'Monthly or quarterly depending on your registration.'),
    ('AE', 'AE-CT', 'Corporate tax return', 'إقرار ضريبة الشركات', 'Federal Tax Authority', 'tax', 'company', 12, 60, null),
    -- Oman
    ('OM', 'OM-REG', 'Vehicle registration (Mulkiya) renewal', 'تجديد ملكية المركبة', 'Royal Oman Police', 'license', 'vehicle', 12, 30, null),
    ('OM', 'OM-SL', 'Speed limiter certificate', 'شهادة محدد السرعة', 'Royal Oman Police', 'safety', 'vehicle', 12, 30,
     'Certificates are issued in the Speed limiters module.'),
    ('OM', 'OM-INSP', 'Vehicle technical inspection', 'الفحص الفني للمركبة', 'Royal Oman Police', 'safety', 'vehicle', 12, 30, null),
    ('OM', 'OM-INS', 'Motor insurance renewal', 'تجديد تأمين المركبة', 'Insurer', 'insurance', 'vehicle', 12, 30, null),
    ('OM', 'OM-DRV-LIC', 'Driving licence renewal', 'تجديد رخصة القيادة', 'Royal Oman Police', 'license', 'driver', null, 30,
     'Set each driver''s due date to their licence expiry.'),
    ('OM', 'OM-RESIDENT', 'Resident card renewal', 'تجديد بطاقة المقيم', 'Royal Oman Police', 'permit', 'employee', 24, 30, null),
    ('OM', 'OM-LABOUR', 'Work permit renewal', 'تجديد تصريح العمل', 'Ministry of Labour', 'permit', 'employee', 24, 60, null),
    ('OM', 'OM-CR', 'Commercial registration renewal', 'تجديد السجل التجاري', 'Ministry of Commerce, Industry and Investment Promotion', 'license', 'company', 12, 45, null),
    ('OM', 'OM-VAT', 'VAT return', 'إقرار ضريبة القيمة المضافة', 'Tax Authority', 'tax', 'company', 3, 14, null),
    -- Qatar
    ('QA', 'QA-ISTIMARA', 'Istimara (vehicle registration) renewal', 'تجديد الاستمارة', 'General Directorate of Traffic', 'license', 'vehicle', 12, 30, null),
    ('QA', 'QA-INSP', 'Vehicle technical inspection', 'الفحص الفني للمركبة', 'Approved inspection centres', 'safety', 'vehicle', 12, 30,
     'Usually due before the registration renewal.'),
    ('QA', 'QA-INS', 'Motor insurance renewal', 'تجديد تأمين المركبة', 'Insurer', 'insurance', 'vehicle', 12, 30, null),
    ('QA', 'QA-DRV-LIC', 'Driving licence renewal', 'تجديد رخصة القيادة', 'General Directorate of Traffic', 'license', 'driver', null, 30,
     'Set each driver''s due date to their licence expiry.'),
    ('QA', 'QA-QID', 'Residence permit (QID) renewal', 'تجديد بطاقة الإقامة', 'Ministry of Interior', 'permit', 'employee', 12, 30, null),
    ('QA', 'QA-CR', 'Commercial registration renewal', 'تجديد السجل التجاري', 'Ministry of Commerce and Industry', 'license', 'company', 12, 45, null),
    ('QA', 'QA-TRADE', 'Trade licence renewal', 'تجديد الرخصة التجارية', 'Ministry of Commerce and Industry', 'license', 'company', 12, 45, null),
    -- Kuwait
    ('KW', 'KW-REG', 'Vehicle registration renewal', 'تجديد دفتر المركبة', 'General Traffic Department', 'license', 'vehicle', 12, 30, null),
    ('KW', 'KW-INSP', 'Vehicle technical inspection', 'الفحص الفني للمركبة', 'General Traffic Department', 'safety', 'vehicle', 12, 30, null),
    ('KW', 'KW-INS', 'Motor insurance renewal', 'تجديد تأمين المركبة', 'Insurer', 'insurance', 'vehicle', 12, 30, null),
    ('KW', 'KW-DRV-LIC', 'Driving licence renewal', 'تجديد رخصة القيادة', 'General Traffic Department', 'license', 'driver', null, 30,
     'Set each driver''s due date to their licence expiry.'),
    ('KW', 'KW-CIVIL-ID', 'Civil ID renewal', 'تجديد البطاقة المدنية', 'Public Authority for Civil Information', 'permit', 'employee', 12, 30, null),
    ('KW', 'KW-RESIDENCY', 'Residency renewal', 'تجديد الإقامة', 'Ministry of Interior', 'permit', 'employee', 12, 60, null),
    ('KW', 'KW-LICENSE', 'Commercial licence renewal', 'تجديد الترخيص التجاري', 'Ministry of Commerce and Industry', 'license', 'company', 12, 45, null),
    -- Bahrain
    ('BH', 'BH-REG', 'Vehicle registration renewal', 'تجديد تسجيل المركبة', 'General Directorate of Traffic', 'license', 'vehicle', 12, 30, null),
    ('BH', 'BH-INSP', 'Vehicle technical inspection', 'الفحص الفني للمركبة', 'General Directorate of Traffic', 'safety', 'vehicle', 12, 30, null),
    ('BH', 'BH-INS', 'Motor insurance renewal', 'تجديد تأمين المركبة', 'Insurer', 'insurance', 'vehicle', 12, 30, null),
    ('BH', 'BH-DRV-LIC', 'Driving licence renewal', 'تجديد رخصة القيادة', 'General Directorate of Traffic', 'license', 'driver', null, 30,
     'Set each driver''s due date to their licence expiry.'),
    ('BH', 'BH-CPR', 'CPR (identity card) renewal', 'تجديد البطاقة الذكية', 'Information & eGovernment Authority', 'permit', 'employee', 24, 30, null),
    ('BH', 'BH-LMRA', 'LMRA work permit renewal', 'تجديد تصريح العمل', 'Labour Market Regulatory Authority', 'permit', 'employee', 24, 60, null),
    ('BH', 'BH-CR', 'Commercial registration renewal', 'تجديد السجل التجاري', 'Ministry of Industry and Commerce', 'license', 'company', 12, 45, null),
    ('BH', 'BH-VAT', 'VAT return', 'إقرار ضريبة القيمة المضافة', 'National Bureau for Revenue', 'tax', 'company', 3, 14,
     'Monthly or quarterly depending on your registration.')
  ), ins as (
    insert into public.compliance_requirements (code, title, title_ar, authority, country, category, applies_to,
                                                frequency_months, lead_days, description, verified)
    select t.code, t.title, t.title_ar, t.authority, nullif(t.country, 'XX'), t.category, t.applies_to,
           t.frequency_months, t.lead_days, t.description, false
    from tpl t
    where t.country = v_country
      and not exists (select 1 from public.compliance_requirements r
                      where r.tenant_id = v_tenant and lower(r.code) = lower(t.code))
    returning 1
  )
  select count(*) into v_count from ins;
  return v_count;
end;
$$;
revoke execute on function public.regulatory_seed_templates(text) from public, anon;
grant execute on function public.regulatory_seed_templates(text) to authenticated;

-- ============================================================
-- Scanner: obligations coming due or overdue
-- ============================================================
create or replace function app.scan_due_regulatory(p_tenant uuid)
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
  if p_tenant is null or not app.tenant_module_enabled(p_tenant, 'regulatory') then
    return 0;
  end if;
  select (now() at time zone coalesce(t.timezone, 'UTC'))::date into v_today
  from public.tenants t where t.id = p_tenant;
  if v_today is null then
    return 0;
  end if;

  for r in
    select q.requirement_id, q.stage, q.title, q.title_ar, count(*)::integer as n,
           min(q.due_date) as first_due, max(q.due_date) as last_due
    from (
      select o.requirement_id, o.due_date, rq.title, rq.title_ar,
             case
               when o.due_date < v_today then 'overdue'
               when o.due_date = v_today then 'd0'
               when o.due_date - v_today <= 7 then 'd7'
               else 'lead'
             end as stage
      from public.compliance_obligations o
      join public.compliance_requirements rq on rq.id = o.requirement_id
      where o.tenant_id = p_tenant
        and rq.active
        and o.status in ('pending', 'non_compliant')
        and o.due_date <= v_today + greatest(rq.lead_days, 7)
        and o.due_date >= v_today - 90
    ) q
    group by q.requirement_id, q.stage, q.title, q.title_ar
  loop
    v_total := v_total + coalesce(app.notify(
      p_tenant,
      'managers',
      'regulatory.obligation_due',
      case when r.stage in ('overdue', 'd0') then 'critical' else 'warning' end,
      'compliance_requirement',
      r.requirement_id,
      '/regulatory/obligations?requirement=' || r.requirement_id,
      jsonb_build_object('requirement', r.title, 'requirement_ar', r.title_ar, 'count', r.n, 'stage', r.stage,
                         'due', r.first_due, 'days', r.first_due - v_today),
      -- English fallbacks; the SPA localizes by kind + params.
      r.title || ': ' || r.n || case when r.n = 1 then ' obligation ' else ' obligations ' end
        || case r.stage when 'overdue' then 'overdue' when 'd0' then 'due today' else 'due soon' end,
      'First due: ' || to_char(r.first_due, 'YYYY-MM-DD'),
      'regulatory.obligation_due:' || r.requirement_id || ':' || r.stage || ':' || r.last_due || ':' || r.n
    ), 0);
  end loop;
  return v_total;
end;
$$;
revoke execute on function app.scan_due_regulatory(uuid) from public, anon, authenticated;

-- ============================================================
-- RLS: members read; managers write.
-- ============================================================
set local lock_timeout = '1s';
do $$
declare
  t text;
begin
  foreach t in array array['compliance_requirements', 'compliance_obligations'] loop
    execute format('create policy %1$s_select on public.%1$I for select to authenticated
      using (tenant_id = (select app.tenant_id()) and (select app.module_enabled(''regulatory'')))', t);
    execute format('create policy %1$s_insert on public.%1$I for insert to authenticated
      with check (tenant_id = (select app.tenant_id()) and (select app.is_manager())
                  and (select app.module_enabled(''regulatory'')))', t);
    execute format('create policy %1$s_update on public.%1$I for update to authenticated
      using (tenant_id = (select app.tenant_id()) and (select app.is_manager())
             and (select app.module_enabled(''regulatory'')))
      with check (tenant_id = (select app.tenant_id()) and (select app.is_manager())
                  and (select app.module_enabled(''regulatory'')))', t);
    execute format('create policy %1$s_delete on public.%1$I for delete to authenticated
      using (tenant_id = (select app.tenant_id()) and (select app.is_manager())
             and (select app.module_enabled(''regulatory'')))', t);
  end loop;
end;
$$;
