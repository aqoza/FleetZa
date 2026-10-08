-- Dry-run tests for 20261008000023_insurance.sql (PGlite replica:
-- node docs/buildout/pglite/harness.mjs run docs/buildout/tests/insurance_tests.sql).
begin;
create temp table _t (name text, ok boolean, detail text);
grant all on _t to authenticated, service_role;

insert into public.tenant_modules (tenant_id, module_id, enabled) values
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'workflow_automation', true),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'notifications', true)
on conflict (tenant_id, module_id) do update set enabled = true;
insert into public.suppliers (id, tenant_id, name, supplier_type) values
  ('a7e1c0de-0023-4b2c-9d3e-4f5a6b7c8d01', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Gulf Shield Insurance', 'insurance');
update public.vehicles set status = 'active', ownership = 'company'
where id in ('5eed0000-0000-4000-8000-00000000e001', '5eed0000-0000-4000-8000-00000000e002');

-- Module off
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
do $$ begin
  insert into public.insurance_policies (policy_number, insurer_name, start_date, end_date)
  values ('X-1', 'Someone', current_date, current_date + 364);
  insert into _t values ('module off: insert refused', false, null);
exception when others then insert into _t values ('module off: insert refused', sqlstate = '42501', sqlerrm); end $$;
reset role;
insert into public.tenant_modules (tenant_id, module_id, enabled)
values ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'insurance_mgmt', true)
on conflict (tenant_id, module_id) do update set enabled = true;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);

-- Policies
insert into public.insurance_policies (policy_number, insurer_supplier_id, policy_type, coverage_amount, premium,
                                       premium_frequency, deductible, start_date, end_date, notes)
values (' GS-2026-001 ', 'a7e1c0de-0023-4b2c-9d3e-4f5a6b7c8d01', 'comprehensive', 500000, 1200, 'annual', 250,
        current_date - 340, current_date + 25, 'p1');
create temp table _p on commit drop as select id from public.insurance_policies where notes = 'p1';
grant all on _p to authenticated;
insert into _t select 'policy saved: number trimmed, tenant currency',
  (select policy_number = 'GS-2026-001' and currency = (select currency from public.tenants
     where id = '170d2d86-5c22-4bcb-9d74-420c879419b2') and canceled_at is null
   from public.insurance_policies where id = (select id from _p)), null;
do $$ begin
  insert into public.insurance_policies (policy_number, start_date, end_date) values ('N-1', current_date, current_date + 10);
  insert into _t values ('policy needs an insurer', false, null);
exception when others then insert into _t values ('policy needs an insurer', sqlstate = '23514', sqlerrm); end $$;
do $$ begin
  insert into public.insurance_policies (policy_number, insurer_name, start_date, end_date)
  values ('N-2', 'X', current_date, current_date - 1);
  insert into _t values ('end before start refused', false, null);
exception when others then insert into _t values ('end before start refused', sqlstate = '23514', sqlerrm); end $$;
do $$ begin
  update public.insurance_policies set currency = 'EUR' where id = (select id from _p);
  insert into _t values ('currency not client-writable', false, null);
exception when others then insert into _t values ('currency not client-writable', sqlstate = '42501', sqlerrm); end $$;

-- Covered vehicles
insert into public.insurance_policy_vehicles (policy_id, vehicle_id, added_on)
values ((select id from _p), '5eed0000-0000-4000-8000-00000000e001', current_date - 340);
do $$ begin
  insert into public.insurance_policy_vehicles (policy_id, vehicle_id) values ((select id from _p), '5eed0000-0000-4000-8000-00000000e001');
  insert into _t values ('vehicle listed once while open', false, null);
exception when others then insert into _t values ('vehicle listed once while open', sqlstate = '23505', sqlerrm); end $$;
do $$ begin
  insert into public.insurance_policy_vehicles (policy_id, vehicle_id) values ((select id from _p), '5eed0000-0000-4000-8000-00000000e0b1');
  insert into _t values ('other tenant vehicle refused', false, null);
exception when others then insert into _t values ('other tenant vehicle refused', sqlerrm like 'CROSS_TENANT_REFERENCE%', sqlerrm); end $$;
insert into _t select 'uninsured list: covered vehicle absent, uncovered present',
  not exists (select 1 from public.insurance_uninsured_vehicles() where id = '5eed0000-0000-4000-8000-00000000e001')
  and exists (select 1 from public.insurance_uninsured_vehicles() where id = '5eed0000-0000-4000-8000-00000000e002'), null;
insert into _t select 'uninsured list: after the policy ends the vehicle shows',
  exists (select 1 from public.insurance_uninsured_vehicles(current_date + 30) where id = '5eed0000-0000-4000-8000-00000000e001'), null;

-- Claims
insert into public.insurance_claims (policy_id, vehicle_id, loss_date, description, amount_claimed, notes)
values ((select id from _p), '5eed0000-0000-4000-8000-00000000e001', current_date - 3, 'Rear bumper hit in yard', 4200, 'c1');
create temp table _c on commit drop as select id from public.insurance_claims where notes = 'c1';
grant all on _c to authenticated;
insert into _t select 'claim numbered CLM, draft, policy currency',
  (select doc_number ~ '^CLM-\d{5}$' and status = 'draft' and claim_date = current_date
     and currency = (select currency from public.insurance_policies where id = (select id from _p))
   from public.insurance_claims where id = (select id from _c)), null;
do $$ begin
  insert into public.insurance_claims (policy_id, loss_date, description) values ((select id from _p), current_date - 400, 'old');
  insert into _t values ('loss before the policy term refused', false, null);
exception when others then insert into _t values ('loss before the policy term refused', sqlerrm = 'CLAIM_OUTSIDE_POLICY', sqlerrm); end $$;
do $$ begin
  insert into public.insurance_claims (policy_id, vehicle_id, loss_date, description)
  values ((select id from _p), '5eed0000-0000-4000-8000-00000000e002', current_date - 1, 'not covered');
  insert into _t values ('vehicle not on the policy refused', false, null);
exception when others then insert into _t values ('vehicle not on the policy refused', sqlerrm = 'CLAIM_VEHICLE_NOT_COVERED', sqlerrm); end $$;
do $$ begin
  insert into public.insurance_claims (policy_id, loss_date, claim_date, description)
  values ((select id from _p), current_date, current_date - 1, 'claim before loss');
  insert into _t values ('claim date before loss refused', false, null);
exception when others then insert into _t values ('claim date before loss refused', sqlstate = '23514', sqlerrm); end $$;
do $$ begin
  insert into public.insurance_claims (policy_id, loss_date, description, status, amount_approved)
  values ((select id from _p), current_date - 2, 'Glass', 'settled', 999);
  insert into _t values ('status and approval not client-insertable', false, null);
exception when others then insert into _t values ('status and approval not client-insertable', sqlstate = '42501', sqlerrm); end $$;
insert into public.insurance_claims (policy_id, loss_date, description, notes)
values ((select id from _p), current_date - 2, 'Glass', 'c2');
do $$ begin
  update public.insurance_claims set status = 'approved', amount_approved = 100 where id = (select id from _c);
  insert into _t values ('cannot skip review', false, null);
exception when others then insert into _t values ('cannot skip review', sqlerrm = 'ILLEGAL_CLAIM_TRANSITION', sqlerrm); end $$;
update public.insurance_claims set status = 'submitted', insurer_reference = 'GS-CL-88' where id = (select id from _c);
insert into _t select 'submit stamps submitted_at',
  (select status = 'submitted' and submitted_at is not null from public.insurance_claims where id = (select id from _c)), null;
update public.insurance_claims set status = 'under_review', adjuster_name = 'R. Nair' where id = (select id from _c);
do $$ begin
  update public.insurance_claims set status = 'approved' where id = (select id from _c);
  insert into _t values ('approve needs an amount', false, null);
exception when others then insert into _t values ('approve needs an amount', sqlerrm = 'CLAIM_AMOUNT_REQUIRED', sqlerrm); end $$;
update public.insurance_claims set status = 'approved', amount_approved = 3950, deductible_applied = 250 where id = (select id from _c);
insert into _t select 'approve stamps the decision',
  (select status = 'approved' and decided_at is not null and amount_approved = 3950 from public.insurance_claims where id = (select id from _c)), null;
update public.insurance_claims set status = 'settled' where id = (select id from _c);
insert into _t select 'settle defaults paid to approved and the date to today',
  (select status = 'settled' and amount_paid = 3950 and settled_at = current_date from public.insurance_claims where id = (select id from _c)), null;
do $$ begin
  update public.insurance_claims set amount_paid = 5000 where id = (select id from _c);
  insert into _t values ('settled claim locked', false, null);
exception when others then insert into _t values ('settled claim locked', sqlerrm = 'CLAIM_LOCKED', sqlerrm); end $$;
update public.insurance_claims set notes = 'c1 paid by transfer' where id = (select id from _c);
insert into _t select 'notes stay editable on a settled claim',
  (select notes = 'c1 paid by transfer' from public.insurance_claims where id = (select id from _c)), null;
do $$ begin
  delete from public.insurance_claims where id = (select id from _c);
  insert into _t values ('only drafts deletable', false, null);
exception when others then insert into _t values ('only drafts deletable', sqlerrm = 'CLAIM_NOT_DELETABLE', sqlerrm); end $$;
update public.insurance_claims set status = 'withdrawn' where notes = 'c2';
insert into _t select 'draft can be withdrawn',
  (select status = 'withdrawn' and withdrawn_at is not null from public.insurance_claims where notes = 'c2'), null;
insert into public.insurance_claims (policy_id, loss_date, description, notes)
values ((select id from _p), current_date - 2, 'Mirror', 'c3');
update public.insurance_claims set status = 'submitted' where notes = 'c3';
update public.insurance_claims set status = 'under_review' where notes = 'c3';
update public.insurance_claims set status = 'rejected', rejection_reason = 'Wear and tear' where notes = 'c3';
insert into _t select 'reject keeps the reason',
  (select status = 'rejected' and rejection_reason = 'Wear and tear' and decided_at is not null
   from public.insurance_claims where notes = 'c3'), null;
do $$ begin
  update public.insurance_claims set status = 'settled' where notes = 'c3';
  insert into _t values ('rejected claim cannot settle', false, null);
exception when others then insert into _t values ('rejected claim cannot settle', sqlerrm in ('CLAIM_LOCKED', 'ILLEGAL_CLAIM_TRANSITION'), sqlerrm); end $$;
insert into public.insurance_claims (policy_id, loss_date, description, notes)
values ((select id from _p), current_date - 1, 'Scratch', 'c4');
delete from public.insurance_claims where notes = 'c4';
insert into _t select 'draft deletable', not exists (select 1 from public.insurance_claims where notes = 'c4'), null;
insert into _t select 'status changes emit automation events',
  (select count(*) >= 4 from public.domain_events where event = 'insurance_claim.status_changed'), null;
do $$ begin
  delete from public.insurance_policies where id = (select id from _p);
  insert into _t values ('policy with claims cannot be deleted', false, null);
exception when others then insert into _t values ('policy with claims cannot be deleted', sqlstate = '23503', sqlerrm); end $$;

-- Scanner (policy ends in 25 days → d30)
reset role;
insert into _t select 'scanner notifies managers', app.scan_due_insurance('170d2d86-5c22-4bcb-9d74-420c879419b2') > 0, null;
insert into _t select 'scanner notifies once per stage',
  app.scan_due_insurance('170d2d86-5c22-4bcb-9d74-420c879419b2') = 0, null;
insert into _t select 'scanner stage and params',
  exists (select 1 from public.notifications where kind = 'insurance.policy_expiring'
              and params->>'stage' = 'd30' and params->>'policy' = 'GS-2026-001'), null;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);

-- Renewal
create temp table _r on commit drop as select public.insurance_renew_policy((select id from _p)) as id;
grant all on _r to authenticated;
insert into _t select 'renewal starts the day after, same length, carries vehicles',
  (select n.start_date = o.end_date + 1 and n.end_date - n.start_date = o.end_date - o.start_date
     and n.policy_number = o.policy_number and n.premium = o.premium
   from public.insurance_policies n, public.insurance_policies o
   where n.id = (select id from _r) and o.id = (select id from _p))
  and exists (select 1 from public.insurance_policy_vehicles where policy_id = (select id from _r)
              and vehicle_id = '5eed0000-0000-4000-8000-00000000e001'), null;
reset role;
delete from public.notifications where kind = 'insurance.policy_expiring';
insert into _t select 'scanner skips a renewed policy',
  app.scan_due_insurance('170d2d86-5c22-4bcb-9d74-420c879419b2') = 0, null;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);

-- Cancellation
do $$ begin
  update public.insurance_policies set canceled_at = current_date + 5 where id = (select id from _r);
  insert into _t values ('cancel date in the future refused', false, null);
exception when others then insert into _t values ('cancel date in the future refused', sqlerrm = 'INVALID_POLICY_CANCEL', sqlerrm); end $$;
update public.insurance_policies set canceled_at = current_date - 10, cancel_reason = 'Vehicle sold'
where id = (select id from _p);
do $$ begin
  insert into public.insurance_policy_vehicles (policy_id, vehicle_id) values ((select id from _p), '5eed0000-0000-4000-8000-00000000e002');
  insert into _t values ('canceled policy takes no vehicles', false, null);
exception when others then insert into _t values ('canceled policy takes no vehicles', sqlerrm = 'POLICY_CANCELED', sqlerrm); end $$;
do $$ begin
  insert into public.insurance_claims (policy_id, loss_date, description) values ((select id from _p), current_date - 2, 'after cancel');
  insert into _t values ('loss after cancellation refused', false, null);
exception when others then insert into _t values ('loss after cancellation refused', sqlerrm = 'CLAIM_OUTSIDE_POLICY', sqlerrm); end $$;
do $$ begin
  perform public.insurance_renew_policy((select id from _p));
  insert into _t values ('canceled policy cannot renew', false, null);
exception when others then insert into _t values ('canceled policy cannot renew', sqlerrm = 'POLICY_CANCELED', sqlerrm); end $$;
update public.insurance_policies set canceled_at = null, cancel_reason = 'x' where id = (select id from _p);
insert into _t select 'clearing the date reinstates and clears the reason',
  (select canceled_at is null and cancel_reason is null from public.insurance_policies where id = (select id from _p)), null;
insert into _t select 'audit log records policy changes',
  (select count(*) > 0 from public.audit_events where table_name = 'insurance_policies'), null;
reset role;

-- Viewer
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"5eed0000-0000-4000-8000-00000000a003","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"viewer"}}', true);
insert into _t select 'viewer reads policies, vehicles and claims',
  (select count(*) = 2 from public.insurance_policies) and (select count(*) > 0 from public.insurance_policy_vehicles)
  and (select count(*) = 3 from public.insurance_claims), null;
do $$ begin
  insert into public.insurance_policies (policy_number, insurer_name, start_date, end_date)
  values ('V-1', 'X', current_date, current_date + 30);
  insert into _t values ('viewer cannot add policies', false, null);
exception when others then insert into _t values ('viewer cannot add policies', sqlstate = '42501', sqlerrm); end $$;
do $$ begin
  perform public.insurance_renew_policy((select id from _p));
  insert into _t values ('viewer cannot renew', false, null);
exception when others then insert into _t values ('viewer cannot renew', sqlerrm = 'FORBIDDEN' or sqlstate = '42501', sqlerrm); end $$;
update public.insurance_claims set notes = 'viewer' where id = (select id from _c);
insert into _t select 'viewer update is a no-op',
  (select notes = 'c1 paid by transfer' from public.insurance_claims where id = (select id from _c)), null;
reset role;

-- Other tenant
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"5eed0000-0000-4000-8000-00000000b001","role":"authenticated","app_metadata":{"tenant_id":"5eed0000-0000-4000-8000-0000000000b1","role":"owner"}}', true);
insert into _t select 'cross-tenant isolation',
  (select count(*) = 0 from public.insurance_policies) and (select count(*) = 0 from public.insurance_claims)
  and (select count(*) = 0 from public.insurance_policy_vehicles)
  and not exists (select 1 from public.insurance_uninsured_vehicles() where id = '5eed0000-0000-4000-8000-00000000e001'), null;
reset role;

-- @print
select name, ok, detail from _t order by ok, name;
rollback;
