-- Certificates invoiced and paid OUTSIDE FleetManage.
--
-- Tenants that back-loaded their paper register (and dealers who billed by
-- hand before the billing module existed) hold live certificates that were
-- invoiced and paid long ago — but FleetManage has no invoice for them, so
-- every one reads "not invoiced", sits in the pending-invoice report and the
-- KPI, and is offered again by the consolidated-invoice dialog.
--
-- A certificate can now carry the date it was settled outside the system and
-- the manual invoice reference. That is a stored FACT about history, not a
-- derived state: there is no invoice row to derive it from. Every surface
-- that asks "is this certificate billed?" now reads it alongside
-- app.certificate_invoice_id(), so the list chip, the report, the KPIs and the
-- double-billing guards all agree:
--
--   * billing_state() returns 'external' (filtered with 'paid' by the list);
--   * the pending-invoice / renewals / jobs reports and both KPIs skip it;
--   * create_invoice_from_certificates and the line/header guards refuse it
--     (CERT_PAID_EXTERNALLY) — it cannot be billed twice;
--   * marking a certificate that IS on a non-void invoice is refused
--     (CERT_ALREADY_INVOICED) — one certificate, one settlement.
--
-- Function bodies below are the live definitions (including the quote/order
-- tracking from certificate_quotes) with only the external check added.

-- ------------------------------------------------------------------
-- 1) The fact. Both nullable; a reference without a date is meaningless, so
--    the check keeps them together. The audit trigger already on the table
--    records who marked it and when; stamp_actor sets updated_by.
-- ------------------------------------------------------------------
alter table public.speed_limiter_certificates
  add column if not exists paid_externally_on date,
  add column if not exists external_invoice_ref text;

alter table public.speed_limiter_certificates
  drop constraint if exists speed_limiter_certificates_external_ref_needs_date;
alter table public.speed_limiter_certificates
  add constraint speed_limiter_certificates_external_ref_needs_date
  check (external_invoice_ref is null or paid_externally_on is not null);

comment on column public.speed_limiter_certificates.paid_externally_on is
  'Date the certificate was invoiced and paid outside FleetManage. Non-null ⇒ billed; never on a FleetManage invoice as well.';
comment on column public.speed_limiter_certificates.external_invoice_ref is
  'The manual/external invoice number or receipt that settled it. Optional; requires paid_externally_on.';

-- ------------------------------------------------------------------
-- 2) Marking (and unmarking) is refused for a certificate a FleetManage
--    invoice already bills — that one is settled through its invoice.
-- ------------------------------------------------------------------
create or replace function app.guard_certificate_external_billing()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.paid_externally_on is null then
    new.external_invoice_ref := null;
    return new;
  end if;
  if old.paid_externally_on is null
     and app.certificate_invoice_id(new.id) is not null then
    raise exception 'CERT_ALREADY_INVOICED: %', new.certificate_number;
  end if;
  return new;
end;
$$;

create or replace trigger speed_limiter_certificates_external_billing
  before update of paid_externally_on, external_invoice_ref
  on public.speed_limiter_certificates
  for each row execute function app.guard_certificate_external_billing();

-- ------------------------------------------------------------------
-- 3) Bulk mark / unmark — the 57-certificate customer is one call, one
--    transaction. SECURITY INVOKER: RLS (managers write) decides who may; a
--    row RLS hides is reported as not found rather than silently skipped.
--    p_paid_on NULL clears the mark (undo).
-- ------------------------------------------------------------------
create or replace function public.set_certificates_paid_externally(
  p_certificate_ids uuid[],
  p_paid_on date,
  p_reference text default null
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_updated integer;
  v_billed text;
begin
  select coalesce(array_agg(distinct u.id), '{}'::uuid[])
    into v_ids
    from unnest(coalesce(p_certificate_ids, '{}'::uuid[])) as u(id)
   where u.id is not null;
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    raise exception 'NO_CERTIFICATES';
  end if;

  if p_paid_on is not null then
    -- Name them up front rather than failing on the first row.
    select string_agg(c.certificate_number, ', ' order by c.certificate_number)
      into v_billed
      from public.speed_limiter_certificates c
     where c.id = any (v_ids)
       and c.paid_externally_on is null
       and app.certificate_invoice_id(c.id) is not null;
    if v_billed is not null then
      raise exception 'CERT_ALREADY_INVOICED: %', v_billed;
    end if;
  end if;

  update public.speed_limiter_certificates c
     set paid_externally_on = p_paid_on,
         external_invoice_ref = case
           when p_paid_on is null then null
           else nullif(btrim(coalesce(p_reference, '')), '')
         end
   where c.id = any (v_ids);
  get diagnostics v_updated = row_count;
  if v_updated <> array_length(v_ids, 1) then
    raise exception 'CERTIFICATE_NOT_FOUND';
  end if;
  return v_updated;
end;
$$;
revoke execute on function public.set_certificates_paid_externally(uuid[], date, text)
  from public, anon;
grant execute on function public.set_certificates_paid_externally(uuid[], date, text)
  to authenticated;

-- ------------------------------------------------------------------
-- 4) billing_state: an invoice still wins (the guards make both impossible);
--    then the external settlement; then the quote/order pipeline.
-- ------------------------------------------------------------------
create or replace function public.billing_state(c public.speed_limiter_certificates)
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select case i.status when 'paid' then 'paid' when 'draft' then 'draft' else 'invoiced' end
       from public.invoices i
      where i.id = app.certificate_invoice_id(c.id)),
    case when c.paid_externally_on is not null then 'external' end,
    case when app.certificate_order_id(c.id) is not null then 'ordered' end,
    case when app.certificate_quote_id(c.id) is not null then 'quoted' end,
    'unbilled');
$$;

-- ------------------------------------------------------------------
-- 5) The guards: a certificate settled outside cannot go on an invoice.
-- ------------------------------------------------------------------
create or replace function app.guard_line_certificate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.certificate_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.certificate_id is not distinct from old.certificate_id then
    return new;
  end if;
  if exists (
       select 1 from public.speed_limiter_certificates sc
        where sc.id = new.certificate_id and sc.paid_externally_on is not null)
  then
    raise exception 'CERT_PAID_EXTERNALLY';
  end if;
  if exists (
       select 1
         from public.invoice_lines il
         join public.invoices i on i.id = il.invoice_id
        where il.certificate_id = new.certificate_id
          and il.id <> new.id
          and i.status <> 'void')
     or exists (
       select 1
         from public.invoices i
        where i.certificate_id = new.certificate_id
          and i.id <> new.invoice_id
          and i.status <> 'void')
  then
    raise exception 'CERT_ALREADY_INVOICED';
  end if;
  return new;
end;
$$;

create or replace function app.guard_invoice_certificate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.certificate_id is null or new.status = 'void' then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.certificate_id is not distinct from old.certificate_id then
    return new;
  end if;
  if exists (
       select 1 from public.speed_limiter_certificates sc
        where sc.id = new.certificate_id and sc.paid_externally_on is not null)
  then
    raise exception 'CERT_PAID_EXTERNALLY';
  end if;
  if exists (
       select 1
         from public.invoices i
        where i.certificate_id = new.certificate_id
          and i.id <> new.id
          and i.status <> 'void')
     or exists (
       select 1
         from public.invoice_lines il
         join public.invoices i on i.id = il.invoice_id
        where il.certificate_id = new.certificate_id
          and i.id <> new.id
          and i.status <> 'void')
  then
    raise exception 'CERT_ALREADY_INVOICED';
  end if;
  return new;
end;
$$;

-- ------------------------------------------------------------------
-- 6) The consolidated invoice names externally settled certificates up front.
-- ------------------------------------------------------------------
create or replace function public.create_invoice_from_certificates(
  p_certificate_ids uuid[],
  p_description text default null,
  p_unit_price numeric default null,
  p_tax_rate numeric default null,
  p_product_id uuid default null
)
returns public.invoices
language plpgsql
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_tenant uuid;
  v_customer uuid;
  v_customers integer;
  v_found integer;
  v_billed text;
  v_terms integer;
  v_invoice_terms text;
  v_default_tax numeric;
  v_product public.products%rowtype;
  v_single public.speed_limiter_certificates%rowtype;
  v_inv public.invoices%rowtype;
begin
  -- De-duplicate: the same certificate twice is one line, not two.
  select coalesce(array_agg(distinct u.id), '{}'::uuid[])
    into v_ids
    from unnest(coalesce(p_certificate_ids, '{}'::uuid[])) as u(id)
   where u.id is not null;
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    raise exception 'NO_CERTIFICATES';
  end if;

  select count(*), count(distinct c.customer_id)
    into v_found, v_customers
    from public.speed_limiter_certificates c
   where c.id = any (v_ids);
  if v_found <> array_length(v_ids, 1) then
    raise exception 'CERTIFICATE_NOT_FOUND';
  end if;
  -- Any of them names the tenant and, once the single-customer check below
  -- has passed, the customer (uuid has no min()/max(), hence not an aggregate).
  select c.tenant_id, c.customer_id
    into v_tenant, v_customer
    from public.speed_limiter_certificates c
   where c.id = any (v_ids)
   limit 1;
  if exists (
    select 1 from public.speed_limiter_certificates c
     where c.id = any (v_ids) and c.customer_id is null
  ) then
    raise exception 'CERT_NO_CUSTOMER';
  end if;
  if v_customers <> 1 then
    raise exception 'CERTS_MULTIPLE_CUSTOMERS';
  end if;

  -- The guard would catch these one line at a time; naming them up front is
  -- the difference between "that one is already on INV-00012" and a rollback.
  select string_agg(c.certificate_number, ', ' order by c.certificate_number)
    into v_billed
    from public.speed_limiter_certificates c
   where c.id = any (v_ids)
     and app.certificate_invoice_id(c.id) is not null;
  if v_billed is not null then
    raise exception 'CERT_ALREADY_INVOICED: %', v_billed;
  end if;

  select string_agg(c.certificate_number, ', ' order by c.certificate_number)
    into v_billed
    from public.speed_limiter_certificates c
   where c.id = any (v_ids)
     and c.paid_externally_on is not null;
  if v_billed is not null then
    raise exception 'CERT_PAID_EXTERNALLY: %', v_billed;
  end if;

  select payment_terms_days, invoice_terms, default_tax_rate
    into v_terms, v_invoice_terms, v_default_tax
    from public.sales_settings
   where tenant_id = v_tenant;

  if p_product_id is not null then
    select * into v_product from public.products where id = p_product_id;
  end if;

  -- A single certificate keeps the header links the job page has always
  -- written, so "linked certificate" on the invoice and the jobs-pending
  -- report read the same whichever way the invoice was raised. A consolidated
  -- invoice has no single vehicle or certificate; its lines carry them.
  if array_length(v_ids, 1) = 1 then
    select * into v_single from public.speed_limiter_certificates where id = v_ids[1];
  end if;

  insert into public.invoices (
    tenant_id, customer_id, vehicle_id, job_id, certificate_id, due_date, terms
  ) values (
    v_tenant, v_customer, v_single.vehicle_id, v_single.job_id, v_single.id,
    current_date + coalesce(v_terms, 30), v_invoice_terms
  ) returning * into v_inv;

  insert into public.invoice_lines (
    tenant_id, invoice_id, sort_order, product_id, vehicle_id, certificate_id,
    description, quantity, unit, unit_price, discount_percent, tax_rate
  )
  select
    v_tenant, v_inv.id,
    (row_number() over (order by v.license_plate nulls last, c.certificate_number))::integer - 1,
    p_product_id, c.vehicle_id, c.id,
    concat_ws(' · ',
      coalesce(nullif(btrim(p_description), ''), v_product.name, 'Speed limiter certificate'),
      nullif(btrim(coalesce(v.license_plate, v.name, '')), ''),
      c.certificate_number),
    1,
    v_product.unit,
    coalesce(p_unit_price, v_product.unit_price, 0),
    0,
    coalesce(p_tax_rate, v_product.tax_rate, v_default_tax, 0)
  from public.speed_limiter_certificates c
  left join public.vehicles v on v.id = c.vehicle_id
  where c.id = any (v_ids);

  select * into v_inv from public.invoices where id = v_inv.id;
  return v_inv;
end;
$$;
revoke execute on function public.create_invoice_from_certificates(uuid[], text, numeric, numeric, uuid)
  from public, anon;

-- ------------------------------------------------------------------
-- 7) Reports and KPIs: settled outside ⇒ not pending.
-- ------------------------------------------------------------------
create or replace function public.sales_report_certificates_pending_invoice(
  p_customer_id uuid default null
)
returns table (
  certificate_id uuid,
  certificate_number text,
  issued_at date,
  expires_at date,
  customer_id uuid,
  customer_name text,
  vehicle_id uuid,
  vehicle_name text,
  license_plate text
)
language sql
set search_path = ''
as $$
  select c.id, c.certificate_number, c.issued_at, c.expires_at,
         c.customer_id, cu.name, c.vehicle_id, v.name, v.license_plate
    from public.speed_limiter_certificates c
    left join public.customers cu on cu.id = c.customer_id
    left join public.vehicles v on v.id = c.vehicle_id
   where c.status = 'valid'
     and c.superseded_by is null
     and c.paid_externally_on is null
     and (p_customer_id is null or c.customer_id = p_customer_id)
     and app.certificate_invoice_id(c.id) is null
   order by cu.name nulls last, c.issued_at desc, c.certificate_number desc;
$$;

create or replace function public.sales_report_jobs_pending_invoice()
returns table (
  job_id uuid,
  job_number integer,
  job_type text,
  status text,
  completed_at timestamptz,
  customer_id uuid,
  customer_name text,
  vehicle_name text
)
language sql
set search_path = ''
as $$
  select
    j.id, j.number, j.job_type, j.status, j.completed_at,
    j.customer_id, c.name, v.name
  from public.sl_jobs j
  left join public.customers c on c.id = j.customer_id
  left join public.vehicles v on v.id = j.vehicle_id
  where j.status in ('completed', 'qc_approved', 'closed')
    and not exists (
      select 1 from public.invoices i
       where i.job_id = j.id and i.status <> 'void'
    )
    and not exists (
      select 1 from public.speed_limiter_certificates sc
       where sc.job_id = j.id
         and (sc.paid_externally_on is not null or app.certificate_invoice_id(sc.id) is not null)
    )
  order by j.completed_at desc nulls last, j.number desc;
$$;

create or replace function public.sales_report_renewals_to_quote(
  p_days integer default 90,
  p_customer_id uuid default null
)
returns table (
  certificate_id uuid,
  certificate_number text,
  issued_at date,
  expires_at date,
  customer_id uuid,
  customer_name text,
  vehicle_id uuid,
  vehicle_name text,
  license_plate text
)
language sql
set search_path = ''
as $$
  select c.id, c.certificate_number, c.issued_at, c.expires_at,
         c.customer_id, cu.name, c.vehicle_id, v.name, v.license_plate
    from public.speed_limiter_certificates c
    left join public.customers cu on cu.id = c.customer_id
    left join public.vehicles v on v.id = c.vehicle_id
   where c.status = 'valid'
     and c.superseded_by is null
     and c.paid_externally_on is null
     and c.expires_at <= current_date + greatest(coalesce(p_days, 90), 0)
     and (p_customer_id is null or c.customer_id = p_customer_id)
     and app.certificate_invoice_id(c.id) is null
     and app.certificate_order_id(c.id) is null
     and app.certificate_quote_id(c.id) is null
   order by cu.name nulls last, c.expires_at, c.certificate_number;
$$;

create or replace function public.sales_report_pipeline()
returns table (
  pending_quotes integer, pending_quote_value numeric,
  accepted_quotes integer, accepted_quote_value numeric,
  declined_quotes integer,
  pos_received integer, pos_received_value numeric,
  jobs_pending_invoice integer,
  invoices_generated integer, invoiced_value numeric,
  partially_paid_invoices integer, partially_paid_outstanding numeric,
  paid_invoices integer, paid_value numeric,
  outstanding_amount numeric,
  overdue_invoices integer, overdue_amount numeric,
  certificates_pending_invoice integer,
  renewals_to_quote integer
)
language sql
set search_path = ''
as $$
  select
    (select count(*)::integer from public.quotes where status in ('draft', 'sent')),
    (select coalesce(sum(total), 0) from public.quotes where status in ('draft', 'sent')),
    (select count(*)::integer from public.quotes where status = 'accepted'),
    (select coalesce(sum(total), 0) from public.quotes where status = 'accepted'),
    (select count(*)::integer from public.quotes where status = 'declined'),

    (select count(*)::integer from public.sales_orders
      where customer_po_number is not null and status <> 'canceled'),
    (select coalesce(sum(total), 0) from public.sales_orders
      where customer_po_number is not null and status <> 'canceled'),

    (select count(*)::integer from public.sl_jobs j
      where j.status in ('completed', 'qc_approved', 'closed')
        and not exists (
          select 1 from public.invoices i
           where i.job_id = j.id and i.status <> 'void'
        )
        and not exists (
          select 1 from public.speed_limiter_certificates sc
           where sc.job_id = j.id
             and (sc.paid_externally_on is not null
                  or app.certificate_invoice_id(sc.id) is not null)
        )),

    (select count(*)::integer from public.invoices
      where status in ('issued', 'partially_paid', 'paid')),
    (select coalesce(sum(total), 0) from public.invoices
      where status in ('issued', 'partially_paid', 'paid')),

    (select count(*)::integer from public.invoices where status = 'partially_paid'),
    (select coalesce(sum(total - amount_paid), 0) from public.invoices
      where status = 'partially_paid'),

    (select count(*)::integer from public.invoices where status = 'paid'),
    (select coalesce(sum(total), 0) from public.invoices where status = 'paid'),

    (select coalesce(sum(total - amount_paid), 0) from public.invoices
      where status in ('issued', 'partially_paid')),

    (select count(*)::integer from public.invoices
      where status in ('issued', 'partially_paid') and due_date < current_date),
    (select coalesce(sum(total - amount_paid), 0) from public.invoices
      where status in ('issued', 'partially_paid') and due_date < current_date),

    (select count(*)::integer from public.speed_limiter_certificates c
      where c.status = 'valid' and c.superseded_by is null
        and c.paid_externally_on is null
        and app.certificate_invoice_id(c.id) is null),

    (select count(*)::integer from public.speed_limiter_certificates c
      where c.status = 'valid' and c.superseded_by is null
        and c.paid_externally_on is null
        and c.expires_at <= current_date + 90
        and app.certificate_invoice_id(c.id) is null
        and app.certificate_order_id(c.id) is null
        and app.certificate_quote_id(c.id) is null);
$$;

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
  collected_30d numeric,
  unbilled_certificates integer,
  renewals_to_quote integer
)
language sql
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
      where paid_at >= current_date - 30),
    (select count(*)::integer from public.speed_limiter_certificates c
      where c.status = 'valid' and c.superseded_by is null
        and c.paid_externally_on is null
        and app.certificate_invoice_id(c.id) is null),
    (select count(*)::integer from public.speed_limiter_certificates c
      where c.status = 'valid' and c.superseded_by is null
        and c.paid_externally_on is null
        and c.expires_at <= current_date + 90
        and app.certificate_invoice_id(c.id) is null
        and app.certificate_order_id(c.id) is null
        and app.certificate_quote_id(c.id) is null);
$$;

notify pgrst, 'reload schema';
