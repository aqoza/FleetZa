-- Customer payment history: every receipt, across invoices.
--
-- The last report from the Stage-3 list. Payments were only visible one
-- invoice at a time, which answers "was this invoice paid" but not "what has
-- this customer actually paid us", which is the question asked when a customer
-- disputes a balance or asks for a statement.
--
-- The join to invoices is what makes it a ledger rather than a list of
-- amounts: a payment on its own does not know who paid it — `payments` carries
-- only `invoice_id`, and the customer hangs off the invoice.
create or replace function public.sales_report_payments(
  p_customer_id uuid default null,
  p_limit integer default 200
)
returns table (
  payment_id uuid,
  paid_at date,
  amount numeric,
  method text,
  reference text,
  invoice_id uuid,
  invoice_number text,
  invoice_total numeric,
  invoice_status text,
  customer_id uuid,
  customer_name text
)
language sql
set search_path to ''
as $function$
  select
    p.id,
    p.paid_at,
    p.amount,
    p.method,
    p.reference,
    i.id,
    i.doc_number,
    i.total,
    i.status,
    c.id,
    c.name
  from public.payments p
  join public.invoices i on i.id = p.invoice_id
  join public.customers c on c.id = i.customer_id
  -- Voided invoices are excluded everywhere else in the reporting layer, but
  -- NOT here: money that actually changed hands stays in the history even if
  -- the invoice it was applied to was later voided. Hiding it would make the
  -- ledger disagree with the bank.
  where p_customer_id is null or c.id = p_customer_id
  order by p.paid_at desc, p.created_at desc
  limit greatest(coalesce(p_limit, 200), 1);
$function$;
