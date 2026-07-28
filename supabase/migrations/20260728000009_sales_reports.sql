-- Stage 3: the reporting layer over the commercial chain.
--
-- Same posture as sales_summary(): plain SQL functions, SECURITY INVOKER, so
-- RLS scopes every row to the caller's tenant and the browser never pulls the
-- document tables down to add them up.
--
-- Four functions rather than thirteen, because most of the requested reports
-- are different readings of the same two questions — "where is each document
-- in its lifecycle" and "who owes us what, and how late" — and splitting them
-- would mean thirteen chances for the definitions to drift.

-- 1) Pipeline: every document-status count on one row.
--    Covers pending / approved / rejected quotations, POs received, jobs
--    pending invoice, invoices generated, partially paid, fully paid,
--    outstanding receivables and overdue.
create or replace function public.sales_report_pipeline()
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
  overdue_invoices integer,      overdue_amount numeric
)
language sql
set search_path to ''
as $function$
  select
    -- Quotes still awaiting a decision. `expired` is derived at render from
    -- valid_until, so a sent-but-lapsed quote is deliberately still counted
    -- here as pending: it is work someone has to chase, not a closed case.
    (select count(*)::integer from public.quotes where status in ('draft', 'sent')),
    (select coalesce(sum(total), 0) from public.quotes where status in ('draft', 'sent')),
    (select count(*)::integer from public.quotes where status = 'accepted'),
    (select coalesce(sum(total), 0) from public.quotes where status = 'accepted'),
    (select count(*)::integer from public.quotes where status = 'declined'),

    -- A "PO received" is an order carrying the customer's PO reference.
    (select count(*)::integer from public.sales_orders
      where customer_po_number is not null and status <> 'canceled'),
    (select coalesce(sum(total), 0) from public.sales_orders
      where customer_po_number is not null and status <> 'canceled'),

    -- Work that is finished but not yet billed. Matched on the invoice's
    -- job_id, which the whole chain carries, so an invoice raised through a
    -- quote and an order still counts its job as billed.
    (select count(*)::integer from public.sl_jobs j
      where j.status in ('completed', 'qc_approved', 'closed')
        and not exists (
          select 1 from public.invoices i
           where i.job_id = j.id and i.status <> 'void'
        )),

    -- Issued invoices, at face value. Drafts are not invoices yet and voids
    -- never happened, so neither is counted.
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
      where status in ('issued', 'partially_paid') and due_date < current_date);
$function$;

-- 2) Receivables by customer, aged.
--    One function answers both "outstanding balance by customer" (the row) and
--    "invoice aging 30/60/90+" (the columns, summed) — two readings of one
--    query rather than two queries that can disagree.
--
--    Aging is measured from the DUE date, not the issue date: an invoice on
--    60-day terms issued 45 days ago is not overdue.
create or replace function public.sales_report_receivables()
returns table (
  customer_id uuid,
  customer_name text,
  open_invoices integer,
  outstanding numeric,
  not_yet_due numeric,
  overdue_1_30 numeric,
  overdue_31_60 numeric,
  overdue_61_90 numeric,
  overdue_90_plus numeric,
  oldest_due_date date
)
language sql
set search_path to ''
as $function$
  select
    c.id,
    c.name,
    count(*)::integer,
    coalesce(sum(i.total - i.amount_paid), 0),
    coalesce(sum(i.total - i.amount_paid)
      filter (where i.due_date is null or i.due_date >= current_date), 0),
    coalesce(sum(i.total - i.amount_paid)
      filter (where current_date - i.due_date between 1 and 30), 0),
    coalesce(sum(i.total - i.amount_paid)
      filter (where current_date - i.due_date between 31 and 60), 0),
    coalesce(sum(i.total - i.amount_paid)
      filter (where current_date - i.due_date between 61 and 90), 0),
    coalesce(sum(i.total - i.amount_paid)
      filter (where current_date - i.due_date > 90), 0),
    min(i.due_date)
  from public.invoices i
  join public.customers c on c.id = i.customer_id
  where i.status in ('issued', 'partially_paid')
  group by c.id, c.name
  having coalesce(sum(i.total - i.amount_paid), 0) > 0
  order by 4 desc;
$function$;

-- 3) Revenue by month: what was invoiced, and what was actually collected.
--    Both matter and they are not the same number — invoicing is revenue,
--    payments are cash.
create or replace function public.sales_report_revenue(p_months integer default 12)
returns table (
  month date,
  invoiced numeric,
  collected numeric,
  invoice_count integer
)
language sql
set search_path to ''
as $function$
  with months as (
    select generate_series(
      date_trunc('month', current_date)::date - ((greatest(p_months, 1) - 1) || ' months')::interval,
      date_trunc('month', current_date)::date,
      '1 month'
    )::date as month
  )
  select
    m.month,
    coalesce((
      select sum(i.total) from public.invoices i
       where i.status in ('issued', 'partially_paid', 'paid')
         and date_trunc('month', i.issue_date)::date = m.month
    ), 0),
    coalesce((
      select sum(p.amount) from public.payments p
       where date_trunc('month', p.paid_at)::date = m.month
    ), 0),
    coalesce((
      select count(*)::integer from public.invoices i
       where i.status in ('issued', 'partially_paid', 'paid')
         and date_trunc('month', i.issue_date)::date = m.month
    ), 0)
  from months m
  order by m.month;
$function$;

-- 4) Jobs finished but not billed — the list behind the pipeline count, so
--    someone can act on it rather than just read the number.
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
  order by j.completed_at desc nulls last, j.number desc;
$function$;
