-- Commerce wave (docs/ARCHITECTURE_REVIEW.md §14 Phase 6): the quote → sales
-- order → invoice → payment document chain, built on the platform horizontals
-- that already exist rather than beside them:
--   * numbering  -> app.next_doc_number (document_sequences), never max()+1
--   * money      -> rounded to the tenant's currency minor units, server-side,
--                   so the DB total and the printed total can never disagree
--   * lifecycle  -> DB-enforced state machines + locked issued documents
--                   (same posture as sl_jobs / certificates)
--   * audit      -> app.stamp_actor + app.log_audit on every document
--
-- Two modules own these tables: `sales` (products, quotes, sales orders) and
-- `billing` (invoices, payments). See shared/modules.ts.

-- ============================================================
-- 0) Currency minor units, server-side.
--    The SPA rounds with getCountry(tenant.country).currencyDecimals
--    (shared/countries.ts). Documents are totalled in SQL, so the same
--    scale has to exist here — mirror the country engine exactly and keep
--    it in sync with a trigger instead of a column anyone can drift.
-- ============================================================
create or replace function app.country_currency_decimals(p_country text)
returns smallint
language sql
immutable
set search_path = ''
as $$
  select case upper(coalesce(p_country, ''))
    -- 3-decimal dinars: KWD, BHD, OMR, JOD
    when 'KW' then 3 when 'BH' then 3 when 'OM' then 3 when 'JO' then 3
    -- 0-decimal currencies (per shared/countries.ts)
    when 'YE' then 0 when 'IQ' then 0 when 'IR' then 0 when 'LB' then 0
    when 'SY' then 0 when 'ID' then 0 when 'VN' then 0 when 'KR' then 0
    when 'JP' then 0
    else 2
  end::smallint;
$$;

alter table public.tenants
  add column if not exists currency_decimals smallint not null default 2;

update public.tenants
   set currency_decimals = app.country_currency_decimals(country);

create or replace function app.stamp_currency_decimals()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.currency_decimals := app.country_currency_decimals(new.country);
  return new;
end;
$$;

create trigger tenants_currency_decimals
  before insert or update of country on public.tenants
  for each row execute function app.stamp_currency_decimals();

-- ============================================================
-- 1) Numbering — extend the shared allocator's doc types.
-- ============================================================
alter table public.document_sequences
  drop constraint document_sequences_doc_type_check;
alter table public.document_sequences
  add constraint document_sequences_doc_type_check check (
    doc_type in (
      'work_order', 'sl_job', 'sl_certificate',
      'quote', 'sales_order', 'invoice'
    )
  );

-- ============================================================
-- 2) Per-tenant sales policy (prefixes, default terms).
--    Mirrors sl_settings: policy, not state — the counters live in
--    document_sequences.
-- ============================================================
create table public.sales_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  quote_prefix text not null default 'QT',
  order_prefix text not null default 'SO',
  invoice_prefix text not null default 'INV',
  quote_valid_days integer not null default 30 check (quote_valid_days > 0),
  payment_terms_days integer not null default 30 check (payment_terms_days >= 0),
  -- null = fall back to the country engine's VAT rate for the tenant.
  default_tax_rate numeric(5, 2) check (default_tax_rate >= 0 and default_tax_rate <= 100),
  quote_terms text,
  invoice_terms text,
  updated_at timestamptz not null default now()
);

-- ============================================================
-- 3) Product / service catalog — the reusable line source.
-- ============================================================
create table public.products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  sku text,
  name text not null,
  description text,
  kind text not null default 'service' check (kind in ('service', 'part', 'fee', 'other')),
  unit text not null default 'unit',
  unit_price numeric(14, 4) not null default 0 check (unit_price >= 0),
  tax_rate numeric(5, 2) not null default 0 check (tax_rate >= 0 and tax_rate <= 100),
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index products_tenant_sku_uk
  on public.products (tenant_id, lower(sku)) where sku is not null;
create index products_tenant_active_idx on public.products (tenant_id, active, name);

-- ============================================================
-- 4) Documents. Money columns are numeric(14,4): unit prices need sub-minor
--    precision, totals are rounded to the document's own currency scale
--    (snapshotted at creation so a later tenant country change cannot
--    retroactively re-round an issued invoice).
-- ============================================================
create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  number integer,
  doc_number text,
  customer_id uuid not null references public.customers(id) on delete restrict,
  contact_id uuid references public.contacts(id) on delete set null,
  -- Optional fleet context: a limiter-install or service quote is about a vehicle.
  vehicle_id uuid references public.vehicles(id) on delete set null,
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'accepted', 'declined', 'expired', 'canceled')),
  issue_date date not null default current_date,
  valid_until date,
  currency text not null,
  currency_decimals smallint not null,
  subtotal numeric(14, 4) not null default 0,
  discount_total numeric(14, 4) not null default 0,
  tax_total numeric(14, 4) not null default 0,
  total numeric(14, 4) not null default 0,
  title text,
  customer_reference text,
  terms text,
  notes text,
  internal_notes text,
  -- Capability URL for customer-facing review + acceptance (same posture as
  -- the certificate verify link: unguessable uuid, whitelisted payload).
  public_token uuid not null default gen_random_uuid(),
  sent_at timestamptz,
  accepted_at timestamptz,
  accepted_by_name text,
  declined_at timestamptz,
  decline_reason text,
  revision integer not null default 1,
  revision_of uuid references public.quotes(id) on delete set null,
  sales_order_id uuid,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index quotes_tenant_number_uk on public.quotes (tenant_id, number);
create unique index quotes_public_token_uk on public.quotes (public_token);
create index quotes_tenant_status_idx on public.quotes (tenant_id, status, issue_date desc);
create index quotes_customer_idx on public.quotes (customer_id);
create index quotes_contact_idx on public.quotes (contact_id);
create index quotes_vehicle_idx on public.quotes (vehicle_id);
create index quotes_revision_of_idx on public.quotes (revision_of);
create index quotes_doc_number_idx on public.quotes (tenant_id, doc_number);

create table public.quote_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  quote_id uuid not null references public.quotes(id) on delete cascade,
  sort_order integer not null default 0,
  product_id uuid references public.products(id) on delete set null,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  description text not null,
  quantity numeric(14, 3) not null default 1 check (quantity > 0),
  unit text,
  unit_price numeric(14, 4) not null default 0,
  discount_percent numeric(5, 2) not null default 0
    check (discount_percent >= 0 and discount_percent <= 100),
  tax_rate numeric(5, 2) not null default 0 check (tax_rate >= 0 and tax_rate <= 100),
  line_gross numeric(14, 4) not null default 0,
  line_discount numeric(14, 4) not null default 0,
  line_net numeric(14, 4) not null default 0,
  line_tax numeric(14, 4) not null default 0,
  line_total numeric(14, 4) not null default 0,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index quote_lines_quote_idx on public.quote_lines (quote_id, sort_order);
create index quote_lines_product_idx on public.quote_lines (product_id);
create index quote_lines_vehicle_idx on public.quote_lines (vehicle_id);

create table public.sales_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  number integer,
  doc_number text,
  customer_id uuid not null references public.customers(id) on delete restrict,
  contact_id uuid references public.contacts(id) on delete set null,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  quote_id uuid references public.quotes(id) on delete set null,
  status text not null default 'draft'
    check (status in ('draft', 'confirmed', 'fulfilled', 'closed', 'canceled')),
  order_date date not null default current_date,
  expected_date date,
  currency text not null,
  currency_decimals smallint not null,
  subtotal numeric(14, 4) not null default 0,
  discount_total numeric(14, 4) not null default 0,
  tax_total numeric(14, 4) not null default 0,
  total numeric(14, 4) not null default 0,
  -- Maintained by the invoice triggers: how much of this order is billed.
  invoiced_total numeric(14, 4) not null default 0,
  title text,
  customer_reference text,
  terms text,
  notes text,
  internal_notes text,
  confirmed_at timestamptz,
  fulfilled_at timestamptz,
  closed_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index sales_orders_tenant_number_uk on public.sales_orders (tenant_id, number);
create index sales_orders_tenant_status_idx
  on public.sales_orders (tenant_id, status, order_date desc);
create index sales_orders_customer_idx on public.sales_orders (customer_id);
create index sales_orders_contact_idx on public.sales_orders (contact_id);
create index sales_orders_vehicle_idx on public.sales_orders (vehicle_id);
create index sales_orders_quote_idx on public.sales_orders (quote_id);
create index sales_orders_doc_number_idx on public.sales_orders (tenant_id, doc_number);

-- One order per quote: makes the conversion idempotent at the schema level.
create unique index sales_orders_quote_uk on public.sales_orders (quote_id)
  where quote_id is not null;

alter table public.quotes
  add constraint quotes_sales_order_id_fkey
  foreign key (sales_order_id) references public.sales_orders(id) on delete set null;
create index quotes_sales_order_idx on public.quotes (sales_order_id);

create table public.sales_order_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  sales_order_id uuid not null references public.sales_orders(id) on delete cascade,
  sort_order integer not null default 0,
  product_id uuid references public.products(id) on delete set null,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  description text not null,
  quantity numeric(14, 3) not null default 1 check (quantity > 0),
  unit text,
  unit_price numeric(14, 4) not null default 0,
  discount_percent numeric(5, 2) not null default 0
    check (discount_percent >= 0 and discount_percent <= 100),
  tax_rate numeric(5, 2) not null default 0 check (tax_rate >= 0 and tax_rate <= 100),
  line_gross numeric(14, 4) not null default 0,
  line_discount numeric(14, 4) not null default 0,
  line_net numeric(14, 4) not null default 0,
  line_tax numeric(14, 4) not null default 0,
  line_total numeric(14, 4) not null default 0,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sales_order_lines_order_idx on public.sales_order_lines (sales_order_id, sort_order);
create index sales_order_lines_product_idx on public.sales_order_lines (product_id);
create index sales_order_lines_vehicle_idx on public.sales_order_lines (vehicle_id);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  number integer,
  doc_number text,
  customer_id uuid not null references public.customers(id) on delete restrict,
  contact_id uuid references public.contacts(id) on delete set null,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  sales_order_id uuid references public.sales_orders(id) on delete set null,
  status text not null default 'draft'
    check (status in ('draft', 'issued', 'partially_paid', 'paid', 'void')),
  issue_date date not null default current_date,
  due_date date,
  currency text not null,
  currency_decimals smallint not null,
  subtotal numeric(14, 4) not null default 0,
  discount_total numeric(14, 4) not null default 0,
  tax_total numeric(14, 4) not null default 0,
  total numeric(14, 4) not null default 0,
  -- Maintained by the payment triggers.
  amount_paid numeric(14, 4) not null default 0,
  title text,
  customer_reference text,
  terms text,
  notes text,
  internal_notes text,
  issued_at timestamptz,
  voided_at timestamptz,
  void_reason text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index invoices_tenant_number_uk on public.invoices (tenant_id, number);
create index invoices_tenant_status_idx on public.invoices (tenant_id, status, issue_date desc);
create index invoices_tenant_due_idx on public.invoices (tenant_id, due_date);
create index invoices_customer_idx on public.invoices (customer_id);
create index invoices_contact_idx on public.invoices (contact_id);
create index invoices_vehicle_idx on public.invoices (vehicle_id);
create index invoices_order_idx on public.invoices (sales_order_id);
create index invoices_doc_number_idx on public.invoices (tenant_id, doc_number);

create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  sort_order integer not null default 0,
  product_id uuid references public.products(id) on delete set null,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  description text not null,
  quantity numeric(14, 3) not null default 1 check (quantity > 0),
  unit text,
  unit_price numeric(14, 4) not null default 0,
  discount_percent numeric(5, 2) not null default 0
    check (discount_percent >= 0 and discount_percent <= 100),
  tax_rate numeric(5, 2) not null default 0 check (tax_rate >= 0 and tax_rate <= 100),
  line_gross numeric(14, 4) not null default 0,
  line_discount numeric(14, 4) not null default 0,
  line_net numeric(14, 4) not null default 0,
  line_tax numeric(14, 4) not null default 0,
  line_total numeric(14, 4) not null default 0,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index invoice_lines_invoice_idx on public.invoice_lines (invoice_id, sort_order);
create index invoice_lines_product_idx on public.invoice_lines (product_id);
create index invoice_lines_vehicle_idx on public.invoice_lines (vehicle_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenants(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  paid_at date not null default current_date,
  amount numeric(14, 4) not null check (amount > 0),
  method text not null default 'bank_transfer'
    check (method in ('cash', 'bank_transfer', 'card', 'cheque', 'online', 'other')),
  reference text,
  notes text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index payments_invoice_idx on public.payments (invoice_id, paid_at);
create index payments_tenant_paid_idx on public.payments (tenant_id, paid_at desc);

-- ============================================================
-- 5) Document math. One generic implementation for all three document
--    families — line amounts on the line, roll-up on the parent, both
--    rounded to the parent document's own currency scale.
--
--    line_gross    = round(qty * unit_price)
--    line_discount = round(line_gross * discount% )
--    line_net      = line_gross - line_discount
--    line_tax      = round(line_net * tax%)          (tax on the net, per line)
--    line_total    = line_net + line_tax
--
--    Mirrors shared/countries.ts taxBreakdown(): amounts are entered NET and
--    tax is added on top, rounded to the currency's minor units.
-- ============================================================
create or replace function app.compute_line_amounts()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_parent uuid;
  v_dec integer;
  v_gross numeric;
  v_disc numeric;
  v_net numeric;
begin
  v_parent := (to_jsonb(new) ->> tg_argv[1])::uuid;
  execute format('select currency_decimals from public.%I where id = $1', tg_argv[0])
    into v_dec using v_parent;
  v_dec := coalesce(v_dec, 2);

  v_gross := round(new.quantity * new.unit_price, v_dec);
  v_disc := round(v_gross * coalesce(new.discount_percent, 0) / 100, v_dec);
  v_net := v_gross - v_disc;

  new.line_gross := v_gross;
  new.line_discount := v_disc;
  new.line_net := v_net;
  new.line_tax := round(v_net * coalesce(new.tax_rate, 0) / 100, v_dec);
  new.line_total := new.line_net + new.line_tax;
  return new;
end;
$$;

create or replace function app.apply_doc_totals(
  p_doc text,
  p_lines text,
  p_fk text,
  p_id uuid
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_id is null then
    return;
  end if;
  -- The `is distinct from` guard keeps a no-op roll-up from bumping
  -- updated_at and writing an empty audit row on every line edit.
  execute format(
    'update public.%I d
        set subtotal = t.net,
            discount_total = t.disc,
            tax_total = t.tax,
            total = t.net + t.tax
       from (select coalesce(sum(l.line_net), 0) as net,
                    coalesce(sum(l.line_discount), 0) as disc,
                    coalesce(sum(l.line_tax), 0) as tax
               from public.%I l where l.%I = $1) t
      where d.id = $1
        and (d.subtotal, d.discount_total, d.tax_total, d.total)
            is distinct from (t.net, t.disc, t.tax, t.net + t.tax)',
    p_doc, p_lines, p_fk)
  using p_id;
end;
$$;

create or replace function app.recompute_doc_totals()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_new uuid;
  v_old uuid;
begin
  if tg_op <> 'DELETE' then
    v_new := (to_jsonb(new) ->> tg_argv[2])::uuid;
  end if;
  if tg_op <> 'INSERT' then
    v_old := (to_jsonb(old) ->> tg_argv[2])::uuid;
  end if;
  perform app.apply_doc_totals(tg_argv[0], tg_argv[1], tg_argv[2], v_new);
  if v_old is distinct from v_new then
    perform app.apply_doc_totals(tg_argv[0], tg_argv[1], tg_argv[2], v_old);
  end if;
  return null;
end;
$$;

-- Lines may only be touched while the parent document is still editable.
-- (A null status means the parent is already gone — a cascade delete.)
create or replace function app.guard_line_editable()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_parent uuid;
  v_status text;
begin
  if tg_op = 'DELETE' then
    v_parent := (to_jsonb(old) ->> tg_argv[1])::uuid;
  else
    v_parent := (to_jsonb(new) ->> tg_argv[1])::uuid;
  end if;
  execute format('select status from public.%I where id = $1', tg_argv[0])
    into v_status using v_parent;
  if v_status is not null and v_status <> all (string_to_array(tg_argv[2], ',')) then
    raise exception 'DOC_NOT_EDITABLE';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- Issued documents are immutable except for the columns their own lifecycle
-- owns (status transitions, payment roll-ups, internal notes).
create or replace function app.guard_doc_locked()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_mutable text[] := string_to_array(tg_argv[1], ',');
begin
  if old.status = any (string_to_array(tg_argv[0], ',')) then
    if (to_jsonb(new) - v_mutable) is distinct from (to_jsonb(old) - v_mutable) then
      raise exception 'DOC_LOCKED';
    end if;
  end if;
  return new;
end;
$$;

-- Only unissued documents can be deleted; everything else is canceled/voided
-- so the numbering sequence keeps its audit-visible continuity.
create or replace function app.guard_doc_deletable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> all (string_to_array(tg_argv[0], ',')) then
    raise exception 'DOC_NOT_DELETABLE';
  end if;
  return old;
end;
$$;

-- ============================================================
-- 6) Numbering: allocate on insert, format with the tenant's prefix.
-- ============================================================
create or replace function app.next_sales_doc_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prefix text;
  v_n integer;
begin
  if new.number is not null then
    return new;
  end if;
  insert into public.sales_settings (tenant_id) values (new.tenant_id)
    on conflict do nothing;
  execute format('select %I from public.sales_settings where tenant_id = $1', tg_argv[1])
    into v_prefix using new.tenant_id;
  v_n := app.next_doc_number(new.tenant_id, tg_argv[0]);
  new.number := v_n;
  new.doc_number := coalesce(nullif(v_prefix, ''), tg_argv[2]) || '-' || lpad(v_n::text, 5, '0');
  return new;
end;
$$;

-- Documents snapshot the tenant's currency + minor units at creation.
create or replace function app.stamp_doc_currency()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_currency text;
  v_dec smallint;
begin
  if new.currency is not null and new.currency_decimals is not null then
    return new;
  end if;
  select t.currency, t.currency_decimals into v_currency, v_dec
    from public.tenants t where t.id = new.tenant_id;
  new.currency := coalesce(new.currency, v_currency, 'USD');
  new.currency_decimals := coalesce(new.currency_decimals, v_dec, 2::smallint);
  return new;
end;
$$;

-- ============================================================
-- 7) State machines. Same posture as app.enforce_job_transition: the UI
--    offers the legal moves, the database is what actually guarantees them.
-- ============================================================
create or replace function app.enforce_quote_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = old.status then
    return new;
  end if;
  if not (
    (old.status = 'draft'    and new.status in ('sent', 'canceled')) or
    (old.status = 'sent'     and new.status in ('accepted', 'declined', 'expired', 'draft', 'canceled')) or
    (old.status = 'expired'  and new.status in ('sent', 'canceled')) or
    (old.status = 'declined' and new.status = 'canceled')
  ) then
    raise exception 'ILLEGAL_QUOTE_TRANSITION: % -> %', old.status, new.status;
  end if;
  if new.status = 'sent' then
    new.sent_at := coalesce(new.sent_at, now());
  elsif new.status = 'accepted' then
    new.accepted_at := coalesce(new.accepted_at, now());
  elsif new.status = 'declined' then
    new.declined_at := coalesce(new.declined_at, now());
  end if;
  return new;
end;
$$;

create or replace function app.enforce_order_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = old.status then
    return new;
  end if;
  if not (
    (old.status = 'draft'     and new.status in ('confirmed', 'canceled')) or
    (old.status = 'confirmed' and new.status in ('fulfilled', 'canceled')) or
    (old.status = 'fulfilled' and new.status = 'closed')
  ) then
    raise exception 'ILLEGAL_ORDER_TRANSITION: % -> %', old.status, new.status;
  end if;
  if new.status = 'confirmed' then
    new.confirmed_at := coalesce(new.confirmed_at, now());
  elsif new.status = 'fulfilled' then
    new.fulfilled_at := coalesce(new.fulfilled_at, now());
  elsif new.status = 'closed' then
    new.closed_at := coalesce(new.closed_at, now());
  end if;
  return new;
end;
$$;

-- issued / partially_paid / paid move freely between themselves because the
-- payment triggers drive them in both directions (recording a payment, or
-- deleting one). `paid` is terminal: correct a settled invoice with a credit,
-- not by voiding history.
create or replace function app.enforce_invoice_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_settled constant text[] := array['issued', 'partially_paid', 'paid'];
begin
  if new.status = old.status then
    return new;
  end if;
  if not (
    (old.status = 'draft' and new.status in ('issued', 'void')) or
    (old.status = any (v_settled) and new.status = any (v_settled)) or
    (old.status in ('issued', 'partially_paid') and new.status = 'void')
  ) then
    raise exception 'ILLEGAL_INVOICE_TRANSITION: % -> %', old.status, new.status;
  end if;
  if new.status = 'issued' and old.status = 'draft' then
    new.issued_at := coalesce(new.issued_at, now());
  elsif new.status = 'void' then
    new.voided_at := coalesce(new.voided_at, now());
  end if;
  return new;
end;
$$;

-- A document cannot leave draft with nothing on it.
create or replace function app.guard_doc_not_empty()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  if old.status <> 'draft' or new.status = old.status or new.status = 'canceled'
     or new.status = 'void' then
    return new;
  end if;
  execute format('select count(*) from public.%I where %I = $1', tg_argv[0], tg_argv[1])
    into v_count using new.id;
  if v_count = 0 then
    raise exception 'EMPTY_DOCUMENT';
  end if;
  return new;
end;
$$;

-- ============================================================
-- 8) Payments → invoice settlement. amount_paid and the settled status are
--    derived state: the client records payments, the database decides what
--    the invoice is.
-- ============================================================
create or replace function app.guard_payment()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_inv public.invoices%rowtype;
  v_other numeric;
begin
  select * into v_inv from public.invoices where id = new.invoice_id for update;
  if not found then
    raise exception 'INVOICE_NOT_FOUND';
  end if;
  if v_inv.status not in ('issued', 'partially_paid', 'paid') then
    raise exception 'INVOICE_NOT_PAYABLE';
  end if;
  select coalesce(sum(p.amount), 0) into v_other
    from public.payments p
   where p.invoice_id = new.invoice_id
     and (tg_op = 'INSERT' or p.id <> new.id);
  if round(v_other + new.amount, v_inv.currency_decimals)
     > round(v_inv.total, v_inv.currency_decimals) then
    raise exception 'PAYMENT_EXCEEDS_BALANCE';
  end if;
  return new;
end;
$$;

create or replace function app.settle_invoice()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_invoice uuid;
  v_inv public.invoices%rowtype;
  v_paid numeric;
  v_status text;
begin
  if tg_op = 'DELETE' then
    v_invoice := old.invoice_id;
  else
    v_invoice := new.invoice_id;
  end if;
  select * into v_inv from public.invoices where id = v_invoice;
  if not found then
    return null; -- invoice is being cascade-deleted
  end if;
  select coalesce(sum(p.amount), 0) into v_paid
    from public.payments p where p.invoice_id = v_invoice;
  v_paid := round(v_paid, v_inv.currency_decimals);

  v_status := v_inv.status;
  if v_inv.status in ('issued', 'partially_paid', 'paid') then
    if v_paid <= 0 then
      v_status := 'issued';
    elsif v_paid >= round(v_inv.total, v_inv.currency_decimals) then
      v_status := 'paid';
    else
      v_status := 'partially_paid';
    end if;
  end if;

  update public.invoices
     set amount_paid = v_paid, status = v_status
   where id = v_invoice
     and (amount_paid, status) is distinct from (v_paid, v_status);
  return null;
end;
$$;

-- Invoices roll up onto their sales order so "how much of this order is
-- billed" never has to be computed in the browser.
create or replace function app.apply_order_invoiced(p_order uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_total numeric;
begin
  if p_order is null then
    return;
  end if;
  select coalesce(sum(i.total), 0) into v_total
    from public.invoices i
   where i.sales_order_id = p_order and i.status <> 'void';
  update public.sales_orders
     set invoiced_total = v_total
   where id = p_order and invoiced_total is distinct from v_total;
end;
$$;

create or replace function app.recompute_order_invoiced()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_new uuid;
  v_old uuid;
begin
  if tg_op <> 'DELETE' then
    v_new := new.sales_order_id;
  end if;
  if tg_op <> 'INSERT' then
    v_old := old.sales_order_id;
  end if;
  perform app.apply_order_invoiced(v_new);
  if v_old is distinct from v_new then
    perform app.apply_order_invoiced(v_old);
  end if;
  return null;
end;
$$;

-- ============================================================
-- 9) Triggers.
-- ============================================================
create trigger sales_settings_updated_at before update on public.sales_settings
  for each row execute function app.set_updated_at();

do $$
declare t text;
begin
  foreach t in array array[
    'products', 'quotes', 'quote_lines', 'sales_orders', 'sales_order_lines',
    'invoices', 'invoice_lines', 'payments'
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

-- Documents (not their lines) join the audit log.
do $$
declare t text;
begin
  foreach t in array array['quotes', 'sales_orders', 'invoices', 'payments', 'products'] loop
    execute format(
      'create trigger %I_audit after insert or update or delete on public.%I
         for each row execute function app.log_audit()', t, t);
  end loop;
end;
$$;

-- Currency snapshot + numbering (a_ / b_ prefixes pin the firing order).
create trigger a_quotes_currency before insert on public.quotes
  for each row execute function app.stamp_doc_currency();
create trigger b_quotes_number before insert on public.quotes
  for each row execute function app.next_sales_doc_number('quote', 'quote_prefix', 'QT');

create trigger a_sales_orders_currency before insert on public.sales_orders
  for each row execute function app.stamp_doc_currency();
create trigger b_sales_orders_number before insert on public.sales_orders
  for each row execute function app.next_sales_doc_number('sales_order', 'order_prefix', 'SO');

create trigger a_invoices_currency before insert on public.invoices
  for each row execute function app.stamp_doc_currency();
create trigger b_invoices_number before insert on public.invoices
  for each row execute function app.next_sales_doc_number('invoice', 'invoice_prefix', 'INV');

-- Line math + editability + parent roll-up.
create trigger quote_lines_guard before insert or update or delete on public.quote_lines
  for each row execute function app.guard_line_editable('quotes', 'quote_id', 'draft');
create trigger quote_lines_amounts before insert or update on public.quote_lines
  for each row execute function app.compute_line_amounts('quotes', 'quote_id');
create trigger quote_lines_totals after insert or update or delete on public.quote_lines
  for each row execute function app.recompute_doc_totals('quotes', 'quote_lines', 'quote_id');

create trigger sales_order_lines_guard
  before insert or update or delete on public.sales_order_lines
  for each row execute function app.guard_line_editable('sales_orders', 'sales_order_id', 'draft');
create trigger sales_order_lines_amounts before insert or update on public.sales_order_lines
  for each row execute function app.compute_line_amounts('sales_orders', 'sales_order_id');
create trigger sales_order_lines_totals
  after insert or update or delete on public.sales_order_lines
  for each row execute function
    app.recompute_doc_totals('sales_orders', 'sales_order_lines', 'sales_order_id');

create trigger invoice_lines_guard before insert or update or delete on public.invoice_lines
  for each row execute function app.guard_line_editable('invoices', 'invoice_id', 'draft');
create trigger invoice_lines_amounts before insert or update on public.invoice_lines
  for each row execute function app.compute_line_amounts('invoices', 'invoice_id');
create trigger invoice_lines_totals after insert or update or delete on public.invoice_lines
  for each row execute function app.recompute_doc_totals('invoices', 'invoice_lines', 'invoice_id');

-- Lifecycle.
create trigger quotes_transition before update of status on public.quotes
  for each row execute function app.enforce_quote_transition();
create trigger quotes_not_empty before update of status on public.quotes
  for each row execute function app.guard_doc_not_empty('quote_lines', 'quote_id');
create trigger quotes_locked before update on public.quotes
  for each row execute function app.guard_doc_locked(
    'accepted,declined,canceled',
    'status,sales_order_id,internal_notes,updated_at,updated_by,sent_at,accepted_at,accepted_by_name,declined_at,decline_reason');
create trigger quotes_deletable before delete on public.quotes
  for each row execute function app.guard_doc_deletable('draft,canceled');

create trigger sales_orders_transition before update of status on public.sales_orders
  for each row execute function app.enforce_order_transition();
create trigger sales_orders_not_empty before update of status on public.sales_orders
  for each row execute function app.guard_doc_not_empty('sales_order_lines', 'sales_order_id');
create trigger sales_orders_locked before update on public.sales_orders
  for each row execute function app.guard_doc_locked(
    'closed,canceled',
    'status,internal_notes,invoiced_total,updated_at,updated_by,confirmed_at,fulfilled_at,closed_at');
create trigger sales_orders_deletable before delete on public.sales_orders
  for each row execute function app.guard_doc_deletable('draft,canceled');

create trigger invoices_transition before update of status on public.invoices
  for each row execute function app.enforce_invoice_transition();
create trigger invoices_not_empty before update of status on public.invoices
  for each row execute function app.guard_doc_not_empty('invoice_lines', 'invoice_id');
create trigger invoices_locked before update on public.invoices
  for each row execute function app.guard_doc_locked(
    'paid,void',
    'status,internal_notes,amount_paid,updated_at,updated_by,issued_at,voided_at,void_reason');
create trigger invoices_deletable before delete on public.invoices
  for each row execute function app.guard_doc_deletable('draft');
create trigger invoices_order_rollup after insert or update or delete on public.invoices
  for each row execute function app.recompute_order_invoiced();

create trigger payments_guard before insert or update on public.payments
  for each row execute function app.guard_payment();
create trigger payments_settle after insert or update or delete on public.payments
  for each row execute function app.settle_invoice();

-- Customers with billing history are retired, not deleted (extends the
-- existing guard from 20260720000002_sequences_guards_audit.sql).
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
  if exists (
    select 1 from public.invoices i
    where i.customer_id = old.id and i.status <> 'draft'
  ) then
    raise exception 'CUSTOMER_HAS_INVOICES';
  end if;
  return old;
end;
$$;

-- ============================================================
-- 10) RLS — members read, managers write (the standard template).
--     sales_settings is admin-write like the other policy tables.
-- ============================================================
do $$
declare t text;
begin
  foreach t in array array[
    'products', 'quotes', 'quote_lines', 'sales_orders', 'sales_order_lines',
    'invoices', 'invoice_lines', 'payments'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I_select on public.%I for select to authenticated
         using (tenant_id = (select app.tenant_id()))', t, t);
    execute format(
      'create policy %I_insert on public.%I for insert to authenticated
         with check (tenant_id = (select app.tenant_id()) and (select app.is_manager()))', t, t);
    execute format(
      'create policy %I_update on public.%I for update to authenticated
         using (tenant_id = (select app.tenant_id()) and (select app.is_manager()))
         with check (tenant_id = (select app.tenant_id()) and (select app.is_manager()))', t, t);
    execute format(
      'create policy %I_delete on public.%I for delete to authenticated
         using (tenant_id = (select app.tenant_id()) and (select app.is_manager()))', t, t);
  end loop;
end;
$$;

alter table public.sales_settings enable row level security;
create policy sales_settings_select on public.sales_settings
  for select to authenticated using (tenant_id = (select app.tenant_id()));
create policy sales_settings_insert on public.sales_settings
  for insert to authenticated
  with check (tenant_id = (select app.tenant_id()) and (select app.is_admin()));
create policy sales_settings_update on public.sales_settings
  for update to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.is_admin()))
  with check (tenant_id = (select app.tenant_id()) and (select app.is_admin()));

-- ============================================================
-- 11) Conversion RPCs. The chain has to be atomic: copying a dozen lines
--     with a dozen round trips is exactly how half-converted documents get
--     created. SECURITY INVOKER — the caller's RLS still applies.
-- ============================================================
create or replace function public.convert_quote_to_order(p_quote_id uuid)
returns public.sales_orders
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_q public.quotes%rowtype;
  v_order public.sales_orders%rowtype;
begin
  select * into v_q from public.quotes where id = p_quote_id for update;
  if not found then
    raise exception 'QUOTE_NOT_FOUND';
  end if;
  if v_q.status <> 'accepted' then
    raise exception 'QUOTE_NOT_CONVERTIBLE';
  end if;
  if v_q.sales_order_id is not null then
    raise exception 'QUOTE_ALREADY_CONVERTED';
  end if;

  insert into public.sales_orders (
    tenant_id, customer_id, contact_id, vehicle_id, quote_id, currency,
    currency_decimals, title, customer_reference, terms, notes, internal_notes
  ) values (
    v_q.tenant_id, v_q.customer_id, v_q.contact_id, v_q.vehicle_id, v_q.id, v_q.currency,
    v_q.currency_decimals, v_q.title, v_q.customer_reference, v_q.terms, v_q.notes,
    v_q.internal_notes
  ) returning * into v_order;

  insert into public.sales_order_lines (
    tenant_id, sales_order_id, sort_order, product_id, vehicle_id, description,
    quantity, unit, unit_price, discount_percent, tax_rate
  )
  select v_order.tenant_id, v_order.id, l.sort_order, l.product_id, l.vehicle_id,
         l.description, l.quantity, l.unit, l.unit_price, l.discount_percent, l.tax_rate
    from public.quote_lines l
   where l.quote_id = v_q.id
   order by l.sort_order, l.created_at;

  update public.quotes set sales_order_id = v_order.id where id = v_q.id;

  select * into v_order from public.sales_orders where id = v_order.id;
  return v_order;
end;
$$;
revoke execute on function public.convert_quote_to_order(uuid) from public, anon;

create or replace function public.create_invoice_from_order(p_order_id uuid)
returns public.invoices
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_o public.sales_orders%rowtype;
  v_inv public.invoices%rowtype;
  v_terms integer;
begin
  select * into v_o from public.sales_orders where id = p_order_id for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;
  if v_o.status not in ('confirmed', 'fulfilled') then
    raise exception 'ORDER_NOT_INVOICEABLE';
  end if;

  select payment_terms_days into v_terms
    from public.sales_settings where tenant_id = v_o.tenant_id;

  insert into public.invoices (
    tenant_id, customer_id, contact_id, vehicle_id, sales_order_id, currency,
    currency_decimals, due_date, title, customer_reference, terms, notes, internal_notes
  ) values (
    v_o.tenant_id, v_o.customer_id, v_o.contact_id, v_o.vehicle_id, v_o.id, v_o.currency,
    v_o.currency_decimals, current_date + coalesce(v_terms, 30), v_o.title,
    v_o.customer_reference, v_o.terms, v_o.notes, v_o.internal_notes
  ) returning * into v_inv;

  insert into public.invoice_lines (
    tenant_id, invoice_id, sort_order, product_id, vehicle_id, description,
    quantity, unit, unit_price, discount_percent, tax_rate
  )
  select v_inv.tenant_id, v_inv.id, l.sort_order, l.product_id, l.vehicle_id,
         l.description, l.quantity, l.unit, l.unit_price, l.discount_percent, l.tax_rate
    from public.sales_order_lines l
   where l.sales_order_id = v_o.id
   order by l.sort_order, l.created_at;

  select * into v_inv from public.invoices where id = v_inv.id;
  return v_inv;
end;
$$;
revoke execute on function public.create_invoice_from_order(uuid) from public, anon;

-- Revising a sent/declined/expired quote clones it into a fresh draft that
-- keeps the lineage, instead of silently editing a document the customer
-- already has a copy of.
create or replace function public.revise_quote(p_quote_id uuid)
returns public.quotes
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_q public.quotes%rowtype;
  v_new public.quotes%rowtype;
  v_valid integer;
begin
  select * into v_q from public.quotes where id = p_quote_id for update;
  if not found then
    raise exception 'QUOTE_NOT_FOUND';
  end if;
  if v_q.status = 'draft' then
    raise exception 'QUOTE_NOT_REVISABLE';
  end if;

  select quote_valid_days into v_valid
    from public.sales_settings where tenant_id = v_q.tenant_id;

  insert into public.quotes (
    tenant_id, customer_id, contact_id, vehicle_id, currency, currency_decimals,
    valid_until, title, customer_reference, terms, notes, internal_notes,
    revision, revision_of
  ) values (
    v_q.tenant_id, v_q.customer_id, v_q.contact_id, v_q.vehicle_id, v_q.currency,
    v_q.currency_decimals, current_date + coalesce(v_valid, 30), v_q.title,
    v_q.customer_reference, v_q.terms, v_q.notes, v_q.internal_notes,
    v_q.revision + 1, coalesce(v_q.revision_of, v_q.id)
  ) returning * into v_new;

  insert into public.quote_lines (
    tenant_id, quote_id, sort_order, product_id, vehicle_id, description,
    quantity, unit, unit_price, discount_percent, tax_rate
  )
  select v_new.tenant_id, v_new.id, l.sort_order, l.product_id, l.vehicle_id,
         l.description, l.quantity, l.unit, l.unit_price, l.discount_percent, l.tax_rate
    from public.quote_lines l
   where l.quote_id = v_q.id
   order by l.sort_order, l.created_at;

  select * into v_new from public.quotes where id = v_new.id;
  return v_new;
end;
$$;
revoke execute on function public.revise_quote(uuid) from public, anon;

-- ============================================================
-- 12) Overview aggregation. KPI tiles never fetch document tables into the
--     browser (docs/ARCHITECTURE_REVIEW.md §6.2) — one row, computed in SQL,
--     RLS-scoped to the caller's tenant.
-- ============================================================
create or replace function public.sales_summary()
returns table (
  open_quotes integer,
  open_quote_value numeric,
  accepted_quotes_90d integer,
  decided_quotes_90d integer,
  open_orders integer,
  open_order_value numeric,
  unbilled_order_value numeric,
  outstanding_amount numeric,
  overdue_invoices integer,
  overdue_amount numeric,
  collected_30d numeric
)
language sql
security invoker
set search_path = ''
as $$
  select
    (select count(*)::integer from public.quotes
      where status in ('draft', 'sent')),
    (select coalesce(sum(total), 0) from public.quotes
      where status in ('draft', 'sent')),
    (select count(*)::integer from public.quotes
      where status = 'accepted' and issue_date >= current_date - 90),
    (select count(*)::integer from public.quotes
      where status in ('accepted', 'declined', 'expired') and issue_date >= current_date - 90),
    (select count(*)::integer from public.sales_orders
      where status in ('draft', 'confirmed', 'fulfilled')),
    (select coalesce(sum(total), 0) from public.sales_orders
      where status in ('draft', 'confirmed', 'fulfilled')),
    (select coalesce(sum(greatest(total - invoiced_total, 0)), 0) from public.sales_orders
      where status in ('confirmed', 'fulfilled')),
    (select coalesce(sum(total - amount_paid), 0) from public.invoices
      where status in ('issued', 'partially_paid')),
    (select count(*)::integer from public.invoices
      where status in ('issued', 'partially_paid') and due_date < current_date),
    (select coalesce(sum(total - amount_paid), 0) from public.invoices
      where status in ('issued', 'partially_paid') and due_date < current_date),
    (select coalesce(sum(amount), 0) from public.payments
      where paid_at >= current_date - 30);
$$;
revoke execute on function public.sales_summary() from public, anon;
