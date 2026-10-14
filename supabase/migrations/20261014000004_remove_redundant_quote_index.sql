-- The retained unique index covers quote equality lookups and FK checks.
-- The application does not filter sales orders by quote_id IS NULL.
-- Production preflight: zero sales-order rows; bounded transactional DDL.
set local lock_timeout = '3s';
set local statement_timeout = '60s';

do $$
begin
  if not exists (
    select 1 from pg_index i
    where i.indexrelid = to_regclass('public.sales_orders_quote_uk')
      and i.indrelid = 'public.sales_orders'::regclass
      and i.indisunique and i.indisvalid and i.indisready
      and pg_get_indexdef(i.indexrelid) =
        'CREATE UNIQUE INDEX sales_orders_quote_uk ON public.sales_orders USING btree (quote_id) WHERE (quote_id IS NOT NULL)'
  ) then
    raise exception 'Required sales-order quote replacement index is missing or changed';
  end if;
end $$;

drop index public.sales_orders_quote_idx;
