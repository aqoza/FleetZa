-- Renewal quotes per vehicle, and the certificate link carried down the chain.
--
-- The other half of certificate billing (20260901000002). Before a renewal is
-- done it is quoted: a customer's vehicles are coming up for expiry, and the
-- dealer sends one quote with a line per vehicle naming the plate and the
-- certificate being renewed. When the customer accepts, the quote becomes an
-- order and then an invoice — and that invoice must count the RENEWED
-- certificate as billed, not the expired one the quote named.
--
-- So the link goes on every line table, and the conversions carry it:
--   quote line   → the certificate being renewed (the one about to expire)
--   order line   → copied as-is by convert_quote_to_order
--   invoice line → resolved to the head of that certificate's supersession
--                  chain by create_invoice_from_order, i.e. the certificate
--                  the vehicle carries by the time it is billed
--
-- Tracking grows two states in front of "unbilled": an open quote makes a
-- certificate "quoted", a live order makes it "ordered". Same rule as
-- invoices — one definition each, read by the computed column, the status
-- RPC, the worklist and the KPI — so a renewal is never quoted twice and
-- never forgotten between the quote and the bill.

-- ------------------------------------------------------------------
-- 1) The link on quote and order lines.
-- ------------------------------------------------------------------
alter table public.quote_lines
  add column if not exists certificate_id uuid
    references public.speed_limiter_certificates (id) on delete set null;
alter table public.sales_order_lines
  add column if not exists certificate_id uuid
    references public.speed_limiter_certificates (id) on delete set null;

create index if not exists quote_lines_certificate_idx
  on public.quote_lines (certificate_id) where certificate_id is not null;
create index if not exists sales_order_lines_certificate_idx
  on public.sales_order_lines (certificate_id) where certificate_id is not null;
create index if not exists quotes_certificate_idx
  on public.quotes (certificate_id) where certificate_id is not null;
create index if not exists sales_orders_certificate_idx
  on public.sales_orders (certificate_id) where certificate_id is not null;

comment on column public.quote_lines.certificate_id is
  'The certificate this line quotes the renewal of. Carried to the order line, and resolved to the renewed certificate on the invoice line.';
comment on column public.sales_order_lines.certificate_id is
  'Copied from the quote line by convert_quote_to_order; create_invoice_from_order resolves it to the head of its chain.';

-- ------------------------------------------------------------------
-- 2) Following a renewal. The quote named the expiring certificate; by the
--    time the work is billed the vehicle carries its successor. Walk the
--    supersession chain to its head (bounded — a chain is one row per year).
-- ------------------------------------------------------------------
create or replace function app.certificate_head(p_certificate_id uuid)
returns uuid
language sql
stable
set search_path = ''
as $$
  with recursive chain as (
    select c.id, c.superseded_by, 1 as depth
      from public.speed_limiter_certificates c
     where c.id = p_certificate_id
    union all
    select n.id, n.superseded_by, chain.depth + 1
      from chain
      join public.speed_limiter_certificates n on n.id = chain.superseded_by
     where chain.depth < 100
  )
  select coalesce(
    (select ch.id from chain ch where ch.superseded_by is null limit 1),
    p_certificate_id);
$$;

-- ------------------------------------------------------------------
-- 3) ONE definition each of "the open quote for this certificate" and "the
--    live order for it" — through the line links or the header link the
--    job page writes. An open quote is draft, sent or accepted (accepted and
--    converted still counts: the renewal is spoken for); a declined,
--    expired or canceled one leaves the certificate free to quote again.
-- ------------------------------------------------------------------
create or replace function app.certificate_quote_id(p_certificate_id uuid)
returns uuid
language sql
stable
set search_path = ''
as $$
  select x.id
    from (
      select q.id, q.status, q.created_at
        from public.quotes q
       where q.certificate_id = p_certificate_id
         and q.status in ('draft', 'sent', 'accepted')
      union
      select q.id, q.status, q.created_at
        from public.quote_lines ql
        join public.quotes q on q.id = ql.quote_id
       where ql.certificate_id = p_certificate_id
         and q.status in ('draft', 'sent', 'accepted')
    ) x
   order by case x.status when 'accepted' then 0 when 'sent' then 1 else 2 end,
            x.created_at desc
   limit 1;
$$;

create or replace function app.certificate_order_id(p_certificate_id uuid)
returns uuid
language sql
stable
set search_path = ''
as $$
  select x.id
    from (
      select o.id, o.created_at
        from public.sales_orders o
       where o.certificate_id = p_certificate_id and o.status <> 'canceled'
      union
      select o.id, o.created_at
        from public.sales_order_lines ol
        join public.sales_orders o on o.id = ol.sales_order_id
       where ol.certificate_id = p_certificate_id and o.status <> 'canceled'
    ) x
   order by x.created_at desc
   limit 1;
$$;

-- The computed column grows the two pre-invoice states. Precedence: an
-- invoice always wins (that is what is owed), then an order, then a quote.
--   unbilled · quoted · ordered · draft · invoiced · paid
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
    case when app.certificate_order_id(c.id) is not null then 'ordered' end,
    case when app.certificate_quote_id(c.id) is not null then 'quoted' end,
    'unbilled');
$$;

-- The quote and order behind a set of certificates — the pre-invoice half of
-- certificate_billing_status(); absent rows mean neither exists.
create or replace function public.certificate_quote_status(p_certificate_ids uuid[])
returns table (
  certificate_id uuid,
  quote_id uuid,
  quote_number text,
  quote_status text,
  valid_until date,
  order_id uuid,
  order_number text,
  order_status text
)
language sql
stable
set search_path = ''
as $$
  select u.id, q.id, q.doc_number, q.status, q.valid_until, o.id, o.doc_number, o.status
    from unnest(coalesce(p_certificate_ids, '{}'::uuid[])) as u(id)
    left join public.quotes q on q.id = app.certificate_quote_id(u.id)
    left join public.sales_orders o on o.id = app.certificate_order_id(u.id)
   where q.id is not null or o.id is not null;
$$;
revoke execute on function public.certificate_quote_status(uuid[]) from public, anon;

-- ------------------------------------------------------------------
-- 4) One quote for a set of certificates — the renewal quote. Same shape and
--    the same up-front checks as create_invoice_from_certificates, minus the
--    already-billed guard: a quote is a proposal, not a claim, and a
--    certificate whose earlier quote was declined or lapsed is quoted again.
--    The dialog tells the operator about an open one; the database does not
--    refuse it.
-- ------------------------------------------------------------------
create or replace function public.create_quote_from_certificates(
  p_certificate_ids uuid[],
  p_description text default null,
  p_unit_price numeric default null,
  p_tax_rate numeric default null,
  p_product_id uuid default null
)
returns public.quotes
language plpgsql
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_tenant uuid;
  v_customer uuid;
  v_customers integer;
  v_found integer;
  v_valid integer;
  v_quote_terms text;
  v_default_tax numeric;
  v_product public.products%rowtype;
  v_single public.speed_limiter_certificates%rowtype;
  v_q public.quotes%rowtype;
begin
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

  select quote_valid_days, quote_terms, default_tax_rate
    into v_valid, v_quote_terms, v_default_tax
    from public.sales_settings
   where tenant_id = v_tenant;

  if p_product_id is not null then
    select * into v_product from public.products where id = p_product_id;
  end if;

  if array_length(v_ids, 1) = 1 then
    select * into v_single from public.speed_limiter_certificates where id = v_ids[1];
  end if;

  insert into public.quotes (
    tenant_id, customer_id, vehicle_id, job_id, certificate_id, valid_until, terms
  ) values (
    v_tenant, v_customer, v_single.vehicle_id, v_single.job_id, v_single.id,
    current_date + coalesce(v_valid, 30), v_quote_terms
  ) returning * into v_q;

  insert into public.quote_lines (
    tenant_id, quote_id, sort_order, product_id, vehicle_id, certificate_id,
    description, quantity, unit, unit_price, discount_percent, tax_rate
  )
  select
    v_tenant, v_q.id,
    (row_number() over (order by v.license_plate nulls last, c.certificate_number))::integer - 1,
    p_product_id, c.vehicle_id, c.id,
    concat_ws(' · ',
      coalesce(nullif(btrim(p_description), ''), v_product.name, 'Speed limiter certificate renewal'),
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

  select * into v_q from public.quotes where id = v_q.id;
  return v_q;
end;
$$;
revoke execute on function public.create_quote_from_certificates(uuid[], text, numeric, numeric, uuid)
  from public, anon;

-- ------------------------------------------------------------------
-- 5) Carry the link down the chain. Bodies as in 20260728000008 and
--    20260728000010 plus the certificate column; revise_quote also gains the
--    header links it had been dropping.
-- ------------------------------------------------------------------
create or replace function public.convert_quote_to_order(p_quote_id uuid)
returns public.sales_orders
language plpgsql
set search_path to ''
as $function$
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
    currency_decimals, title, customer_reference, terms, notes, internal_notes,
    job_id, certificate_id
  ) values (
    v_q.tenant_id, v_q.customer_id, v_q.contact_id, v_q.vehicle_id, v_q.id, v_q.currency,
    v_q.currency_decimals, v_q.title, v_q.customer_reference, v_q.terms, v_q.notes,
    v_q.internal_notes, v_q.job_id, v_q.certificate_id
  ) returning * into v_order;

  insert into public.sales_order_lines (
    tenant_id, sales_order_id, sort_order, product_id, vehicle_id, certificate_id, description,
    quantity, unit, unit_price, discount_percent, tax_rate
  )
  select v_order.tenant_id, v_order.id, l.sort_order, l.product_id, l.vehicle_id, l.certificate_id,
         l.description, l.quantity, l.unit, l.unit_price, l.discount_percent, l.tax_rate
    from public.quote_lines l
   where l.quote_id = v_q.id
   order by l.sort_order, l.created_at;

  update public.quotes set sales_order_id = v_order.id where id = v_q.id;

  select * into v_order from public.sales_orders where id = v_order.id;
  return v_order;
end;
$function$;

create or replace function public.create_invoice_from_order(
  p_order_id uuid,
  p_lines jsonb default null
)
returns public.invoices
language plpgsql
set search_path to ''
as $function$
declare
  v_o public.sales_orders%rowtype;
  v_inv public.invoices%rowtype;
  v_terms integer;
  v_req jsonb;
begin
  select * into v_o from public.sales_orders where id = p_order_id for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;
  if v_o.status not in ('confirmed', 'fulfilled') then
    raise exception 'ORDER_NOT_INVOICEABLE';
  end if;

  if p_lines is null then
    select coalesce(jsonb_agg(jsonb_build_object(
             'line_id', b.line_id, 'quantity', b.remaining_quantity)), '[]'::jsonb)
      into v_req
      from public.sales_order_line_balance(p_order_id) b
     where b.remaining_quantity > 0;
  else
    select coalesce(jsonb_agg(jsonb_build_object(
             'line_id', line_id, 'quantity', qty)), '[]'::jsonb)
      into v_req
      from (
        select (e->>'line_id')::uuid as line_id, sum((e->>'quantity')::numeric) as qty
          from jsonb_array_elements(p_lines) e
         group by 1
        having sum((e->>'quantity')::numeric) > 0
      ) grouped;
  end if;

  if jsonb_array_length(v_req) = 0 then
    raise exception 'NOTHING_TO_INVOICE';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(v_req) e
      left join public.sales_order_line_balance(p_order_id) b
        on b.line_id = (e->>'line_id')::uuid
     where b.line_id is null
        or (e->>'quantity')::numeric > b.remaining_quantity
  ) then
    raise exception 'INVOICE_EXCEEDS_ORDER';
  end if;

  select payment_terms_days into v_terms
    from public.sales_settings where tenant_id = v_o.tenant_id;

  insert into public.invoices (
    tenant_id, customer_id, contact_id, vehicle_id, sales_order_id, currency,
    currency_decimals, due_date, title, customer_reference, terms, notes, internal_notes,
    job_id, certificate_id, customer_po_number
  ) values (
    v_o.tenant_id, v_o.customer_id, v_o.contact_id, v_o.vehicle_id, v_o.id, v_o.currency,
    v_o.currency_decimals, current_date + coalesce(v_terms, 30), v_o.title,
    v_o.customer_reference, v_o.terms, v_o.notes, v_o.internal_notes,
    v_o.job_id, app.certificate_head(v_o.certificate_id), v_o.customer_po_number
  ) returning * into v_inv;

  -- The order line named the certificate the quote was for; the invoice bills
  -- the renewal, so the line links the certificate the vehicle carries NOW —
  -- the head of that chain (itself, if it has not been renewed yet).
  insert into public.invoice_lines (
    tenant_id, invoice_id, sales_order_line_id, sort_order, product_id, vehicle_id, certificate_id,
    description, quantity, unit, unit_price, discount_percent, tax_rate
  )
  select v_inv.tenant_id, v_inv.id, l.id, l.sort_order, l.product_id, l.vehicle_id,
         app.certificate_head(l.certificate_id),
         l.description, (e->>'quantity')::numeric, l.unit, l.unit_price, l.discount_percent, l.tax_rate
    from jsonb_array_elements(v_req) e
    join public.sales_order_lines l on l.id = (e->>'line_id')::uuid
   order by l.sort_order, l.created_at;

  select * into v_inv from public.invoices where id = v_inv.id;
  return v_inv;
end;
$function$;

create or replace function public.revise_quote(p_quote_id uuid)
returns public.quotes
language plpgsql
set search_path to ''
as $function$
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
    revision, revision_of, job_id, certificate_id
  ) values (
    v_q.tenant_id, v_q.customer_id, v_q.contact_id, v_q.vehicle_id, v_q.currency,
    v_q.currency_decimals, current_date + coalesce(v_valid, 30), v_q.title,
    v_q.customer_reference, v_q.terms, v_q.notes, v_q.internal_notes,
    v_q.revision + 1, coalesce(v_q.revision_of, v_q.id), v_q.job_id, v_q.certificate_id
  ) returning * into v_new;

  insert into public.quote_lines (
    tenant_id, quote_id, sort_order, product_id, vehicle_id, certificate_id, description,
    quantity, unit, unit_price, discount_percent, tax_rate
  )
  select v_new.tenant_id, v_new.id, l.sort_order, l.product_id, l.vehicle_id, l.certificate_id,
         l.description, l.quantity, l.unit, l.unit_price, l.discount_percent, l.tax_rate
    from public.quote_lines l
   where l.quote_id = v_q.id
   order by l.sort_order, l.created_at;

  select * into v_new from public.quotes where id = v_new.id;
  return v_new;
end;
$function$;

-- ------------------------------------------------------------------
-- 6) The worklist: renewals due that nobody has quoted. Live certificates
--    expiring within p_days (or already expired — those need it most) with
--    no open quote, no live order and no invoice.
-- ------------------------------------------------------------------
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
     and c.expires_at <= current_date + greatest(coalesce(p_days, 90), 0)
     and (p_customer_id is null or c.customer_id = p_customer_id)
     and app.certificate_invoice_id(c.id) is null
     and app.certificate_order_id(c.id) is null
     and app.certificate_quote_id(c.id) is null
   order by cu.name nulls last, c.expires_at, c.certificate_number;
$$;
revoke execute on function public.sales_report_renewals_to_quote(integer, uuid) from public, anon;

-- The KPI, on the pipeline row and the hub summary (drop + create: a
-- function's return type cannot change in place). Ninety days is the
-- certificates list's own outer band.
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
  certificates_pending_invoice integer,
  renewals_to_quote integer
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

    (select count(*)::integer from public.speed_limiter_certificates c
      where c.status = 'valid' and c.superseded_by is null
        and app.certificate_invoice_id(c.id) is null),

    (select count(*)::integer from public.speed_limiter_certificates c
      where c.status = 'valid' and c.superseded_by is null
        and c.expires_at <= current_date + 90
        and app.certificate_invoice_id(c.id) is null
        and app.certificate_order_id(c.id) is null
        and app.certificate_quote_id(c.id) is null);
$function$;

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
  unbilled_certificates integer,
  renewals_to_quote integer
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
        and app.certificate_invoice_id(c.id) is null),
    (select count(*)::integer from public.speed_limiter_certificates c
      where c.status = 'valid' and c.superseded_by is null
        and c.expires_at <= current_date + 90
        and app.certificate_invoice_id(c.id) is null
        and app.certificate_order_id(c.id) is null
        and app.certificate_quote_id(c.id) is null);
$$;
revoke execute on function public.sales_summary() from public, anon;

notify pgrst, 'reload schema';
