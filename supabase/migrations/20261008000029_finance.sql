-- Finance (module finance): double-entry bookkeeping on top of the existing
-- sales, billing, purchasing and payroll records.
--
-- 1) gl_accounts: the chart of accounts (code unique per tenant, name,
--    name_ar, account_type asset|liability|equity|income|expense, parent,
--    is_system, active). public.finance_setup() seeds a standard SME chart
--    and the default account mapping; it is idempotent.
-- 2) journal_entries (numbered JE-00001, doc type 'journal_entry') with
--    journal_lines (one-sided debit or credit, optional vehicle / customer /
--    supplier). Staff write manual DRAFTS only; public.finance_post_entry
--    posts a balanced draft (JOURNAL_UNBALANCED), and posted entries are
--    immutable (JOURNAL_LOCKED). public.finance_reverse_entry posts the mirror
--    entry and marks the original reversed. Nothing posts on or before the
--    lock date (PERIOD_LOCKED).
-- 3) expenses (numbered EXP-00001): draft → approved → posted; draft or
--    approved → rejected; approved → draft. Posting
--    (public.finance_post_expense) books Dr expense account + Dr VAT input /
--    Cr the cash or bank account it was paid from, and links the entry.
-- 4) finance_settings: default account mapping (jsonb, key → account id),
--    fiscal_year_start_month, lock_date.
-- 5) Source posting, idempotent per source (one live entry per source):
--    finance_post_invoice, finance_post_payment, finance_post_vendor_bill,
--    finance_post_vendor_payment and finance_post_payroll (the last three
--    read purchasing and payroll tables dynamically, so this migration does
--    not depend on them). public.finance_sync() posts everything not yet
--    posted and reverses entries whose source was voided or deleted.
-- 6) Reports (invoker, RLS applies): finance_balances(from, to) per account
--    (opening, debit, credit), finance_monthly(from, to) for income and
--    expense by month, finance_ledger(account, from, to) with a running
--    balance.
--
-- Raised codes: FINANCE_NOT_SET_UP, JOURNAL_UNBALANCED, JOURNAL_LOCKED,
-- PERIOD_LOCKED, ENTRY_NOT_REVERSIBLE, ACCOUNT_INACTIVE, SYSTEM_ACCOUNT,
-- ACCOUNT_IN_USE, ILLEGAL_EXPENSE_TRANSITION, EXPENSE_LOCKED,
-- EXPENSE_ACCOUNT_INVALID, PAYMENT_ACCOUNT_INVALID, FINANCE_SOURCE_NOT_FOUND
-- (+ FORBIDDEN, MODULE_DISABLED, CROSS_TENANT_REFERENCE). Additive only.

set local lock_timeout = '3s';
set local statement_timeout = '60s';

-- ============================================================
-- Tables
-- ============================================================
create table public.gl_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  code text not null check (code ~ '^[0-9A-Za-z.\-]{1,20}$'),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  name_ar text check (name_ar is null or char_length(name_ar) <= 120),
  account_type text not null check (account_type in ('asset', 'liability', 'equity', 'income', 'expense')),
  parent_id uuid references public.gl_accounts(id) on delete set null,
  is_system boolean not null default false,
  active boolean not null default true,
  description text check (description is null or char_length(description) <= 500),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index gl_accounts_tenant_code_uk on public.gl_accounts (tenant_id, code);
create index gl_accounts_parent_idx on public.gl_accounts (parent_id) where parent_id is not null;

create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  number integer,
  doc_number text,
  entry_date date not null default current_date,
  memo text check (memo is null or char_length(memo) <= 500),
  status text not null default 'draft' check (status in ('draft', 'posted', 'reversed')),
  source_type text not null default 'manual'
    check (source_type in ('manual', 'invoice', 'payment', 'vendor_bill', 'vendor_payment', 'expense', 'payroll', 'pos')),
  source_id uuid,
  reversal_of uuid references public.journal_entries(id) on delete restrict,
  reversed_by uuid references public.journal_entries(id) on delete set null,
  total numeric(16,3) not null default 0,
  posted_at timestamptz,
  posted_by uuid,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index journal_entries_tenant_number_uk on public.journal_entries (tenant_id, number);
create unique index journal_entries_tenant_doc_number_uk on public.journal_entries (tenant_id, doc_number);
create index journal_entries_tenant_date_idx on public.journal_entries (tenant_id, entry_date desc);
create index journal_entries_reversal_of_idx on public.journal_entries (reversal_of) where reversal_of is not null;
create index journal_entries_reversed_by_idx on public.journal_entries (reversed_by) where reversed_by is not null;
-- One live entry per source document.
create unique index journal_entries_source_uk on public.journal_entries (tenant_id, source_type, source_id)
  where source_type <> 'manual' and status = 'posted' and reversal_of is null;

create table public.journal_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  entry_id uuid not null references public.journal_entries(id) on delete cascade,
  account_id uuid not null references public.gl_accounts(id) on delete restrict,
  sort_order integer not null default 0,
  description text check (description is null or char_length(description) <= 300),
  debit numeric(16,3) not null default 0 check (debit >= 0),
  credit numeric(16,3) not null default 0 check (credit >= 0),
  vehicle_id uuid references public.vehicles(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  supplier_id uuid references public.suppliers(id) on delete set null,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint journal_lines_one_side_ck check ((debit > 0) <> (credit > 0))
);
create index journal_lines_entry_idx on public.journal_lines (entry_id, sort_order);
create index journal_lines_account_idx on public.journal_lines (account_id);
create index journal_lines_tenant_idx on public.journal_lines (tenant_id);
create index journal_lines_vehicle_idx on public.journal_lines (vehicle_id) where vehicle_id is not null;
create index journal_lines_customer_idx on public.journal_lines (customer_id) where customer_id is not null;
create index journal_lines_supplier_idx on public.journal_lines (supplier_id) where supplier_id is not null;

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  number integer,
  doc_number text,
  expense_date date not null default current_date,
  category_account_id uuid not null references public.gl_accounts(id) on delete restrict,
  payment_account_id uuid not null references public.gl_accounts(id) on delete restrict,
  supplier_id uuid references public.suppliers(id) on delete set null,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  description text not null check (char_length(btrim(description)) between 1 and 300),
  reference text check (reference is null or char_length(reference) <= 100),
  amount numeric(16,3) not null check (amount > 0),
  tax_amount numeric(16,3) not null default 0 check (tax_amount >= 0),
  total numeric(16,3) not null default 0,
  status text not null default 'draft' check (status in ('draft', 'approved', 'posted', 'rejected')),
  rejection_reason text check (rejection_reason is null or char_length(rejection_reason) <= 500),
  receipt_document_id uuid,
  journal_entry_id uuid references public.journal_entries(id) on delete set null,
  approved_at timestamptz,
  approved_by uuid,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index expenses_tenant_number_uk on public.expenses (tenant_id, number);
create unique index expenses_tenant_doc_number_uk on public.expenses (tenant_id, doc_number);
create index expenses_tenant_status_idx on public.expenses (tenant_id, status, expense_date desc);
create index expenses_category_idx on public.expenses (category_account_id);
create index expenses_payment_idx on public.expenses (payment_account_id);
create index expenses_supplier_idx on public.expenses (supplier_id) where supplier_id is not null;
create index expenses_vehicle_idx on public.expenses (vehicle_id) where vehicle_id is not null;
create index expenses_entry_idx on public.expenses (journal_entry_id) where journal_entry_id is not null;

create table public.finance_settings (
  -- id only gives the audit log a row key; the tenant is the real key.
  id uuid not null default gen_random_uuid() unique,
  tenant_id uuid primary key default app.tenant_id() references public.tenants(id) on delete cascade,
  accounts jsonb not null default '{}'::jsonb,
  fiscal_year_start_month smallint not null default 1 check (fiscal_year_start_month between 1 and 12),
  lock_date date,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

alter table public.gl_accounts enable row level security;
alter table public.journal_entries enable row level security;
alter table public.journal_lines enable row level security;
alter table public.expenses enable row level security;
alter table public.finance_settings enable row level security;
revoke all on public.gl_accounts, public.journal_entries, public.journal_lines, public.expenses, public.finance_settings from anon;

revoke insert, update on public.gl_accounts from authenticated;
grant insert (code, name, name_ar, account_type, parent_id, description) on public.gl_accounts to authenticated;
grant update (code, name, name_ar, account_type, parent_id, active, description) on public.gl_accounts to authenticated;
-- Entries: staff write the date and memo of manual drafts; status, source,
-- totals and the reversal links are server-side.
revoke insert, update on public.journal_entries from authenticated;
grant insert (entry_date, memo) on public.journal_entries to authenticated;
grant update (entry_date, memo) on public.journal_entries to authenticated;
revoke insert, update on public.journal_lines from authenticated;
grant insert (entry_id, account_id, sort_order, description, debit, credit, vehicle_id, customer_id, supplier_id)
  on public.journal_lines to authenticated;
grant update (account_id, sort_order, description, debit, credit, vehicle_id, customer_id, supplier_id)
  on public.journal_lines to authenticated;
revoke insert, update on public.expenses from authenticated;
grant insert (expense_date, category_account_id, payment_account_id, supplier_id, vehicle_id, description, reference,
              amount, tax_amount, receipt_document_id)
  on public.expenses to authenticated;
grant update (expense_date, category_account_id, payment_account_id, supplier_id, vehicle_id, description, reference,
              amount, tax_amount, receipt_document_id, status, rejection_reason)
  on public.expenses to authenticated;
revoke insert, update, delete on public.finance_settings from authenticated;
grant update (accounts, fiscal_year_start_month, lock_date) on public.finance_settings to authenticated;

-- ============================================================
-- Accounts
-- ============================================================
create or replace function app.gl_account_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_client boolean := coalesce(nullif(current_setting('role', true), ''), 'none') in ('authenticated', 'anon')
                      and pg_trigger_depth() <= 1;
begin
  if tg_op = 'DELETE' then
    if v_client and old.is_system then
      raise exception 'SYSTEM_ACCOUNT';
    end if;
    if exists (select 1 from public.journal_lines l where l.account_id = old.id)
       or exists (select 1 from public.expenses e where e.category_account_id = old.id or e.payment_account_id = old.id) then
      raise exception 'ACCOUNT_IN_USE';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if v_client and old.is_system and (new.account_type is distinct from old.account_type or new.code is distinct from old.code) then
      raise exception 'SYSTEM_ACCOUNT';
    end if;
    if new.account_type is distinct from old.account_type
       and exists (select 1 from public.journal_lines l where l.account_id = old.id) then
      raise exception 'ACCOUNT_IN_USE';
    end if;
    if new.parent_id = new.id then
      raise exception 'FORBIDDEN';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function app.gl_account_guard() from public, anon, authenticated;

create trigger gl_accounts_guard before insert or update or delete on public.gl_accounts
  for each row execute function app.gl_account_guard();
create trigger gl_accounts_stamp_actor before insert or update on public.gl_accounts
  for each row execute function app.stamp_actor();
create trigger gl_accounts_same_tenant before insert or update of parent_id on public.gl_accounts
  for each row execute function app.assert_same_tenant('parent_id', 'gl_accounts');
create trigger gl_accounts_audit after insert or update or delete on public.gl_accounts
  for each row execute function app.log_audit();

-- ============================================================
-- Journal
-- ============================================================
create or replace function app.finance_check_lock(p_tenant uuid, p_date date)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_lock date;
begin
  select s.lock_date into v_lock from public.finance_settings s where s.tenant_id = p_tenant;
  if v_lock is not null and p_date <= v_lock then
    raise exception 'PERIOD_LOCKED';
  end if;
end;
$$;
revoke execute on function app.finance_check_lock(uuid, date) from public, anon, authenticated;

create or replace function app.journal_entry_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'JOURNAL_LOCKED';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      perform app.finance_check_lock(new.tenant_id, new.entry_date);
    end if;
    return new;
  end if;
  if old.status <> 'draft'
     and (new.entry_date is distinct from old.entry_date or new.memo is distinct from old.memo
          or new.source_type is distinct from old.source_type or new.source_id is distinct from old.source_id
          or new.total is distinct from old.total or new.reversal_of is distinct from old.reversal_of) then
    raise exception 'JOURNAL_LOCKED';
  end if;
  if new.status is distinct from old.status then
    if not ((old.status = 'draft' and new.status = 'posted') or (old.status = 'posted' and new.status = 'reversed')) then
      raise exception 'JOURNAL_LOCKED';
    end if;
    if new.status = 'posted' then
      perform app.finance_check_lock(new.tenant_id, new.entry_date);
      new.posted_at := now();
      new.posted_by := auth.uid();
    end if;
  elsif old.status = 'draft' and new.entry_date is distinct from old.entry_date then
    perform app.finance_check_lock(new.tenant_id, new.entry_date);
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function app.journal_entry_guard() from public, anon, authenticated;

create or replace function app.journal_line_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry public.journal_entries;
  v_active boolean;
begin
  select * into v_entry from public.journal_entries e
  where e.id = case when tg_op = 'DELETE' then old.entry_id else new.entry_id end;
  -- A cascade from a deleted draft finds no entry; let it through.
  if v_entry.id is not null and v_entry.status <> 'draft' then
    raise exception 'JOURNAL_LOCKED';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'UPDATE' and new.entry_id is distinct from old.entry_id then
    raise exception 'FORBIDDEN';
  end if;
  select a.active into v_active from public.gl_accounts a where a.id = new.account_id;
  if v_active is distinct from true then
    raise exception 'ACCOUNT_INACTIVE';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function app.journal_line_guard() from public, anon, authenticated;

-- Totals follow the lines (drafts only; posted entries cannot change).
create or replace function app.journal_line_after()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry uuid := case when tg_op = 'DELETE' then old.entry_id else new.entry_id end;
begin
  update public.journal_entries e
     set total = coalesce((select sum(l.debit) from public.journal_lines l where l.entry_id = v_entry), 0)
   where e.id = v_entry and e.status = 'draft';
  return null;
end;
$$;
revoke execute on function app.journal_line_after() from public, anon, authenticated;

create trigger journal_entries_number
  before insert or update of number, doc_number on public.journal_entries
  for each row execute function app.assign_doc_number('journal_entry', 'JE');
create trigger journal_entries_guard before insert or update or delete on public.journal_entries
  for each row execute function app.journal_entry_guard();
create trigger journal_entries_stamp_actor before insert or update on public.journal_entries
  for each row execute function app.stamp_actor();
create trigger journal_entries_audit after insert or update or delete on public.journal_entries
  for each row execute function app.log_audit();
create trigger journal_lines_guard before insert or update or delete on public.journal_lines
  for each row execute function app.journal_line_guard();
create trigger journal_lines_stamp_actor before insert or update on public.journal_lines
  for each row execute function app.stamp_actor();
create trigger journal_lines_same_tenant before insert or update of entry_id, account_id, vehicle_id, customer_id, supplier_id
  on public.journal_lines
  for each row execute function app.assert_same_tenant('entry_id', 'journal_entries', 'account_id', 'gl_accounts',
    'vehicle_id', 'vehicles', 'customer_id', 'customers', 'supplier_id', 'suppliers');
create trigger journal_lines_after after insert or update or delete on public.journal_lines
  for each row execute function app.journal_line_after();

-- ============================================================
-- Expenses
-- ============================================================
create or replace function app.expense_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type text;
  v_decimals integer;
begin
  if tg_op = 'DELETE' then
    if old.status = 'posted' then
      raise exception 'EXPENSE_LOCKED';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and old.status in ('posted', 'rejected')
     and (to_jsonb(new) - array['status', 'journal_entry_id', 'updated_at', 'updated_by', 'rejection_reason'])
         is distinct from (to_jsonb(old) - array['status', 'journal_entry_id', 'updated_at', 'updated_by', 'rejection_reason']) then
    raise exception 'EXPENSE_LOCKED';
  end if;
  if tg_op = 'UPDATE' and old.status = 'approved' and new.status = 'approved'
     and (to_jsonb(new) - array['updated_at', 'updated_by']) is distinct from (to_jsonb(old) - array['updated_at', 'updated_by']) then
    raise exception 'EXPENSE_LOCKED';
  end if;

  select a.account_type into v_type from public.gl_accounts a where a.id = new.category_account_id and a.active;
  if v_type is distinct from 'expense' then
    raise exception 'EXPENSE_ACCOUNT_INVALID';
  end if;
  select a.account_type into v_type from public.gl_accounts a where a.id = new.payment_account_id and a.active;
  if v_type is distinct from 'asset' and v_type is distinct from 'liability' then
    raise exception 'PAYMENT_ACCOUNT_INVALID';
  end if;

  select coalesce(t.currency_decimals, 2) into v_decimals from public.tenants t where t.id = new.tenant_id;
  new.amount := round(new.amount, coalesce(v_decimals, 2));
  new.tax_amount := round(new.tax_amount, coalesce(v_decimals, 2));
  new.total := new.amount + new.tax_amount;

  if tg_op = 'INSERT' then
    new.status := 'draft';
    new.journal_entry_id := null;
    return new;
  end if;
  if new.status is distinct from old.status then
    if not ((old.status = 'draft' and new.status in ('approved', 'rejected'))
            or (old.status = 'approved' and new.status in ('draft', 'rejected'))
            -- Only finance_post_expense links an entry, so only it can post.
            or (old.status = 'approved' and new.status = 'posted' and new.journal_entry_id is not null)
            -- ...and only finance_reverse_entry unlinks it again.
            or (old.status = 'posted' and new.status = 'approved' and new.journal_entry_id is null)) then
      raise exception 'ILLEGAL_EXPENSE_TRANSITION';
    end if;
    if new.status = 'approved' and old.status = 'draft' then
      new.approved_at := now();
      new.approved_by := auth.uid();
    elsif new.status = 'draft' then
      new.approved_at := null;
      new.approved_by := null;
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function app.expense_guard() from public, anon, authenticated;

create trigger expenses_number
  before insert or update of number, doc_number on public.expenses
  for each row execute function app.assign_doc_number('expense', 'EXP');
create trigger expenses_guard before insert or update or delete on public.expenses
  for each row execute function app.expense_guard();
create trigger expenses_stamp_actor before insert or update on public.expenses
  for each row execute function app.stamp_actor();
create trigger expenses_same_tenant before insert or update of category_account_id, payment_account_id, supplier_id, vehicle_id
  on public.expenses
  for each row execute function app.assert_same_tenant('category_account_id', 'gl_accounts', 'payment_account_id', 'gl_accounts',
    'supplier_id', 'suppliers', 'vehicle_id', 'vehicles');
create trigger expenses_audit after insert or update or delete on public.expenses
  for each row execute function app.log_audit();

create or replace function app.finance_settings_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if jsonb_typeof(new.accounts) is distinct from 'object' then
    raise exception 'FORBIDDEN';
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;
revoke execute on function app.finance_settings_guard() from public, anon, authenticated;
create trigger finance_settings_guard before insert or update on public.finance_settings
  for each row execute function app.finance_settings_guard();
create trigger finance_settings_audit after insert or update or delete on public.finance_settings
  for each row execute function app.log_audit();

-- ============================================================
-- Setup
-- ============================================================
create or replace function app.finance_require(p_manager boolean default true)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id();
begin
  if v_tenant is null or (p_manager and not app.is_manager()) then
    raise exception 'FORBIDDEN';
  end if;
  if not app.module_enabled('finance') then
    raise exception 'MODULE_DISABLED';
  end if;
  return v_tenant;
end;
$$;
revoke execute on function app.finance_require(boolean) from public, anon, authenticated;

create or replace function app.finance_setup_core(p_tenant uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_added integer;
  v_map jsonb;
begin
  with chart(code, name, name_ar, account_type, key) as (values
    ('1000', 'Cash', 'النقدية', 'asset', 'cash'),
    ('1010', 'Bank', 'البنك', 'asset', 'bank'),
    ('1100', 'Accounts receivable', 'الذمم المدينة', 'asset', 'receivable'),
    ('1200', 'Inventory', 'المخزون', 'asset', 'inventory'),
    ('1300', 'VAT input', 'ضريبة المدخلات', 'asset', 'vat_input'),
    ('1500', 'Vehicles and equipment', 'المركبات والمعدات', 'asset', null),
    ('1590', 'Accumulated depreciation', 'مجمع الإهلاك', 'asset', null),
    ('2000', 'Accounts payable', 'الذمم الدائنة', 'liability', 'payable'),
    ('2100', 'VAT output', 'ضريبة المخرجات', 'liability', 'vat_output'),
    ('2200', 'Payroll liabilities', 'التزامات الرواتب', 'liability', 'payroll_liabilities'),
    ('3000', 'Owner''s equity', 'حقوق الملكية', 'equity', 'equity'),
    ('3100', 'Retained earnings', 'الأرباح المحتجزة', 'equity', 'retained_earnings'),
    ('4000', 'Sales revenue', 'إيرادات المبيعات', 'income', 'revenue'),
    ('4100', 'Service revenue', 'إيرادات الخدمات', 'income', null),
    ('4200', 'Freight revenue', 'إيرادات الشحن', 'income', null),
    ('4900', 'Other income', 'إيرادات أخرى', 'income', null),
    ('5000', 'Cost of goods sold', 'تكلفة البضاعة المباعة', 'expense', null),
    ('5050', 'Purchases', 'المشتريات', 'expense', 'purchases'),
    ('6000', 'Fuel expense', 'مصروف الوقود', 'expense', null),
    ('6100', 'Maintenance expense', 'مصروف الصيانة', 'expense', null),
    ('6200', 'Insurance expense', 'مصروف التأمين', 'expense', null),
    ('6300', 'Salaries expense', 'مصروف الرواتب', 'expense', 'salaries'),
    ('6400', 'Depreciation', 'الإهلاك', 'expense', null),
    ('6500', 'Rent', 'الإيجار', 'expense', null),
    ('6600', 'Utilities', 'المرافق', 'expense', null),
    ('6700', 'Bank charges', 'الرسوم البنكية', 'expense', null),
    ('6900', 'Other expense', 'مصروفات أخرى', 'expense', null)
  ), ins as (
    insert into public.gl_accounts (tenant_id, code, name, name_ar, account_type, is_system)
    select p_tenant, c.code, c.name, c.name_ar, c.account_type, c.key is not null from chart c
    on conflict (tenant_id, code) do nothing
    returning 1
  )
  select count(*)::integer into v_added from ins;

  select coalesce(jsonb_object_agg(m.key, a.id), '{}'::jsonb) into v_map
  from (values ('cash', '1000'), ('bank', '1010'), ('receivable', '1100'), ('inventory', '1200'), ('vat_input', '1300'),
               ('payable', '2000'), ('vat_output', '2100'), ('payroll_liabilities', '2200'), ('equity', '3000'),
               ('retained_earnings', '3100'), ('revenue', '4000'), ('purchases', '5050'), ('salaries', '6300')) m(key, code)
  join public.gl_accounts a on a.tenant_id = p_tenant and a.code = m.code;

  -- Keep any mapping the tenant already changed; fill the gaps.
  insert into public.finance_settings (tenant_id, accounts) values (p_tenant, v_map)
  on conflict (tenant_id) do update set accounts = excluded.accounts || public.finance_settings.accounts;
  return v_added;
end;
$$;
revoke execute on function app.finance_setup_core(uuid) from public, anon, authenticated;

create or replace function public.finance_setup()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  return app.finance_setup_core(app.finance_require());
end;
$$;
revoke execute on function public.finance_setup() from public, anon;
grant execute on function public.finance_setup() to authenticated;

-- ============================================================
-- Posting
-- ============================================================
create or replace function app.finance_account(p_tenant uuid, p_key text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select a.id into v_id
  from public.finance_settings s
  join public.gl_accounts a on a.id = nullif(s.accounts ->> p_key, '')::uuid and a.tenant_id = p_tenant
  where s.tenant_id = p_tenant;
  if v_id is null then
    raise exception 'FINANCE_NOT_SET_UP';
  end if;
  return v_id;
end;
$$;
revoke execute on function app.finance_account(uuid, text) from public, anon, authenticated;

-- Posts a balanced entry for a source. p_lines: [{account_id, debit, credit,
-- description?, vehicle_id?, customer_id?, supplier_id?}]; zero lines are
-- dropped. Returns the live entry for the source if one already exists.
create or replace function app.finance_post(p_tenant uuid, p_date date, p_memo text, p_source_type text, p_source_id uuid, p_lines jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry uuid;
  v_decimals integer;
  v_debit numeric := 0;
  v_credit numeric := 0;
  l jsonb;
  i integer := 0;
begin
  if p_source_type <> 'manual' then
    select e.id into v_entry from public.journal_entries e
    where e.tenant_id = p_tenant and e.source_type = p_source_type and e.source_id = p_source_id
      and e.status = 'posted' and e.reversal_of is null;
    if v_entry is not null then
      return v_entry;
    end if;
  end if;
  select coalesce(t.currency_decimals, 2) into v_decimals from public.tenants t where t.id = p_tenant;

  insert into public.journal_entries (tenant_id, entry_date, memo, source_type, source_id)
  values (p_tenant, p_date, left(p_memo, 500), p_source_type, p_source_id)
  returning id into v_entry;
  for l in select * from jsonb_array_elements(p_lines) loop
    if round(coalesce((l->>'debit')::numeric, 0), v_decimals) = 0 and round(coalesce((l->>'credit')::numeric, 0), v_decimals) = 0 then
      continue;
    end if;
    i := i + 1;
    insert into public.journal_lines (tenant_id, entry_id, account_id, sort_order, description, debit, credit,
                                      vehicle_id, customer_id, supplier_id)
    values (p_tenant, v_entry, (l->>'account_id')::uuid, i, left(l->>'description', 300),
            round(coalesce((l->>'debit')::numeric, 0), v_decimals), round(coalesce((l->>'credit')::numeric, 0), v_decimals),
            nullif(l->>'vehicle_id', '')::uuid, nullif(l->>'customer_id', '')::uuid, nullif(l->>'supplier_id', '')::uuid);
    v_debit := v_debit + round(coalesce((l->>'debit')::numeric, 0), v_decimals);
    v_credit := v_credit + round(coalesce((l->>'credit')::numeric, 0), v_decimals);
  end loop;
  if v_debit <> v_credit or v_debit = 0 then
    raise exception 'JOURNAL_UNBALANCED';
  end if;
  update public.journal_entries set status = 'posted' where id = v_entry;
  return v_entry;
end;
$$;
revoke execute on function app.finance_post(uuid, date, text, text, uuid, jsonb) from public, anon, authenticated;

create or replace function public.finance_post_entry(p_entry_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.finance_require();
  v_entry public.journal_entries;
  v_debit numeric;
  v_credit numeric;
  v_lines integer;
begin
  select * into v_entry from public.journal_entries e where e.id = p_entry_id and e.tenant_id = v_tenant for update;
  if v_entry.id is null then
    raise exception 'FINANCE_SOURCE_NOT_FOUND';
  end if;
  if v_entry.status <> 'draft' then
    raise exception 'JOURNAL_LOCKED';
  end if;
  select coalesce(sum(debit), 0), coalesce(sum(credit), 0), count(*) into v_debit, v_credit, v_lines
  from public.journal_lines where entry_id = p_entry_id;
  if v_lines < 2 or v_debit <> v_credit or v_debit = 0 then
    raise exception 'JOURNAL_UNBALANCED';
  end if;
  if exists (select 1 from public.journal_lines l join public.gl_accounts a on a.id = l.account_id
             where l.entry_id = p_entry_id and not a.active) then
    raise exception 'ACCOUNT_INACTIVE';
  end if;
  update public.journal_entries set status = 'posted', total = v_debit where id = p_entry_id;
  return p_entry_id;
end;
$$;
revoke execute on function public.finance_post_entry(uuid) from public, anon;
grant execute on function public.finance_post_entry(uuid) to authenticated;

create or replace function app.finance_reverse_core(p_tenant uuid, p_entry_id uuid, p_date date, p_memo text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry public.journal_entries;
  v_new uuid;
begin
  select * into v_entry from public.journal_entries e where e.id = p_entry_id and e.tenant_id = p_tenant for update;
  if v_entry.id is null or v_entry.status <> 'posted' or v_entry.reversal_of is not null then
    raise exception 'ENTRY_NOT_REVERSIBLE';
  end if;
  insert into public.journal_entries (tenant_id, entry_date, memo, source_type, source_id, reversal_of)
  values (p_tenant, p_date, left(coalesce(p_memo, 'Reversal of ' || coalesce(v_entry.doc_number, '')), 500),
          v_entry.source_type, v_entry.source_id, v_entry.id)
  returning id into v_new;
  insert into public.journal_lines (tenant_id, entry_id, account_id, sort_order, description, debit, credit,
                                    vehicle_id, customer_id, supplier_id)
  select p_tenant, v_new, l.account_id, l.sort_order, l.description, l.credit, l.debit, l.vehicle_id, l.customer_id, l.supplier_id
  from public.journal_lines l where l.entry_id = v_entry.id;
  update public.journal_entries set status = 'posted' where id = v_new;
  update public.journal_entries set status = 'reversed', reversed_by = v_new where id = v_entry.id;
  -- An expense whose entry is reversed goes back to approved.
  update public.expenses set status = 'approved', journal_entry_id = null
   where journal_entry_id = v_entry.id and status = 'posted';
  return v_new;
end;
$$;
revoke execute on function app.finance_reverse_core(uuid, uuid, date, text) from public, anon, authenticated;

create or replace function public.finance_reverse_entry(p_entry_id uuid, p_date date default null, p_memo text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.finance_require();
  v_today date;
begin
  select (now() at time zone coalesce(t.timezone, 'UTC'))::date into v_today from public.tenants t where t.id = v_tenant;
  return app.finance_reverse_core(v_tenant, p_entry_id, coalesce(p_date, v_today), nullif(btrim(coalesce(p_memo, '')), ''));
end;
$$;
revoke execute on function public.finance_reverse_entry(uuid, date, text) from public, anon;
grant execute on function public.finance_reverse_entry(uuid, date, text) to authenticated;

create or replace function app.finance_post_expense_core(p_tenant uuid, p_expense_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exp public.expenses;
  v_entry uuid;
begin
  select * into v_exp from public.expenses e where e.id = p_expense_id and e.tenant_id = p_tenant for update;
  if v_exp.id is null then
    raise exception 'FINANCE_SOURCE_NOT_FOUND';
  end if;
  if v_exp.status = 'posted' and v_exp.journal_entry_id is not null then
    return v_exp.journal_entry_id;
  end if;
  if v_exp.status <> 'approved' then
    raise exception 'ILLEGAL_EXPENSE_TRANSITION';
  end if;
  v_entry := app.finance_post(p_tenant, v_exp.expense_date,
    coalesce(v_exp.doc_number, '') || ' ' || v_exp.description, 'expense', v_exp.id,
    jsonb_build_array(
      jsonb_build_object('account_id', v_exp.category_account_id, 'debit', v_exp.amount, 'description', v_exp.description,
                         'vehicle_id', v_exp.vehicle_id, 'supplier_id', v_exp.supplier_id),
      jsonb_build_object('account_id', case when v_exp.tax_amount > 0 then app.finance_account(p_tenant, 'vat_input') end,
                         'debit', v_exp.tax_amount, 'description', 'VAT'),
      jsonb_build_object('account_id', v_exp.payment_account_id, 'credit', v_exp.total, 'supplier_id', v_exp.supplier_id)));
  update public.expenses set status = 'posted', journal_entry_id = v_entry where id = v_exp.id;
  return v_entry;
end;
$$;
revoke execute on function app.finance_post_expense_core(uuid, uuid) from public, anon, authenticated;

create or replace function public.finance_post_expense(p_expense_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  return app.finance_post_expense_core(app.finance_require(), p_expense_id);
end;
$$;
revoke execute on function public.finance_post_expense(uuid) from public, anon;
grant execute on function public.finance_post_expense(uuid) to authenticated;

create or replace function app.finance_post_invoice_core(p_tenant uuid, p_invoice_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invoices;
begin
  select * into v_inv from public.invoices i where i.id = p_invoice_id and i.tenant_id = p_tenant;
  if v_inv.id is null or v_inv.status not in ('issued', 'partially_paid', 'paid') then
    raise exception 'FINANCE_SOURCE_NOT_FOUND';
  end if;
  return app.finance_post(p_tenant, v_inv.issue_date, 'Invoice ' || coalesce(v_inv.doc_number, ''), 'invoice', v_inv.id,
    jsonb_build_array(
      jsonb_build_object('account_id', app.finance_account(p_tenant, 'receivable'), 'debit', v_inv.total,
                         'customer_id', v_inv.customer_id, 'vehicle_id', v_inv.vehicle_id),
      jsonb_build_object('account_id', app.finance_account(p_tenant, 'revenue'), 'credit', v_inv.total - v_inv.tax_total,
                         'customer_id', v_inv.customer_id, 'vehicle_id', v_inv.vehicle_id),
      jsonb_build_object('account_id', case when v_inv.tax_total > 0 then app.finance_account(p_tenant, 'vat_output') end,
                         'credit', v_inv.tax_total, 'description', 'VAT')));
end;
$$;
revoke execute on function app.finance_post_invoice_core(uuid, uuid) from public, anon, authenticated;

create or replace function app.finance_post_payment_core(p_tenant uuid, p_payment_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay public.payments;
  v_inv public.invoices;
begin
  select * into v_pay from public.payments p where p.id = p_payment_id and p.tenant_id = p_tenant;
  if v_pay.id is null then
    raise exception 'FINANCE_SOURCE_NOT_FOUND';
  end if;
  select * into v_inv from public.invoices i where i.id = v_pay.invoice_id;
  return app.finance_post(p_tenant, v_pay.paid_at,
    'Payment for ' || coalesce(v_inv.doc_number, '') || coalesce(' · ' || v_pay.reference, ''), 'payment', v_pay.id,
    jsonb_build_array(
      jsonb_build_object('account_id', app.finance_account(p_tenant, case when v_pay.method = 'cash' then 'cash' else 'bank' end),
                         'debit', v_pay.amount, 'customer_id', v_inv.customer_id),
      jsonb_build_object('account_id', app.finance_account(p_tenant, 'receivable'), 'credit', v_pay.amount,
                         'customer_id', v_inv.customer_id)));
end;
$$;
revoke execute on function app.finance_post_payment_core(uuid, uuid) from public, anon, authenticated;

-- Purchasing and payroll are read dynamically: their tables may not exist.
create or replace function app.finance_post_vendor_bill_core(p_tenant uuid, p_bill_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  if to_regclass('public.vendor_bills') is null then
    raise exception 'FINANCE_SOURCE_NOT_FOUND';
  end if;
  execute 'select id, doc_number, supplier_invoice_number, supplier_id, bill_date, total, tax_total, status
           from public.vendor_bills where id = $1 and tenant_id = $2'
    into r using p_bill_id, p_tenant;
  if r.id is null or r.status not in ('open', 'partially_paid', 'paid') then
    raise exception 'FINANCE_SOURCE_NOT_FOUND';
  end if;
  return app.finance_post(p_tenant, r.bill_date::date,
    'Bill ' || coalesce(r.doc_number, '') || coalesce(' · ' || r.supplier_invoice_number, ''), 'vendor_bill', r.id,
    jsonb_build_array(
      jsonb_build_object('account_id', app.finance_account(p_tenant, 'purchases'), 'debit', r.total - r.tax_total,
                         'supplier_id', r.supplier_id),
      jsonb_build_object('account_id', case when r.tax_total > 0 then app.finance_account(p_tenant, 'vat_input') end,
                         'debit', r.tax_total, 'description', 'VAT'),
      jsonb_build_object('account_id', app.finance_account(p_tenant, 'payable'), 'credit', r.total, 'supplier_id', r.supplier_id)));
end;
$$;
revoke execute on function app.finance_post_vendor_bill_core(uuid, uuid) from public, anon, authenticated;

create or replace function app.finance_post_vendor_payment_core(p_tenant uuid, p_payment_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  if to_regclass('public.vendor_payments') is null then
    raise exception 'FINANCE_SOURCE_NOT_FOUND';
  end if;
  execute 'select p.id, p.paid_at, p.amount, p.method, p.reference, b.doc_number, b.supplier_id
           from public.vendor_payments p join public.vendor_bills b on b.id = p.vendor_bill_id
           where p.id = $1 and p.tenant_id = $2'
    into r using p_payment_id, p_tenant;
  if r.id is null then
    raise exception 'FINANCE_SOURCE_NOT_FOUND';
  end if;
  return app.finance_post(p_tenant, r.paid_at::date,
    'Payment of ' || coalesce(r.doc_number, '') || coalesce(' · ' || r.reference, ''), 'vendor_payment', r.id,
    jsonb_build_array(
      jsonb_build_object('account_id', app.finance_account(p_tenant, 'payable'), 'debit', r.amount, 'supplier_id', r.supplier_id),
      jsonb_build_object('account_id', app.finance_account(p_tenant, case when r.method = 'cash' then 'cash' else 'bank' end),
                         'credit', r.amount, 'supplier_id', r.supplier_id)));
end;
$$;
revoke execute on function app.finance_post_vendor_payment_core(uuid, uuid) from public, anon, authenticated;

create or replace function app.finance_post_payroll_core(p_tenant uuid, p_run_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  if to_regclass('public.payroll_runs') is null then
    raise exception 'FINANCE_SOURCE_NOT_FOUND';
  end if;
  execute 'select id, doc_number, status, paid_at, pay_date, period_end, total_gross, total_deductions, total_net,
                  total_employer_cost
           from public.payroll_runs where id = $1 and tenant_id = $2'
    into r using p_run_id, p_tenant;
  if r.id is null or r.status <> 'paid' then
    raise exception 'FINANCE_SOURCE_NOT_FOUND';
  end if;
  -- Gross pay and employer contributions are the cost; net pay leaves the
  -- bank; deductions and contributions are owed until remitted.
  return app.finance_post(p_tenant, coalesce(r.paid_at::date, r.pay_date::date, r.period_end::date), 'Payroll ' || coalesce(r.doc_number, ''),
    'payroll', r.id,
    jsonb_build_array(
      jsonb_build_object('account_id', app.finance_account(p_tenant, 'salaries'), 'debit', r.total_gross + r.total_employer_cost),
      jsonb_build_object('account_id', app.finance_account(p_tenant, 'bank'), 'credit', r.total_net),
      jsonb_build_object('account_id', app.finance_account(p_tenant, 'payroll_liabilities'),
                         'credit', r.total_gross + r.total_employer_cost - r.total_net)));
end;
$$;
revoke execute on function app.finance_post_payroll_core(uuid, uuid) from public, anon, authenticated;

create or replace function public.finance_post_invoice(p_invoice_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  return app.finance_post_invoice_core(app.finance_require(), p_invoice_id);
end;
$$;
create or replace function public.finance_post_payment(p_payment_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  return app.finance_post_payment_core(app.finance_require(), p_payment_id);
end;
$$;
create or replace function public.finance_post_vendor_bill(p_bill_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  return app.finance_post_vendor_bill_core(app.finance_require(), p_bill_id);
end;
$$;
create or replace function public.finance_post_vendor_payment(p_payment_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  return app.finance_post_vendor_payment_core(app.finance_require(), p_payment_id);
end;
$$;
create or replace function public.finance_post_payroll(p_run_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  return app.finance_post_payroll_core(app.finance_require(), p_run_id);
end;
$$;
revoke execute on function public.finance_post_invoice(uuid), public.finance_post_payment(uuid),
  public.finance_post_vendor_bill(uuid), public.finance_post_vendor_payment(uuid), public.finance_post_payroll(uuid)
  from public, anon;
grant execute on function public.finance_post_invoice(uuid), public.finance_post_payment(uuid),
  public.finance_post_vendor_bill(uuid), public.finance_post_vendor_payment(uuid), public.finance_post_payroll(uuid)
  to authenticated;

-- What is waiting to be posted (or reversed), per source type.
create or replace function app.finance_pending(p_tenant uuid)
returns table (source_type text, source_id uuid, action text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
    select 'invoice'::text, i.id, 'post'::text from public.invoices i
    where i.tenant_id = p_tenant and i.status in ('issued', 'partially_paid', 'paid')
      and not exists (select 1 from public.journal_entries e where e.tenant_id = p_tenant and e.source_type = 'invoice'
                        and e.source_id = i.id and e.status = 'posted' and e.reversal_of is null)
    union all
    select 'payment', p.id, 'post' from public.payments p
    where p.tenant_id = p_tenant
      and not exists (select 1 from public.journal_entries e where e.tenant_id = p_tenant and e.source_type = 'payment'
                        and e.source_id = p.id and e.status = 'posted' and e.reversal_of is null)
    union all
    select 'expense', x.id, 'post' from public.expenses x where x.tenant_id = p_tenant and x.status = 'approved'
    union all
    -- Live entries whose source was voided or deleted.
    select e.source_type, e.id, 'reverse' from public.journal_entries e
    where e.tenant_id = p_tenant and e.status = 'posted' and e.reversal_of is null
      and ((e.source_type = 'invoice' and not exists (select 1 from public.invoices i where i.id = e.source_id
                                                        and i.status in ('issued', 'partially_paid', 'paid')))
           or (e.source_type = 'payment' and not exists (select 1 from public.payments p where p.id = e.source_id)));

  if to_regclass('public.vendor_bills') is not null then
    return query execute
      'select ''vendor_bill''::text, b.id, ''post''::text from public.vendor_bills b
       where b.tenant_id = $1 and b.status in (''open'', ''partially_paid'', ''paid'')
         and not exists (select 1 from public.journal_entries e where e.tenant_id = $1 and e.source_type = ''vendor_bill''
                           and e.source_id = b.id and e.status = ''posted'' and e.reversal_of is null)
       union all
       select ''vendor_payment'', p.id, ''post'' from public.vendor_payments p
       where p.tenant_id = $1
         and not exists (select 1 from public.journal_entries e where e.tenant_id = $1 and e.source_type = ''vendor_payment''
                           and e.source_id = p.id and e.status = ''posted'' and e.reversal_of is null)
       union all
       select e.source_type, e.id, ''reverse'' from public.journal_entries e
       where e.tenant_id = $1 and e.status = ''posted'' and e.reversal_of is null
         and ((e.source_type = ''vendor_bill'' and not exists (select 1 from public.vendor_bills b where b.id = e.source_id
                                                               and b.status in (''open'', ''partially_paid'', ''paid'')))
              or (e.source_type = ''vendor_payment'' and not exists (select 1 from public.vendor_payments p where p.id = e.source_id)))'
      using p_tenant;
  end if;
  if to_regclass('public.payroll_runs') is not null then
    return query execute
      'select ''payroll''::text, r.id, ''post''::text from public.payroll_runs r
       where r.tenant_id = $1 and r.status = ''paid''
         and not exists (select 1 from public.journal_entries e where e.tenant_id = $1 and e.source_type = ''payroll''
                           and e.source_id = r.id and e.status = ''posted'' and e.reversal_of is null)'
      using p_tenant;
  end if;
end;
$$;
revoke execute on function app.finance_pending(uuid) from public, anon, authenticated;

create or replace function public.finance_pending_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.finance_require(false);
begin
  return coalesce((select jsonb_object_agg(k, n) from (
    select case when action = 'reverse' then 'reverse' else source_type end as k, count(*) as n
    from app.finance_pending(v_tenant) group by 1) x), '{}'::jsonb);
end;
$$;
revoke execute on function public.finance_pending_counts() from public, anon;
grant execute on function public.finance_pending_counts() to authenticated;

-- Posts everything pending. A source that cannot post (a locked period, a
-- missing account) is skipped and counted, never half-posted.
create or replace function public.finance_sync()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.finance_require();
  v_today date;
  v_lock date;
  v_posted integer := 0;
  v_reversed integer := 0;
  v_skipped integer := 0;
  r record;
begin
  perform app.finance_account(v_tenant, 'receivable');
  select (now() at time zone coalesce(t.timezone, 'UTC'))::date into v_today from public.tenants t where t.id = v_tenant;
  select s.lock_date into v_lock from public.finance_settings s where s.tenant_id = v_tenant;
  for r in select * from app.finance_pending(v_tenant) order by action, source_type loop
    begin
      if r.action = 'reverse' then
        perform app.finance_reverse_core(v_tenant, r.source_id, greatest(v_today, coalesce(v_lock + 1, v_today)),
                                         'Source voided or deleted');
        v_reversed := v_reversed + 1;
      else
        case r.source_type
          when 'invoice' then perform app.finance_post_invoice_core(v_tenant, r.source_id);
          when 'payment' then perform app.finance_post_payment_core(v_tenant, r.source_id);
          when 'expense' then perform app.finance_post_expense_core(v_tenant, r.source_id);
          when 'vendor_bill' then perform app.finance_post_vendor_bill_core(v_tenant, r.source_id);
          when 'vendor_payment' then perform app.finance_post_vendor_payment_core(v_tenant, r.source_id);
          when 'payroll' then perform app.finance_post_payroll_core(v_tenant, r.source_id);
        end case;
        v_posted := v_posted + 1;
      end if;
    exception when others then
      v_skipped := v_skipped + 1;
    end;
  end loop;
  return jsonb_build_object('posted', v_posted, 'reversed', v_reversed, 'skipped', v_skipped);
end;
$$;
revoke execute on function public.finance_sync() from public, anon;
grant execute on function public.finance_sync() to authenticated;

-- ============================================================
-- Reports (invoker: RLS decides what is read)
-- ============================================================
-- Posted movement per account: before p_from (opening) and within the period.
-- Reversed entries stay in (their reversal cancels them out).
create or replace function public.finance_balances(p_from date default null, p_to date default null)
returns table (account_id uuid, opening numeric, debit numeric, credit numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  select l.account_id,
         coalesce(sum(l.debit - l.credit) filter (where p_from is not null and e.entry_date < p_from), 0) as opening,
         coalesce(sum(l.debit) filter (where (p_from is null or e.entry_date >= p_from)), 0) as debit,
         coalesce(sum(l.credit) filter (where (p_from is null or e.entry_date >= p_from)), 0) as credit
  from public.journal_lines l
  join public.journal_entries e on e.id = l.entry_id
  where e.status in ('posted', 'reversed') and (p_to is null or e.entry_date <= p_to)
  group by l.account_id
$$;
revoke execute on function public.finance_balances(date, date) from public, anon;
grant execute on function public.finance_balances(date, date) to authenticated;

-- Income and expense by month (amounts in their natural sign: income as
-- credit - debit, expense as debit - credit).
create or replace function public.finance_monthly(p_from date, p_to date)
returns table (month text, account_type text, amount numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  select to_char(e.entry_date, 'YYYY-MM') as month, a.account_type,
         sum(case when a.account_type = 'income' then l.credit - l.debit else l.debit - l.credit end) as amount
  from public.journal_lines l
  join public.journal_entries e on e.id = l.entry_id
  join public.gl_accounts a on a.id = l.account_id
  where e.status in ('posted', 'reversed') and a.account_type in ('income', 'expense')
    and e.entry_date between p_from and p_to
  group by 1, 2
  order by 1, 2
$$;
revoke execute on function public.finance_monthly(date, date) from public, anon;
grant execute on function public.finance_monthly(date, date) to authenticated;

create or replace function public.finance_ledger(p_account_id uuid, p_from date, p_to date, p_limit integer default 500)
returns table (line_id uuid, entry_id uuid, doc_number text, entry_date date, memo text, description text, source_type text,
               debit numeric, credit numeric, balance numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  with opening as (
    select coalesce(sum(l.debit - l.credit), 0) as amount
    from public.journal_lines l join public.journal_entries e on e.id = l.entry_id
    where l.account_id = p_account_id and e.status in ('posted', 'reversed') and e.entry_date < p_from
  ), rows as (
    select l.id, e.id as entry_id, e.doc_number, e.entry_date, e.memo, l.description, e.source_type, l.debit, l.credit,
           e.number, l.sort_order
    from public.journal_lines l join public.journal_entries e on e.id = l.entry_id
    where l.account_id = p_account_id and e.status in ('posted', 'reversed') and e.entry_date between p_from and p_to
  )
  select r.id, r.entry_id, r.doc_number, r.entry_date, r.memo, r.description, r.source_type, r.debit, r.credit,
         (select amount from opening) + sum(r.debit - r.credit) over (order by r.entry_date, r.number, r.sort_order, r.id)
  from rows r
  order by r.entry_date, r.number, r.sort_order, r.id
  limit least(greatest(coalesce(p_limit, 500), 1), 2000)
$$;
revoke execute on function public.finance_ledger(uuid, date, date, integer) from public, anon;
grant execute on function public.finance_ledger(uuid, date, date, integer) to authenticated;

-- ============================================================
-- RLS: members read; managers write.
-- ============================================================
set local lock_timeout = '1s';
do $$
declare
  t text;
begin
  foreach t in array array['gl_accounts', 'journal_entries', 'journal_lines', 'expenses'] loop
    execute format('create policy %1$s_select on public.%1$I for select to authenticated
      using (tenant_id = (select app.tenant_id()) and (select app.module_enabled(''finance'')))', t);
    execute format('create policy %1$s_insert on public.%1$I for insert to authenticated
      with check (tenant_id = (select app.tenant_id()) and (select app.is_manager())
                  and (select app.module_enabled(''finance'')))', t);
    execute format('create policy %1$s_update on public.%1$I for update to authenticated
      using (tenant_id = (select app.tenant_id()) and (select app.is_manager())
             and (select app.module_enabled(''finance'')))
      with check (tenant_id = (select app.tenant_id()) and (select app.is_manager())
                  and (select app.module_enabled(''finance'')))', t);
    execute format('create policy %1$s_delete on public.%1$I for delete to authenticated
      using (tenant_id = (select app.tenant_id()) and (select app.is_manager())
             and (select app.module_enabled(''finance'')))', t);
  end loop;
end;
$$;
create policy finance_settings_select on public.finance_settings for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.module_enabled('finance')));
create policy finance_settings_update on public.finance_settings for update to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_manager()) and (select app.module_enabled('finance')))
  with check (tenant_id = (select app.tenant_id()) and (select app.is_manager()) and (select app.module_enabled('finance')));
