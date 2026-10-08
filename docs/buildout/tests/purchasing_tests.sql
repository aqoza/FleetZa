-- Dry-run tests for 20261008000011_purchasing.sql (PGlite replica:
-- node docs/buildout/pglite/harness.mjs run docs/buildout/tests/purchasing_tests.sql).
begin;
create temp table _t (name text, ok boolean, detail text);
grant all on _t to authenticated;

update public.tenants set currency = 'OMR', currency_decimals = 3
 where id = '170d2d86-5c22-4bcb-9d74-420c879419b2';
insert into public.tenant_modules (tenant_id, module_id, enabled) values
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'suppliers', true),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'inventory', true),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'notifications', true),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'workflow_automation', true),
  ('5eed0000-0000-4000-8000-0000000000b1', 'suppliers', true),
  ('5eed0000-0000-4000-8000-0000000000b1', 'purchasing', true)
on conflict (tenant_id, module_id) do update set enabled = true;
insert into public.suppliers (id, tenant_id, name, payment_terms_days) values
  ('5a000000-0000-4000-8000-000000000001', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Gulf Parts LLC', 45),
  ('5a000000-0000-4000-8000-000000000002', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Other Supplier', 30),
  ('5a000000-0000-4000-8000-0000000000b1', '5eed0000-0000-4000-8000-0000000000b1', 'Foreign', 30);

-- Module off
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
do $$ begin
  insert into public.purchase_orders (supplier_id) values ('5a000000-0000-4000-8000-000000000001');
  insert into _t values ('module off: PO refused', false, null);
exception when others then insert into _t values ('module off: PO refused', sqlstate = '42501', sqlerrm); end $$;
reset role;
insert into public.tenant_modules (tenant_id, module_id, enabled)
values ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'purchasing', true)
on conflict (tenant_id, module_id) do update set enabled = true;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
insert into public.warehouses (id, name, code, is_default) values
  ('aa000000-0000-4000-8000-000000000001', 'Main', 'MAIN', true);
insert into public.inventory_items (id, sku, name, cost_price) values
  ('bb000000-0000-4000-8000-000000000001', 'OIL', 'Oil filter', 0),
  ('bb000000-0000-4000-8000-000000000002', 'PAD', 'Brake pads', 0);

create temp table _po as
  with ins as (insert into public.purchase_orders (supplier_id, warehouse_id, expected_date)
               values ('5a000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000001', current_date - 2)
               returning *)
  select * from ins;
grant select on _po to authenticated;
insert into _t select 'PO numbered + currency snapshot', (select doc_number = 'PO-00001' and currency = 'OMR'
  and currency_decimals = 3 and status = 'draft' from _po), (select doc_number from _po);
do $$ begin
  insert into public.purchase_orders (supplier_id, status) values ('5a000000-0000-4000-8000-000000000001', 'received');
  insert into _t values ('client cannot insert status', false, null);
exception when others then insert into _t values ('client cannot insert status', sqlstate = '42501', sqlerrm); end $$;
do $$ begin
  insert into public.purchase_orders (supplier_id) values ('5a000000-0000-4000-8000-0000000000b1');
  insert into _t values ('foreign supplier refused', false, null);
exception when others then insert into _t values ('foreign supplier refused', sqlerrm like 'CROSS_TENANT_REFERENCE%', sqlerrm); end $$;
do $$ begin
  update public.purchase_orders set status = 'sent' where id = (select id from _po);
  insert into _t values ('empty PO cannot be sent', false, null);
exception when others then insert into _t values ('empty PO cannot be sent', sqlerrm = 'EMPTY_DOCUMENT', sqlerrm); end $$;

insert into public.purchase_order_lines (purchase_order_id, sort_order, item_id, description, quantity, unit_price, discount_percent, tax_rate)
values ((select id from _po), 0, 'bb000000-0000-4000-8000-000000000001', 'Oil filter', 10, 2.5, 10, 5),
       ((select id from _po), 1, 'bb000000-0000-4000-8000-000000000002', 'Brake pads', 4, 12.345, 0, 5),
       ((select id from _po), 2, null, 'Delivery charge', 1, 3, 0, 0);
-- 10*2.5=25 - 2.5 = 22.5 tax 1.125; 4*12.345=49.38 tax 2.469; 3 → subtotal 74.88, tax 3.594, total 78.474
insert into _t select 'PO totals rolled up', (select subtotal = 74.88 and discount_total = 2.5 and tax_total = 3.594
  and total = 78.474 from public.purchase_orders where id = (select id from _po)),
  (select format('%s/%s/%s', subtotal, tax_total, total) from public.purchase_orders where id = (select id from _po));
do $$ begin
  update public.purchase_order_lines set received_qty = 5 where purchase_order_id = (select id from _po);
  insert into _t values ('client cannot set received qty', false, null);
exception when others then insert into _t values ('client cannot set received qty', sqlstate = '42501', sqlerrm); end $$;
do $$ begin
  perform public.purchase_receive((select id from _po), '[]');
  insert into _t values ('draft not receivable', false, null);
exception when others then insert into _t values ('draft not receivable', sqlerrm = 'PO_NOT_RECEIVABLE', sqlerrm); end $$;

update public.purchase_orders set status = 'sent' where id = (select id from _po);
insert into _t select 'sent stamps sent_at', (select status = 'sent' and sent_at is not null from public.purchase_orders where id = (select id from _po)), null;
do $$ begin
  update public.purchase_order_lines set quantity = 20 where purchase_order_id = (select id from _po) and sort_order = 0;
  insert into _t values ('lines locked once sent', false, null);
exception when others then insert into _t values ('lines locked once sent', sqlerrm = 'DOC_NOT_EDITABLE', sqlerrm); end $$;
do $$ begin
  update public.purchase_orders set supplier_id = '5a000000-0000-4000-8000-000000000002' where id = (select id from _po);
  insert into _t values ('supplier locked once sent', false, null);
exception when others then insert into _t values ('supplier locked once sent', sqlerrm = 'DOC_LOCKED', sqlerrm); end $$;
do $$ begin
  update public.purchase_orders set status = 'received' where id = (select id from _po);
  insert into _t values ('client cannot mark received', false, null);
exception when others then insert into _t values ('client cannot mark received', sqlerrm like 'ILLEGAL_PO_TRANSITION%', sqlerrm); end $$;
update public.purchase_orders set status = 'confirmed', expected_date = current_date + 5 where id = (select id from _po);
update public.purchase_orders set expected_date = current_date - 2 where id = (select id from _po);

create temp table _lines as select id, sort_order from public.purchase_order_lines where purchase_order_id = (select id from _po);
grant select on _lines to authenticated;
do $$ begin
  perform public.purchase_receive((select id from _po),
    jsonb_build_array(jsonb_build_object('line_id', (select id from _lines where sort_order = 0), 'quantity', 11)));
  insert into _t values ('over-receipt refused', false, null);
exception when others then insert into _t values ('over-receipt refused', sqlerrm = 'RECEIPT_EXCEEDS_ORDERED', sqlerrm); end $$;
do $$ begin
  perform public.purchase_receive((select id from _po), '[{"line_id":"00000000-0000-4000-8000-000000000000","quantity":1}]');
  insert into _t values ('foreign line refused', false, null);
exception when others then insert into _t values ('foreign line refused', sqlerrm = 'RECEIPT_EXCEEDS_ORDERED', sqlerrm); end $$;
create temp table _g1 as select * from public.purchase_receive((select id from _po),
  jsonb_build_array(jsonb_build_object('line_id', (select id from _lines where sort_order = 0), 'quantity', 6),
                    jsonb_build_object('line_id', (select id from _lines where sort_order = 2), 'quantity', 1)),
  null, 'First drop');
insert into _t select 'receipt numbered GRN', (select doc_number = 'GRN-00001' and warehouse_id = 'aa000000-0000-4000-8000-000000000001' from _g1), (select doc_number from _g1);
insert into _t select 'PO partially received', (select status = 'partially_received' from public.purchase_orders where id = (select id from _po)), null;
insert into _t select 'received qty bumped', (select received_qty = 6 from public.purchase_order_lines where id = (select id from _lines where sort_order = 0)), null;
insert into _t select 'stock posted at net unit cost', (select on_hand = 6 from public.stock_levels where item_id = 'bb000000-0000-4000-8000-000000000001')
  and (select cost_price = 2.25 from public.inventory_items where id = 'bb000000-0000-4000-8000-000000000001')
  and (select count(*) = 1 from public.stock_moves where reference_type = 'purchase_receipt'), null;
insert into _t select 'untracked line has no move', (select stock_move_id is null from public.purchase_receipt_lines
  where purchase_order_line_id = (select id from _lines where sort_order = 2)), null;
do $$ begin
  insert into public.purchase_receipts (tenant_id, purchase_order_id, supplier_id)
  values ('170d2d86-5c22-4bcb-9d74-420c879419b2', (select id from _po), '5a000000-0000-4000-8000-000000000001');
  insert into _t values ('direct receipt write refused', false, null);
exception when others then insert into _t values ('direct receipt write refused', sqlstate = '42501', sqlerrm); end $$;

-- Bill from PO: received quantities only
create temp table _b1 as select * from public.vendor_bill_from_po((select id from _po));
grant select on _b1 to authenticated;
insert into _t select 'bill drafted from receipts', (select doc_number = 'BILL-00001' and status = 'draft'
  and due_date = bill_date + 45 and purchase_order_id = (select id from _po) from _b1),
  (select format('%s due %s', doc_number, due_date) from _b1);
insert into _t select 'bill bills received qty', (select count(*) = 2 and sum(quantity) = 7 from public.vendor_bill_lines where vendor_bill_id = (select id from _b1)), null;
-- 6*2.5=15 -1.5 = 13.5 tax .675 ; 3 → total 17.175
insert into _t select 'bill totals', (select total = 17.175 from public.vendor_bills where id = (select id from _b1)),
  (select total::text from public.vendor_bills where id = (select id from _b1));
do $$ begin
  perform public.vendor_bill_from_po((select id from _po));
  insert into _t values ('nothing left to bill', false, null);
exception when others then insert into _t values ('nothing left to bill', sqlerrm = 'NOTHING_TO_BILL', sqlerrm); end $$;
do $$ begin
  insert into public.vendor_payments (vendor_bill_id, amount) values ((select id from _b1), 1);
  insert into _t values ('draft bill not payable', false, null);
exception when others then insert into _t values ('draft bill not payable', sqlerrm = 'BILL_NOT_PAYABLE', sqlerrm); end $$;
update public.vendor_bills set status = 'open', supplier_invoice_number = 'GP-7781' where id = (select id from _b1);
insert into _t select 'bill opened', (select status = 'open' and opened_at is not null from public.vendor_bills where id = (select id from _b1)), null;
do $$ begin
  update public.vendor_bills set notes = 'ok', bill_date = bill_date - 1 where id = (select id from _b1);
  insert into _t values ('open bill locked', false, null);
exception when others then insert into _t values ('open bill locked', sqlerrm = 'DOC_LOCKED', sqlerrm); end $$;
do $$ begin
  update public.vendor_bills set status = 'paid' where id = (select id from _b1);
  insert into _t values ('client cannot mark paid', false, null);
exception when others then insert into _t values ('client cannot mark paid', sqlerrm like 'ILLEGAL_BILL_TRANSITION%', sqlerrm); end $$;
insert into public.vendor_payments (vendor_bill_id, amount, method) values ((select id from _b1), 10, 'cash');
insert into _t select 'partial payment', (select status = 'partially_paid' and amount_paid = 10 from public.vendor_bills where id = (select id from _b1)), null;
do $$ begin
  update public.vendor_bills set status = 'void' where id = (select id from _b1);
  insert into _t values ('paid bill cannot be voided', false, null);
exception when others then insert into _t values ('paid bill cannot be voided', sqlerrm = 'BILL_HAS_PAYMENTS', sqlerrm); end $$;
do $$ begin
  insert into public.vendor_payments (vendor_bill_id, amount) values ((select id from _b1), 7.2);
  insert into _t values ('overpayment refused', false, null);
exception when others then insert into _t values ('overpayment refused', sqlerrm = 'BILL_OVERPAYMENT', sqlerrm); end $$;
insert into public.vendor_payments (vendor_bill_id, amount) values ((select id from _b1), 7.175);
insert into _t select 'fully paid', (select status = 'paid' and amount_paid = 17.175 from public.vendor_bills where id = (select id from _b1)), null;
delete from public.vendor_payments where vendor_bill_id = (select id from _b1) and amount = 7.175;
insert into _t select 'deleting a payment reopens', (select status = 'partially_paid' from public.vendor_bills where id = (select id from _b1)), null;
insert into public.vendor_payments (vendor_bill_id, amount) values ((select id from _b1), 7.175);

-- Rest of the receipt
create temp table _g2 as select * from public.purchase_receive((select id from _po),
  jsonb_build_array(jsonb_build_object('line_id', (select id from _lines where sort_order = 0), 'quantity', 4),
                    jsonb_build_object('line_id', (select id from _lines where sort_order = 1), 'quantity', 4)));
insert into _t select 'PO fully received', (select status = 'received' and received_at is not null from public.purchase_orders where id = (select id from _po)), null;
do $$ begin
  update public.purchase_orders set notes = 'n', expected_date = current_date where id = (select id from _po);
  insert into _t values ('received PO locked', false, null);
exception when others then insert into _t values ('received PO locked', sqlerrm = 'DOC_LOCKED', sqlerrm); end $$;
create temp table _b2 as select * from public.vendor_bill_from_po((select id from _po));
insert into _t select 'second bill covers the rest', (select count(*) = 2 and sum(quantity) = 8 from public.vendor_bill_lines where vendor_bill_id = (select id from _b2)), null;
update public.purchase_orders set status = 'closed' where id = (select id from _po);
do $$ begin
  delete from public.purchase_orders where id = (select id from _po);
  insert into _t values ('closed PO not deletable', false, null);
exception when others then insert into _t values ('closed PO not deletable', sqlerrm = 'DOC_NOT_DELETABLE', sqlerrm); end $$;

-- Warehouse required when inventory is on and lines are tracked
create temp table _po2 as with ins as (insert into public.purchase_orders (supplier_id) values ('5a000000-0000-4000-8000-000000000002') returning *) select * from ins;
insert into public.purchase_order_lines (purchase_order_id, item_id, description, quantity, unit_price)
values ((select id from _po2), 'bb000000-0000-4000-8000-000000000002', 'Pads', 2, 10);
update public.purchase_orders set status = 'confirmed' where id = (select id from _po2);
do $$ begin
  perform public.purchase_receive((select id from _po2),
    jsonb_build_array(jsonb_build_object('line_id', (select id from public.purchase_order_lines where purchase_order_id = (select id from _po2)), 'quantity', 1)));
  insert into _t values ('warehouse required', false, null);
exception when others then insert into _t values ('warehouse required', sqlerrm = 'PO_WAREHOUSE_REQUIRED', sqlerrm); end $$;
update public.purchase_orders set status = 'canceled' where id = (select id from _po2);
delete from public.purchase_orders where id = (select id from _po2);
insert into _t select 'canceled PO deletable', not exists (select 1 from public.purchase_orders where id = (select id from _po2)), null;
reset role;

insert into _t select 'events emitted', (select count(*) from public.domain_events where event in ('purchase_order.sent', 'purchase_order.received', 'vendor_bill.paid')) = 3,
  (select string_agg(event, ',') from public.domain_events where event like 'purchase%' or event like 'vendor%');
insert into _t select 'PO + bill audited', exists (select 1 from public.audit_events where table_name = 'purchase_orders')
  and exists (select 1 from public.audit_events where table_name = 'vendor_bills'), null;

-- Scanner: overdue bill + late PO
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
create temp table _po3 as with ins as (insert into public.purchase_orders (supplier_id, expected_date) values ('5a000000-0000-4000-8000-000000000002', current_date - 1) returning *) select * from ins;
insert into public.purchase_order_lines (purchase_order_id, description, quantity, unit_price) values ((select id from _po3), 'Service', 1, 50);
update public.purchase_orders set status = 'sent' where id = (select id from _po3);
create temp table _b3 as with ins as (insert into public.vendor_bills (supplier_id, bill_date, due_date) values ('5a000000-0000-4000-8000-000000000002', current_date - 40, current_date - 10) returning *) select * from ins;
insert into public.vendor_bill_lines (vendor_bill_id, description, quantity, unit_price) values ((select id from _b3), 'Rent', 1, 100);
update public.vendor_bills set status = 'open' where id = (select id from _b3);
do $$ begin
  insert into public.vendor_bills (supplier_id, purchase_order_id) values ('5a000000-0000-4000-8000-000000000001', (select id from _po3));
  insert into _t values ('bill PO supplier mismatch refused', false, null);
exception when others then insert into _t values ('bill PO supplier mismatch refused', sqlerrm = 'BILL_PO_MISMATCH', sqlerrm); end $$;
reset role;
insert into _t select 'scanner notifies', app.scan_due_purchasing('170d2d86-5c22-4bcb-9d74-420c879419b2') >= 2, null;
insert into _t select 'overdue bill notified', exists (select 1 from public.notifications where kind = 'purchasing.bill_due' and entity_id = (select id from _b3)), null;
insert into _t select 'late PO notified', exists (select 1 from public.notifications where kind = 'purchasing.po_late' and entity_id = (select id from _po3)), null;
insert into _t select 'scanner idempotent', app.scan_due_purchasing('170d2d86-5c22-4bcb-9d74-420c879419b2') = 0, null;

-- Viewer reads, cannot write
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"5eed0000-0000-4000-8000-00000000a003","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"viewer"}}', true);
insert into _t select 'viewer reads POs', (select count(*) >= 2 from public.purchase_orders), null;
do $$ begin
  insert into public.purchase_orders (supplier_id) values ('5a000000-0000-4000-8000-000000000001');
  insert into _t values ('viewer cannot create PO', false, null);
exception when others then insert into _t values ('viewer cannot create PO', sqlstate = '42501', sqlerrm); end $$;
do $$ begin
  perform public.vendor_bill_from_po((select id from _po3));
  insert into _t values ('viewer cannot bill', false, null);
exception when others then insert into _t values ('viewer cannot bill', sqlerrm = 'FORBIDDEN', sqlerrm); end $$;
reset role;

-- Other tenant
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"5eed0000-0000-4000-8000-00000000b001","role":"authenticated","app_metadata":{"tenant_id":"5eed0000-0000-4000-8000-0000000000b1","role":"owner"}}', true);
insert into _t select 'cross-tenant isolation', (select count(*) = 0 from public.purchase_orders) and (select count(*) = 0 from public.vendor_bills)
  and (select count(*) = 0 from public.purchase_receipts), null;
do $$ begin
  perform public.purchase_receive((select id from _po3), '[]');
  insert into _t values ('cross-tenant receive refused', false, null);
exception when others then insert into _t values ('cross-tenant receive refused', sqlerrm = 'PO_NOT_FOUND', sqlerrm); end $$;
reset role;

-- @print
select name, ok, detail from _t order by ok, name;
rollback;
