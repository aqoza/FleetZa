-- Sales quote conversion, uniqueness, nullable references, and FK regression.
-- Safe for the demo tenant in production: every write is rolled back.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';
insert into public.tenant_modules (tenant_id, module_id, enabled)
select '170d2d86-5c22-4bcb-9d74-420c879419b2', m, true
from unnest(array['customers','sales','billing']) m
on conflict (tenant_id, module_id) do update set enabled = true;
update public.tenant_modules set enabled = false
where tenant_id = '170d2d86-5c22-4bcb-9d74-420c879419b2'
  and module_id in ('workflow_automation','integrations','notifications');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
do $verify$
declare
  customer uuid; quote uuid; draft_quote uuid; detached uuid;
  converted public.sales_orders; invoice public.invoices;
begin
  insert into public.customers(name) values ('Quote index regression - rollback only') returning id into customer;
  insert into public.quotes(customer_id) values (customer) returning id into quote;
  insert into public.quote_lines(quote_id, description, quantity, unit_price, tax_rate)
  values (quote, 'Regression line', 2, 50, 0);
  update public.quotes set status = 'sent' where id = quote;
  update public.quotes set status = 'accepted' where id = quote;
  converted := public.convert_quote_to_order(quote);
  if (converted.quote_id = quote and converted.status = 'draft' and converted.total = 100) is not true then
    raise exception 'VERIFY FAILED: quote conversion and totals';
  end if;
  if (select sales_order_id = converted.id from public.quotes where id = quote) is not true then
    raise exception 'VERIFY FAILED: reverse quote link';
  end if;
  if (select count(*) = 1 from public.sales_order_lines where sales_order_id = converted.id) is not true then
    raise exception 'VERIFY FAILED: copied lines';
  end if;
  if (select id = converted.id from public.sales_orders where quote_id = quote) is not true then
    raise exception 'VERIFY FAILED: quote equality lookup';
  end if;
  begin
    perform public.convert_quote_to_order(quote);
    raise exception 'VERIFY FAILED: duplicate conversion accepted';
  exception when others then
    if sqlerrm <> 'QUOTE_ALREADY_CONVERTED' then raise; end if;
  end;
  begin
    insert into public.sales_orders(customer_id, quote_id) values (customer, quote);
    raise exception 'VERIFY FAILED: duplicate quote reference accepted';
  exception when unique_violation then null;
  end;
  begin
    insert into public.sales_orders(customer_id, quote_id) values (customer, gen_random_uuid());
    raise exception 'VERIFY FAILED: missing quote reference accepted';
  exception when foreign_key_violation then null;
  end;
  insert into public.sales_orders(customer_id) values (customer), (customer);
  if (select count(*) = 2 from public.sales_orders where customer_id = customer and quote_id is null) is not true then
    raise exception 'VERIFY FAILED: multiple orders without quotes';
  end if;
  insert into public.quotes(customer_id) values (customer) returning id into draft_quote;
  insert into public.sales_orders(customer_id, quote_id) values (customer, draft_quote) returning id into detached;
  delete from public.quotes where id = draft_quote;
  if (select quote_id is null from public.sales_orders where id = detached) is not true then
    raise exception 'VERIFY FAILED: quote deletion sets reference null';
  end if;
  update public.sales_orders set status = 'confirmed' where id = converted.id;
  invoice := public.create_invoice_from_order(converted.id, null::jsonb);
  if (invoice.sales_order_id = converted.id and invoice.total = 100 and invoice.status = 'draft') is not true then
    raise exception 'VERIFY FAILED: order to invoice';
  end if;
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', auth.uid(), 'role', 'authenticated',
      'app_metadata', jsonb_build_object('tenant_id', gen_random_uuid(), 'role', 'owner'))::text, true);
  if exists(select 1 from public.sales_orders where quote_id = quote) then
    raise exception 'VERIFY FAILED: foreign tenant can read quote order';
  end if;
end $verify$;
rollback;
-- @print
select '11 sales quote regression assertions passed; all test writes rolled back' as result;
