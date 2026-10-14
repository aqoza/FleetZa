-- Dry-run tests for 20261008000030_pos.sql (PGlite replica:
-- node docs/buildout/pglite/harness.mjs run docs/buildout/tests/pos_tests.sql).
begin;
create temp table _t (name text, ok boolean, detail text);
grant all on _t to authenticated, service_role, anon;
create temp table _ids (k text primary key, id uuid);
grant all on _ids to authenticated, service_role;

update public.tenants set currency_decimals = 2 where id = '170d2d86-5c22-4bcb-9d74-420c879419b2';
insert into public.tenant_modules (tenant_id, module_id, enabled) values
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'sales', true),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'inventory', true)
on conflict (tenant_id, module_id) do update set enabled = true;
insert into public.products (id, tenant_id, name, unit_price, tax_rate, kind) values
  ('b05c0de0-0030-4b2c-9d3e-000000000001', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Engine oil 5L', 12.5, 5, 'part'),
  ('b05c0de0-0030-4b2c-9d3e-000000000002', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Car wash', 4, 0, 'service'),
  ('b05c0de0-0030-4b2c-9d3e-000000000003', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Old item', 1, 0, 'part'),
  ('b05c0de0-0030-4b2c-9d3e-00000000000b', '5eed0000-0000-4000-8000-0000000000b1', 'Foreign', 1, 0, 'part');
update public.products set active = false where id = 'b05c0de0-0030-4b2c-9d3e-000000000003';
insert into public.customers (id, tenant_id, name) values
  ('b05c0de0-0030-4b2c-9d3e-0000000000d1', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Walk-in regular');
insert into public.warehouses (id, tenant_id, name) values
  ('b05c0de0-0030-4b2c-9d3e-0000000000a1', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Shop floor');
insert into public.inventory_items (id, tenant_id, name, product_id, cost_price, track_stock) values
  ('b05c0de0-0030-4b2c-9d3e-0000000000c1', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Engine oil 5L', 'b05c0de0-0030-4b2c-9d3e-000000000001', 8, true);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
select public.stock_receive('b05c0de0-0030-4b2c-9d3e-0000000000c1', 'b05c0de0-0030-4b2c-9d3e-0000000000a1', 10, 8, null);
do $$ begin
  insert into public.pos_registers (name) values ('Front desk');
  insert into _t values ('module off: register refused', false, null);
exception when others then insert into _t values ('module off: register refused', sqlstate = '42501', sqlerrm); end $$;
reset role;
insert into public.tenant_modules (tenant_id, module_id, enabled)
values ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'pos', true)
on conflict (tenant_id, module_id) do update set enabled = true;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
with x as (insert into public.pos_registers (name, warehouse_id) values ('  Front desk ', 'b05c0de0-0030-4b2c-9d3e-0000000000a1') returning id)
insert into _ids select 'reg', id from x;
insert into _t select 'register created, name trimmed',
  (select name = 'Front desk' and tenant_id = '170d2d86-5c22-4bcb-9d74-420c879419b2' and created_by is not null
   from public.pos_registers where id = (select id from _ids where k = 'reg')), null;
do $$ begin
  insert into public.pos_registers (name) values ('front DESK');
  insert into _t values ('duplicate register name refused', false, null);
exception when others then insert into _t values ('duplicate register name refused', sqlstate = '23505', sqlerrm); end $$;
do $$ begin
  insert into public.pos_sessions (register_id) values ((select id from _ids where k = 'reg'));
  insert into _t values ('client cannot insert sessions', false, null);
exception when others then insert into _t values ('client cannot insert sessions', sqlstate = '42501', sqlerrm); end $$;
do $$ begin
  perform public.pos_checkout(gen_random_uuid(), '[{"product_id":"b05c0de0-0030-4b2c-9d3e-000000000002","quantity":1}]', '{"cash":4}');
  insert into _t values ('checkout needs an open session', false, null);
exception when others then insert into _t values ('checkout needs an open session', sqlerrm = 'POS_SESSION_CLOSED', sqlerrm); end $$;

-- Session
with x as (select public.pos_open_session((select id from _ids where k = 'reg'), 50, null) as id)
insert into _ids select 'sess', id from x;
insert into _t select 'session opened, numbered POSS',
  (select status = 'open' and doc_number like 'POSS-%' and opening_cash = 50 and opened_by = '129bbbae-fdfc-4d21-8a86-8949fec2403b'
   from public.pos_sessions where id = (select id from _ids where k = 'sess')), null;
do $$ begin
  perform public.pos_open_session((select id from _ids where k = 'reg'), 0, null);
  insert into _t values ('one open session per register', false, null);
exception when others then insert into _t values ('one open session per register', sqlerrm = 'POS_SESSION_OPEN', sqlerrm); end $$;
do $$ begin
  update public.pos_registers set active = false where id = (select id from _ids where k = 'reg');
  insert into _t values ('register with open session cannot deactivate', false, null);
exception when others then insert into _t values ('register with open session cannot deactivate', sqlerrm = 'POS_SESSION_OPEN', sqlerrm); end $$;

-- Checkout validation
do $$ begin
  perform public.pos_checkout((select id from _ids where k = 'sess'), '[]', '{"cash":4}');
  insert into _t values ('empty cart refused', false, null);
exception when others then insert into _t values ('empty cart refused', sqlerrm = 'POS_EMPTY_CART', sqlerrm); end $$;
do $$ begin
  perform public.pos_checkout((select id from _ids where k = 'sess'), '[{"product_id":"b05c0de0-0030-4b2c-9d3e-000000000003","quantity":1}]', '{"cash":4}');
  insert into _t values ('inactive product refused', false, null);
exception when others then insert into _t values ('inactive product refused', sqlerrm = 'POS_PRODUCT_INVALID', sqlerrm); end $$;
do $$ begin
  perform public.pos_checkout((select id from _ids where k = 'sess'), '[{"product_id":"b05c0de0-0030-4b2c-9d3e-00000000000b","quantity":1}]', '{"cash":4}');
  insert into _t values ('foreign product refused', false, null);
exception when others then insert into _t values ('foreign product refused', sqlerrm = 'POS_PRODUCT_INVALID', sqlerrm); end $$;
do $$ begin
  perform public.pos_checkout((select id from _ids where k = 'sess'), '[{"product_id":"b05c0de0-0030-4b2c-9d3e-000000000002","quantity":0}]', '{"cash":4}');
  insert into _t values ('zero quantity refused', false, null);
exception when others then insert into _t values ('zero quantity refused', sqlerrm = 'POS_LINE_INVALID', sqlerrm); end $$;
do $$ begin
  perform public.pos_checkout((select id from _ids where k = 'sess'), '[{"product_id":"b05c0de0-0030-4b2c-9d3e-000000000002","quantity":"abc"}]', '{"cash":4}');
  insert into _t values ('garbage quantity refused', false, null);
exception when others then insert into _t values ('garbage quantity refused', sqlerrm = 'POS_LINE_INVALID', sqlerrm); end $$;
do $$ begin
  perform public.pos_checkout((select id from _ids where k = 'sess'), '[{"product_id":"b05c0de0-0030-4b2c-9d3e-000000000002","quantity":2}]', '{"cash":7.99}');
  insert into _t values ('underpaid refused', false, null);
exception when others then insert into _t values ('underpaid refused', sqlerrm = 'POS_UNDERPAID', sqlerrm); end $$;
do $$ begin
  perform public.pos_checkout((select id from _ids where k = 'sess'), '[{"product_id":"b05c0de0-0030-4b2c-9d3e-000000000002","quantity":1}]', '{"card":10}');
  insert into _t values ('change from card refused', false, null);
exception when others then insert into _t values ('change from card refused', sqlerrm = 'POS_CHANGE_FROM_CARD', sqlerrm); end $$;
do $$ begin
  perform public.pos_checkout((select id from _ids where k = 'sess'), '[{"product_id":"b05c0de0-0030-4b2c-9d3e-000000000001","quantity":11}]', '{"cash":500}');
  insert into _t values ('more than stock refused', false, null);
exception when others then insert into _t values ('more than stock refused', sqlerrm like 'INSUFFICIENT_STOCK%', sqlerrm); end $$;
insert into _t select 'failed checkouts leave no orders', (select count(*) = 0 from public.pos_orders), null;

-- Sale: 2 x oil at 12.50 with 10% off (+5% tax) and a wash priced at 999; paid 1000 cash + 30 card
create temp table _sale as select public.pos_checkout((select id from _ids where k = 'sess'),
  '[{"product_id":"b05c0de0-0030-4b2c-9d3e-000000000001","quantity":2,"discount_percent":10},
    {"product_id":"b05c0de0-0030-4b2c-9d3e-000000000002","quantity":1,"unit_price":999}]'::jsonb,
  '{"cash":1000,"card":30}'::jsonb, 'b05c0de0-0030-4b2c-9d3e-0000000000d1', 'Counter sale') as r;
insert into _ids select 'sale', (r->>'order_id')::uuid from _sale;
insert into _t select 'checkout totals computed server-side',
  (select subtotal = 1024 and discount_total = 2.5 and tax_total = 1.13 and total = 1022.63 from public.pos_orders
   where id = (select id from _ids where k = 'sale')),
  (select row_to_json(o)::text from public.pos_orders o where id = (select id from _ids where k = 'sale'));
insert into _t select 'payments and change recorded',
  (select paid_cash = 1000 and paid_card = 30 and change_due = 7.37 and status = 'completed' and doc_number like 'POS-%'
          and currency is not null from public.pos_orders where id = (select id from _ids where k = 'sale')), (select r::text from _sale);
insert into _t select 'lines priced from the catalog with override',
  (select count(*) = 2 and bool_and(case when sort_order = 1 then unit_price = 12.5 and line_net = 22.5 and line_tax = 1.13
                                         and inventory_item_id = 'b05c0de0-0030-4b2c-9d3e-0000000000c1' and description = 'Engine oil 5L'
                                    else unit_price = 999 and line_tax = 0 and inventory_item_id is null end)
   from public.pos_order_lines where order_id = (select id from _ids where k = 'sale')), null;
insert into _t select 'sale moved stock out',
  (select on_hand = 8 from public.stock_levels where item_id = 'b05c0de0-0030-4b2c-9d3e-0000000000c1')
  and (select count(*) = 1 from public.stock_moves where reference_type = 'pos_order' and move_type = 'sale' and quantity = -2), null;
create temp table _sale2 as select public.pos_checkout((select id from _ids where k = 'sess'),
  '[{"product_id":"b05c0de0-0030-4b2c-9d3e-000000000002","quantity":3}]'::jsonb, '{"cash":20}'::jsonb) as r;
insert into _ids select 'sale2', (r->>'order_id')::uuid from _sale2;
insert into _t select 'walk-in sale with change', (select (r->>'change_due')::numeric = 8 from _sale2), (select r::text from _sale2);

-- Refund
create temp table _ref as select public.pos_refund((select id from _ids where k = 'sale'), 'Wrong oil') as r;
insert into _ids select 'refund', (r->>'order_id')::uuid from _ref;
insert into _t select 'refund mirrors the order',
  (select o.total = -1022.63 and o.refund_of = (select id from _ids where k = 'sale') and o.paid_cash = -992.63 and o.paid_card = -30
          and o.change_due = 0 and o.notes = 'Wrong oil'
   from public.pos_orders o where o.id = (select id from _ids where k = 'refund')),
  (select row_to_json(o)::text from public.pos_orders o where o.id = (select id from _ids where k = 'refund'));
insert into _t select 'original marked refunded',
  (select status = 'refunded' from public.pos_orders where id = (select id from _ids where k = 'sale')), null;
insert into _t select 'refund returned stock',
  (select on_hand = 10 from public.stock_levels where item_id = 'b05c0de0-0030-4b2c-9d3e-0000000000c1'), null;
do $$ begin
  perform public.pos_refund((select id from _ids where k = 'sale'));
  insert into _t values ('order cannot be refunded twice', false, null);
exception when others then insert into _t values ('order cannot be refunded twice', sqlerrm = 'POS_NOT_REFUNDABLE', sqlerrm); end $$;
do $$ begin
  perform public.pos_refund((select id from _ids where k = 'refund'));
  insert into _t values ('a refund cannot be refunded', false, null);
exception when others then insert into _t values ('a refund cannot be refunded', sqlerrm = 'POS_NOT_REFUNDABLE', sqlerrm); end $$;

-- Summary and close
create temp table _sum as select public.pos_session_summary((select id from _ids where k = 'sess')) as s;
insert into _t select 'Z-report summary',
  (select (s->>'sales_count')::int = 2 and (s->>'refund_count')::int = 1 and (s->>'net_sales')::numeric = 12
          and (s->>'cash')::numeric = 12 and (s->>'card')::numeric = 0 and (s->>'expected_cash')::numeric = 62 from _sum),
  (select s::text from _sum);
insert into _t select 'daily sales', (select orders = 2 and total = 12 from public.pos_daily_sales(current_date - 1, current_date + 1)),
  (select string_agg(row_to_json(d)::text, ',') from public.pos_daily_sales(current_date - 1, current_date + 1) d);
select public.pos_close_session((select id from _ids where k = 'sess'), 60, 'Short by 2');
insert into _t select 'close records expected and difference',
  (select status = 'closed' and expected_cash = 62 and closing_cash_counted = 60 and cash_difference = -2 and closed_at is not null
   from public.pos_sessions where id = (select id from _ids where k = 'sess')), null;
do $$ begin
  perform public.pos_close_session((select id from _ids where k = 'sess'), 60);
  insert into _t values ('closed session cannot close again', false, null);
exception when others then insert into _t values ('closed session cannot close again', sqlerrm = 'POS_SESSION_CLOSED', sqlerrm); end $$;
do $$ begin
  perform public.pos_checkout((select id from _ids where k = 'sess'), '[{"product_id":"b05c0de0-0030-4b2c-9d3e-000000000002","quantity":1}]', '{"cash":4}');
  insert into _t values ('closed session refuses sales', false, null);
exception when others then insert into _t values ('closed session refuses sales', sqlerrm = 'POS_SESSION_CLOSED', sqlerrm); end $$;
do $$ begin
  perform public.pos_refund((select id from _ids where k = 'sale2'));
  insert into _t values ('refund needs an open session', false, null);
exception when others then insert into _t values ('refund needs an open session', sqlerrm = 'POS_NO_OPEN_SESSION', sqlerrm); end $$;
do $$ begin
  delete from public.pos_registers where id = (select id from _ids where k = 'reg');
  insert into _t values ('register with history cannot be deleted', false, null);
exception when others then insert into _t values ('register with history cannot be deleted', sqlstate = '23503', sqlerrm); end $$;
update public.pos_registers set active = false where id = (select id from _ids where k = 'reg');
do $$ begin
  perform public.pos_open_session((select id from _ids where k = 'reg'), 0);
  insert into _t values ('inactive register cannot open', false, null);
exception when others then insert into _t values ('inactive register cannot open', sqlerrm = 'POS_REGISTER_INACTIVE', sqlerrm); end $$;
reset role;

-- Viewer
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"5eed0000-0000-4000-8000-00000000a003","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"viewer"}}', true);
insert into _t select 'viewer reads orders', (select count(*) = 3 from public.pos_orders), null;
do $$ begin
  perform public.pos_open_session((select id from public.pos_registers limit 1), 0);
  insert into _t values ('viewer cannot open sessions', false, null);
exception when others then insert into _t values ('viewer cannot open sessions', sqlerrm = 'FORBIDDEN', sqlerrm); end $$;
reset role;

-- Other tenant
insert into public.tenant_modules (tenant_id, module_id, enabled)
values ('5eed0000-0000-4000-8000-0000000000b1', 'pos', true)
on conflict (tenant_id, module_id) do update set enabled = true;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"5eed0000-0000-4000-8000-00000000b001","role":"authenticated","app_metadata":{"tenant_id":"5eed0000-0000-4000-8000-0000000000b1","role":"owner"}}', true);
insert into _t select 'other tenant sees no orders or registers',
  (select count(*) = 0 from public.pos_orders) and (select count(*) = 0 from public.pos_registers), null;
do $$ begin
  perform public.pos_refund((select id from _ids where k = 'sale2'));
  insert into _t values ('other tenant cannot refund ours', false, null);
exception when others then insert into _t values ('other tenant cannot refund ours', sqlerrm = 'POS_NOT_REFUNDABLE', sqlerrm); end $$;
do $$ begin
  insert into public.pos_registers (name, warehouse_id) values ('Theirs', 'b05c0de0-0030-4b2c-9d3e-0000000000a1');
  insert into _t values ('foreign warehouse refused', false, null);
exception when others then insert into _t values ('foreign warehouse refused', sqlerrm like 'CROSS_TENANT_REFERENCE%', sqlerrm); end $$;
reset role;

select name, ok, detail from _t order by ok, name;
rollback;
