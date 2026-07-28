-- Stage 1 of the flexible commercial workflow: capture the customer's purchase
-- order, and link sales documents to the operational work they bill for.
--
-- Four customer processes have to be walkable, not one:
--
--   1. Quote → PO → Invoice → Payment
--   2. PO → Job → Invoice → Payment
--   3. Job → Certificate → Quote → PO → Invoice
--   4. Job → Invoice → Payment            (no quote, no PO)
--
-- The chain already supported the *shape* of all four — `sales_orders.quote_id`
-- and `invoices.sales_order_id` are both nullable, so a document can start
-- anywhere. What was missing is the two things that make them one story: the
-- customer's PO, and a link back to the job/certificate being billed.
--
-- The PO lives on the sales order rather than in a table of its own. The order
-- already is "the agreed work": it carries lines, totals, tax, a state machine
-- and `invoiced_total`, so "several invoices against one PO" becomes partial
-- invoicing of that order (Stage 2) rather than a second order-shaped entity
-- kept in step with the first.

-- The PO as the customer issued it. Three separate columns, not one text
-- field: the reports want to count POs received and the date they arrived, and
-- a scanned PO is what an auditor asks for.
alter table public.sales_orders
  add column if not exists customer_po_number text,
  add column if not exists customer_po_date   date,
  add column if not exists customer_po_url    text;

-- Snapshotted onto the invoice, not joined through the order: an invoice must
-- print the PO it was raised against for the rest of its life, and a direct
-- invoice (scenario 4) has no order to join to. Populated by
-- create_invoice_from_order and editable by hand while the invoice is a draft.
alter table public.invoices
  add column if not exists customer_po_number text;

-- Which work each document bills for. Nullable everywhere — a document that
-- bills no specific job is normal — and `on delete set null` so removing a job
-- can never take an issued invoice with it.
--
-- One job per document, not a link table: in this domain a job is one vehicle
-- and one certificate, which is what the four flows describe. An invoice that
-- has to span several jobs is a real case (a monthly consolidated bill) and is
-- the reason to promote this to a link table later; it does not block Stage 1.
alter table public.quotes
  add column if not exists job_id uuid references public.sl_jobs (id) on delete set null,
  add column if not exists certificate_id uuid
    references public.speed_limiter_certificates (id) on delete set null;

alter table public.sales_orders
  add column if not exists job_id uuid references public.sl_jobs (id) on delete set null,
  add column if not exists certificate_id uuid
    references public.speed_limiter_certificates (id) on delete set null;

alter table public.invoices
  add column if not exists job_id uuid references public.sl_jobs (id) on delete set null,
  add column if not exists certificate_id uuid
    references public.speed_limiter_certificates (id) on delete set null;

-- "Jobs pending invoice" reads jobs that have no invoice; "POs received" reads
-- orders that carry a PO number. Both are list queries, so both get an index.
create index if not exists invoices_job_id_idx
  on public.invoices (tenant_id, job_id) where job_id is not null;
create index if not exists quotes_job_id_idx
  on public.quotes (tenant_id, job_id) where job_id is not null;
create index if not exists sales_orders_job_id_idx
  on public.sales_orders (tenant_id, job_id) where job_id is not null;
create index if not exists sales_orders_customer_po_idx
  on public.sales_orders (tenant_id, customer_po_date desc)
  where customer_po_number is not null;

comment on column public.sales_orders.customer_po_number is
  'The customer''s own purchase order reference. Its presence is what makes this order a "PO received".';
comment on column public.invoices.customer_po_number is
  'Snapshot of the PO this invoice was raised against, so an issued invoice keeps printing it.';

-- ------------------------------------------------------------------
-- Carry the links along the chain. Without this a quote raised from a job
-- loses the job the moment it becomes an order, and the invoice at the end of
-- the chain cannot say which work it billed.
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
$function$;

create or replace function public.create_invoice_from_order(p_order_id uuid)
returns public.invoices
language plpgsql
set search_path to ''
as $function$
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
    currency_decimals, due_date, title, customer_reference, terms, notes, internal_notes,
    job_id, certificate_id, customer_po_number
  ) values (
    v_o.tenant_id, v_o.customer_id, v_o.contact_id, v_o.vehicle_id, v_o.id, v_o.currency,
    v_o.currency_decimals, current_date + coalesce(v_terms, 30), v_o.title,
    v_o.customer_reference, v_o.terms, v_o.notes, v_o.internal_notes,
    v_o.job_id, v_o.certificate_id, v_o.customer_po_number
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
$function$;
