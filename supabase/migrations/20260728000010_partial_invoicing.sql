-- Stage 2: several invoices against one order (and therefore one PO).
--
-- Until now create_invoice_from_order copied EVERY line, so calling it twice
-- produced two full invoices for the same work rather than progress billing.
-- That is the bug behind "multiple invoices against a single Purchase Order":
-- the operation was not partial, it was repeatable.
--
-- The unit is quantity per order line. A fleet PO is "50 × installation", and
-- the dealer invoices 20 vehicles this month and 30 next — so invoicing whole
-- lines only would not cover it, while quantity does (a whole line is just the
-- full quantity).

-- Which order line an invoice line bills. This is the whole mechanism: with
-- it, "how much of this line is already invoiced" is a sum over invoice lines
-- rather than a counter someone has to keep in step.
alter table public.invoice_lines
  add column if not exists sales_order_line_id uuid
    references public.sales_order_lines (id) on delete set null;

create index if not exists invoice_lines_order_line_idx
  on public.invoice_lines (sales_order_line_id)
  where sales_order_line_id is not null;

comment on column public.invoice_lines.sales_order_line_id is
  'The order line this bills. Progress billing derives remaining quantity from these rather than storing a counter.';

-- What is left to invoice on an order, per line.
--
-- Derived, never stored: a stored invoiced_quantity would need to be corrected
-- on every invoice insert, void, un-void and line delete, and any missed path
-- silently lets a customer be billed twice. Voided invoices are excluded
-- because a void never happened; drafts ARE counted, so two people preparing
-- drafts at once cannot both claim the same quantity.
create or replace function public.sales_order_line_balance(p_order_id uuid)
returns table (
  line_id uuid,
  sort_order integer,
  description text,
  unit text,
  unit_price numeric,
  quantity numeric,
  invoiced_quantity numeric,
  remaining_quantity numeric
)
language sql
set search_path to ''
as $function$
  select
    l.id,
    l.sort_order,
    l.description,
    l.unit,
    l.unit_price,
    l.quantity,
    coalesce(inv.qty, 0),
    greatest(l.quantity - coalesce(inv.qty, 0), 0)
  from public.sales_order_lines l
  left join lateral (
    select sum(il.quantity) as qty
      from public.invoice_lines il
      join public.invoices i on i.id = il.invoice_id
     where il.sales_order_line_id = l.id
       and i.status <> 'void'
  ) inv on true
  where l.sales_order_id = p_order_id
  order by l.sort_order, l.created_at;
$function$;

-- Issue an invoice for part of an order.
--
-- p_lines is [{"line_id": uuid, "quantity": number}, …]. Passing null keeps
-- the old call working and invoices everything REMAINING — which is what the
-- old signature always meant to do; copying every line unconditionally was the
-- defect, because the second call duplicated the first.
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

  -- What the caller asked for, defaulted to "whatever is still uninvoiced",
  -- aggregated by line so two entries for the same line are one claim rather
  -- than two that each pass the check and together overdraw it.
  --
  -- Held in a jsonb local rather than a temp table: issuing several invoices
  -- for one order inside a single transaction is precisely what this function
  -- is for, and an ON COMMIT DROP temp table makes the second call fail.
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

  -- Every requested line must belong to this order and still have the room.
  -- Checked before anything is written, so a rejected request leaves no
  -- half-built invoice and no consumed document number behind.
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
    v_o.job_id, v_o.certificate_id, v_o.customer_po_number
  ) returning * into v_inv;

  insert into public.invoice_lines (
    tenant_id, invoice_id, sales_order_line_id, sort_order, product_id, vehicle_id,
    description, quantity, unit, unit_price, discount_percent, tax_rate
  )
  select v_inv.tenant_id, v_inv.id, l.id, l.sort_order, l.product_id, l.vehicle_id,
         l.description, (e->>'quantity')::numeric, l.unit, l.unit_price, l.discount_percent, l.tax_rate
    from jsonb_array_elements(v_req) e
    join public.sales_order_lines l on l.id = (e->>'line_id')::uuid
   order by l.sort_order, l.created_at;

  select * into v_inv from public.invoices where id = v_inv.id;
  return v_inv;
end;
$function$;
