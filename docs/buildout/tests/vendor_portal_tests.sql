-- Dry-run tests for 20261008000012_vendor_portal.sql (PGlite replica:
-- node docs/buildout/pglite/harness.mjs run docs/buildout/tests/vendor_portal_tests.sql).
begin;
create temp table _t (name text, ok boolean, detail text);
grant all on _t to authenticated, service_role, anon;

insert into public.tenant_modules (tenant_id, module_id, enabled) values
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'suppliers', true),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'purchasing', true),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'notifications', true),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'workflow_automation', true),
  ('5eed0000-0000-4000-8000-0000000000b1', 'suppliers', true),
  ('5eed0000-0000-4000-8000-0000000000b1', 'purchasing', true),
  ('5eed0000-0000-4000-8000-0000000000b1', 'vendor_portal', true)
on conflict (tenant_id, module_id) do update set enabled = true;
insert into public.suppliers (id, tenant_id, name) values
  ('5a000000-0000-4000-8000-000000000001', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Gulf Parts LLC'),
  ('5a000000-0000-4000-8000-000000000002', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Other Supplier'),
  ('5a000000-0000-4000-8000-0000000000b1', '5eed0000-0000-4000-8000-0000000000b1', 'Foreign');

-- Module off: managers cannot create links
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
do $$ begin
  insert into public.supplier_portal_access (supplier_id) values ('5a000000-0000-4000-8000-000000000001');
  insert into _t values ('module off: link refused', false, null);
exception when others then insert into _t values ('module off: link refused', sqlstate = '42501', sqlerrm); end $$;
reset role;
insert into public.tenant_modules (tenant_id, module_id, enabled)
values ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'vendor_portal', true)
on conflict (tenant_id, module_id) do update set enabled = true;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
create temp table _link as
  with ins as (insert into public.supplier_portal_access (supplier_id, label)
               values ('5a000000-0000-4000-8000-000000000001', 'Sales desk') returning *)
  select * from ins;
grant select on _link to authenticated, service_role, anon;
insert into _t select 'link created with token + tenant', (select token is not null and active and tenant_id = '170d2d86-5c22-4bcb-9d74-420c879419b2'
  and created_by = '129bbbae-fdfc-4d21-8a86-8949fec2403b' from _link), null;
do $$ begin
  insert into public.supplier_portal_access (supplier_id, token) values ('5a000000-0000-4000-8000-000000000001', gen_random_uuid());
  insert into _t values ('client cannot choose token', false, null);
exception when others then insert into _t values ('client cannot choose token', sqlstate = '42501', sqlerrm); end $$;
do $$ begin
  update public.supplier_portal_access set token = gen_random_uuid() where id = (select id from _link);
  insert into _t values ('client cannot change token', false, null);
exception when others then insert into _t values ('client cannot change token', sqlstate = '42501', sqlerrm); end $$;
do $$ begin
  insert into public.supplier_portal_access (supplier_id) values ('5a000000-0000-4000-8000-0000000000b1');
  insert into _t values ('foreign supplier refused', false, null);
exception when others then insert into _t values ('foreign supplier refused', sqlerrm like 'CROSS_TENANT_REFERENCE%', sqlerrm); end $$;

-- POs for the supplier: a draft, a sent, a canceled; one for another supplier
create temp table _pos as
  with ins as (insert into public.purchase_orders (supplier_id, supplier_reference) values
     ('5a000000-0000-4000-8000-000000000001', 'draft'),
     ('5a000000-0000-4000-8000-000000000001', 'sent'),
     ('5a000000-0000-4000-8000-000000000001', 'canceled'),
     ('5a000000-0000-4000-8000-000000000002', 'other')
   returning id, supplier_reference)
  select * from ins;
grant select on _pos to authenticated, service_role;
insert into public.purchase_order_lines (purchase_order_id, description, quantity, unit_price)
select id, 'Oil filter', 10, 5 from _pos;
update public.purchase_orders set status = 'sent'
 where id in (select id from _pos where supplier_reference in ('sent', 'canceled', 'other'));
update public.purchase_orders set status = 'canceled' where id = (select id from _pos where supplier_reference = 'canceled');
reset role;

-- The client cannot call the service RPCs
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
do $$ begin
  perform public.vendor_portal_view((select token from _link));
  insert into _t values ('authenticated cannot call view RPC', false, null);
exception when others then insert into _t values ('authenticated cannot call view RPC', sqlstate = '42501', sqlerrm); end $$;
reset role;
set local role anon;
do $$ begin
  perform public.vendor_portal_acknowledge((select token from _link), gen_random_uuid());
  insert into _t values ('anon cannot call acknowledge RPC', false, null);
exception when others then insert into _t values ('anon cannot call acknowledge RPC', sqlstate = '42501', sqlerrm); end $$;
reset role;

-- Viewer cannot see links (token is a secret)
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"5eed0000-0000-4000-8000-00000000a003","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"viewer"}}', true);
insert into _t select 'viewer cannot read links', (select count(*) = 0 from public.supplier_portal_access), null;
reset role;

-- Service role: view
set local role service_role;
create temp table _view as select public.vendor_portal_view((select token from _link)) as v;
insert into _t select 'view: supplier + company', (select v->'supplier'->>'name' = 'Gulf Parts LLC' and v->'company'->>'name' is not null from _view), null;
insert into _t select 'view: only the sent PO (no draft, canceled, other supplier)',
  (select jsonb_array_length(v->'orders') = 1 and v->'orders'->0->>'status' = 'sent'
          and jsonb_array_length(v->'orders'->0->'lines') = 1 from _view),
  (select (v->'orders')::text from _view);
insert into _t select 'view: no internal fields leak', (select not (v->'orders'->0 ? 'notes') and not (v->'orders'->0 ? 'tenant_id')
  and not (v ? 'token') from _view), null;
insert into _t select 'view: access stamped', (select last_accessed_at is not null and access_count = 1
  from public.supplier_portal_access where id = (select id from _link)), null;
select public.vendor_portal_view((select token from _link));
insert into _t select 'view: repeat within a minute not re-stamped', (select access_count = 1
  from public.supplier_portal_access where id = (select id from _link)), null;
insert into _t select 'view: unknown token is null', public.vendor_portal_view(gen_random_uuid()) is null, null;

-- Acknowledge
do $$ begin
  perform public.vendor_portal_acknowledge((select token from _link), (select id from _pos where supplier_reference = 'draft'));
  insert into _t values ('ack draft = not found', false, null);
exception when others then insert into _t values ('ack draft = not found', sqlerrm = 'PO_NOT_FOUND', sqlerrm); end $$;
do $$ begin
  perform public.vendor_portal_acknowledge((select token from _link), (select id from _pos where supplier_reference = 'other'));
  insert into _t values ('ack other supplier PO = not found', false, null);
exception when others then insert into _t values ('ack other supplier PO = not found', sqlerrm = 'PO_NOT_FOUND', sqlerrm); end $$;
do $$ begin
  perform public.vendor_portal_acknowledge((select token from _link), (select id from _pos where supplier_reference = 'sent'),
    current_date - 30, null);
  insert into _t values ('ack expected date before order date refused', false, null);
exception when others then insert into _t values ('ack expected date before order date refused', sqlerrm = 'INVALID_EXPECTED_DATE', sqlerrm); end $$;
select public.vendor_portal_acknowledge((select token from _link), (select id from _pos where supplier_reference = 'sent'),
  current_date + 5, '  Ships Monday  ');
insert into _t select 'ack: PO confirmed with ack fields', (select status = 'confirmed' and vendor_ack_at is not null
  and vendor_ack_note = 'Ships Monday' and vendor_expected_date = current_date + 5 and confirmed_at is not null
  from public.purchase_orders where id = (select id from _pos where supplier_reference = 'sent')), null;
insert into _t select 'ack: managers notified', (select count(*) >= 1 from public.notifications
  where kind = 'vendor_portal.po_acknowledged'), null;
insert into _t select 'ack: event emitted', (select count(*) = 1 from public.domain_events
  where event = 'purchase_order.acknowledged'), null;
do $$ begin
  perform public.vendor_portal_acknowledge((select token from _link), (select id from _pos where supplier_reference = 'sent'));
  insert into _t values ('ack twice refused', false, null);
exception when others then insert into _t values ('ack twice refused', sqlerrm = 'PO_NOT_ACKNOWLEDGEABLE', sqlerrm); end $$;
reset role;

-- Revoke / expire / module off
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
update public.supplier_portal_access set active = false where id = (select id from _link);
insert into _t select 'revoke stamps revoked_at', (select revoked_at is not null from public.supplier_portal_access where id = (select id from _link)), null;
reset role;
set local role service_role;
insert into _t select 'revoked link is null', public.vendor_portal_view((select token from _link)) is null, null;
do $$ begin
  perform public.vendor_portal_acknowledge((select token from _link), gen_random_uuid());
  insert into _t values ('revoked link cannot acknowledge', false, null);
exception when others then insert into _t values ('revoked link cannot acknowledge', sqlerrm = 'VENDOR_LINK_INVALID', sqlerrm); end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
update public.supplier_portal_access set active = true, expires_at = now() - interval '1 day' where id = (select id from _link);
insert into _t select 're-activate clears revoked_at', (select revoked_at is null from public.supplier_portal_access where id = (select id from _link)), null;
reset role;
set local role service_role;
insert into _t select 'expired link is null', public.vendor_portal_view((select token from _link)) is null, null;
reset role;
update public.supplier_portal_access set expires_at = null where id = (select id from _link);
update public.tenant_modules set enabled = false
 where tenant_id = '170d2d86-5c22-4bcb-9d74-420c879419b2' and module_id = 'vendor_portal';
set local role service_role;
insert into _t select 'module off: link is null', public.vendor_portal_view((select token from _link)) is null, null;
reset role;
update public.tenant_modules set enabled = true
 where tenant_id = '170d2d86-5c22-4bcb-9d74-420c879419b2' and module_id = 'vendor_portal';

-- Other tenant sees nothing
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"5eed0000-0000-4000-8000-00000000b001","role":"authenticated","app_metadata":{"tenant_id":"5eed0000-0000-4000-8000-0000000000b1","role":"owner"}}', true);
insert into _t select 'cross-tenant isolation', (select count(*) = 0 from public.supplier_portal_access), null;
reset role;

-- @print
select name, ok, detail from _t order by ok, name;
rollback;
