-- Dry-run tests for 20261008000026_crm.sql (PGlite replica:
-- node docs/buildout/pglite/harness.mjs run docs/buildout/tests/crm_tests.sql).
begin;
create temp table _t (name text, ok boolean, detail text);
grant all on _t to authenticated, service_role;
create temp table _ids (k text primary key, id uuid);
grant all on _ids to authenticated;

insert into public.tenant_modules (tenant_id, module_id, enabled) values
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'notifications', true),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'customers', true)
on conflict (tenant_id, module_id) do update set enabled = true;
insert into public.customers (id, tenant_id, name) values
  ('a7e1c0de-0026-4b2c-9d3e-4f5a6b7c8d0b', '5eed0000-0000-4000-8000-0000000000b1', 'Other tenant customer');

-- Module off
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
do $$ begin
  insert into public.crm_leads (name) values ('x');
  insert into _t values ('module off: insert refused', false, null);
exception when others then insert into _t values ('module off: insert refused', sqlstate = '42501', sqlerrm); end $$;
reset role;
insert into public.tenant_modules (tenant_id, module_id, enabled)
values ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'crm', true)
on conflict (tenant_id, module_id) do update set enabled = true;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);

-- Leads
with x as (insert into public.crm_leads (name, company_name, email, phone, source, owner_id, estimated_value, fleet_size, interest)
values ('Khalid Rashdi', 'Rashdi Transport', 'k@rashdi.test', '+968 9000 0001', 'referral',
        '129bbbae-fdfc-4d21-8a86-8949fec2403b', 12000, 40, 'Speed limiters for 40 trucks') returning id) insert into _ids select 'lead1', id from x;
with x as (insert into public.crm_leads (name, source) values ('Walk-in visitor', 'walk_in') returning id) insert into _ids select 'lead2', id from x;
insert into _t select 'leads numbered LEAD, status new, currency snapshotted',
  (select doc_number like 'LEAD-%' and status = 'new' and currency = (select currency from public.tenants
     where id = '170d2d86-5c22-4bcb-9d74-420c879419b2') from public.crm_leads where id = (select id from _ids where k = 'lead1')), null;
do $$ begin
  update public.crm_leads set status = 'converted' where id = (select id from _ids where k = 'lead2');
  insert into _t values ('lead cannot be marked converted directly', false, null);
exception when others then insert into _t values ('lead cannot be marked converted directly', sqlerrm = 'ILLEGAL_LEAD_TRANSITION', sqlerrm); end $$;
do $$ begin
  update public.crm_leads set converted_customer_id = gen_random_uuid() where id = (select id from _ids where k = 'lead2');
  insert into _t values ('conversion record not client-writable', false, null);
exception when others then insert into _t values ('conversion record not client-writable', sqlstate = '42501', sqlerrm); end $$;
update public.crm_leads set status = 'contacted' where id = (select id from _ids where k = 'lead1');
update public.crm_leads set status = 'qualified' where id = (select id from _ids where k = 'lead1');
insert into _t select 'lead moves new → contacted → qualified',
  (select status = 'qualified' from public.crm_leads where id = (select id from _ids where k = 'lead1')), null;
update public.crm_leads set status = 'unqualified' where id = (select id from _ids where k = 'lead2');
do $$ begin
  update public.crm_leads set status = 'qualified' where id = (select id from _ids where k = 'lead2');
  insert into _t values ('unqualified lead only reopens to new', false, null);
exception when others then insert into _t values ('unqualified lead only reopens to new', sqlerrm = 'ILLEGAL_LEAD_TRANSITION', sqlerrm); end $$;
do $$ begin
  perform public.crm_convert_lead((select id from _ids where k = 'lead2'), false);
  insert into _t values ('unqualified lead cannot be converted', false, null);
exception when others then insert into _t values ('unqualified lead cannot be converted', sqlerrm = 'ILLEGAL_LEAD_TRANSITION', sqlerrm); end $$;
do $$ begin
  insert into public.crm_leads (name, owner_id) values ('x', '5eed0000-0000-4000-8000-00000000b001');
  insert into _t values ('owner from another tenant refused', false, null);
exception when others then insert into _t values ('owner from another tenant refused', sqlerrm like 'CROSS_TENANT_REFERENCE%', sqlerrm); end $$;

-- Activities on the lead, one overdue
insert into public.crm_activities (activity_type, subject, due_at, owner_id, lead_id)
values ('call', 'Call Khalid back', now() - interval '2 days', '129bbbae-fdfc-4d21-8a86-8949fec2403b',
        (select id from _ids where k = 'lead1')),
       ('task', 'Send brochure', now() + interval '2 days', '129bbbae-fdfc-4d21-8a86-8949fec2403b',
        (select id from _ids where k = 'lead1'));

-- Conversion
create temp table _conv (r jsonb);
grant all on _conv to authenticated;
insert into _conv select public.crm_convert_lead((select id from _ids where k = 'lead1'), true);
insert into _t select 'conversion creates customer, primary contact and opportunity',
  exists (select 1 from public.customers c, _conv where c.id = (_conv.r->>'customer_id')::uuid and c.name = 'Rashdi Transport')
  and exists (select 1 from public.contacts ct, _conv where ct.id = (_conv.r->>'contact_id')::uuid
              and ct.is_primary and ct.name = 'Khalid Rashdi' and ct.customer_id = (_conv.r->>'customer_id')::uuid)
  and exists (select 1 from public.crm_opportunities o, _conv where o.id = (_conv.r->>'opportunity_id')::uuid
              and o.stage = 'qualification' and o.probability = 25 and o.amount = 12000
              and o.doc_number like 'OPP-%' and o.title = 'Speed limiters for 40 trucks'), (select r::text from _conv);
insert into _t select 'lead records its conversion',
  (select status = 'converted' and converted_at is not null
          and converted_customer_id = (select (r->>'customer_id')::uuid from _conv)
          and converted_opportunity_id = (select (r->>'opportunity_id')::uuid from _conv)
   from public.crm_leads where id = (select id from _ids where k = 'lead1')), null;
insert into _t select 'lead activities follow it to the customer',
  (select count(*) = 2 from public.crm_activities where customer_id = (select (r->>'customer_id')::uuid from _conv)), null;
do $$ begin
  perform public.crm_convert_lead((select id from _ids where k = 'lead1'), true);
  insert into _t values ('second conversion refused', false, null);
exception when others then insert into _t values ('second conversion refused', sqlerrm = 'LEAD_ALREADY_CONVERTED', sqlerrm); end $$;
do $$ begin
  update public.crm_leads set name = 'Renamed' where id = (select id from _ids where k = 'lead1');
  insert into _t values ('converted lead locked', false, null);
exception when others then insert into _t values ('converted lead locked', sqlerrm = 'LEAD_LOCKED', sqlerrm); end $$;
update public.crm_leads set notes = 'Signed in October' where id = (select id from _ids where k = 'lead1');
insert into _t select 'converted lead still takes notes',
  (select notes = 'Signed in October' from public.crm_leads where id = (select id from _ids where k = 'lead1')), null;
do $$ begin
  delete from public.crm_leads where id = (select id from _ids where k = 'lead1');
  insert into _t values ('converted lead not deletable', false, null);
exception when others then insert into _t values ('converted lead not deletable', sqlerrm = 'LEAD_NOT_DELETABLE', sqlerrm); end $$;

-- Opportunities
with x as (insert into public.crm_opportunities (title, amount) values ('Telematics pilot', 5000) returning id) insert into _ids select 'opp2', id from x;
insert into _t select 'new opportunity defaults to prospecting at 10%',
  (select stage = 'prospecting' and probability = 10 from public.crm_opportunities where id = (select id from _ids where k = 'opp2')), null;
update public.crm_opportunities set stage = 'negotiation' where id = (select id from _ids where k = 'opp2');
insert into _t select 'probability follows the stage',
  (select probability = 75 from public.crm_opportunities where id = (select id from _ids where k = 'opp2')), null;
update public.crm_opportunities set stage = 'proposal', probability = 60 where id = (select id from _ids where k = 'opp2');
insert into _t select 'probability set with the stage is kept',
  (select probability = 60 from public.crm_opportunities where id = (select id from _ids where k = 'opp2')), null;
do $$ begin
  update public.crm_opportunities set stage = 'lost' where id = (select id from _ids where k = 'opp2');
  insert into _t values ('losing needs a reason', false, null);
exception when others then insert into _t values ('losing needs a reason', sqlerrm = 'OPPORTUNITY_LOST_REASON_REQUIRED', sqlerrm); end $$;
update public.crm_opportunities set stage = 'lost', lost_reason = 'Price' where id = (select id from _ids where k = 'opp2');
insert into _t select 'lost stamps lost_at and 0%',
  (select lost_at is not null and probability = 0 from public.crm_opportunities where id = (select id from _ids where k = 'opp2')), null;
do $$ begin
  update public.crm_opportunities set stage = 'won' where id = (select id from _ids where k = 'opp2');
  insert into _t values ('lost cannot jump to won', false, null);
exception when others then insert into _t values ('lost cannot jump to won', sqlerrm = 'ILLEGAL_OPPORTUNITY_TRANSITION', sqlerrm); end $$;
update public.crm_opportunities set stage = 'negotiation' where id = (select id from _ids where k = 'opp2');
insert into _t select 'reopening clears lost_at and restores the stage probability',
  (select lost_at is null and probability = 75 from public.crm_opportunities where id = (select id from _ids where k = 'opp2')), null;
update public.crm_opportunities set stage = 'won' where id = (select id from _ids where k = 'opp2');
insert into _t select 'won stamps won_at and 100%',
  (select won_at is not null and probability = 100 from public.crm_opportunities where id = (select id from _ids where k = 'opp2')), null;
do $$ begin
  update public.crm_opportunities set customer_id = 'a7e1c0de-0026-4b2c-9d3e-4f5a6b7c8d0b' where id = (select id from _ids where k = 'opp2');
  insert into _t values ('customer from another tenant refused', false, null);
exception when others then insert into _t values ('customer from another tenant refused', sqlerrm like 'CROSS_TENANT_REFERENCE%', sqlerrm); end $$;
do $$ begin
  update public.crm_opportunities set won_at = now() - interval '1 year' where id = (select id from _ids where k = 'opp2');
  insert into _t values ('won_at not client-writable', false, null);
exception when others then insert into _t values ('won_at not client-writable', sqlstate = '42501', sqlerrm); end $$;
reset role;

-- Scanner
select app.scan_due_crm('170d2d86-5c22-4bcb-9d74-420c879419b2');
insert into _t select 'overdue activities notify their owner once',
  (select count(*) = 1 from public.notifications where kind = 'crm.activities_overdue'
     and recipient_id = '129bbbae-fdfc-4d21-8a86-8949fec2403b' and params->>'count' = '1'
     and params->>'subject' = 'Call Khalid back'), null;
select app.scan_due_crm('170d2d86-5c22-4bcb-9d74-420c879419b2');
insert into _t select 'scanning again is deduplicated',
  (select count(*) = 1 from public.notifications where kind = 'crm.activities_overdue'), null;

-- Deleting a customer still clears a converted lead's link (FK action)
insert into public.customers (id, tenant_id, name) values
  ('a7e1c0de-0026-4b2c-9d3e-4f5a6b7c8d0c', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Throwaway');
insert into public.crm_leads (id, tenant_id, name, status, converted_customer_id) values
  ('a7e1c0de-0026-4b2c-9d3e-4f5a6b7c8d0d', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Imported', 'converted',
   'a7e1c0de-0026-4b2c-9d3e-4f5a6b7c8d0c');
delete from public.customers where id = 'a7e1c0de-0026-4b2c-9d3e-4f5a6b7c8d0c';
insert into _t select 'customer deletion clears the converted lead link',
  (select converted_customer_id is null from public.crm_leads where id = 'a7e1c0de-0026-4b2c-9d3e-4f5a6b7c8d0d'), null;

-- Viewer
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"5eed0000-0000-4000-8000-00000000a003","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"viewer"}}', true);
insert into _t select 'viewer reads the pipeline',
  (select count(*) > 0 from public.crm_leads) and (select count(*) > 0 from public.crm_opportunities)
  and (select count(*) > 0 from public.crm_activities), null;
do $$ begin
  insert into public.crm_leads (name) values ('viewer');
  insert into _t values ('viewer cannot add leads', false, null);
exception when others then insert into _t values ('viewer cannot add leads', sqlstate = '42501', sqlerrm); end $$;
do $$ begin
  perform public.crm_convert_lead((select id from public.crm_leads where status = 'new' limit 1), true);
  insert into _t values ('viewer cannot convert leads', false, null);
exception when others then insert into _t values ('viewer cannot convert leads', sqlerrm = 'FORBIDDEN' or sqlstate = '42501', sqlerrm); end $$;
reset role;

-- Other tenant
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"5eed0000-0000-4000-8000-00000000b001","role":"authenticated","app_metadata":{"tenant_id":"5eed0000-0000-4000-8000-0000000000b1","role":"owner"}}', true);
insert into _t select 'cross-tenant isolation',
  (select count(*) = 0 from public.crm_leads) and (select count(*) = 0 from public.crm_opportunities)
  and (select count(*) = 0 from public.crm_activities), null;
reset role;

-- @print
select name, ok, detail from _t order by ok, name;
rollback;
