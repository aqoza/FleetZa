-- Dry-run tests for 20261008000028_customer_portal.sql (PGlite replica:
-- node docs/buildout/pglite/harness.mjs run docs/buildout/tests/customer_portal_tests.sql).
begin;
create temp table _t (name text, ok boolean, detail text);
grant all on _t to authenticated, service_role, anon;
create temp table _ids (k text primary key, id uuid);
grant all on _ids to authenticated, service_role;

insert into public.tenant_modules (tenant_id, module_id, enabled) values
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'notifications', true),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'customers', true),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'sales', true),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'billing', true),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'speed_limiters', true)
on conflict (tenant_id, module_id) do update set enabled = true;
insert into public.customers (id, tenant_id, name) values
  ('a7e1c0de-0028-4b2c-9d3e-4f5a6b7c8d01', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Gulf Freight'),
  ('a7e1c0de-0028-4b2c-9d3e-4f5a6b7c8d02', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Someone Else'),
  ('a7e1c0de-0028-4b2c-9d3e-4f5a6b7c8d0b', '5eed0000-0000-4000-8000-0000000000b1', 'Other tenant customer');
insert into public.vehicles (id, tenant_id, name, license_plate, customer_id) values
  ('a7e1c0de-0028-4b2c-9d3e-0000000000e1', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Truck 07', '1234 AB', 'a7e1c0de-0028-4b2c-9d3e-4f5a6b7c8d01'),
  ('a7e1c0de-0028-4b2c-9d3e-0000000000e2', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Not theirs', '9999 ZZ', 'a7e1c0de-0028-4b2c-9d3e-4f5a6b7c8d02');

-- Module off
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
do $$ begin
  insert into public.customer_portal_access (customer_id) values ('a7e1c0de-0028-4b2c-9d3e-4f5a6b7c8d01');
  insert into _t values ('module off: link refused', false, null);
exception when others then insert into _t values ('module off: link refused', sqlstate = '42501', sqlerrm); end $$;
reset role;
insert into public.tenant_modules (tenant_id, module_id, enabled)
values ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'customer_portal', true)
on conflict (tenant_id, module_id) do update set enabled = true;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
with x as (insert into public.customer_portal_access (customer_id, label, show_quotes)
           values ('a7e1c0de-0028-4b2c-9d3e-4f5a6b7c8d01', 'Fleet office', false) returning id)
insert into _ids select 'link', id from x;
insert into _t select 'link created with token + tenant + actor',
  (select token is not null and active and tenant_id = '170d2d86-5c22-4bcb-9d74-420c879419b2'
     and created_by = '129bbbae-fdfc-4d21-8a86-8949fec2403b' and allow_requests
   from public.customer_portal_access where id = (select id from _ids where k = 'link')), null;
do $$ begin
  insert into public.customer_portal_access (customer_id, token) values ('a7e1c0de-0028-4b2c-9d3e-4f5a6b7c8d01', gen_random_uuid());
  insert into _t values ('client cannot choose token', false, null);
exception when others then insert into _t values ('client cannot choose token', sqlstate = '42501', sqlerrm); end $$;
do $$ begin
  update public.customer_portal_access set token = gen_random_uuid() where id = (select id from _ids where k = 'link');
  insert into _t values ('client cannot change token', false, null);
exception when others then insert into _t values ('client cannot change token', sqlstate = '42501', sqlerrm); end $$;
do $$ begin
  insert into public.customer_portal_access (customer_id) values ('a7e1c0de-0028-4b2c-9d3e-4f5a6b7c8d0b');
  insert into _t values ('foreign customer refused', false, null);
exception when others then insert into _t values ('foreign customer refused', sqlerrm like 'CROSS_TENANT_REFERENCE%', sqlerrm); end $$;
do $$ begin
  insert into public.portal_service_requests (tenant_id, customer_id, description)
  values ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'a7e1c0de-0028-4b2c-9d3e-4f5a6b7c8d01', 'x');
  insert into _t values ('staff cannot insert requests', false, null);
exception when others then insert into _t values ('staff cannot insert requests', sqlstate = '42501', sqlerrm); end $$;
do $$ begin
  perform public.customer_portal_view((select token from public.customer_portal_access limit 1));
  insert into _t values ('authenticated cannot call view RPC', false, null);
exception when others then insert into _t values ('authenticated cannot call view RPC', sqlstate = '42501', sqlerrm); end $$;

-- Customer data: an issued + a draft invoice, a sent + a draft quote, certificates
with x as (insert into public.invoices (customer_id, title, due_date) values
  ('a7e1c0de-0028-4b2c-9d3e-4f5a6b7c8d01', 'issued one', current_date + 30),
  ('a7e1c0de-0028-4b2c-9d3e-4f5a6b7c8d01', 'draft one', current_date + 30) returning id, title)
insert into _ids select 'inv_' || split_part(title, ' ', 1), id from x;
insert into public.invoice_lines (invoice_id, sort_order, description, quantity, unit_price)
select id, 1, 'Service', 1, 100 from _ids where k like 'inv_%';
update public.invoices set status = 'issued' where id = (select id from _ids where k = 'inv_issued');
with x as (insert into public.quotes (customer_id, title, valid_until) values
  ('a7e1c0de-0028-4b2c-9d3e-4f5a6b7c8d01', 'sent one', current_date + 30) returning id)
insert into _ids select 'quote', id from x;
reset role;

insert into public.speed_limiter_certificates (id, tenant_id, customer_id, vehicle_id, certificate_number, issued_at, expires_at, status)
values
  ('a7e1c0de-0028-4b2c-9d3e-0000000000c1', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'a7e1c0de-0028-4b2c-9d3e-4f5a6b7c8d01',
   'a7e1c0de-0028-4b2c-9d3e-0000000000e1', 'CERT-OLD', now() - interval '400 days', now() - interval '35 days', 'valid'),
  ('a7e1c0de-0028-4b2c-9d3e-0000000000c2', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'a7e1c0de-0028-4b2c-9d3e-4f5a6b7c8d02',
   'a7e1c0de-0028-4b2c-9d3e-0000000000e2', 'CERT-OTHER', now() - interval '10 days', now() + interval '355 days', 'valid');

-- Viewer cannot see links (the token is a secret)
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"5eed0000-0000-4000-8000-00000000a003","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"viewer"}}', true);
insert into _t select 'viewer cannot read links', (select count(*) = 0 from public.customer_portal_access), null;
reset role;

-- Service role: view
set local role service_role;
create temp table _view as
  select public.customer_portal_view((select token from public.customer_portal_access where id = (select id from _ids where k = 'link'))) as v;
insert into _t select 'view: customer + company + sections',
  (select v->'customer'->>'name' = 'Gulf Freight' and v->'company'->>'name' is not null
          and (v->'sections'->>'vehicles')::boolean and not (v->'sections'->>'quotes')::boolean
          and not (v->'sections'->>'contracts')::boolean and (v->'sections'->>'requests')::boolean from _view),
  (select (v->'sections')::text from _view);
insert into _t select 'view: only their vehicles',
  (select jsonb_array_length(v->'vehicles') = 1 and v->'vehicles'->0->>'name' = 'Truck 07' from _view), null;
insert into _t select 'view: only their certificates, expired state derived',
  (select jsonb_array_length(v->'certificates') = 1 and v->'certificates'->0->>'state' = 'expired'
          and v->'certificates'->0->>'id' = 'a7e1c0de-0028-4b2c-9d3e-0000000000c1' from _view),
  (select (v->'certificates')::text from _view);
insert into _t select 'view: issued invoices only',
  (select jsonb_array_length(v->'invoices') = 1 and v->'invoices'->0->>'status' = 'issued' from _view),
  (select (v->'invoices')::text from _view);
insert into _t select 'view: hidden section is empty', (select jsonb_array_length(v->'quotes') = 0 from _view), null;
insert into _t select 'view: no internal fields leak',
  (select not (v->'invoices'->0 ? 'internal_notes') and not (v->'invoices'->0 ? 'tenant_id') and not (v ? 'token')
          and not (v->'vehicles'->0 ? 'purchase_price') from _view), null;
insert into _t select 'view: access stamped', (select last_accessed_at is not null and access_count = 1
  from public.customer_portal_access where id = (select id from _ids where k = 'link')), null;
insert into _t select 'view: unknown token is null', public.customer_portal_view(gen_random_uuid()) is null, null;

-- Requests
create temp table _req as
  select public.customer_portal_request((select token from public.customer_portal_access where id = (select id from _ids where k = 'link')),
    'inspection', '  Annual inspection for Truck 07  ', 'a7e1c0de-0028-4b2c-9d3e-0000000000e1', current_date + 7,
    'Ahmed', '+968 9000 0000') as r;
insert into _t select 'request created, numbered SRQ, trimmed',
  (select doc_number like 'SRQ-%' and status = 'new' and description = 'Annual inspection for Truck 07'
          and access_id = (select id from _ids where k = 'link') and tenant_id = '170d2d86-5c22-4bcb-9d74-420c879419b2'
   from public.portal_service_requests where id = ((select r->>'id' from _req))::uuid), null;
insert into _t select 'request notifies managers',
  (select count(*) > 0 from public.notifications where kind = 'customer_portal.request'), null;
do $$ begin
  perform public.customer_portal_request((select token from public.customer_portal_access where id = (select id from _ids where k = 'link')),
    'service', 'x', 'a7e1c0de-0028-4b2c-9d3e-0000000000e2');
  insert into _t values ('another customer''s vehicle refused', false, null);
exception when others then insert into _t values ('another customer''s vehicle refused', sqlerrm = 'PORTAL_REQUEST_INVALID', sqlerrm); end $$;
do $$ begin
  perform public.customer_portal_request((select token from public.customer_portal_access where id = (select id from _ids where k = 'link')),
    'teleport', 'x');
  insert into _t values ('bad request type refused', false, null);
exception when others then insert into _t values ('bad request type refused', sqlerrm = 'PORTAL_REQUEST_INVALID', sqlerrm); end $$;
do $$ begin
  perform public.customer_portal_request((select token from public.customer_portal_access where id = (select id from _ids where k = 'link')),
    'service', '   ');
  insert into _t values ('empty description refused', false, null);
exception when others then insert into _t values ('empty description refused', sqlerrm = 'PORTAL_REQUEST_INVALID', sqlerrm); end $$;
do $$ begin
  perform public.customer_portal_request(gen_random_uuid(), 'service', 'x');
  insert into _t values ('unknown token refused', false, null);
exception when others then insert into _t values ('unknown token refused', sqlerrm = 'PORTAL_LINK_INVALID', sqlerrm); end $$;
create temp table _view2 as
  select public.customer_portal_view((select token from public.customer_portal_access where id = (select id from _ids where k = 'link'))) as v;
insert into _t select 'view lists the request', (select jsonb_array_length(v->'requests') = 1
  and v->'requests'->0->>'vehicle' = 'Truck 07' from _view2), null;
reset role;

-- Staff triage
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"5eed0000-0000-4000-8000-00000000a003","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"viewer"}}', true);
insert into _t select 'viewer reads requests', (select count(*) = 1 from public.portal_service_requests), null;
update public.portal_service_requests set status = 'in_review';
insert into _t select 'viewer cannot triage', (select status = 'new' from public.portal_service_requests limit 1), null;
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
update public.portal_service_requests set status = 'scheduled', scheduled_for = current_date + 3;
insert into _t select 'scheduling stamps handler',
  (select status = 'scheduled' and handled_by = '129bbbae-fdfc-4d21-8a86-8949fec2403b' and resolved_at is null
   from public.portal_service_requests limit 1), null;
do $$ begin
  update public.portal_service_requests set description = 'changed';
  insert into _t values ('description not editable', false, null);
exception when others then insert into _t values ('description not editable', sqlstate = '42501', sqlerrm); end $$;
update public.portal_service_requests set status = 'done';
insert into _t select 'done stamps resolved_at', (select resolved_at is not null from public.portal_service_requests limit 1), null;
do $$ begin
  update public.portal_service_requests set status = 'scheduled';
  insert into _t values ('done cannot jump to scheduled', false, null);
exception when others then insert into _t values ('done cannot jump to scheduled', sqlerrm = 'ILLEGAL_REQUEST_TRANSITION', sqlerrm); end $$;
update public.portal_service_requests set status = 'in_review';
insert into _t select 'reopen clears resolved_at', (select status = 'in_review' and resolved_at is null
  from public.portal_service_requests limit 1), null;
do $$ begin
  update public.portal_service_requests set handled_by = '5eed0000-0000-4000-8000-00000000b001';
  insert into _t values ('handler from another tenant refused', false, null);
exception when others then insert into _t values ('handler from another tenant refused', sqlerrm like 'CROSS_TENANT_REFERENCE%', sqlerrm); end $$;

-- Contracts section (read dynamically; a stand-in table when the contracts migration is absent)
reset role;
do $$ begin
  if to_regclass('public.contracts') is null then
    create table public.contracts (id uuid primary key default gen_random_uuid(), tenant_id uuid, customer_id uuid,
      doc_number text, title text, contract_type text, start_date date, end_date date, billing_frequency text, status text);
  end if;
end $$;
insert into public.contracts (tenant_id, customer_id, doc_number, title, contract_type, start_date, end_date, billing_frequency, status)
values ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'a7e1c0de-0028-4b2c-9d3e-4f5a6b7c8d01', 'CTR-T1', 'Active one', 'service', current_date - 10, current_date + 300, 'monthly', 'active'),
       ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'a7e1c0de-0028-4b2c-9d3e-4f5a6b7c8d01', 'CTR-T2', 'Draft one', 'service', current_date, null, 'monthly', 'draft');
insert into public.tenant_modules (tenant_id, module_id, enabled)
values ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'contracts', true)
on conflict (tenant_id, module_id) do update set enabled = true;
set local role service_role;
create temp table _view3 as
  select public.customer_portal_view((select token from public.customer_portal_access where id = (select id from _ids where k = 'link'))) as v;
insert into _t select 'view: active contracts only', (select (v->'sections'->>'contracts')::boolean
  and jsonb_array_length(v->'contracts') = 1 and v->'contracts'->0->>'doc_number' = 'CTR-T1' from _view3),
  (select (v->'contracts')::text from _view3);
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);

-- Revoke / requests off
update public.customer_portal_access set allow_requests = false where id = (select id from _ids where k = 'link');
reset role;
set local role service_role;
do $$ begin
  perform public.customer_portal_request((select token from public.customer_portal_access where id = (select id from _ids where k = 'link')),
    'service', 'x');
  insert into _t values ('requests off refused', false, null);
exception when others then insert into _t values ('requests off refused', sqlerrm = 'PORTAL_REQUESTS_DISABLED', sqlerrm); end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
update public.customer_portal_access set active = false where id = (select id from _ids where k = 'link');
insert into _t select 'revoke stamps revoked_at', (select revoked_at is not null from public.customer_portal_access
  where id = (select id from _ids where k = 'link')), null;
reset role;
set local role service_role;
insert into _t select 'revoked link reads as unknown', public.customer_portal_view((select token from public.customer_portal_access
  where id = (select id from _ids where k = 'link'))) is null, null;
reset role;

select name, ok, detail from _t order by ok, name;
rollback;
