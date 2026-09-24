-- Platform foundation for the module build-out (see the module contract,
-- FOUNDATION.md §2 and §5). Every later cluster migration builds on the objects
-- created here, so this file is applied FIRST. Additive only: new helpers, new
-- tables, new nullable columns (vehicles.branch_id, drivers.branch_id), and a
-- relaxed document_sequences doc_type check. No existing behavior changes for
-- tenants that have not enabled the new modules.
--
--   1) Module gating helpers   app.module_enabled / app.tenant_module_enabled /
--                              app.require_module
--   2) Generic numbering       app.assign_doc_number() (+ public.set_document_prefix)
--   3) Generic trigger helpers ensure_single_default, guard_item_cost,
--                              inventory_item_defaults, assert_same_tenant
--   4) Master data             companies, branches, departments, employees,
--                              suppliers, supplier_contacts, warehouses,
--                              inventory_items
--   5) Stock ledger            stock_levels, stock_moves, app.post_stock_move and
--                              the stock_receive/issue/transfer/adjust RPCs
--   6) Platform horizontals    notifications (+ preferences, app.notify),
--                              domain_events (app.emit_event), documents
--                              (+ private `documents` bucket), api_keys
--                              (create_api_key / revoke_api_key)
--   7) Time-based scans        notification_state + public.refresh_notifications,
--                              which runs every app.scan_due_<suffix>(uuid) found
--
-- Lock layout (production safety): everything that takes a contended lock is
-- at the END of the file, so those locks are held for milliseconds:
--   section 17  ALTERs on existing tables (document_sequences, vehicles,
--               drivers: ACCESS EXCLUSIVE),
--   section 18  every CREATE POLICY (each one takes ACCESS EXCLUSIVE on ~23
--               auth/storage/realtime tables on this project) + the bucket,
-- both under a 1 s lock timeout.
--
-- Posture (same as 20260720000002 / 20260726000001):
--   * SECURITY DEFINER functions pin search_path = '', fully qualify names and
--     re-assert tenant + role + module themselves (definer bypasses RLS).
--   * Internal app.* definer helpers (notify, emit_event, post_stock_move,
--     alert_low_stock, assert_same_tenant) are revoked from clients; only
--     definer callers and triggers may use them.
--   * RLS on every new table, gated by the owning module:
--     tenant_id = app.tenant_id() and (select app.module_enabled('<module>')).
--   * Server-maintained tables (ledgers, events, scan state) get a select
--     policy only, plus revoked write privileges as defence in depth.
--   * Client-writable FKs to tenant-owned parents are checked by
--     app.assert_same_tenant (a manager cannot pin or squat another tenant's
--     rows by guessing their uuids).
--
-- Declared deviations from the FOUNDATION §1 table template:
--   * stock_moves is an append-only ledger: created_by (default auth.uid()) +
--     created_at only; no updated_* columns, no stamp_actor/updated_at/audit.
--   * notifications, notification_state and domain_events are system-written
--     (app.notify / refresh_notifications / app.emit_event): no created_by /
--     updated_by, no audit. notifications.read_at is the only client-updatable
--     column and is its own timestamp, so there is no updated_at.
--   * notification_preferences rows belong to user_id (the only writer), so
--     there is no created_by/updated_by or stamp_actor; updated_at is kept.
--   * api_keys: updated_at / stamp_actor / audit fire only for meaningful
--     columns, never for the per-request last_used_at stamp.
--   * employees is readable by managers + the linked user only (HR data), and
--     documents attached to employees ('employee' / 'hr_*' entity types)
--     follow that restriction.

set local lock_timeout = '3s';
set local statement_timeout = '60s';

-- ============================================================
-- 1) Module gating helpers.
-- ============================================================

-- Policies call this as the requesting user: always wrap it as
-- `(select app.module_enabled('x'))` so it is evaluated once per statement.
create or replace function app.module_enabled(p_module text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tenant_modules tm
    where tm.tenant_id = app.tenant_id()
      and tm.module_id = p_module
      and tm.enabled
  );
$$;
revoke execute on function app.module_enabled(text) from public, anon;
grant execute on function app.module_enabled(text) to authenticated, service_role;

-- Same check for an explicit tenant, for triggers and definer code.
-- Granted to authenticated as well: SECURITY INVOKER trigger functions on
-- existing tables (FOUNDATION §0.2) run as the writing user and gate on it; a
-- missing grant there would silently turn the trigger into a no-op.
create or replace function app.tenant_module_enabled(p_tenant uuid, p_module text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tenant_modules tm
    where tm.tenant_id = p_tenant
      and tm.module_id = p_module
      and tm.enabled
  );
$$;
revoke execute on function app.tenant_module_enabled(uuid, text) from public, anon;
grant execute on function app.tenant_module_enabled(uuid, text) to authenticated, service_role;

-- One-line guard for definer RPCs: resolves the caller's tenant and asserts
-- the role level ('member' | 'manager' | 'admin') and that the module is on.
-- Raises NO_TENANT / FORBIDDEN / MODULE_DISABLED. Returns the tenant id.
create or replace function app.require_module(p_module text, p_level text default 'manager')
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id();
  v_allowed boolean;
begin
  if v_tenant is null then
    raise exception 'NO_TENANT';
  end if;
  v_allowed := case coalesce(p_level, 'manager')
                 when 'member' then true
                 when 'manager' then coalesce(app.is_manager(), false)
                 when 'admin' then coalesce(app.is_admin(), false)
                 else false
               end;
  if not v_allowed then
    raise exception 'FORBIDDEN';
  end if;
  if p_module is not null and not app.tenant_module_enabled(v_tenant, p_module) then
    raise exception 'MODULE_DISABLED';
  end if;
  return v_tenant;
end;
$$;
revoke execute on function app.require_module(text, text) from public, anon;
grant execute on function app.require_module(text, text) to authenticated, service_role;

-- ============================================================
-- 2) Generic document numbering.
--    document_sequences accepts any well-formed doc type and gets a per-tenant
--    prefix override (both changes are at the END of this file, section 18).
--    The sales documents keep their prefixes in sales_settings, certificates
--    in sl_settings.
--
--    Usage on a numbered table (columns `number integer`, `doc_number text`):
--      create trigger <t>_number
--        before insert or update of number, doc_number on public.<t>
--        for each row execute function app.assign_doc_number('<doc_type>', '<PREFIX>');
--      create unique index <t>_tenant_number_uk on public.<t> (tenant_id, number);
--      create unique index <t>_tenant_doc_number_uk on public.<t> (tenant_id, doc_number);
--
--    Client writes (the SET ROLE is authenticated/anon: every PostgREST call,
--    including definer RPCs the SPA invokes) never choose numbers: on INSERT
--    any supplied number/doc_number is replaced by a fresh allocation, on
--    UPDATE both columns are kept. Only trusted sessions (service_role, direct
--    SQL / migrations) may import an explicit number in 1..99,999,999, and the
--    counter is advanced past it so later allocations cannot collide.
-- ============================================================
create or replace function app.assign_doc_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
  v_prefix text;
  -- current_user is the definer here; the SET ROLE of the session is not.
  v_trusted boolean :=
    coalesce(nullif(current_setting('role', true), ''), 'none') not in ('authenticated', 'anon');
begin
  if tg_op = 'UPDATE' then
    if not v_trusted then
      new.number := old.number;
      new.doc_number := old.doc_number;
    elsif new.number is distinct from old.number then
      if new.number is null or new.number not between 1 and 99999999 then
        raise exception 'INVALID_DOC_NUMBER';
      end if;
      insert into public.document_sequences as ds (tenant_id, doc_type, next_number)
      values (new.tenant_id, tg_argv[0], new.number + 1)
      on conflict (tenant_id, doc_type)
      do update set next_number = greatest(ds.next_number, excluded.next_number);
    end if;
    return new;
  end if;

  if not v_trusted then
    new.number := null;
    new.doc_number := null;
  end if;

  if new.number is null then
    v_n := app.next_doc_number(new.tenant_id, tg_argv[0]);
    new.number := v_n;
  else
    v_n := new.number;
    if v_n not between 1 and 99999999 then
      raise exception 'INVALID_DOC_NUMBER';
    end if;
    insert into public.document_sequences as ds (tenant_id, doc_type, next_number)
    values (new.tenant_id, tg_argv[0], v_n + 1)
    on conflict (tenant_id, doc_type)
    do update set next_number = greatest(ds.next_number, excluded.next_number);
    if new.doc_number is not null then
      return new;
    end if;
  end if;
  -- Read the override after allocation: the sequence row exists by now.
  select nullif(btrim(ds.prefix), '') into v_prefix
  from public.document_sequences ds
  where ds.tenant_id = new.tenant_id and ds.doc_type = tg_argv[0];
  -- lpad() truncates longer strings, so only pad below five digits.
  new.doc_number := coalesce(v_prefix, tg_argv[1]) || '-'
    || case when v_n >= 10000 then v_n::text else lpad(v_n::text, 5, '0') end;
  return new;
end;
$$;
revoke execute on function app.assign_doc_number() from public, anon, authenticated;

-- Admin RPC: set (or clear, with null/'') the prefix of a generically
-- numbered doc type for the caller's tenant. Legacy types keep their own
-- settings tables and are rejected.
create or replace function public.set_document_prefix(p_doc_type text, p_prefix text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.require_module(null, 'admin');
  v_prefix text := nullif(btrim(p_prefix), '');
begin
  if p_doc_type is null
     or p_doc_type !~ '^[a-z][a-z0-9_]{1,40}$'
     or p_doc_type in ('work_order', 'sl_job', 'sl_certificate', 'quote', 'sales_order', 'invoice') then
    raise exception 'INVALID_DOC_TYPE';
  end if;
  if v_prefix is not null and v_prefix !~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,15}$' then
    raise exception 'INVALID_DOC_PREFIX';
  end if;
  insert into public.document_sequences as ds (tenant_id, doc_type, next_number, prefix)
  values (v_tenant, p_doc_type, 1, v_prefix)
  on conflict (tenant_id, doc_type) do update set prefix = excluded.prefix;
end;
$$;
revoke execute on function public.set_document_prefix(text, text) from public, anon;
grant execute on function public.set_document_prefix(text, text) to authenticated;

-- ============================================================
-- 3) Small generic trigger helpers.
-- ============================================================

-- "One default per tenant": setting is_default on a row clears it on the
-- tenant's other rows first, so the partial unique index never trips in
-- normal use. Runs as the writing user (RLS applies to the clearing update).
create or replace function app.ensure_single_default()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.is_default and (tg_op = 'INSERT' or not coalesce(old.is_default, false)) then
    execute format(
      'update public.%I set is_default = false where tenant_id = $1 and id <> $2 and is_default',
      tg_table_name)
    using new.tenant_id, new.id;
  end if;
  return new;
end;
$$;

-- inventory_items.cost_price is a server-maintained moving average. Client
-- updates (forms that post the whole row) must not clobber it; only the
-- definer stock ledger (running as the function owner) may change it.
create or replace function app.guard_item_cost()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.cost_price is distinct from old.cost_price
     and current_user in ('authenticated', 'anon') then
    new.cost_price := old.cost_price;
  end if;
  return new;
end;
$$;

-- Forms send blank optional inputs as null (`x.trim() || null`), and a column
-- default only applies when the column is omitted. Normalize the two NOT NULL
-- inventory columns a form may blank instead of failing with 23502.
create or replace function app.inventory_item_defaults()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.uom := coalesce(nullif(btrim(new.uom), ''), 'unit');
  if new.cost_price is null then
    new.cost_price := case when tg_op = 'UPDATE' then old.cost_price else 0 end;
  end if;
  return new;
end;
$$;

-- Cross-tenant reference guard for client-writable FKs. Arguments are pairs
-- (column, parent table in public); each non-null (changed) value must be a
-- row of the parent table with the same tenant_id as NEW. Definer, so module
-- gating / RLS on the parent cannot hide a legitimate parent. Not-found and
-- other-tenant raise the same error (no existence oracle). Usage:
--   create trigger <t>_same_tenant before insert or update of <cols> on public.<t>
--     for each row execute function app.assert_same_tenant('<col>', '<parent>', ...);
create or replace function app.assert_same_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new jsonb := to_jsonb(new);
  v_old jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
  v_col text;
  v_id text;
  v_ok boolean;
  i integer := 0;
begin
  while i + 1 < tg_nargs loop
    v_col := tg_argv[i];
    v_id := v_new ->> v_col;
    if v_id is not null and (v_old is null or v_id is distinct from v_old ->> v_col) then
      execute format(
        'select exists (select 1 from public.%I p where p.id = $1 and p.tenant_id = $2)',
        tg_argv[i + 1])
      into v_ok using v_id::uuid, new.tenant_id;
      if not v_ok then
        raise exception 'CROSS_TENANT_REFERENCE: %', v_col;
      end if;
    end if;
    i := i + 2;
  end loop;
  return new;
end;
$$;
revoke execute on function app.assert_same_tenant() from public, anon, authenticated;

-- ============================================================
-- 4) Master data.
--    companies / branches  -> multi_company
--    departments / employees -> employees
--    suppliers / supplier_contacts -> suppliers
--    warehouses / inventory_items / stock_* -> inventory
-- ============================================================
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  legal_name text not null check (char_length(btrim(legal_name)) between 1 and 200),
  trade_name text,
  name_ar text,
  cr_number text,
  tax_number text,
  email text,
  phone text,
  address text,
  city text,
  country text,
  currency text,
  is_default boolean not null default false,
  active boolean not null default true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index companies_tenant_name_idx on public.companies (tenant_id, legal_name);
create unique index companies_tenant_default_uk on public.companies (tenant_id) where is_default;

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  company_id uuid references public.companies(id) on delete restrict,
  code text,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  name_ar text,
  address text,
  city text,
  country text,
  phone text,
  manager_employee_id uuid, -- FK to employees added below (circular)
  active boolean not null default true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index branches_tenant_name_idx on public.branches (tenant_id, name);
create index branches_company_idx on public.branches (company_id);
create index branches_manager_idx on public.branches (manager_employee_id);
create unique index branches_tenant_code_uk on public.branches (tenant_id, lower(code))
  where code is not null;

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  name_ar text,
  code text,
  parent_id uuid references public.departments(id) on delete set null,
  manager_employee_id uuid, -- FK to employees added below (circular)
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (parent_id is null or parent_id <> id)
);
create index departments_tenant_name_idx on public.departments (tenant_id, name);
create index departments_parent_idx on public.departments (parent_id);
create index departments_manager_idx on public.departments (manager_employee_id);
create unique index departments_tenant_code_uk on public.departments (tenant_id, lower(code))
  where code is not null;

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  number integer,
  doc_number text,
  first_name text not null check (char_length(btrim(first_name)) between 1 and 100),
  last_name text,
  name_ar text,
  job_title text,
  department_id uuid references public.departments(id) on delete set null,
  branch_id uuid references public.branches(id) on delete set null,
  manager_id uuid references public.employees(id) on delete set null,
  employment_type text not null default 'full_time'
    check (employment_type in ('full_time', 'part_time', 'contract', 'temporary', 'intern')),
  status text not null default 'active'
    check (status in ('active', 'on_leave', 'suspended', 'terminated')),
  hire_date date,
  termination_date date,
  birth_date date,
  gender text check (gender in ('male', 'female')),
  nationality text, -- ISO 3166-1 alpha-2
  national_id text,
  passport_number text,
  passport_expiry date,
  residence_permit_number text,
  residence_permit_expiry date,
  work_permit_expiry date,
  email text,
  phone text,
  address text,
  emergency_contact_name text,
  emergency_contact_phone text,
  -- The employee's app login (auth user / profile), when they have one.
  user_id uuid references public.profiles(id) on delete set null,
  driver_id uuid references public.drivers(id) on delete set null,
  sl_technician_id uuid references public.sl_technicians(id) on delete set null,
  basic_salary numeric(14, 2) check (basic_salary >= 0),
  housing_allowance numeric(14, 2) check (housing_allowance >= 0),
  transport_allowance numeric(14, 2) check (transport_allowance >= 0),
  other_allowance numeric(14, 2) check (other_allowance >= 0),
  hourly_rate numeric(14, 4) check (hourly_rate >= 0),
  bank_name text,
  iban text,
  social_insurance_number text,
  notes text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (manager_id is null or manager_id <> id),
  check (termination_date is null or hire_date is null or termination_date >= hire_date)
);
create unique index employees_tenant_number_uk on public.employees (tenant_id, number);
create unique index employees_tenant_doc_number_uk on public.employees (tenant_id, doc_number);
create index employees_tenant_name_idx on public.employees (tenant_id, first_name, last_name);
create index employees_tenant_status_idx on public.employees (tenant_id, status);
create index employees_department_idx on public.employees (department_id);
create index employees_branch_idx on public.employees (branch_id);
create index employees_manager_idx on public.employees (manager_id);
create index employees_sl_technician_idx on public.employees (sl_technician_id);
-- One employee record per login / per driver. Leading column = the FK column
-- so the same index serves the FK lookups.
create unique index employees_user_uk on public.employees (user_id, tenant_id)
  where user_id is not null;
create unique index employees_driver_uk on public.employees (driver_id, tenant_id)
  where driver_id is not null;

-- These two FKs make employees<->branches and employees<->departments
-- ambiguous for PostgREST embeds: always name the FK, e.g.
--   branches!employees_branch_id_fkey(name), departments!employees_department_id_fkey(name),
--   manager:employees!branches_manager_employee_id_fkey(first_name,last_name).
alter table public.branches
  add constraint branches_manager_employee_id_fkey
  foreign key (manager_employee_id) references public.employees(id) on delete set null;
alter table public.departments
  add constraint departments_manager_employee_id_fkey
  foreign key (manager_employee_id) references public.employees(id) on delete set null;

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  number integer,
  doc_number text,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  name_ar text,
  supplier_type text not null default 'other'
    check (supplier_type in ('parts', 'fuel', 'service', 'insurance', 'carrier', 'leasing',
                             'utilities', 'equipment', 'other')),
  cr_number text,
  tax_number text,
  email text,
  phone text,
  website text,
  address text,
  city text,
  country text,
  payment_terms_days integer default 30 check (payment_terms_days >= 0),
  currency text,
  bank_name text,
  iban text,
  rating smallint check (rating between 1 and 5),
  status text not null default 'active' check (status in ('active', 'inactive', 'blocked')),
  notes text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index suppliers_tenant_number_uk on public.suppliers (tenant_id, number);
create unique index suppliers_tenant_doc_number_uk on public.suppliers (tenant_id, doc_number);
create index suppliers_tenant_name_idx on public.suppliers (tenant_id, lower(name));
create index suppliers_tenant_status_idx on public.suppliers (tenant_id, status);

create table public.supplier_contacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  title text,
  email text,
  phone text,
  is_primary boolean not null default false,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index supplier_contacts_tenant_idx on public.supplier_contacts (tenant_id);
create index supplier_contacts_supplier_idx on public.supplier_contacts (supplier_id, name);
create unique index supplier_contacts_primary_uk on public.supplier_contacts (supplier_id, tenant_id)
  where is_primary;

create table public.warehouses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  code text,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  name_ar text,
  branch_id uuid references public.branches(id) on delete set null,
  address text,
  is_default boolean not null default false,
  active boolean not null default true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index warehouses_tenant_name_idx on public.warehouses (tenant_id, name);
create index warehouses_branch_idx on public.warehouses (branch_id);
create unique index warehouses_tenant_code_uk on public.warehouses (tenant_id, lower(code))
  where code is not null;
create unique index warehouses_tenant_default_uk on public.warehouses (tenant_id) where is_default;

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  sku text,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  name_ar text,
  description text,
  category text,
  item_type text not null default 'part'
    check (item_type in ('part', 'consumable', 'fluid', 'tire', 'tool', 'merchandise', 'other')),
  uom text not null default 'unit', -- null/blank normalized to 'unit' by trigger
  barcode text,
  -- Moving-average unit cost, maintained by app.post_stock_move.
  cost_price numeric(14, 4) not null default 0 check (cost_price >= 0),
  sale_price numeric(14, 4) check (sale_price >= 0),
  product_id uuid references public.products(id) on delete set null,
  preferred_supplier_id uuid references public.suppliers(id) on delete set null,
  reorder_point numeric(14, 3) check (reorder_point >= 0),
  reorder_qty numeric(14, 3) check (reorder_qty >= 0),
  track_stock boolean not null default true,
  active boolean not null default true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index inventory_items_tenant_sku_uk on public.inventory_items (tenant_id, lower(sku))
  where sku is not null;
create index inventory_items_tenant_name_idx on public.inventory_items (tenant_id, name);
create index inventory_items_tenant_barcode_idx on public.inventory_items (tenant_id, barcode)
  where barcode is not null;
create index inventory_items_product_idx on public.inventory_items (product_id);
create index inventory_items_supplier_idx on public.inventory_items (preferred_supplier_id);

-- ============================================================
-- 5) Stock ledger. stock_moves is the immutable journal, stock_levels the
--    per-warehouse balance. Both are written ONLY by app.post_stock_move.
-- ============================================================
create table public.stock_levels (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  warehouse_id uuid not null references public.warehouses(id) on delete cascade,
  on_hand numeric(14, 3) not null default 0,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (item_id, warehouse_id)
);
create index stock_levels_tenant_idx on public.stock_levels (tenant_id, item_id);
create index stock_levels_warehouse_idx on public.stock_levels (warehouse_id);

create table public.stock_moves (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  warehouse_id uuid not null references public.warehouses(id) on delete restrict,
  move_type text not null
    check (move_type in ('receipt', 'issue', 'transfer_in', 'transfer_out', 'adjustment',
                         'sale', 'return', 'consumption')),
  -- Signed: + into the warehouse, - out of it.
  quantity numeric(14, 3) not null check (quantity <> 0),
  unit_cost numeric(14, 4),
  -- The warehouse balance right after this move (stock card running total).
  on_hand_after numeric(14, 3),
  reference_type text,
  reference_id uuid,
  notes text,
  moved_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index stock_moves_tenant_moved_idx on public.stock_moves (tenant_id, moved_at desc);
create index stock_moves_item_idx on public.stock_moves (item_id, moved_at desc);
create index stock_moves_warehouse_idx on public.stock_moves (warehouse_id, moved_at desc);
create index stock_moves_reference_idx on public.stock_moves (reference_type, reference_id)
  where reference_id is not null;

-- ============================================================
-- 6) Notifications, preferences, scan state.
-- ============================================================
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  severity text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  entity_type text,
  entity_id uuid,
  link text,
  params jsonb not null default '{}'::jsonb,
  title text not null,
  body text,
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_recipient_idx
  on public.notifications (recipient_id, read_at, created_at desc);
create index notifications_tenant_created_idx on public.notifications (tenant_id, created_at desc);
create unique index notifications_dedupe_uk
  on public.notifications (tenant_id, recipient_id, dedupe_key)
  where dedupe_key is not null;

create table public.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  kind text not null,
  muted boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index notification_preferences_user_kind_uk
  on public.notification_preferences (user_id, tenant_id, kind);
create index notification_preferences_tenant_idx on public.notification_preferences (tenant_id);

create table public.notification_state (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  last_scan_at timestamptz,
  last_scan_count integer
);

-- ============================================================
-- 7) Domain events (automation / webhook substrate).
-- ============================================================
create table public.domain_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  event text not null,
  entity_type text,
  entity_id uuid,
  payload jsonb not null default '{}'::jsonb,
  actor uuid,
  dedupe_key text,
  occurred_at timestamptz not null default now()
);
create index domain_events_tenant_occurred_idx on public.domain_events (tenant_id, occurred_at desc);
create index domain_events_entity_idx on public.domain_events (entity_type, entity_id)
  where entity_id is not null;
create unique index domain_events_dedupe_uk on public.domain_events (tenant_id, dedupe_key)
  where dedupe_key is not null;

-- ============================================================
-- 8) Documents (metadata; the bytes live in the private `documents` bucket
--    at <tenant_id>/<document id>/<filename>, created in section 18).
-- ============================================================
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 255),
  storage_path text not null unique,
  mime_type text,
  size_bytes bigint check (size_bytes >= 0),
  entity_type text,
  entity_id uuid,
  category text not null default 'general'
    check (category in ('general', 'contract', 'invoice', 'receipt', 'photo', 'license',
                        'insurance', 'permit', 'report', 'certificate', 'other')),
  description text,
  expires_on date,
  tags text[] not null default '{}',
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Same tenant folder the storage policies enforce.
  check (split_part(storage_path, '/', 1) = tenant_id::text)
);
create index documents_tenant_created_idx on public.documents (tenant_id, created_at desc);
create index documents_entity_idx on public.documents (entity_type, entity_id)
  where entity_id is not null;
create index documents_tenant_expiry_idx on public.documents (tenant_id, expires_on)
  where expires_on is not null;

-- ============================================================
-- 9) API keys (machine ingestion under /api/v1/*). Only the sha256 of a key
--    is stored; the plaintext is returned once by create_api_key.
-- ============================================================
create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  key_prefix text not null,
  key_hash text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  scopes text[] not null default '{}',
  active boolean not null default true,
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index api_keys_tenant_idx on public.api_keys (tenant_id, created_at desc);

-- The scope vocabulary. Clusters that add ingestion endpoints extend it with
-- `create or replace` (keep every existing scope).
create or replace function app.api_scopes()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'telematics:write', 'iot:write', 'driver_events:write', 'vehicles:read', 'deliveries:write'
  ]::text[];
$$;

-- ============================================================
-- 10) Triggers: numbering, defaults, cost guard, tenant guard, updated_at,
--     actor, audit.
-- ============================================================
create trigger suppliers_number
  before insert or update of number, doc_number on public.suppliers
  for each row execute function app.assign_doc_number('supplier', 'SUP');
create trigger employees_number
  before insert or update of number, doc_number on public.employees
  for each row execute function app.assign_doc_number('employee', 'EMP');

create trigger companies_single_default before insert or update of is_default on public.companies
  for each row execute function app.ensure_single_default();
create trigger warehouses_single_default before insert or update of is_default on public.warehouses
  for each row execute function app.ensure_single_default();

create trigger inventory_items_defaults before insert or update of uom, cost_price on public.inventory_items
  for each row execute function app.inventory_item_defaults();
create trigger inventory_items_guard_cost before update of cost_price on public.inventory_items
  for each row execute function app.guard_item_cost();

-- Same-tenant parents for every client-writable FK (stock_* are definer-only
-- and check the tenant themselves).
create trigger branches_same_tenant
  before insert or update of company_id, manager_employee_id on public.branches
  for each row execute function app.assert_same_tenant(
    'company_id', 'companies', 'manager_employee_id', 'employees');
create trigger departments_same_tenant
  before insert or update of parent_id, manager_employee_id on public.departments
  for each row execute function app.assert_same_tenant(
    'parent_id', 'departments', 'manager_employee_id', 'employees');
create trigger employees_same_tenant
  before insert or update of department_id, branch_id, manager_id, user_id, driver_id,
    sl_technician_id on public.employees
  for each row execute function app.assert_same_tenant(
    'department_id', 'departments', 'branch_id', 'branches', 'manager_id', 'employees',
    'user_id', 'profiles', 'driver_id', 'drivers', 'sl_technician_id', 'sl_technicians');
create trigger supplier_contacts_same_tenant
  before insert or update of supplier_id on public.supplier_contacts
  for each row execute function app.assert_same_tenant('supplier_id', 'suppliers');
create trigger warehouses_same_tenant
  before insert or update of branch_id on public.warehouses
  for each row execute function app.assert_same_tenant('branch_id', 'branches');
create trigger inventory_items_same_tenant
  before insert or update of product_id, preferred_supplier_id on public.inventory_items
  for each row execute function app.assert_same_tenant(
    'product_id', 'products', 'preferred_supplier_id', 'suppliers');

do $$
declare t text;
begin
  foreach t in array array[
    'companies', 'branches', 'departments', 'employees', 'suppliers', 'supplier_contacts',
    'warehouses', 'inventory_items', 'stock_levels', 'documents'
  ] loop
    execute format(
      'create trigger %I_updated_at before update on public.%I
         for each row execute function app.set_updated_at()', t, t);
    execute format(
      'create trigger %I_stamp_actor before insert or update on public.%I
         for each row execute function app.stamp_actor()', t, t);
  end loop;
end;
$$;

create trigger notification_preferences_updated_at before update on public.notification_preferences
  for each row execute function app.set_updated_at();

-- api_keys: the worker stamps last_used_at on every /api/v1 request; that
-- column must not bump updated_at/updated_by or write an audit row.
create trigger api_keys_updated_at
  before update of tenant_id, name, key_prefix, key_hash, scopes, active, expires_at, revoked_at
  on public.api_keys
  for each row execute function app.set_updated_at();
create trigger api_keys_stamp_actor
  before insert or update of tenant_id, name, key_prefix, key_hash, scopes, active, expires_at,
    revoked_at on public.api_keys
  for each row execute function app.stamp_actor();
create trigger api_keys_audit
  after insert or delete or update of tenant_id, name, key_prefix, key_hash, scopes, active,
    expires_at, revoked_at on public.api_keys
  for each row execute function app.log_audit();

-- Master data + documents join the audit log (not the ledger, events,
-- notifications or scan state: high volume / system written).
do $$
declare t text;
begin
  foreach t in array array[
    'companies', 'branches', 'departments', 'employees', 'suppliers', 'supplier_contacts',
    'warehouses', 'inventory_items', 'documents'
  ] loop
    execute format(
      'create trigger %I_audit after insert or update or delete on public.%I
         for each row execute function app.log_audit()', t, t);
  end loop;
end;
$$;

-- ============================================================
-- 11) RLS switched on + privileges. The policies themselves are created in
--     section 18, at the very end of the file (see there why).
-- ============================================================
do $$
declare t text;
begin
  foreach t in array array[
    'companies', 'branches', 'departments', 'employees', 'suppliers', 'supplier_contacts',
    'warehouses', 'inventory_items', 'stock_levels', 'stock_moves', 'notifications',
    'notification_preferences', 'notification_state', 'domain_events', 'documents', 'api_keys'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end;
$$;

-- Privileges (defence in depth on top of RLS; the project's default ACL
-- grants everything on new public tables to anon + authenticated).
revoke insert, update, delete, truncate on
  public.stock_levels, public.stock_moves, public.domain_events, public.notification_state
  from anon, authenticated;
revoke insert, update, truncate on public.notifications from anon, authenticated;
grant update (read_at) on public.notifications to authenticated;
revoke all on public.api_keys from anon;
revoke insert, update, truncate on public.api_keys from authenticated;
grant update (name) on public.api_keys to authenticated;

-- ============================================================
-- 12) app.notify — fan-out to in-app notifications.
--     Audience: p_recipient if given (must belong to the tenant), else
--     'managers' (owner/admin/manager), 'admins' (owner/admin), 'all'.
--     Skips users who muted p_kind; (tenant, recipient, dedupe_key) is unique
--     so re-running a scan never duplicates. Returns rows inserted.
--     No-op unless the tenant has the notifications module enabled.
-- ============================================================
create or replace function app.notify(
  p_tenant uuid,
  p_audience text,
  p_kind text,
  p_severity text,
  p_entity_type text,
  p_entity_id uuid,
  p_link text,
  p_params jsonb,
  p_title text,
  p_body text,
  p_dedupe_key text,
  p_recipient uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_tenant is null or p_kind is null then
    return 0;
  end if;
  if not app.tenant_module_enabled(p_tenant, 'notifications') then
    return 0;
  end if;
  if p_recipient is null and coalesce(p_audience, '') not in ('managers', 'admins', 'all') then
    raise exception 'INVALID_AUDIENCE: %', p_audience;
  end if;

  insert into public.notifications (
    tenant_id, recipient_id, kind, severity, entity_type, entity_id, link, params,
    title, body, dedupe_key
  )
  select p_tenant, p.id, p_kind, coalesce(p_severity, 'info'), p_entity_type, p_entity_id,
         p_link, coalesce(p_params, '{}'::jsonb), coalesce(p_title, p_kind), p_body, p_dedupe_key
  from public.profiles p
  where p.tenant_id = p_tenant
    and case
          when p_recipient is not null then p.id = p_recipient
          when p_audience = 'managers' then p.role in ('owner', 'admin', 'manager')
          when p_audience = 'admins' then p.role in ('owner', 'admin')
          else true
        end
    and not exists (
      select 1 from public.notification_preferences np
      where np.user_id = p.id and np.tenant_id = p_tenant and np.kind = p_kind and np.muted
    )
  on conflict (tenant_id, recipient_id, dedupe_key) where dedupe_key is not null
  do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke execute on function
  app.notify(uuid, text, text, text, text, uuid, text, jsonb, text, text, text, uuid)
  from public, anon, authenticated;

-- ============================================================
-- 13) app.emit_event — record a domain event (`<entity>.<verb>`).
--     Foundation version: stores the event when the tenant has
--     workflow_automation or integrations on; otherwise a no-op. The platform
--     cluster replaces the body (same signature + return type) to also run
--     automation rules and enqueue webhook deliveries. Returns the event id,
--     or null when skipped / deduplicated.
-- ============================================================
create or replace function app.emit_event(
  p_tenant uuid,
  p_event text,
  p_entity_type text,
  p_entity_id uuid,
  p_payload jsonb,
  p_dedupe_key text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  if p_tenant is null or p_event is null then
    return null;
  end if;
  if not (app.tenant_module_enabled(p_tenant, 'workflow_automation')
          or app.tenant_module_enabled(p_tenant, 'integrations')) then
    return null;
  end if;
  insert into public.domain_events (tenant_id, event, entity_type, entity_id, payload, actor, dedupe_key)
  values (p_tenant, p_event, p_entity_type, p_entity_id, coalesce(p_payload, '{}'::jsonb),
          auth.uid(), p_dedupe_key)
  on conflict (tenant_id, dedupe_key) where dedupe_key is not null
  do nothing
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function app.emit_event(uuid, text, text, uuid, jsonb, text)
  from public, anon, authenticated;

-- ============================================================
-- 14) Stock ledger API.
--     app.post_stock_move is the single writer. It locks the item row
--     (FOR NO KEY UPDATE: serializes every move of one item — the moving
--     average is per item, across warehouses — without conflicting with the
--     KEY SHARE locks that callers' FK inserts, e.g. a work-order part line
--     referencing the item, already hold), and upserts the warehouse balance
--     atomically. Callers posting several items in one transaction must post
--     them in a deterministic order (e.g. order by item_id) to avoid
--     cross-item deadlocks.
-- ============================================================

-- Low-stock alert for one item: inventory.low_stock notification (managers)
-- + stock.below_reorder event, both deduplicated per item per day. No-op
-- unless the item is active, tracked, has a reorder point and p_on_hand is at
-- or below it. Never raises.
create or replace function app.alert_low_stock(
  p_tenant uuid,
  p_item uuid,
  p_on_hand numeric,
  p_warehouse uuid default null,
  p_move uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.inventory_items%rowtype;
  v_key text;
begin
  select * into v_item
  from public.inventory_items i
  where i.id = p_item and i.tenant_id = p_tenant;
  if not found or not v_item.active or not v_item.track_stock
     or v_item.reorder_point is null or p_on_hand is null
     or p_on_hand > v_item.reorder_point then
    return;
  end if;
  v_key := p_item::text || ':' || current_date::text;
  perform app.notify(
    p_tenant, 'managers', 'inventory.low_stock', 'warning', 'inventory_item', p_item,
    '/inventory?item=' || p_item::text,
    jsonb_build_object('item_id', p_item, 'sku', v_item.sku, 'name', v_item.name,
                       'on_hand', p_on_hand, 'reorder_point', v_item.reorder_point,
                       'reorder_qty', v_item.reorder_qty, 'uom', v_item.uom),
    'Low stock: ' || v_item.name,
    'On hand ' || p_on_hand::text || ' ' || v_item.uom
      || ' is at or below the reorder point ' || v_item.reorder_point::text || '.',
    'inventory.low_stock:' || v_key);
  perform app.emit_event(
    p_tenant, 'stock.below_reorder', 'inventory_item', p_item,
    jsonb_build_object('item_id', p_item, 'sku', v_item.sku, 'name', v_item.name,
                       'warehouse_id', p_warehouse, 'move_id', p_move,
                       'on_hand', p_on_hand, 'reorder_point', v_item.reorder_point,
                       'reorder_qty', v_item.reorder_qty),
    'stock.below_reorder:' || v_key);
exception when others then
  raise warning 'alert_low_stock: % (%)', sqlerrm, sqlstate;
end;
$$;
revoke execute on function app.alert_low_stock(uuid, uuid, numeric, uuid, uuid)
  from public, anon, authenticated;

create or replace function app.post_stock_move(
  p_tenant uuid,
  p_item uuid,
  p_warehouse uuid,
  p_type text,
  p_qty_signed numeric,
  p_unit_cost numeric,
  p_ref_type text,
  p_ref_id uuid,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.inventory_items%rowtype;
  v_total_before numeric;
  v_total_after numeric;
  v_on_hand numeric;
  v_cost numeric;
  v_move uuid;
  -- Quantities are stored at 3 decimals, costs at 4: work at that scale.
  v_qty numeric := round(p_qty_signed, 3);
  v_unit_cost numeric := round(p_unit_cost, 4);
begin
  if p_tenant is null then
    raise exception 'NO_TENANT';
  end if;
  if p_type is null or p_type not in ('receipt', 'issue', 'transfer_in', 'transfer_out',
                                      'adjustment', 'sale', 'return', 'consumption') then
    raise exception 'INVALID_STOCK_MOVE_TYPE';
  end if;
  if v_qty is null or v_qty = 0
     or (p_type in ('receipt', 'transfer_in') and v_qty < 0)
     or (p_type in ('issue', 'transfer_out', 'sale', 'consumption') and v_qty > 0) then
    raise exception 'INVALID_QUANTITY';
  end if;
  if v_unit_cost is not null and v_unit_cost < 0 then
    raise exception 'INVALID_UNIT_COST';
  end if;

  -- Tenant membership is checked here, not by RLS (definer bypasses it).
  select * into v_item
  from public.inventory_items i
  where i.id = p_item and i.tenant_id = p_tenant
  for no key update;
  if not found then
    raise exception 'INVENTORY_ITEM_NOT_FOUND';
  end if;
  if not exists (
    select 1 from public.warehouses w where w.id = p_warehouse and w.tenant_id = p_tenant
  ) then
    raise exception 'WAREHOUSE_NOT_FOUND';
  end if;

  select coalesce(sum(sl.on_hand), 0) into v_total_before
  from public.stock_levels sl where sl.item_id = p_item;

  insert into public.stock_levels as sl (tenant_id, item_id, warehouse_id, on_hand)
  values (p_tenant, p_item, p_warehouse, v_qty)
  on conflict (item_id, warehouse_id)
  do update set on_hand = sl.on_hand + excluded.on_hand
  returning sl.on_hand into v_on_hand;

  -- Only outbound moves can be short; inbound moves may reduce a deficit.
  if v_qty < 0 and v_on_hand < 0 and p_type <> 'adjustment' and v_item.track_stock then
    raise exception 'INSUFFICIENT_STOCK: on hand %, requested %',
      v_on_hand - v_qty, abs(v_qty);
  end if;

  -- Moving average on priced inbound stock (receipts, customer returns).
  v_cost := v_item.cost_price;
  if v_qty > 0 and p_type in ('receipt', 'return') and v_unit_cost is not null then
    if v_total_before <= 0 then
      v_cost := v_unit_cost;
    else
      v_cost := (v_total_before * v_item.cost_price + v_qty * v_unit_cost)
                / (v_total_before + v_qty);
    end if;
    v_cost := round(v_cost, 4);
    if v_cost is distinct from v_item.cost_price then
      update public.inventory_items set cost_price = v_cost where id = p_item;
    end if;
  end if;

  insert into public.stock_moves (
    tenant_id, item_id, warehouse_id, move_type, quantity, unit_cost, on_hand_after,
    reference_type, reference_id, notes
  ) values (
    p_tenant, p_item, p_warehouse, p_type, v_qty,
    coalesce(v_unit_cost, v_item.cost_price), v_on_hand, p_ref_type, p_ref_id, p_notes
  )
  returning id into v_move;

  -- Low stock (item total across warehouses): any outbound move that leaves
  -- the total at or below the reorder point, deduplicated per item per day.
  -- Transfers leave the total unchanged, so they never alert.
  v_total_after := v_total_before + v_qty;
  if v_qty < 0 and p_type <> 'transfer_out' and v_item.track_stock
     and v_item.reorder_point is not null and v_total_after <= v_item.reorder_point then
    perform app.alert_low_stock(p_tenant, p_item, v_total_after, p_warehouse, v_move);
  end if;

  return v_move;
end;
$$;
revoke execute on function
  app.post_stock_move(uuid, uuid, uuid, text, numeric, numeric, text, uuid, text)
  from public, anon, authenticated;

-- Raising the reorder point above the current total (or re-enabling
-- tracking / the item) alerts right away instead of waiting for the next
-- outbound move. AFTER trigger, never raises.
create or replace function app.inventory_item_reorder_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total numeric;
begin
  if new.reorder_point is null or not new.track_stock or not new.active then
    return null;
  end if;
  if new.reorder_point is not distinct from old.reorder_point
     and new.track_stock = old.track_stock and new.active = old.active then
    return null;
  end if;
  select coalesce(sum(sl.on_hand), 0) into v_total
  from public.stock_levels sl where sl.item_id = new.id;
  -- Already low (and alerting) under the old settings: nothing new to say.
  if old.reorder_point is not null and old.track_stock and old.active
     and v_total <= old.reorder_point then
    return null;
  end if;
  if v_total <= new.reorder_point then
    perform app.alert_low_stock(new.tenant_id, new.id, v_total);
  end if;
  return null;
exception when others then
  raise warning 'inventory_item_reorder_check: % (%)', sqlerrm, sqlstate;
  return null;
end;
$$;
revoke execute on function app.inventory_item_reorder_check() from public, anon, authenticated;
create trigger inventory_items_reorder_check
  after update of reorder_point, track_stock, active on public.inventory_items
  for each row execute function app.inventory_item_reorder_check();

create or replace function public.stock_receive(
  p_item uuid,
  p_warehouse uuid,
  p_qty numeric,
  p_unit_cost numeric default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.require_module('inventory', 'manager');
begin
  if p_qty is null or p_qty <= 0 then
    raise exception 'INVALID_QUANTITY';
  end if;
  return app.post_stock_move(v_tenant, p_item, p_warehouse, 'receipt', p_qty, p_unit_cost,
                             null, null, p_notes);
end;
$$;

create or replace function public.stock_issue(
  p_item uuid,
  p_warehouse uuid,
  p_qty numeric,
  p_ref_type text default null,
  p_ref_id uuid default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.require_module('inventory', 'manager');
begin
  if p_qty is null or p_qty <= 0 then
    raise exception 'INVALID_QUANTITY';
  end if;
  return app.post_stock_move(v_tenant, p_item, p_warehouse, 'issue', -p_qty, null,
                             nullif(btrim(p_ref_type), ''), p_ref_id, p_notes);
end;
$$;

-- Returns the transfer reference id shared by both legs
-- (stock_moves.reference_type = 'stock_transfer').
create or replace function public.stock_transfer(
  p_item uuid,
  p_from_warehouse uuid,
  p_to_warehouse uuid,
  p_qty numeric,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.require_module('inventory', 'manager');
  v_ref uuid := gen_random_uuid();
begin
  if p_qty is null or p_qty <= 0 then
    raise exception 'INVALID_QUANTITY';
  end if;
  if p_from_warehouse is not distinct from p_to_warehouse then
    raise exception 'TRANSFER_SAME_WAREHOUSE';
  end if;
  perform app.post_stock_move(v_tenant, p_item, p_from_warehouse, 'transfer_out', -p_qty, null,
                              'stock_transfer', v_ref, p_notes);
  perform app.post_stock_move(v_tenant, p_item, p_to_warehouse, 'transfer_in', p_qty, null,
                              'stock_transfer', v_ref, p_notes);
  return v_ref;
end;
$$;

-- Counts: sets the warehouse balance to p_new_on_hand (rounded to the
-- ledger's 3 decimals) with one adjustment move for the difference. Returns
-- the move id (null when nothing changed).
create or replace function public.stock_adjust(
  p_item uuid,
  p_warehouse uuid,
  p_new_on_hand numeric,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.require_module('inventory', 'manager');
  v_target numeric := round(p_new_on_hand, 3);
  v_current numeric;
begin
  if v_target is null or v_target < 0 then
    raise exception 'INVALID_QUANTITY';
  end if;
  -- Lock the item first so the balance cannot move between read and post
  -- (same lock strength as app.post_stock_move).
  perform 1 from public.inventory_items i
  where i.id = p_item and i.tenant_id = v_tenant
  for no key update;
  if not found then
    raise exception 'INVENTORY_ITEM_NOT_FOUND';
  end if;
  select sl.on_hand into v_current
  from public.stock_levels sl
  where sl.item_id = p_item and sl.warehouse_id = p_warehouse and sl.tenant_id = v_tenant;
  v_current := coalesce(v_current, 0);
  if v_target = v_current then
    return null;
  end if;
  return app.post_stock_move(v_tenant, p_item, p_warehouse, 'adjustment',
                             v_target - v_current, null, null, null, p_notes);
end;
$$;

revoke execute on function public.stock_receive(uuid, uuid, numeric, numeric, text) from public, anon;
revoke execute on function public.stock_issue(uuid, uuid, numeric, text, uuid, text) from public, anon;
revoke execute on function public.stock_transfer(uuid, uuid, uuid, numeric, text) from public, anon;
revoke execute on function public.stock_adjust(uuid, uuid, numeric, text) from public, anon;
grant execute on function public.stock_receive(uuid, uuid, numeric, numeric, text) to authenticated;
grant execute on function public.stock_issue(uuid, uuid, numeric, text, uuid, text) to authenticated;
grant execute on function public.stock_transfer(uuid, uuid, uuid, numeric, text) to authenticated;
grant execute on function public.stock_adjust(uuid, uuid, numeric, text) to authenticated;

-- ============================================================
-- 15) API key RPCs.
-- ============================================================
create or replace function public.create_api_key(
  p_name text,
  p_scopes text[],
  p_expires_at timestamptz default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.require_module('integrations', 'admin');
  v_scopes text[];
  v_key text;
begin
  if p_name is null or char_length(btrim(p_name)) not between 1 and 100 then
    raise exception 'INVALID_API_KEY_NAME';
  end if;
  select array_agg(distinct s order by s) into v_scopes from unnest(p_scopes) as s;
  if v_scopes is null or not (v_scopes <@ app.api_scopes()) then
    raise exception 'INVALID_API_SCOPE';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'INVALID_API_KEY_EXPIRY';
  end if;

  v_key := 'fm_' || encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.api_keys (tenant_id, name, key_prefix, key_hash, scopes, expires_at)
  values (v_tenant, btrim(p_name), left(v_key, 12),
          encode(extensions.digest(v_key, 'sha256'), 'hex'), v_scopes, p_expires_at);
  return v_key; -- shown once; never stored
end;
$$;

create or replace function public.revoke_api_key(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.require_module('integrations', 'admin');
begin
  update public.api_keys
     set active = false, revoked_at = coalesce(revoked_at, now())
   where id = p_id and tenant_id = v_tenant;
  if not found then
    raise exception 'API_KEY_NOT_FOUND';
  end if;
end;
$$;

revoke execute on function public.create_api_key(text, text[], timestamptz) from public, anon;
revoke execute on function public.revoke_api_key(uuid) from public, anon;
grant execute on function public.create_api_key(text, text[], timestamptz) to authenticated;
grant execute on function public.revoke_api_key(uuid) to authenticated;

-- ============================================================
-- 16) Time-based scans (no cron: the SPA calls this when the bell mounts).
--     Throttled per tenant (15 min; admins may force). Runs every
--     app.scan_due_<suffix>(p_tenant uuid) returns integer that exists, in
--     name order, each in its own exception block so one broken scanner cannot
--     stop the others. A statement timeout / cancel inside a scanner, or a
--     spent 5-second budget, stops the run but keeps the throttle claim (so
--     every bell mount does not re-run a slow scan). Scanners must stay well
--     under a second per tenant. Returns the notifications the scanners
--     reported.
-- ============================================================
create or replace function public.refresh_notifications(p_force boolean default false)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id();
  v_force boolean := coalesce(p_force, false) and coalesce(app.is_admin(), false);
  v_started timestamptz := clock_timestamp();
  v_claimed boolean;
  v_fn text;
  v_n integer;
  v_total integer := 0;
begin
  if v_tenant is null or not app.tenant_module_enabled(v_tenant, 'notifications') then
    return 0;
  end if;

  -- Atomic claim: concurrent callers serialize on the row; losers see the
  -- fresh last_scan_at and skip.
  insert into public.notification_state as ns (tenant_id, last_scan_at)
  values (v_tenant, now())
  on conflict (tenant_id) do update
    set last_scan_at = excluded.last_scan_at
    where v_force
       or ns.last_scan_at is null
       or ns.last_scan_at < now() - interval '15 minutes'
  returning true into v_claimed;
  if not coalesce(v_claimed, false) then
    return 0;
  end if;

  for v_fn in
    select p.proname
    from pg_catalog.pg_proc p
    where p.pronamespace = 'app'::regnamespace
      and p.proname like 'scan\_due\_%'
      and p.pronargs = 1
      and p.proargtypes[0] = 'uuid'::regtype
      and p.prorettype = 'integer'::regtype
    order by p.proname
  loop
    if clock_timestamp() - v_started > interval '5 seconds' then
      raise warning 'refresh_notifications: time budget spent before app.%; remaining scanners skipped', v_fn;
      exit;
    end if;
    begin
      execute format('select app.%I($1)', v_fn) into v_n using v_tenant;
      v_total := v_total + coalesce(v_n, 0);
    exception
      -- OTHERS does not match QUERY_CANCELED: trap it by name, then stop (the
      -- statement timeout does not re-arm once it has fired).
      when query_canceled then
        raise warning 'refresh_notifications: app.% cancelled (%); remaining scanners skipped', v_fn, sqlerrm;
        exit;
      when others then
        raise warning 'refresh_notifications: app.% failed: % (%)', v_fn, sqlerrm, sqlstate;
    end;
  end loop;

  update public.notification_state set last_scan_count = v_total where tenant_id = v_tenant;
  return v_total;
end;
$$;
revoke execute on function public.refresh_notifications(boolean) from public, anon;
grant execute on function public.refresh_notifications(boolean) to authenticated;

-- ============================================================
-- 17) Existing-table changes, near the end: each takes an ACCESS EXCLUSIVE
--     lock that is held until commit, so they run right before section 18.
--     * document_sequences: any well-formed doc type + a per-tenant prefix
--       override for types numbered by app.assign_doc_number.
--     * vehicles / drivers: nullable branch link (metadata-only column adds;
--       set null FK, so a cross-tenant value can only affect the writer's own
--       row — no same-tenant trigger on these existing tables, §0.2).
-- ============================================================
set local lock_timeout = '1s';

alter table public.document_sequences
  drop constraint if exists document_sequences_doc_type_check;
alter table public.document_sequences
  add constraint document_sequences_doc_type_check
  check (doc_type ~ '^[a-z][a-z0-9_]{1,40}$');
alter table public.document_sequences
  add column if not exists prefix text;

alter table public.vehicles
  add column if not exists branch_id uuid references public.branches(id) on delete set null;
create index if not exists vehicles_branch_idx on public.vehicles (branch_id);
alter table public.drivers
  add column if not exists branch_id uuid references public.branches(id) on delete set null;
create index if not exists drivers_branch_idx on public.drivers (branch_id);

-- ============================================================
-- 18) RLS policies + documents storage, LAST.
--     On this project every CREATE POLICY (on any table, public or storage)
--     takes ACCESS EXCLUSIVE locks on ~23 auth.* / storage.* / realtime.*
--     tables (users, sessions, refresh_tokens, objects, ...) until commit —
--     the platform's policy hook, not something this file can avoid. Nothing
--     else in this file takes them (verified: tables, triggers, indexes, FKs,
--     ALTERs, grants, the bucket insert). So every policy is created here,
--     after everything else, under the 1 s lock timeout set in section 17:
--     sign-ins / token refreshes wait milliseconds, and if the locks cannot
--     be had within 1 s the migration fails cleanly — just retry it.
--     Cluster migrations: same layout (policies last, short lock timeout),
--     and keep dry-runs short (no sleeps) — they hold these locks until
--     their rollback.
-- ============================================================
-- Module-gated standard loop: members read, managers write.
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('companies', 'multi_company'),
      ('branches', 'multi_company'),
      ('departments', 'employees'),
      ('suppliers', 'suppliers'),
      ('supplier_contacts', 'suppliers'),
      ('warehouses', 'inventory'),
      ('inventory_items', 'inventory'),
      ('documents', 'documents')
    ) as v (t, m)
  loop
    -- documents gets its own select policy below.
    if r.t <> 'documents' then
      execute format(
        'create policy %I on public.%I for select to authenticated
           using (tenant_id = (select app.tenant_id()) and (select app.module_enabled(%L)))',
        r.t || '_select', r.t, r.m);
    end if;
    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check (tenant_id = (select app.tenant_id()) and (select app.is_manager())
                     and (select app.module_enabled(%L)))',
      r.t || '_insert', r.t, r.m);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (tenant_id = (select app.tenant_id()) and (select app.is_manager())
                and (select app.module_enabled(%L)))
         with check (tenant_id = (select app.tenant_id()) and (select app.is_manager())
                     and (select app.module_enabled(%L)))',
      r.t || '_update', r.t, r.m, r.m);
    execute format(
      'create policy %I on public.%I for delete to authenticated
         using (tenant_id = (select app.tenant_id()) and (select app.is_manager())
                and (select app.module_enabled(%L)))',
      r.t || '_delete', r.t, r.m);
  end loop;
end;
$$;

-- employees carries HR-sensitive data (salary, IBAN, national id): managers
-- see the directory, everyone else only their own record. Writes: managers.
create policy employees_select on public.employees for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.module_enabled('employees'))
         and ((select app.is_manager()) or user_id = (select auth.uid())));
create policy employees_insert on public.employees for insert to authenticated
  with check (tenant_id = (select app.tenant_id()) and (select app.is_manager())
              and (select app.module_enabled('employees')));
create policy employees_update on public.employees for update to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_manager())
         and (select app.module_enabled('employees')))
  with check (tenant_id = (select app.tenant_id()) and (select app.is_manager())
              and (select app.module_enabled('employees')));
create policy employees_delete on public.employees for delete to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_manager())
         and (select app.module_enabled('employees')));

-- Documents: members read, except HR files. entity_type 'employee' is
-- visible to managers and to the linked employee (the subquery runs under the
-- employees policy); entity types 'hr_*' (payslips, disciplinary files, ...)
-- are manager-only. The storage.objects select policy follows the row.
create policy documents_select on public.documents for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.module_enabled('documents'))
         and ((select app.is_manager())
              or entity_type is null
              or (entity_type <> 'employee' and entity_type not like 'hr\_%')
              or (entity_type = 'employee' and exists (
                    select 1 from public.employees e
                    where e.id = documents.entity_id and e.user_id = (select auth.uid())))));

-- Server-maintained ledger: read-only to members of an inventory tenant.
create policy stock_levels_select on public.stock_levels for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.module_enabled('inventory')));
create policy stock_moves_select on public.stock_moves for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.module_enabled('inventory')));

-- Notifications: the recipient's own rows only. Inserts via app.notify only;
-- clients may mark read (read_at column grant below) and delete their own.
create policy notifications_select on public.notifications for select to authenticated
  using (recipient_id = (select auth.uid()) and tenant_id = (select app.tenant_id())
         and (select app.module_enabled('notifications')));
create policy notifications_update on public.notifications for update to authenticated
  using (recipient_id = (select auth.uid()) and tenant_id = (select app.tenant_id())
         and (select app.module_enabled('notifications')))
  with check (recipient_id = (select auth.uid()) and tenant_id = (select app.tenant_id())
              and (select app.module_enabled('notifications')));
create policy notifications_delete on public.notifications for delete to authenticated
  using (recipient_id = (select auth.uid()) and tenant_id = (select app.tenant_id())
         and (select app.module_enabled('notifications')));

create policy notification_preferences_select on public.notification_preferences
  for select to authenticated
  using (user_id = (select auth.uid()) and tenant_id = (select app.tenant_id())
         and (select app.module_enabled('notifications')));
create policy notification_preferences_insert on public.notification_preferences
  for insert to authenticated
  with check (user_id = (select auth.uid()) and tenant_id = (select app.tenant_id())
              and (select app.module_enabled('notifications')));
create policy notification_preferences_update on public.notification_preferences
  for update to authenticated
  using (user_id = (select auth.uid()) and tenant_id = (select app.tenant_id())
         and (select app.module_enabled('notifications')))
  with check (user_id = (select auth.uid()) and tenant_id = (select app.tenant_id())
              and (select app.module_enabled('notifications')));
create policy notification_preferences_delete on public.notification_preferences
  for delete to authenticated
  using (user_id = (select auth.uid()) and tenant_id = (select app.tenant_id())
         and (select app.module_enabled('notifications')));

create policy notification_state_select on public.notification_state for select to authenticated
  using (tenant_id = (select app.tenant_id()));

-- Domain events: admins, when an automation consumer module is on.
create policy domain_events_select on public.domain_events for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_admin())
         and ((select app.module_enabled('integrations'))
              or (select app.module_enabled('workflow_automation'))));

-- API keys: admin-only. Created via create_api_key (no insert policy),
-- revoked via revoke_api_key; admins may rename (column grant) or delete.
create policy api_keys_select on public.api_keys for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_admin())
         and (select app.module_enabled('integrations')));
create policy api_keys_update on public.api_keys for update to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_admin())
         and (select app.module_enabled('integrations')))
  with check (tenant_id = (select app.tenant_id()) and (select app.is_admin())
              and (select app.module_enabled('integrations')));
create policy api_keys_delete on public.api_keys for delete to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_admin())
         and (select app.module_enabled('integrations')));

-- Documents storage: private bucket, object path <tenant_id>/<document id>/<filename>.
--   * select: tenant folder + documents module, and either a manager (so the
--     uploader can list / clean up orphans) or a public.documents row with
--     this storage_path that the caller can see. The subquery runs under the
--     documents policy above, so a file is exactly as visible as its row (HR
--     files stay hidden from other members) and orphans are manager-only.
--   * insert / update / delete: managers, own tenant folder, module on.
--   Only managers write and they see every object, so upload/row order does
--   not matter; still prefer: insert the row (client-generated id), upload,
--   delete the row if the upload fails; to delete, remove the object first.
insert into storage.buckets (id, name, public, file_size_limit)
values ('documents', 'documents', false, 26214400)
on conflict (id) do nothing;

create policy documents_objects_select on storage.objects for select to authenticated
  using (bucket_id = 'documents'
         and (storage.foldername(name))[1] = (select app.tenant_id())::text
         and (select app.module_enabled('documents'))
         and ((select app.is_manager())
              or exists (select 1 from public.documents d where d.storage_path = objects.name)));
create policy documents_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'documents'
              and (storage.foldername(name))[1] = (select app.tenant_id())::text
              and (select app.is_manager())
              and (select app.module_enabled('documents')));
create policy documents_objects_update on storage.objects for update to authenticated
  using (bucket_id = 'documents'
         and (storage.foldername(name))[1] = (select app.tenant_id())::text
         and (select app.is_manager())
         and (select app.module_enabled('documents')))
  with check (bucket_id = 'documents'
              and (storage.foldername(name))[1] = (select app.tenant_id())::text
              and (select app.is_manager())
              and (select app.module_enabled('documents')));
create policy documents_objects_delete on storage.objects for delete to authenticated
  using (bucket_id = 'documents'
         and (storage.foldername(name))[1] = (select app.tenant_id())::text
         and (select app.is_manager())
         and (select app.module_enabled('documents')));
