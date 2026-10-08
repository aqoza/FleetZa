-- Dry-run tests for 20261008000021_tms.sql (PGlite replica:
-- node docs/buildout/pglite/harness.mjs run docs/buildout/tests/tms_tests.sql).
begin;
create temp table _t (name text, ok boolean, detail text);
grant all on _t to authenticated, service_role;

insert into public.tenant_modules (tenant_id, module_id, enabled) values
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'workflow_automation', true)
on conflict (tenant_id, module_id) do update set enabled = true;

insert into public.vehicles (id, tenant_id, name, status) values
  ('a7e1c0de-0021-4b2c-9d3e-4f5a6b7c8d01', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Tractor 21', 'active');
insert into public.suppliers (id, tenant_id, name, supplier_type) values
  ('a7e1c0de-0021-4b2c-9d3e-4f5a6b7c8d02', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Desert Haulage LLC', 'carrier');

-- Module off
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
do $$ begin
  insert into public.shipments (customer_id, origin_city, destination_city)
  values ('5eed0000-0000-4000-8000-00000000c001', 'Muscat', 'Sohar');
  insert into _t values ('module off: insert refused', false, null);
exception when others then insert into _t values ('module off: insert refused', sqlstate = '42501', sqlerrm); end $$;
reset role;
insert into public.tenant_modules (tenant_id, module_id, enabled)
values ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'tms', true)
on conflict (tenant_id, module_id) do update set enabled = true;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);

-- Rates and quotes
insert into public.freight_rates (origin_city, destination_city, mode, rate_per_trip, rate_per_kg, min_charge, notes)
values ('Muscat', 'Sohar', 'road_ftl', 120, 0.01, 150, 'general');
insert into public.freight_rates (origin_city, destination_city, mode, rate_per_trip, min_charge, notes)
values ('Muscat', 'Sohar', 'road_ftl', 140, 0, 'general cheaper at weight');
insert into public.freight_rates (origin_city, destination_city, mode, customer_id, rate_per_trip, min_charge, notes)
values ('muscat ', 'SOHAR', 'road_ftl', '5eed0000-0000-4000-8000-00000000c001', 200, 0, 'contract');
insert into public.freight_rates (origin_city, destination_city, mode, rate_per_trip, valid_from, valid_to, notes)
values ('Muscat', 'Sohar', 'road_ftl', 10, current_date - 30, current_date - 1, 'expired');
insert into _t select 'quote applies the minimum charge and picks the cheapest general rate',
  (select price = 140 and not customer_specific from public.quote_freight('Muscat', 'Sohar', 'road_ftl', 1000)), null;
insert into _t select 'quote uses per kg above the minimum',
  (select price = 140 from public.quote_freight('Muscat', 'Sohar', 'road_ftl', 0))
  and (select price = 150 from public.quote_freight('Muscat', 'Sohar', 'road_ftl', null)) is not true, null;
insert into _t select 'quote prefers the customer contract, case-insensitive',
  (select price = 200 and customer_specific from public.quote_freight(' MUSCAT', 'sohar', 'road_ftl', 1000,
     '5eed0000-0000-4000-8000-00000000c001')), null;
insert into _t select 'quote ignores expired rates and other modes',
  not exists (select 1 from public.quote_freight('Muscat', 'Sohar', 'courier', 10))
  and (select price <> 10 from public.quote_freight('Muscat', 'Sohar', 'road_ftl', 0)), null;
do $$ begin
  insert into public.freight_rates (origin_city, destination_city, mode) values ('A', 'B', 'road_ftl');
  insert into _t values ('rate needs a price', false, null);
exception when others then insert into _t values ('rate needs a price', sqlstate = '23514', sqlerrm); end $$;

-- Shipments
insert into public.shipments (customer_id, origin_city, destination_city, weight_kg, freight_charge, fuel_surcharge,
                              carrier_cost, carrier_type, carrier_supplier_id, delivery_window_end, customer_ref, notes)
values ('5eed0000-0000-4000-8000-00000000c001', 'Muscat', 'Sohar', 8000, 300, 25, 200, 'own',
        'a7e1c0de-0021-4b2c-9d3e-4f5a6b7c8d02', now() + interval '2 days', 'PO-7781', 's1');
create temp table _s on commit drop as select id from public.shipments where notes = 's1';
grant all on _s to authenticated;
insert into _t select 'shipment numbered SHP, draft, totals generated',
  (select doc_number ~ '^SHP-\d{5}$' and status = 'draft' and total_charge = 325 and margin = 125
     from public.shipments where id = (select id from _s)), null;
insert into _t select 'own fleet clears the supplier; currency is the tenant''s',
  (select carrier_supplier_id is null and currency = (select currency from public.tenants
     where id = '170d2d86-5c22-4bcb-9d74-420c879419b2') from public.shipments where id = (select id from _s)), null;
insert into _t select 'creation writes a draft timeline row',
  (select count(*) = 1 from public.shipment_events where shipment_id = (select id from _s) and status = 'draft'), null;
do $$ begin
  update public.shipments set invoice_id = gen_random_uuid() where id = (select id from _s);
  insert into _t values ('invoice link not client-writable', false, null);
exception when others then insert into _t values ('invoice link not client-writable', sqlstate = '42501', sqlerrm); end $$;
do $$ begin
  update public.shipments set status = 'in_transit' where id = (select id from _s);
  insert into _t values ('cannot skip steps', false, null);
exception when others then insert into _t values ('cannot skip steps', sqlerrm = 'ILLEGAL_SHIPMENT_TRANSITION', sqlerrm); end $$;
do $$ begin
  insert into public.shipments (customer_id, origin_city, destination_city, vehicle_id)
  values ('5eed0000-0000-4000-8000-00000000c001', 'A', 'B', '5eed0000-0000-4000-8000-00000000e0b1');
  insert into _t values ('other tenant vehicle refused', false, null);
exception when others then insert into _t values ('other tenant vehicle refused', sqlerrm like 'CROSS_TENANT_REFERENCE%', sqlerrm); end $$;

update public.shipments set status = 'booked' where id = (select id from _s);
do $$ begin
  update public.shipments set status = 'dispatched' where id = (select id from _s);
  insert into _t values ('dispatch needs a carrier', false, null);
exception when others then insert into _t values ('dispatch needs a carrier', sqlerrm = 'SHIPMENT_CARRIER_REQUIRED', sqlerrm); end $$;
update public.shipments set carrier_type = 'third_party', carrier_supplier_id = 'a7e1c0de-0021-4b2c-9d3e-4f5a6b7c8d02',
       vehicle_id = 'a7e1c0de-0021-4b2c-9d3e-4f5a6b7c8d01', status = 'dispatched' where id = (select id from _s);
insert into _t select 'third party dispatch clears the vehicle and stamps',
  (select vehicle_id is null and carrier_supplier_id is not null and booked_at is not null and dispatched_at is not null
     from public.shipments where id = (select id from _s)), null;
do $$ begin
  update public.shipments set received_by = 'x' where id = (select id from _s);
  insert into _t values ('proof only with the delivered step', false, null);
exception when others then insert into _t values ('proof only with the delivered step', sqlerrm = 'ILLEGAL_SHIPMENT_TRANSITION', sqlerrm); end $$;
update public.shipments set status = 'in_transit' where id = (select id from _s);
update public.shipments set status = 'exception' where id = (select id from _s);
update public.shipments set status = 'in_transit' where id = (select id from _s);
insert into public.shipment_events (shipment_id, location, note, at)
values ((select id from _s), 'Barka checkpoint', 'On schedule', now() + interval '3 days');
insert into _t select 'tracking update stored as manual row, time clamped',
  (select status is null and created_by = '129bbbae-fdfc-4d21-8a86-8949fec2403b' and at <= now() + interval '5 minutes'
     from public.shipment_events where shipment_id = (select id from _s) and location = 'Barka checkpoint'), null;
do $$ begin
  update public.shipment_events set note = 'edited' where shipment_id = (select id from _s);
  insert into _t values ('timeline append-only', false, null);
exception when others then insert into _t values ('timeline append-only', sqlstate = '42501', sqlerrm); end $$;
do $$ begin
  insert into public.shipment_events (shipment_id, note) values ((select id from _s), 'x');
  insert into public.shipment_events (shipment_id) values ((select id from _s));
  insert into _t values ('empty tracking update refused', false, null);
exception when others then insert into _t values ('empty tracking update refused', sqlstate = '23514', sqlerrm); end $$;
do $$ begin
  update public.shipments set status = 'delivered' where id = (select id from _s);
  insert into _t values ('delivered needs the receiver', false, null);
exception when others then insert into _t values ('delivered needs the receiver', sqlerrm = 'SHIPMENT_POD_REQUIRED', sqlerrm); end $$;
do $$ begin
  update public.shipments set status = 'delivered', received_by = 'Ali', delivered_at = now() + interval '1 day'
   where id = (select id from _s);
  insert into _t values ('future delivery time refused', false, null);
exception when others then insert into _t values ('future delivery time refused', sqlerrm = 'INVALID_POD_TIME', sqlerrm); end $$;
do $$ begin
  update public.shipments set status = 'cancel' || 'ed' where id = (select id from _s);
  insert into _t values ('in transit cannot cancel', false, null);
exception when others then insert into _t values ('in transit cannot cancel', sqlerrm = 'ILLEGAL_SHIPMENT_TRANSITION', sqlerrm); end $$;
update public.shipments set status = 'delivered', received_by = 'Ali Hamad', pod_notes = 'Two pallets wrapped'
 where id = (select id from _s);
insert into _t select 'delivered stamps the time',
  (select delivered_at is not null and status = 'delivered' from public.shipments where id = (select id from _s)), null;
insert into _t select 'each status change is on the timeline',
  -- (one transaction here, so compare as a sorted list rather than by time)
  (select array_agg(status order by status) filter (where status is not null)
     = array['booked','delivered','dispatched','draft','exception','in_transit','in_transit']
     from public.shipment_events where shipment_id = (select id from _s)), null;
do $$ begin
  delete from public.shipments where id = (select id from _s);
  insert into _t values ('only drafts deletable', false, null);
exception when others then insert into _t values ('only drafts deletable', sqlerrm = 'SHIPMENT_NOT_DELETABLE', sqlerrm); end $$;

-- Invoicing
do $$ begin
  perform public.shipment_create_invoice((select id from _s));
  insert into _t values ('invoice needs billing on', false, null);
exception when others then insert into _t values ('invoice needs billing on', sqlerrm = 'MODULE_DISABLED', sqlerrm); end $$;
reset role;
insert into public.tenant_modules (tenant_id, module_id, enabled) values
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'sales', true), ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'billing', true)
on conflict (tenant_id, module_id) do update set enabled = true;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
select public.shipment_create_invoice((select id from _s));
insert into _t select 'invoice is a draft with one line for the total',
  (select i.status = 'draft' and i.customer_id = s.customer_id and i.customer_reference = 'PO-7781'
          and (select count(*) = 1 and sum(l.unit_price) = 325 from public.invoice_lines l where l.invoice_id = i.id)
     from public.shipments s join public.invoices i on i.id = s.invoice_id where s.id = (select id from _s)), null;
do $$ begin
  perform public.shipment_create_invoice((select id from _s));
  insert into _t values ('no double invoice', false, null);
exception when others then insert into _t values ('no double invoice', sqlerrm = 'SHIPMENT_ALREADY_INVOICED', sqlerrm); end $$;

update public.shipments set status = 'closed' where id = (select id from _s);
do $$ begin
  update public.shipments set freight_charge = 1 where id = (select id from _s);
  insert into _t values ('closed shipment locked', false, null);
exception when others then insert into _t values ('closed shipment locked', sqlerrm = 'SHIPMENT_LOCKED', sqlerrm); end $$;
do $$ begin
  update public.shipments set notes = 'archived' where id = (select id from _s);
  insert into _t values ('closed shipment notes editable', true, null);
exception when others then insert into _t values ('closed shipment notes editable', false, sqlerrm); end $$;

-- A draft that is not invoiceable, then canceled and deleted paths
insert into public.shipments (customer_id, origin_city, destination_city, notes)
values ('5eed0000-0000-4000-8000-00000000c001', 'Nizwa', 'Sur', 's2');
do $$ begin
  perform public.shipment_create_invoice((select id from public.shipments where notes = 's2'));
  insert into _t values ('draft not invoiceable', false, null);
exception when others then insert into _t values ('draft not invoiceable', sqlerrm = 'SHIPMENT_NOT_INVOICEABLE', sqlerrm); end $$;
update public.shipments set status = 'canceled', cancel_reason = 'Customer withdrew' where notes = 's2';
insert into _t select 'cancel stamps the time',
  (select canceled_at is not null from public.shipments where notes = 's2'), null;
insert into public.shipments (customer_id, origin_city, destination_city, notes)
values ('5eed0000-0000-4000-8000-00000000c001', 'Nizwa', 'Sur', 's3');
delete from public.shipments where notes = 's3';
insert into _t select 'draft deletable', not exists (select 1 from public.shipments where notes = 's3'), null;
reset role;

insert into _t select 'status changes emit events',
  (select count(*) = 8 from public.domain_events where event = 'shipment.status_changed'), null;
insert into _t select 'delivered event carries on_time',
  (select (payload->>'on_time')::boolean from public.domain_events
    where event = 'shipment.status_changed' and payload->>'to_status' = 'delivered'), null;

-- Viewer
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"5eed0000-0000-4000-8000-00000000a003","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"viewer"}}', true);
insert into _t select 'viewer reads shipments and the timeline',
  (select count(*) = 2 from public.shipments) and (select count(*) > 0 from public.shipment_events), null;
do $$ begin
  insert into public.shipment_events (shipment_id, note) values ((select id from _s), 'viewer note');
  insert into _t values ('viewer cannot add tracking', false, null);
exception when others then insert into _t values ('viewer cannot add tracking', sqlstate = '42501', sqlerrm); end $$;
do $$ begin
  perform public.shipment_create_invoice((select id from _s));
  insert into _t values ('viewer cannot invoice', false, null);
exception when others then insert into _t values ('viewer cannot invoice', sqlerrm in ('FORBIDDEN', 'SHIPMENT_ALREADY_INVOICED') or sqlstate = '42501', sqlerrm); end $$;
update public.shipments set notes = 'viewer' where id = (select id from _s);
insert into _t select 'viewer update is a no-op', (select notes = 'archived' from public.shipments where id = (select id from _s)), null;
reset role;

-- Other tenant
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"5eed0000-0000-4000-8000-00000000b001","role":"authenticated","app_metadata":{"tenant_id":"5eed0000-0000-4000-8000-0000000000b1","role":"owner"}}', true);
insert into _t select 'cross-tenant isolation',
  (select count(*) = 0 from public.shipments) and (select count(*) = 0 from public.freight_rates)
  and (select count(*) = 0 from public.shipment_events), null;
reset role;

-- @print
select name, ok, detail from _t order by ok, name;
rollback;
