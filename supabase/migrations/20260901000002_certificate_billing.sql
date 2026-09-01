-- Certificate ↔ invoice tracking, and the consolidated renewal invoice.
--
-- The dealer certifies fleets: a customer turns up with 10 or 100 vehicles,
-- every one gets a renewed certificate, and the customer expects ONE invoice
-- with a line per vehicle. Until now the only link between the two was
-- invoices.certificate_id — one certificate per document, the shape
-- docs/SALES.md called "the case that would promote this to a link table".
-- This is that promotion, made at the level where it is true: an invoice LINE
-- bills one certificate for one vehicle, so the link lives on the line.
--
-- What it buys:
--   * a certificate knows whether it has been invoiced, and whether that
--     invoice is paid — derived from the links, never stored;
--   * a certificate cannot be billed twice (CERT_ALREADY_INVOICED);
--   * one RPC turns any set of a customer's certificates into one draft
--     invoice, a line per vehicle carrying the plate and certificate number;
--   * "certificates pending invoice" is a report row and a KPI, so a renewal
--     that was issued but never billed is a number someone sees, not a
--     payment that never arrives.
--
-- invoices.certificate_id stays: the job page still raises a single-document
-- invoice with it, and every tracking query below reads both the header link
-- and the line links, so the two paths agree.

-- ------------------------------------------------------------------
-- 1) The link. Nullable, ON DELETE SET NULL — deleting a certificate can never
--    take an issued invoice with it. Partial indexes because the tracking
--    queries below are all "find the invoice for THIS certificate".
-- ------------------------------------------------------------------
alter table public.invoice_lines
  add column if not exists certificate_id uuid
    references public.speed_limiter_certificates (id) on delete set null;

create index if not exists invoice_lines_certificate_idx
  on public.invoice_lines (certificate_id) where certificate_id is not null;
create index if not exists invoices_certificate_idx
  on public.invoices (certificate_id) where certificate_id is not null;

comment on column public.invoice_lines.certificate_id is
  'The certificate this line bills. A certificate is on at most one non-void invoice (app.guard_line_certificate).';

-- ------------------------------------------------------------------
-- 2) ONE definition of "the invoice that bills this certificate". Every
--    surface — the computed column, the status RPC, the guard, the reports —
--    goes through it, so they cannot disagree about what "invoiced" means.
--
--    Voided invoices are excluded (a void never happened); drafts ARE counted,
--    so two people preparing drafts cannot both claim the same certificate —
--    the same rule progress billing applies to order lines. If, despite the
--    guard, more than one qualifies, the most settled one wins.
-- ------------------------------------------------------------------
create or replace function app.certificate_invoice_id(p_certificate_id uuid)
returns uuid
language sql
stable
set search_path = ''
as $$
  select x.id
    from (
      select i.id, i.status, i.created_at
        from public.invoices i
       where i.certificate_id = p_certificate_id and i.status <> 'void'
      union
      select i.id, i.status, i.created_at
        from public.invoice_lines il
        join public.invoices i on i.id = il.invoice_id
       where il.certificate_id = p_certificate_id and i.status <> 'void'
    ) x
   order by case x.status
              when 'paid' then 0 when 'partially_paid' then 1 when 'issued' then 2 else 3
            end,
            x.created_at desc
   limit 1;
$$;

-- ------------------------------------------------------------------
-- 3) Billing state as a PostgREST computed column on the certificate row, so
--    the certificates list can filter on it (`billing_state=eq.unbilled`)
--    alongside its existing expiry and search predicates rather than growing
--    a second list query. Coarse on purpose — the invoice's number, due date
--    and balance come from certificate_billing_status() below.
--
--      unbilled · draft · invoiced (issued or partially paid) · paid
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
    'unbilled');
$$;

-- ------------------------------------------------------------------
-- 4) The invoice behind a set of certificates — the page of 25 the list
--    shows, the current certificate on a vehicle page, a modal's selection.
--    Bounded by the caller's array; absent rows mean "not invoiced".
-- ------------------------------------------------------------------
create or replace function public.certificate_billing_status(p_certificate_ids uuid[])
returns table (
  certificate_id uuid,
  invoice_id uuid,
  doc_number text,
  status text,
  due_date date,
  total numeric,
  amount_paid numeric,
  currency text
)
language sql
stable
set search_path = ''
as $$
  select u.id, i.id, i.doc_number, i.status, i.due_date, i.total, i.amount_paid, i.currency
    from unnest(coalesce(p_certificate_ids, '{}'::uuid[])) as u(id)
    join public.invoices i on i.id = app.certificate_invoice_id(u.id);
$$;
revoke execute on function public.certificate_billing_status(uuid[]) from public, anon;

-- ------------------------------------------------------------------
-- 5) A certificate is billed at most once. Same posture as the money
--    guards: the UI hides what it can, the database is what guarantees it.
--    A header link and a line for the same certificate on the SAME invoice is
--    allowed — that is what a single-certificate invoice looks like.
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

drop trigger if exists invoice_lines_certificate_guard on public.invoice_lines;
create trigger invoice_lines_certificate_guard
  before insert or update of certificate_id on public.invoice_lines
  for each row execute function app.guard_line_certificate();

drop trigger if exists invoices_certificate_guard on public.invoices;
create trigger invoices_certificate_guard
  before insert or update of certificate_id on public.invoices
  for each row execute function app.guard_invoice_certificate();

-- ------------------------------------------------------------------
-- 6) One invoice for a set of certificates — the consolidated renewal bill.
--    One RPC, one transaction, same as the other conversions: copying a
--    hundred lines with a hundred round trips is how half-built invoices
--    get created.
--
--    Every check runs before anything is written, so a rejected request
--    leaves no half-built invoice and no consumed document number:
--      NO_CERTIFICATES           – nothing to bill
--      CERTIFICATE_NOT_FOUND     – an id that does not resolve (RLS hides
--                                  other tenants' rows, which reads the same)
--      CERT_NO_CUSTOMER          – a certificate with no customer to bill
--      CERTS_MULTIPLE_CUSTOMERS  – an invoice bills one customer
--      CERT_ALREADY_INVOICED     – already on a non-void invoice
--
--    Each line: quantity 1, the vehicle and certificate linked, and a
--    description that snapshots the service name, the plate and the
--    certificate number — the printed invoice keeps them even if the
--    certificate row is later deleted (the FK goes null, the text stays).
--    p_description is the service name the caller wants printed; the plate
--    and number are appended here so every path spells the line the same way.
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
-- 7) Reporting. Live certificates (the one a vehicle carries, not revoked)
--    with no invoice: the list behind the KPI, so it can be acted on — and
--    optionally one customer's, which is the list the consolidated invoice
--    is built from. The imported paper register makes this long on day one;
--    that is the backlog, not noise.
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
     and (p_customer_id is null or c.customer_id = p_customer_id)
     and app.certificate_invoice_id(c.id) is null
   order by cu.name nulls last, c.issued_at desc, c.certificate_number desc;
$$;
revoke execute on function public.sales_report_certificates_pending_invoice(uuid) from public, anon;

-- A job is billed when an invoice names it OR when the certificate it produced
-- is on an invoice. Until now only the first counted, so a job whose
-- certificate was billed through a consolidated invoice would have stayed
-- "pending" forever.
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
set search_path to ''
as $function$
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
       where sc.job_id = j.id and app.certificate_invoice_id(sc.id) is not null
    )
  order by j.completed_at desc nulls last, j.number desc;
$function$;

-- The pipeline row grows a column, which means drop + create: a function's
-- return type cannot be changed in place. Body otherwise as before, apart
-- from jobs_pending_invoice adopting the rule above.
drop function if exists public.sales_report_pipeline();
create function public.sales_report_pipeline()
returns table (
  pending_quotes integer,        pending_quote_value numeric,
  accepted_quotes integer,       accepted_quote_value numeric,
  declined_quotes integer,
  pos_received integer,          pos_received_value numeric,
  jobs_pending_invoice integer,
  invoices_generated integer,    invoiced_value numeric,
  partially_paid_invoices integer, partially_paid_outstanding numeric,
  paid_invoices integer,         paid_value numeric,
  outstanding_amount numeric,
  overdue_invoices integer,      overdue_amount numeric,
  certificates_pending_invoice integer
)
language sql
set search_path to ''
as $function$
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
           where sc.job_id = j.id and app.certificate_invoice_id(sc.id) is not null
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

    -- Live certificates nobody has billed — the renewal that was issued and
    -- then forgotten is exactly the payment that never arrives.
    (select count(*)::integer from public.speed_limiter_certificates c
      where c.status = 'valid' and c.superseded_by is null
        and app.certificate_invoice_id(c.id) is null);
$function$;

-- Same for the hub's KPI row: the count the overview needs to point at the
-- certificates list, computed in SQL like every other tile.
drop function if exists public.sales_summary();
create function public.sales_summary()
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
  unbilled_certificates integer
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
      where paid_at >= current_date - 30),
    (select count(*)::integer from public.speed_limiter_certificates c
      where c.status = 'valid' and c.superseded_by is null
        and app.certificate_invoice_id(c.id) is null);
$$;
revoke execute on function public.sales_summary() from public, anon;

notify pgrst, 'reload schema';
