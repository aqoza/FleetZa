-- Dry-run tests for 20261008000027_contracts.sql (PGlite replica:
-- node docs/buildout/pglite/harness.mjs run docs/buildout/tests/contracts_tests.sql).
begin;
create temp table _t (name text, ok boolean, detail text);
grant all on _t to authenticated, service_role;
create temp table _ids (k text primary key, id uuid);
grant all on _ids to authenticated;

insert into public.tenant_modules (tenant_id, module_id, enabled) values
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'notifications', true),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'customers', true),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'sales', true),
  ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'billing', true)
on conflict (tenant_id, module_id) do update set enabled = true;
insert into public.customers (id, tenant_id, name) values
  ('a7e1c0de-0027-4b2c-9d3e-4f5a6b7c8d01', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'Gulf Freight'),
  ('a7e1c0de-0027-4b2c-9d3e-4f5a6b7c8d0b', '5eed0000-0000-4000-8000-0000000000b1', 'Other tenant customer');

-- Module off
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
do $$ begin
  insert into public.contracts (customer_id, title, start_date) values ('a7e1c0de-0027-4b2c-9d3e-4f5a6b7c8d01', 'x', current_date);
  insert into _t values ('module off: insert refused', false, null);
exception when others then insert into _t values ('module off: insert refused', sqlstate = '42501', sqlerrm); end $$;
reset role;
insert into public.tenant_modules (tenant_id, module_id, enabled)
values ('170d2d86-5c22-4bcb-9d74-420c879419b2', 'contracts', true)
on conflict (tenant_id, module_id) do update set enabled = true;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);

-- Contracts
with x as (insert into public.contracts (customer_id, contract_type, title, start_date, end_date, billing_frequency,
                                         recurring_amount, tax_rate, notice_days)
           values ('a7e1c0de-0027-4b2c-9d3e-4f5a6b7c8d01', 'maintenance', 'Fleet maintenance', current_date - 70,
                   current_date + 294, 'monthly', 1000, 5, 60) returning id)
insert into _ids select 'c1', id from x;
insert into _t select 'contract numbered CTR, draft, currency snapshotted',
  (select doc_number like 'CTR-%' and status = 'draft' and currency = (select currency from public.tenants
     where id = '170d2d86-5c22-4bcb-9d74-420c879419b2') from public.contracts where id = (select id from _ids where k = 'c1')), null;
do $$ begin
  insert into public.contracts (customer_id, title, start_date, end_date)
  values ('a7e1c0de-0027-4b2c-9d3e-4f5a6b7c8d01', 'x', current_date, current_date - 1);
  insert into _t values ('end before start refused', false, null);
exception when others then insert into _t values ('end before start refused', sqlerrm = 'INVALID_CONTRACT_DATES', sqlerrm); end $$;
do $$ begin
  insert into public.contracts (customer_id, title, start_date) values ('a7e1c0de-0027-4b2c-9d3e-4f5a6b7c8d0b', 'x', current_date);
  insert into _t values ('customer from another tenant refused', false, null);
exception when others then insert into _t values ('customer from another tenant refused', sqlerrm like 'CROSS_TENANT_REFERENCE%', sqlerrm); end $$;
do $$ begin
  update public.contracts set status = 'expired' where id = (select id from _ids where k = 'c1');
  insert into _t values ('draft cannot expire', false, null);
exception when others then insert into _t values ('draft cannot expire', sqlerrm = 'ILLEGAL_CONTRACT_TRANSITION', sqlerrm); end $$;
do $$ begin
  update public.contracts set renewed_to = (select id from _ids where k = 'c1') where id = (select id from _ids where k = 'c1');
  insert into _t values ('renewal link not client-writable', false, null);
exception when others then insert into _t values ('renewal link not client-writable', sqlstate = '42501', sqlerrm); end $$;

-- Vehicles
insert into public.contract_vehicles (contract_id, vehicle_id, rate_override)
values ((select id from _ids where k = 'c1'), '5eed0000-0000-4000-8000-00000000e001', 150),
       ((select id from _ids where k = 'c1'), '5eed0000-0000-4000-8000-00000000e002', null);
do $$ begin
  insert into public.contract_vehicles (contract_id, vehicle_id) values ((select id from _ids where k = 'c1'), '5eed0000-0000-4000-8000-00000000e001');
  insert into _t values ('vehicle covered once per contract', false, null);
exception when others then insert into _t values ('vehicle covered once per contract', sqlstate = '23505', sqlerrm); end $$;
do $$ begin
  insert into public.contract_vehicles (contract_id, vehicle_id) values ((select id from _ids where k = 'c1'), '5eed0000-0000-4000-8000-00000000e0b1');
  insert into _t values ('vehicle from another tenant refused', false, null);
exception when others then insert into _t values ('vehicle from another tenant refused', sqlerrm like 'CROSS_TENANT_REFERENCE%', sqlerrm); end $$;

-- Activation and billing
do $$ begin
  perform public.contract_bill_period((select id from _ids where k = 'c1'));
  insert into _t values ('draft cannot be billed', false, null);
exception when others then insert into _t values ('draft cannot be billed', sqlerrm = 'CONTRACT_NOT_BILLABLE', sqlerrm); end $$;
update public.contracts set status = 'active' where id = (select id from _ids where k = 'c1');
insert into _t select 'activation sets the first billing date to the start',
  (select activated_at is not null and next_billing_date = start_date from public.contracts where id = (select id from _ids where k = 'c1')), null;
with x as (select public.contract_bill_period((select id from _ids where k = 'c1')) as id) insert into _ids select 'inv1', id from x;
insert into _t select 'billing drafts an invoice with the contract and vehicle lines',
  (select i.status = 'draft' and i.customer_id = 'a7e1c0de-0027-4b2c-9d3e-4f5a6b7c8d01' and i.total = 1207.5
          and i.customer_reference like 'CTR-%'
   from public.invoices i where i.id = (select id from _ids where k = 'inv1'))
  and (select count(*) = 2 from public.invoice_lines where invoice_id = (select id from _ids where k = 'inv1') and tax_rate = 5),
  (select total::text from public.invoices where id = (select id from _ids where k = 'inv1'));
insert into _t select 'billing records the period and advances the next date',
  exists (select 1 from public.contract_invoices ci join public.contracts c on c.id = ci.contract_id
          where ci.invoice_id = (select id from _ids where k = 'inv1') and ci.period_start = c.start_date
            and ci.period_end = (c.start_date + interval '1 month')::date - 1
            and c.next_billing_date = (c.start_date + interval '1 month')::date), null;
create temp table _n (n integer);
grant all on _n to authenticated;
insert into _n select public.contracts_bill_due();
insert into _t select 'bill due catches up the remaining past periods',
  (select n = 2 from _n)
  and (select next_billing_date > current_date from public.contracts where id = (select id from _ids where k = 'c1')),
  (select n::text from _n) || ' / ' || (select next_billing_date::text from public.contracts where id = (select id from _ids where k = 'c1'));
insert into _t select 'nothing more is due',
  public.contracts_bill_due() = 0, null;
do $$ begin
  insert into public.contract_invoices (tenant_id, contract_id, invoice_id, period_start, period_end)
  values ('170d2d86-5c22-4bcb-9d74-420c879419b2', (select id from _ids where k = 'c1'), (select id from _ids where k = 'inv1'), current_date, current_date);
  insert into _t values ('billing records not client-writable', false, null);
exception when others then insert into _t values ('billing records not client-writable', sqlstate = '42501', sqlerrm); end $$;

-- One-time contract
with x as (insert into public.contracts (customer_id, title, start_date, end_date, billing_frequency, recurring_amount)
           values ('a7e1c0de-0027-4b2c-9d3e-4f5a6b7c8d01', 'Installation', current_date, current_date + 30, 'one_time', 500)
           returning id) insert into _ids select 'c2', id from x;
update public.contracts set status = 'active' where id = (select id from _ids where k = 'c2');
select public.contract_bill_period((select id from _ids where k = 'c2'));
insert into _t select 'one-time contract bills its whole term once',
  (select next_billing_date is null from public.contracts where id = (select id from _ids where k = 'c2'))
  and exists (select 1 from public.contract_invoices ci join public.contracts c on c.id = ci.contract_id
              where c.id = (select id from _ids where k = 'c2') and ci.period_end = c.end_date), null;
do $$ begin
  perform public.contract_bill_period((select id from _ids where k = 'c2'));
  insert into _t values ('billed one-time contract has nothing left', false, null);
exception when others then insert into _t values ('billed one-time contract has nothing left', sqlerrm = 'CONTRACT_NOTHING_TO_BILL', sqlerrm); end $$;

-- Termination
do $$ begin
  update public.contracts set status = 'terminated' where id = (select id from _ids where k = 'c2');
  insert into _t values ('termination needs a reason', false, null);
exception when others then insert into _t values ('termination needs a reason', sqlerrm = 'CONTRACT_TERMINATION_REASON_REQUIRED', sqlerrm); end $$;
update public.contracts set status = 'terminated', termination_reason = 'Customer sold the fleet' where id = (select id from _ids where k = 'c2');
do $$ begin
  update public.contracts set title = 'changed' where id = (select id from _ids where k = 'c2');
  insert into _t values ('terminated contract locked', false, null);
exception when others then insert into _t values ('terminated contract locked', sqlerrm = 'CONTRACT_LOCKED', sqlerrm); end $$;
do $$ begin
  delete from public.contracts where id = (select id from _ids where k = 'c2');
  insert into _t values ('only drafts can be deleted', false, null);
exception when others then insert into _t values ('only drafts can be deleted', sqlerrm = 'CONTRACT_NOT_DELETABLE', sqlerrm); end $$;
do $$ begin
  perform public.contract_renew((select id from _ids where k = 'c2'));
  insert into _t values ('terminated contract cannot be renewed', false, null);
exception when others then insert into _t values ('terminated contract cannot be renewed', sqlerrm = 'CONTRACT_NOT_RENEWABLE', sqlerrm); end $$;

-- Renewal
with x as (select public.contract_renew((select id from _ids where k = 'c1'), null, 1100) as id) insert into _ids select 'c1r', id from x;
insert into _t select 'renewal opens the next term with the same vehicles',
  (select status = 'active' and start_date = (select end_date + 1 from public.contracts where id = (select id from _ids where k = 'c1'))
          and recurring_amount = 1100 and renewed_from = (select id from _ids where k = 'c1') and doc_number like 'CTR-%'
   from public.contracts where id = (select id from _ids where k = 'c1r'))
  and (select count(*) = 2 from public.contract_vehicles where contract_id = (select id from _ids where k = 'c1r')), null;
insert into _t select 'renewed contract links forward and locks',
  (select status = 'renewed' and renewed_to = (select id from _ids where k = 'c1r') from public.contracts where id = (select id from _ids where k = 'c1')), null;
do $$ begin
  insert into public.contract_vehicles (contract_id, vehicle_id) values ((select id from _ids where k = 'c1'), '5eed0000-0000-4000-8000-00000000e002');
  insert into _t values ('renewed contract vehicles locked', false, null);
exception when others then insert into _t values ('renewed contract vehicles locked', sqlerrm = 'CONTRACT_LOCKED', sqlerrm); end $$;
reset role;

-- Scanner: one past end without auto-renew, one with, one ending soon.
insert into public.contracts (id, tenant_id, customer_id, title, start_date, end_date, status, recurring_amount, auto_renew, next_billing_date)
values ('a7e1c0de-0027-4b2c-9d3e-4f5a6b7c8e01', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'a7e1c0de-0027-4b2c-9d3e-4f5a6b7c8d01',
        'Old rental', current_date - 400, current_date - 35, 'active', 200, false, current_date + 400),
       ('a7e1c0de-0027-4b2c-9d3e-4f5a6b7c8e02', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'a7e1c0de-0027-4b2c-9d3e-4f5a6b7c8d01',
        'Rolling SLA', current_date - 366, current_date - 2, 'active', 300, true, current_date + 400),
       ('a7e1c0de-0027-4b2c-9d3e-4f5a6b7c8e03', '170d2d86-5c22-4bcb-9d74-420c879419b2', 'a7e1c0de-0027-4b2c-9d3e-4f5a6b7c8d01',
        'Lease ending', current_date - 300, current_date + 5, 'active', 400, false, current_date - 3);
select app.scan_due_contracts('170d2d86-5c22-4bcb-9d74-420c879419b2');
insert into _t select 'contract past its end expires',
  (select status = 'expired' from public.contracts where id = 'a7e1c0de-0027-4b2c-9d3e-4f5a6b7c8e01'), null;
insert into _t select 'auto-renew contract renews itself',
  (select status = 'renewed' and renewed_to is not null from public.contracts where id = 'a7e1c0de-0027-4b2c-9d3e-4f5a6b7c8e02')
  and exists (select 1 from public.contracts where renewed_from = 'a7e1c0de-0027-4b2c-9d3e-4f5a6b7c8e02' and status = 'active'
              and start_date = current_date - 1 and end_date = current_date + 363), null;
insert into _t select 'ending-soon contract notifies managers',
  exists (select 1 from public.notifications where kind = 'contracts.expiring' and entity_id = 'a7e1c0de-0027-4b2c-9d3e-4f5a6b7c8e03'
          and params->>'stage' = 'd7' and severity = 'critical'), null;
insert into _t select 'billing due notifies once',
  exists (select 1 from public.notifications where kind = 'contracts.billing_due' and (params->>'count')::int >= 1), null;
create temp table _c as select count(*) as n from public.notifications where kind like 'contracts.%';
select app.scan_due_contracts('170d2d86-5c22-4bcb-9d74-420c879419b2');
insert into _t select 'scanning again is deduplicated',
  (select count(*) from public.notifications where kind like 'contracts.%') = (select n from _c), null;

-- Late renewal of the expired one
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"129bbbae-fdfc-4d21-8a86-8949fec2403b","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"owner"}}', true);
select public.contract_renew('a7e1c0de-0027-4b2c-9d3e-4f5a6b7c8e01', current_date + 365);
insert into _t select 'expired contract can be renewed late',
  (select status = 'renewed' from public.contracts where id = 'a7e1c0de-0027-4b2c-9d3e-4f5a6b7c8e01')
  and exists (select 1 from public.contracts where renewed_from = 'a7e1c0de-0027-4b2c-9d3e-4f5a6b7c8e01' and end_date = current_date + 365), null;
reset role;

-- Viewer
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"5eed0000-0000-4000-8000-00000000a003","role":"authenticated","app_metadata":{"tenant_id":"170d2d86-5c22-4bcb-9d74-420c879419b2","role":"viewer"}}', true);
insert into _t select 'viewer reads contracts and billing',
  (select count(*) > 0 from public.contracts) and (select count(*) > 0 from public.contract_invoices)
  and (select count(*) > 0 from public.contract_vehicles), null;
do $$ begin
  insert into public.contracts (customer_id, title, start_date) values ('a7e1c0de-0027-4b2c-9d3e-4f5a6b7c8d01', 'v', current_date);
  insert into _t values ('viewer cannot add contracts', false, null);
exception when others then insert into _t values ('viewer cannot add contracts', sqlstate = '42501', sqlerrm); end $$;
do $$ begin
  perform public.contracts_bill_due();
  insert into _t values ('viewer cannot bill', false, null);
exception when others then insert into _t values ('viewer cannot bill', sqlerrm = 'FORBIDDEN' or sqlstate = '42501', sqlerrm); end $$;
reset role;

-- Other tenant
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"5eed0000-0000-4000-8000-00000000b001","role":"authenticated","app_metadata":{"tenant_id":"5eed0000-0000-4000-8000-0000000000b1","role":"owner"}}', true);
insert into _t select 'cross-tenant isolation',
  (select count(*) = 0 from public.contracts) and (select count(*) = 0 from public.contract_invoices)
  and (select count(*) = 0 from public.contract_vehicles), null;
reset role;

-- @print
select name, ok, detail from _t order by ok, name;
rollback;
